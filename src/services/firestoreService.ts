import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { PHYSICS_12_QUESTIONS, SEED_CLASSES, SEED_SUBMISSIONS } from '../data/seedData';
import type {
  ClassRoster,
  ClassRosterEntry,
  Classroom,
  EssayCriterionResult,
  Exam,
  ExamQuestion,
  HandwrittenCheck,
  HomeworkSession,
  HomeworkStatus,
  ParentMessage,
  StudentAnswer,
  StudentRecord,
  Submission,
  UserProfile,
} from '../types';
import { recompressDataUrlToBudget } from '../utils/imageUtils';
import { syncStudentJournalsForTeacher } from './studentJournalService';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function clampStr(val: string | undefined | null, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

function stripVietnameseAccents(val: string): string {
  return val
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function safeCode(val: string | undefined | null, fallback: string, max: number): string {
  const ascii = stripVietnameseAccents(val ?? '');
  const cleaned = ascii.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
  if (cleaned.length >= 3) return cleaned;
  const fb = stripVietnameseAccents(fallback).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
  return fb.length >= 3 ? fb : `${fb}CLS`.slice(0, Math.max(3, max));
}

export function extractFriendlyFirestoreError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    const inner = String(parsed?.error || raw);
    if (inner.includes('permission-denied') || inner.includes('Missing or insufficient permissions')) {
      return 'Tài khoản chưa đủ quyền ghi dữ liệu hoặc phiên đăng nhập vừa hết hạn. Vui lòng thử tải lại trang hoặc đăng nhập lại.';
    }
    if (inner.includes('unavailable') || inner.includes('offline')) {
      return 'Mất kết nối tới máy chủ Firestore. Vui lòng kiểm tra mạng và thử lại.';
    }
    return inner;
  } catch {
    return raw;
  }
}

export function normalizeStudentCode(val: string | undefined | null): string {
  return stripVietnameseAccents(val ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40);
}

export function normalizeJoinCode(val: string | undefined | null): string {
  return stripVietnameseAccents(val ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 20);
}

export function normalizeExamCode(val: string | undefined | null): string {
  return stripVietnameseAccents(val ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 30);
}

function buildStudentCodeDocId(teacherId: string, normalizedCode: string): string {
  return `${teacherId}_${normalizedCode}`;
}

function buildClassRosterEntries(students: StudentRecord[]): ClassRosterEntry[] {
  return [...students]
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
    .slice(0, 200)
    .map((s) => ({
      id: s.id,
      fullName: clampStr(s.fullName, 120) || 'Học sinh',
      studentCode: normalizeStudentCode(s.studentCode),
    }));
}

async function syncSingleClassRoster(
  cls: Classroom,
  students: StudentRecord[]
): Promise<void> {
  const joinCode = normalizeJoinCode(cls.joinCode);
  if (joinCode.length < 3) return;
  const rosterRef = doc(db, 'classRosters', joinCode);
  const studentEntries = buildClassRosterEntries(students);
  try {
    const existingSnap = await getDoc(rosterRef);
    if (existingSnap.exists()) {
      await updateDoc(rosterRef, {
        className: clampStr(cls.name, 100) || 'Lớp',
        subject: clampStr(cls.subject, 80) || 'Vật lí',
        studentEntries,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(rosterRef, {
        id: joinCode,
        teacherId: cls.teacherId,
        classId: cls.id,
        className: clampStr(cls.name, 100) || 'Lớp',
        subject: clampStr(cls.subject, 80) || 'Vật lí',
        joinCode,
        studentEntries,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn(`Could not sync classRoster ${joinCode}:`, err);
  }
}

async function syncClassRosterByClassId(classId: string, teacherId: string): Promise<void> {
  try {
    const clsSnap = await getDoc(doc(db, 'classes', classId));
    if (!clsSnap.exists()) return;
    const cls = clsSnap.data() as Classroom;
    const stuSnap = await getDocs(
      query(collection(db, 'classes', classId, 'students'), where('teacherId', '==', teacherId))
    );
    const students = stuSnap.docs.map((d) => d.data() as StudentRecord);
    await syncSingleClassRoster(cls, students);
  } catch (err) {
    console.warn(`Could not sync classRoster for class ${classId}:`, err);
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const userPath = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }
}

export async function ensureStudentProfile(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const existing = await getUserProfile(user.uid);
  if (existing) {
    return existing;
  }

  const newProfile: UserProfile = {
    uid: user.uid,
    email: clampStr(user.email || 'hocsinh@diem10.edu.vn', 200),
    displayName: clampStr(user.displayName || user.email?.split('@')[0] || 'Học sinh', 120),
    role: 'student',
    seeded: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(userRef, newProfile);
    return newProfile;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, userPath);
  }
}

export async function ensureTeacherProfileAndSeed(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);

  let profile = await getUserProfile(user.uid);

  if (!profile) {
    const newProfile: UserProfile = {
      uid: user.uid,
      email: clampStr(user.email || 'giaovien@diem10.edu.vn', 200),
      displayName: clampStr(user.displayName || user.email?.split('@')[0] || 'Giáo viên', 120),
      role: 'teacher',
      seeded: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(userRef, newProfile);
      profile = { ...newProfile, seeded: false };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }
  } else if (profile.role !== 'teacher') {
    try {
      await updateDoc(userRef, {
        role: 'teacher',
        updatedAt: serverTimestamp(),
      });
      profile.role = 'teacher';
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }
  }

  // Always verify that the teacher has classroom data when logging into teacher portal
  let hasClasses = false;
  try {
    const clsSnap = await getDocs(
      query(collection(db, 'classes'), where('teacherId', '==', user.uid))
    );
    hasClasses = !clsSnap.empty;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'classes');
  }

  if (!profile.seeded || !hasClasses) {
    await seedDemoDataForTeacher(user.uid);
    if (!profile.seeded) {
      try {
        await updateDoc(userRef, {
          seeded: true,
          updatedAt: serverTimestamp(),
        });
        profile.seeded = true;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, userPath);
      }
    }
  } else {
    await ensureStudentCodesSynced(user.uid);
  }

  return profile;
}

export async function ensureStudentCodesSynced(teacherId: string): Promise<void> {
  try {
    const existingCodesSnap = await getDocs(
      query(collection(db, 'studentCodes'), where('teacherId', '==', teacherId))
    );
    const existingIds = new Set(existingCodesSnap.docs.map((d) => d.id));

    const classesSnap = await getDocs(
      query(collection(db, 'classes'), where('teacherId', '==', teacherId))
    );
    if (classesSnap.empty) return;

    const batch = writeBatch(db);
    let writes = 0;

    for (const clsDoc of classesSnap.docs) {
      const cls = clsDoc.data() as Classroom;
      const stuSnap = await getDocs(
        query(collection(db, 'classes', cls.id, 'students'), where('teacherId', '==', teacherId))
      );
      const classStudents = stuSnap.docs.map((d) => d.data() as StudentRecord);
      classStudents.forEach((stu) => {
        const code = normalizeStudentCode(stu.studentCode);
        if (!code) return;
        const docId = buildStudentCodeDocId(teacherId, code);
        if (!existingIds.has(docId)) {
          existingIds.add(docId);
          batch.set(doc(db, 'studentCodes', docId), {
            id: docId,
            teacherId,
            classId: cls.id,
            className: clampStr(cls.name, 100) || 'Lớp',
            studentCode: code,
            studentName: clampStr(stu.fullName, 120) || 'Học sinh',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          writes++;
        }
      });
      await syncSingleClassRoster(cls, classStudents);
    }

    if (writes > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.warn('Could not sync studentCodes index:', err);
  }
}

export async function seedDemoDataForTeacher(teacherId: string): Promise<void> {
  const batch = writeBatch(db);
  const uidPrefix = teacherId.slice(0, 8).replace(/[^a-zA-Z0-9_-]/g, '');
  let batch1Writes = 0;

  // Check existing classes/exams so we only create missing seed docs (preserving existing createdAt rules)
  const existingClassIds = new Set<string>();
  try {
    const clsSnap = await getDocs(
      query(collection(db, 'classes'), where('teacherId', '==', teacherId))
    );
    clsSnap.docs.forEach((d) => existingClassIds.add(d.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'classes');
  }

  const seededClassIds: string[] = [];
  for (const clsTemplate of SEED_CLASSES) {
    const classId = `${clsTemplate.idSuffix}_${uidPrefix}`;
    if (!existingClassIds.has(classId)) {
      const classRef = doc(db, 'classes', classId);
      batch.set(classRef, {
        id: classId,
        teacherId,
        name: clsTemplate.name,
        subject: clsTemplate.subject,
        grade: clsTemplate.grade,
        academicYear: clsTemplate.academicYear,
        joinCode: `${clsTemplate.joinCode}_${uidPrefix.slice(0, 4).toUpperCase()}`,
        studentCount: clsTemplate.students.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch1Writes++;
      seededClassIds.push(classId);
    }
  }

  const examId = `exam_vl12_hk1_${uidPrefix}`;
  const examTitle = 'Đề ôn số 1 — Vật lí 12 (HK1)';
  const examRef = doc(db, 'exams', examId);
  let examExists = false;
  try {
    const examSnap = await getDoc(examRef);
    examExists = examSnap.exists();
  } catch {
    examExists = false;
  }

  if (!examExists) {
    batch.set(examRef, {
      id: examId,
      teacherId,
      title: examTitle,
      subject: 'Vật lí',
      examCode: `VL12HK1_${uidPrefix.slice(0, 4).toUpperCase()}`,
      durationMinutes: 50,
      isPublished: true,
      questionCount: PHYSICS_12_QUESTIONS.length,
      questions: PHYSICS_12_QUESTIONS,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch1Writes++;
  }

  if (batch1Writes > 0) {
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'seed/classes_and_exam');
    }
  }

  // Query existing studentCodes & submissions/messages so we never overwrite immutable createdAt/submittedAt
  const existingCodeIds = new Set<string>();
  try {
    const codesSnap = await getDocs(
      query(collection(db, 'studentCodes'), where('teacherId', '==', teacherId))
    );
    codesSnap.docs.forEach((d) => existingCodeIds.add(d.id));
  } catch {
    // Fallback safely
  }

  // Write subcollection students & submissions in a second batch (after parent docs exist)
  const batch2 = writeBatch(db);
  let batch2Writes = 0;

  for (const clsTemplate of SEED_CLASSES) {
    const classId = `${clsTemplate.idSuffix}_${uidPrefix}`;
    if (!seededClassIds.includes(classId)) continue;
    clsTemplate.students.forEach((stu, idx) => {
      const stuId = `stu_${clsTemplate.idSuffix}_${idx + 1}_${uidPrefix}`;
      const stuRef = doc(db, 'classes', classId, 'students', stuId);
      batch2.set(stuRef, {
        id: stuId,
        classId,
        teacherId,
        fullName: stu.fullName,
        studentCode: stu.studentCode,
        parentPhone: stu.parentPhone,
        parentName: stu.parentName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch2Writes++;

      const normCode = normalizeStudentCode(stu.studentCode);
      if (normCode) {
        const codeDocId = buildStudentCodeDocId(teacherId, normCode);
        const codeRef = doc(db, 'studentCodes', codeDocId);
        if (existingCodeIds.has(codeDocId)) {
          batch2.update(codeRef, {
            classId,
            className: clsTemplate.name,
            studentName: stu.fullName,
            updatedAt: serverTimestamp(),
          });
        } else {
          existingCodeIds.add(codeDocId);
          batch2.set(codeRef, {
            id: codeDocId,
            teacherId,
            classId,
            className: clsTemplate.name,
            studentCode: normCode,
            studentName: stu.fullName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        batch2Writes++;
      }
    });
  }

  if (!examExists) {
    for (const sub of SEED_SUBMISSIONS) {
      const subId = `${sub.idSuffix}_${uidPrefix}`;
      const subRef = doc(db, 'submissions', subId);
      let subExists = false;
      try {
        subExists = (await getDoc(subRef)).exists();
      } catch {
        subExists = false;
      }
      if (subExists) continue;

      const totalScore = Number(
        sub.answers.reduce((sum, a) => sum + a.score, 0).toFixed(2)
      );
      batch2.set(subRef, {
        id: subId,
        examId,
        examTitle,
        teacherId,
        studentUid: teacherId,
        studentName: sub.studentName,
        className: sub.className,
        durationSeconds: sub.durationSeconds,
        violationCount: sub.violationCount,
        status: 'graded',
        totalScore,
        maxScore: 10,
        teacherComment: sub.teacherComment,
        aiAnalysis: '',
        parentPhone: sub.parentPhone,
        answers: sub.answers,
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch2Writes++;
    }

    const sampleMsgId = `msg_thu_${uidPrefix}`;
    const msgRef = doc(db, 'parentMessages', sampleMsgId);
    let msgExists = false;
    try {
      msgExists = (await getDoc(msgRef)).exists();
    } catch {
      msgExists = false;
    }
    if (!msgExists) {
      batch2.set(msgRef, {
        id: sampleMsgId,
        teacherId,
        submissionId: `sub_thu_${uidPrefix}`,
        studentName: 'Ngô Thị Minh Thư',
        className: '12A1',
        examTitle,
        parentPhone: '0908123456',
        content: `Kính gửi phụ huynh em Ngô Thị Minh Thư,\nKết quả bài "${examTitle}" của em đạt 7/10 điểm. Em nắm chắc phần nhiệt học, cần chú ý thêm bài tập đổi đơn vị phần từ trường.\nTrân trọng.`,
        status: 'sent',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch2Writes++;
    }
  }

  if (batch2Writes > 0) {
    try {
      await batch2.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'seed/students_and_submissions');
    }
  }

  for (const clsTemplate of SEED_CLASSES) {
    const classId = `${clsTemplate.idSuffix}_${uidPrefix}`;
    await syncClassRosterByClassId(classId, teacherId);
  }
}

export function subscribeTeacherWorkspace(
  teacherId: string,
  onClasses: (items: Classroom[]) => void,
  onExams: (items: Exam[]) => void,
  onSubmissions: (items: Submission[]) => void,
  onMessages: (items: ParentMessage[]) => void
): () => void {
  let latestExams: Exam[] = [];
  let latestSubs: Submission[] = [];
  let examsReady = false;
  let subsReady = false;
  let journalSyncTimer: number | null = null;

  const scheduleJournalSync = () => {
    if (!examsReady || !subsReady) return;
    if (journalSyncTimer !== null) {
      window.clearTimeout(journalSyncTimer);
    }
    journalSyncTimer = window.setTimeout(() => {
      void syncStudentJournalsForTeacher(teacherId, latestSubs, latestExams);
    }, 600);
  };

  const unsubClasses = onSnapshot(
    query(collection(db, 'classes'), where('teacherId', '==', teacherId)),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as Classroom);
      rows.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      onClasses(rows);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'classes')
  );

  const unsubExams = onSnapshot(
    query(collection(db, 'exams'), where('teacherId', '==', teacherId)),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as Exam);
      latestExams = rows;
      examsReady = true;
      onExams(rows);
      scheduleJournalSync();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'exams')
  );

  const unsubSubs = onSnapshot(
    query(collection(db, 'submissions'), where('teacherId', '==', teacherId)),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as Submission);
      latestSubs = rows;
      subsReady = true;
      onSubmissions(rows);
      scheduleJournalSync();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'submissions')
  );

  const unsubMsgs = onSnapshot(
    query(collection(db, 'parentMessages'), where('teacherId', '==', teacherId)),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as ParentMessage);
      onMessages(rows);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'parentMessages')
  );

  return () => {
    if (journalSyncTimer !== null) {
      window.clearTimeout(journalSyncTimer);
    }
    unsubClasses();
    unsubExams();
    unsubSubs();
    unsubMsgs();
  };
}

export function subscribeClassStudents(
  classId: string,
  teacherId: string,
  onStudents: (items: StudentRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = `classes/${classId}/students`;
  return onSnapshot(
    query(collection(db, 'classes', classId, 'students'), where('teacherId', '==', teacherId)),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as StudentRecord);
      rows.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
      onStudents(rows);
    },
    (err) => {
      console.warn(`Firestore listener warning on ${path}:`, err);
      onError?.(err);
    }
  );
}

export async function createClassroom(
  teacherId: string,
  input: {
    name: string;
    subject: string;
    grade: string;
    academicYear: string;
    joinCode?: string;
  }
): Promise<string> {
  if (!teacherId) {
    throw new Error('Không xác định được tài khoản giáo viên.');
  }
  const id = makeSafeId('cls');
  let joinCode = '';
  if (input.joinCode && input.joinCode.trim().length > 0) {
    const normalized = normalizeJoinCode(input.joinCode);
    if (normalized.length < 3 || normalized.length > 20 || !/^[A-Z0-9_-]{3,20}$/.test(normalized)) {
      throw new Error(
        'Mã lớp phải dài từ 3 đến 20 ký tự, chỉ gồm chữ cái không dấu, số, dấu gạch dưới (_) hoặc gạch ngang (-).'
      );
    }
    try {
      const existingRoster = await getDoc(doc(db, 'classRosters', normalized));
      if (existingRoster.exists()) {
        throw new Error(`Mã lớp "${normalized}" đã tồn tại. Vui lòng chọn mã lớp khác.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('đã tồn tại')) {
        throw err;
      }
    }
    joinCode = normalized;
  } else {
    const randSuffix = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');
    const namePrefix = stripVietnameseAccents(input.name)
      .replace(/\s+/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .toUpperCase()
      .slice(0, 14);
    const rawJoin = namePrefix ? `${namePrefix}_${randSuffix}` : `CLS_${randSuffix}`;
    joinCode = safeCode(rawJoin, `CLS_${randSuffix}`, 20);
  }

  const path = `classes/${id}`;
  const newClass: Classroom = {
    id,
    teacherId,
    name: clampStr(input.name, 100) || 'Lớp mới',
    subject: clampStr(input.subject, 80) || 'Vật lí',
    grade: clampStr(input.grade, 30),
    academicYear: clampStr(input.academicYear, 30) || '2025–2026',
    joinCode,
    studentCount: 0,
  };
  try {
    await setDoc(doc(db, 'classes', id), {
      ...newClass,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await syncSingleClassRoster(newClass, []);
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateClassroom(
  classId: string,
  teacherId: string,
  patch: {
    name?: string;
    subject?: string;
    grade?: string;
    academicYear?: string;
    joinCode?: string;
  }
): Promise<void> {
  const path = `classes/${classId}`;
  const clsSnap = await getDoc(doc(db, 'classes', classId));
  if (!clsSnap.exists()) {
    throw new Error('Không tìm thấy lớp học cần chỉnh sửa.');
  }
  const existingCls = clsSnap.data() as Classroom;
  if (existingCls.teacherId !== teacherId) {
    throw new Error('Bạn không có quyền chỉnh sửa lớp học này.');
  }

  const oldJoinCode = normalizeJoinCode(existingCls.joinCode);
  let nextJoinCode = oldJoinCode;
  if (patch.joinCode !== undefined) {
    nextJoinCode = normalizeJoinCode(patch.joinCode);
    if (
      nextJoinCode.length < 3 ||
      nextJoinCode.length > 20 ||
      !/^[A-Z0-9_-]{3,20}$/.test(nextJoinCode)
    ) {
      throw new Error(
        'Mã lớp phải dài từ 3 đến 20 ký tự, chỉ gồm chữ cái không dấu, số, dấu gạch dưới (_) hoặc gạch ngang (-).'
      );
    }
    if (nextJoinCode !== oldJoinCode) {
      try {
        const collisionSnap = await getDoc(doc(db, 'classRosters', nextJoinCode));
        if (collisionSnap.exists()) {
          const collisionData = collisionSnap.data() as ClassRoster;
          if (collisionData.classId !== classId) {
            throw new Error(
              `Mã lớp "${nextJoinCode}" đang được dùng cho lớp ${collisionData.className || 'khác'}. Vui lòng chọn mã lớp khác.`
            );
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('đang được dùng')) {
          throw err;
        }
      }
    }
  }

  const nextName =
    patch.name !== undefined
      ? clampStr(patch.name, 100) || existingCls.name
      : existingCls.name;
  const nextSubject =
    patch.subject !== undefined
      ? clampStr(patch.subject, 80) || existingCls.subject
      : existingCls.subject;
  const nextGrade =
    patch.grade !== undefined ? clampStr(patch.grade, 30) : existingCls.grade;
  const nextAcademicYear =
    patch.academicYear !== undefined
      ? clampStr(patch.academicYear, 30) || existingCls.academicYear
      : existingCls.academicYear;

  try {
    await updateDoc(doc(db, 'classes', classId), {
      name: nextName,
      subject: nextSubject,
      grade: nextGrade,
      academicYear: nextAcademicYear,
      joinCode: nextJoinCode,
      updatedAt: serverTimestamp(),
    });

    const updatedCls: Classroom = {
      ...existingCls,
      name: nextName,
      subject: nextSubject,
      grade: nextGrade,
      academicYear: nextAcademicYear,
      joinCode: nextJoinCode,
    };

    const stuSnap = await getDocs(
      query(collection(db, 'classes', classId, 'students'), where('teacherId', '==', teacherId))
    );
    const students = stuSnap.docs.map((d) => d.data() as StudentRecord);

    if (nextJoinCode !== oldJoinCode) {
      await syncSingleClassRoster(updatedCls, students);
      if (oldJoinCode.length >= 3) {
        try {
          await deleteDoc(doc(db, 'classRosters', oldJoinCode));
        } catch {
          // Ignore if old roster did not exist
        }
      }
    } else {
      await syncSingleClassRoster(updatedCls, students);
    }

    if (nextName !== existingCls.name) {
      try {
        const codesSnap = await getDocs(
          query(
            collection(db, 'studentCodes'),
            where('teacherId', '==', teacherId),
            where('classId', '==', classId)
          )
        );
        if (!codesSnap.empty) {
          const codeBatch = writeBatch(db);
          codesSnap.docs.forEach((d) => {
            codeBatch.update(d.ref, {
              className: nextName,
              updatedAt: serverTimestamp(),
            });
          });
          await codeBatch.commit();
        }
      } catch (syncErr) {
        console.warn('Could not update className in studentCodes:', syncErr);
      }

      try {
        const examsSnap = await getDocs(
          query(collection(db, 'exams'), where('teacherId', '==', teacherId))
        );
        const affectedExams = examsSnap.docs.filter((d) => {
          const ex = d.data() as Exam;
          return Array.isArray(ex.assignedClassIds) && ex.assignedClassIds.includes(classId);
        });
        if (affectedExams.length > 0) {
          const clsSnapAll = await getDocs(
            query(collection(db, 'classes'), where('teacherId', '==', teacherId))
          );
          const classNameById = new Map<string, string>(
            clsSnapAll.docs.map((d) => [d.id, (d.data() as Classroom).name])
          );
          classNameById.set(classId, nextName);
          const examBatch = writeBatch(db);
          affectedExams.forEach((d) => {
            const ex = d.data() as Exam;
            const ids = ex.assignedClassIds || [];
            examBatch.update(d.ref, {
              assignedClassNames: ids.map((id) => clampStr(classNameById.get(id) || id, 100)),
              updatedAt: serverTimestamp(),
            });
          });
          await examBatch.commit();
        }
      } catch (examSyncErr) {
        console.warn('Could not update assignedClassNames in exams:', examSyncErr);
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteClassroom(classId: string, teacherId?: string): Promise<void> {
  const path = `classes/${classId}`;
  try {
    let joinCodeToDelete = '';
    try {
      const clsSnap = await getDoc(doc(db, 'classes', classId));
      if (clsSnap.exists()) {
        joinCodeToDelete = normalizeJoinCode((clsSnap.data() as Classroom).joinCode);
      }
    } catch {
      // Ignore pre-read issues
    }

    if (teacherId) {
      try {
        const stuSnap = await getDocs(
          query(collection(db, 'classes', classId, 'students'), where('teacherId', '==', teacherId))
        );
        if (!stuSnap.empty) {
          const cleanupBatch = writeBatch(db);
          stuSnap.docs.forEach((d) => {
            cleanupBatch.delete(d.ref);
            const stu = d.data() as StudentRecord;
            const normCode = normalizeStudentCode(stu.studentCode);
            if (normCode) {
              cleanupBatch.delete(doc(db, 'studentCodes', buildStudentCodeDocId(teacherId, normCode)));
            }
          });
          await cleanupBatch.commit();
        }
      } catch (cleanupErr) {
        console.warn('Could not clean up student docs while deleting class:', cleanupErr);
      }
    }
    await deleteDoc(doc(db, 'classes', classId));
    if (joinCodeToDelete.length >= 3) {
      try {
        await deleteDoc(doc(db, 'classRosters', joinCodeToDelete));
      } catch {
        // Ignore if roster doc wasn't created yet
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function addStudentsToClass(
  classId: string,
  teacherId: string,
  currentCount: number,
  students: { fullName: string; studentCode?: string; parentPhone?: string; parentName?: string }[],
  className = ''
): Promise<void> {
  const valid = students.filter((s) => s.fullName.trim().length > 0);
  if (valid.length === 0) return;

  let resolvedClassName = className;
  if (!resolvedClassName) {
    try {
      const clsSnap = await getDoc(doc(db, 'classes', classId));
      if (clsSnap.exists()) {
        resolvedClassName = (clsSnap.data() as Classroom).name;
      }
    } catch {
      resolvedClassName = 'Lớp';
    }
  }

  // Check existing studentCodes so existing index docs are updated (preserving createdAt)
  const existingCodeIds = new Set<string>();
  try {
    const existingCodesSnap = await getDocs(
      query(collection(db, 'studentCodes'), where('teacherId', '==', teacherId))
    );
    existingCodesSnap.docs.forEach((d) => existingCodeIds.add(d.id));
  } catch {
    // Proceed even if list fails
  }

  const batch = writeBatch(db);
  const writtenInThisBatch = new Set<string>();

  valid.slice(0, 200).forEach((stu) => {
    const id = makeSafeId('stu');
    const normCode = normalizeStudentCode(stu.studentCode);
    const ref = doc(db, 'classes', classId, 'students', id);
    batch.set(ref, {
      id,
      classId,
      teacherId,
      fullName: clampStr(stu.fullName, 120),
      studentCode: normCode || clampStr(stu.studentCode || '', 40),
      parentPhone: clampStr(stu.parentPhone || '', 30),
      parentName: clampStr(stu.parentName || '', 120),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (normCode) {
      const codeDocId = buildStudentCodeDocId(teacherId, normCode);
      if (!writtenInThisBatch.has(codeDocId)) {
        writtenInThisBatch.add(codeDocId);
        const codeRef = doc(db, 'studentCodes', codeDocId);
        if (existingCodeIds.has(codeDocId)) {
          batch.update(codeRef, {
            classId,
            className: clampStr(resolvedClassName, 100) || 'Lớp',
            studentName: clampStr(stu.fullName, 120),
            updatedAt: serverTimestamp(),
          });
        } else {
          existingCodeIds.add(codeDocId);
          batch.set(codeRef, {
            id: codeDocId,
            teacherId,
            classId,
            className: clampStr(resolvedClassName, 100) || 'Lớp',
            studentCode: normCode,
            studentName: clampStr(stu.fullName, 120),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  });

  batch.update(doc(db, 'classes', classId), {
    studentCount: Math.min(1000, currentCount + valid.slice(0, 200).length),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await syncClassRosterByClassId(classId, teacherId);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `classes/${classId}/students`);
  }
}

export async function updateStudentRecord(
  classId: string,
  studentId: string,
  patch: { fullName: string; studentCode: string; parentPhone: string; parentName: string },
  meta?: { teacherId?: string; className?: string; previousCode?: string }
): Promise<void> {
  const path = `classes/${classId}/students/${studentId}`;
  const normCode = normalizeStudentCode(patch.studentCode);
  try {
    await updateDoc(doc(db, 'classes', classId, 'students', studentId), {
      fullName: clampStr(patch.fullName, 120),
      studentCode: normCode || clampStr(patch.studentCode, 40),
      parentPhone: clampStr(patch.parentPhone, 30),
      parentName: clampStr(patch.parentName, 120),
      updatedAt: serverTimestamp(),
    });

    if (meta?.teacherId) {
      const prevNorm = normalizeStudentCode(meta.previousCode);
      if (prevNorm && prevNorm !== normCode) {
        try {
          await deleteDoc(doc(db, 'studentCodes', buildStudentCodeDocId(meta.teacherId, prevNorm)));
        } catch {
          // Ignore missing old code doc
        }
      }
      if (normCode) {
        const codeDocId = buildStudentCodeDocId(meta.teacherId, normCode);
        const existingCodeSnap = await getDoc(doc(db, 'studentCodes', codeDocId));
        if (existingCodeSnap.exists()) {
          await updateDoc(doc(db, 'studentCodes', codeDocId), {
            classId,
            className: clampStr(meta.className || 'Lớp', 100),
            studentName: clampStr(patch.fullName, 120),
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(doc(db, 'studentCodes', codeDocId), {
            id: codeDocId,
            teacherId: meta.teacherId,
            classId,
            className: clampStr(meta.className || 'Lớp', 100),
            studentCode: normCode,
            studentName: clampStr(patch.fullName, 120),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await syncClassRosterByClassId(classId, meta.teacherId);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteStudentRecord(
  classId: string,
  studentId: string,
  currentCount: number,
  meta?: { teacherId?: string; studentCode?: string }
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'classes', classId, 'students', studentId));
  batch.update(doc(db, 'classes', classId), {
    studentCount: Math.max(0, currentCount - 1),
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
    const normCode = normalizeStudentCode(meta?.studentCode);
    if (meta?.teacherId && normCode) {
      try {
        await deleteDoc(doc(db, 'studentCodes', buildStudentCodeDocId(meta.teacherId, normCode)));
      } catch {
        // Ignore if index doc doesn't exist
      }
    }
    if (meta?.teacherId) {
      await syncClassRosterByClassId(classId, meta.teacherId);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `classes/${classId}/students/${studentId}`);
  }
}

function sanitizeExamQuestions(rawQuestions: ExamQuestion[]): ExamQuestion[] {
  const usedIds = new Set<string>();
  return rawQuestions.slice(0, 100).map((q, idx) => {
    let candidateId = (q.id || `q${idx + 1}`).trim() || `q${idx + 1}`;
    if (usedIds.has(candidateId)) {
      candidateId = makeSafeId('q');
    }
    usedIds.add(candidateId);

    const clean: ExamQuestion = {
      id: candidateId,
      index: idx + 1,
      type:
        q.type === 'true_false' ||
        q.type === 'short_answer' ||
        q.type === 'essay'
          ? q.type
          : 'mcq',
      prompt: clampStr(q.prompt || `Câu ${idx + 1}`, 4000),
      maxScore: Math.max(0.1, Number(q.maxScore || 0.25)),
      explanation: clampStr(q.explanation || '', 4000),
    };
    if (Array.isArray(q.imageUrls) && q.imageUrls.length > 0) {
      clean.imageUrls = q.imageUrls
        .filter((u) => typeof u === 'string' && u.length > 0)
        .slice(0, 5);
    }
    if (Array.isArray(q.explanationImageUrls) && q.explanationImageUrls.length > 0) {
      clean.explanationImageUrls = q.explanationImageUrls
        .filter((u) => typeof u === 'string' && u.length > 0)
        .slice(0, 4);
    }
    if (clean.type === 'mcq') {
      clean.options =
        Array.isArray(q.options) && q.options.length > 0
          ? q.options.slice(0, 4).map((o) => String(o ?? ''))
          : ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'];
      clean.correctOption =
        typeof q.correctOption === 'number' && q.correctOption >= 0 && q.correctOption < 4
          ? q.correctOption
          : 0;
    } else if (clean.type === 'true_false') {
      clean.statements =
        Array.isArray(q.statements) && q.statements.length > 0
          ? q.statements.slice(0, 4).map((s) => ({
              text: String(s?.text ?? ''),
              isTrue: Boolean(s?.isTrue),
            }))
          : [];
    } else {
      clean.correctAnswer = clampStr(q.correctAnswer || '', 2000);
    }
    return clean;
  });
}

export async function createExam(
  teacherId: string,
  input: {
    title: string;
    subject: string;
    examCode?: string;
    durationMinutes: number;
    isPublished: boolean;
    questions: ExamQuestion[];
    assignedClassIds?: string[];
    assignedClassNames?: string[];
  }
): Promise<string> {
  const id = makeSafeId('exam');
  let examCode = '';
  if (input.examCode && input.examCode.trim().length > 0) {
    const normalized = normalizeExamCode(input.examCode);
    if (
      normalized.length < 3 ||
      normalized.length > 30 ||
      !/^[A-Z0-9_-]{3,30}$/.test(normalized)
    ) {
      throw new Error(
        'Mã đề phải dài từ 3 đến 30 ký tự, chỉ gồm chữ cái không dấu, số, dấu gạch dưới (_) hoặc gạch ngang (-).'
      );
    }
    examCode = normalized;
  } else {
    examCode = safeCode(
      `D10_${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      'D10_EXAM',
      30
    );
  }

  const questions = sanitizeExamQuestions(input.questions);
  const cleanClassIds = Array.from(
    new Set((input.assignedClassIds || []).map((v) => clampStr(v, 128)).filter(Boolean))
  ).slice(0, 100);
  const cleanClassNames = (input.assignedClassNames || [])
    .map((v) => clampStr(v, 100))
    .filter(Boolean)
    .slice(0, 100);

  try {
    await setDoc(doc(db, 'exams', id), {
      id,
      teacherId,
      title: clampStr(input.title, 200) || 'Đề kiểm tra mới',
      subject: clampStr(input.subject, 80) || 'Vật lí',
      examCode,
      durationMinutes: Math.min(Math.max(Math.round(input.durationMinutes || 45), 1), 300),
      isPublished: Boolean(input.isPublished),
      questionCount: questions.length,
      questions,
      assignedClassIds: cleanClassIds,
      assignedClassNames: cleanClassNames,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `exams/${id}`);
  }
}

export async function updateExam(
  examId: string,
  patch: {
    title?: string;
    subject?: string;
    examCode?: string;
    durationMinutes?: number;
    questions?: ExamQuestion[];
    assignedClassIds?: string[];
    assignedClassNames?: string[];
  }
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (patch.questions !== undefined) {
    const questions = sanitizeExamQuestions(patch.questions);
    if (questions.length === 0) {
      throw new Error('Đề thi phải có ít nhất 1 câu hỏi.');
    }
    updatePayload.questions = questions;
    updatePayload.questionCount = questions.length;
  }

  if (patch.title !== undefined) {
    updatePayload.title = clampStr(patch.title, 200) || 'Đề kiểm tra';
  }
  if (patch.subject !== undefined) {
    updatePayload.subject = clampStr(patch.subject, 80) || 'Vật lí';
  }
  if (patch.examCode !== undefined) {
    const normalizedCode = normalizeExamCode(patch.examCode);
    if (
      normalizedCode.length < 3 ||
      normalizedCode.length > 30 ||
      !/^[A-Z0-9_-]{3,30}$/.test(normalizedCode)
    ) {
      throw new Error(
        'Mã đề phải dài từ 3 đến 30 ký tự, chỉ gồm chữ cái không dấu, số, dấu gạch dưới (_) hoặc gạch ngang (-).'
      );
    }
    updatePayload.examCode = normalizedCode;
  }
  if (patch.durationMinutes !== undefined) {
    updatePayload.durationMinutes = Math.min(
      Math.max(Math.round(patch.durationMinutes || 45), 1),
      300
    );
  }
  if (patch.assignedClassIds !== undefined) {
    const cleanIds = Array.from(
      new Set(patch.assignedClassIds.map((v) => clampStr(v, 128)).filter(Boolean))
    ).slice(0, 100);
    updatePayload.assignedClassIds = cleanIds;
    updatePayload.assignedClassNames = (patch.assignedClassNames || [])
      .map((v) => clampStr(v, 100))
      .filter(Boolean)
      .slice(0, 100);
  }

  try {
    await updateDoc(doc(db, 'exams', examId), updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `exams/${examId}`);
  }
}

export function normalizeShortNumeric(val: string): string {
  const cleaned = val
    .trim()
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, '')
    .replace(/(v|j|kj|l|lít|n|t|wb|k|°c|m|cm|mm|kg|g|s|hz|a|ω|ohm|w|kw|pa|atm)$/i, '');
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
    const num = Number(cleaned);
    return Number.isFinite(num) ? String(num) : cleaned;
  }
  return cleaned;
}

export async function regradeExamSubmissions(
  submissionsToRegrade: Submission[],
  updatedQuestions: ExamQuestion[]
): Promise<number> {
  const cleanQuestions = sanitizeExamQuestions(updatedQuestions);
  const qMap = new Map<string, ExamQuestion>(cleanQuestions.map((q) => [q.id, q]));
  let updatedCount = 0;

  for (const sub of submissionsToRegrade) {
    const nextAnswers: StudentAnswer[] = [];
    for (const ans of sub.answers) {
      const q = qMap.get(ans.questionId);
      if (!q) continue;

      if (q.type === 'mcq') {
        const picked = ans.selectedOption ?? null;
        const isRight = picked !== null && picked === q.correctOption;
        nextAnswers.push({
          ...ans,
          type: 'mcq',
          maxScore: q.maxScore,
          score: isRight ? q.maxScore : 0,
          isCorrect: isRight,
        });
      } else if (q.type === 'true_false') {
        const picks = ans.statementAnswers || [null, null, null, null];
        const statements = q.statements || [];
        let rightCount = 0;
        statements.forEach((st, idx) => {
          if (picks[idx] === st.isTrue) rightCount++;
        });
        const ratio =
          rightCount === 4
            ? 1
            : rightCount === 3
              ? 0.5
              : rightCount === 2
                ? 0.25
                : rightCount === 1
                  ? 0.1
                  : 0;
        const score = Number((q.maxScore * ratio).toFixed(2));
        nextAnswers.push({
          ...ans,
          type: 'true_false',
          maxScore: q.maxScore,
          score,
          isCorrect: statements.length > 0 && rightCount === statements.length,
        });
      } else if (q.type === 'short_answer') {
        const hasLongAiReview =
          Boolean(ans.aiFeedback) &&
          ((ans.textAnswer || '').trim().length > 25 || Boolean(ans.imageDataUrl));
        if (hasLongAiReview) {
          const cappedScore = Number(Math.min(ans.score || 0, q.maxScore).toFixed(2));
          nextAnswers.push({
            ...ans,
            type: 'short_answer',
            maxScore: q.maxScore,
            score: cappedScore,
            isCorrect: q.maxScore > 0 && cappedScore >= q.maxScore,
          });
        } else {
          const normStudent = normalizeShortNumeric(ans.textAnswer || '');
          const normKey = normalizeShortNumeric(q.correctAnswer || '');
          const isExact =
            normKey.length > 0 && normStudent.length > 0 && normStudent === normKey;
          nextAnswers.push({
            ...ans,
            type: 'short_answer',
            maxScore: q.maxScore,
            score: isExact ? q.maxScore : 0,
            isCorrect: isExact,
          });
        }
      } else {
        const cappedScore = Number(Math.min(ans.score || 0, q.maxScore).toFixed(2));
        nextAnswers.push({
          ...ans,
          type: 'essay',
          maxScore: q.maxScore,
          score: cappedScore,
          isCorrect: q.maxScore > 0 && cappedScore >= q.maxScore,
        });
      }
    }

    const totalScore = Number(
      Math.min(
        100,
        Math.max(
          0,
          nextAnswers.reduce((acc, a) => acc + Number(a.score || 0), 0)
        )
      ).toFixed(2)
    );

    const fittedAnswers = await fitSubmissionAnswersToBudget(nextAnswers);
    try {
      await updateDoc(doc(db, 'submissions', sub.id), {
        totalScore,
        answers: fittedAnswers,
        updatedAt: serverTimestamp(),
      });
      updatedCount++;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `submissions/${sub.id}`);
    }
  }

  return updatedCount;
}

export async function toggleExamPublish(examId: string, isPublished: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'exams', examId), {
      isPublished,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `exams/${examId}`);
  }
}

export async function deleteExam(examId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'exams', examId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `exams/${examId}`);
  }
}

export async function lookupStudentByCode(
  rawCode: string,
  candidateTeacherIds: string[]
): Promise<{
  studentCode: string;
  studentName: string;
  classId?: string;
  className: string;
  teacherId: string;
} | null> {
  const code = normalizeStudentCode(rawCode);
  if (!code) return null;

  const uniqueTeachers = Array.from(
    new Set(candidateTeacherIds.filter((id) => id && id !== 'sample_teacher'))
  );

  for (const teacherId of uniqueTeachers) {
    try {
      const snap = await getDoc(
        doc(db, 'studentCodes', buildStudentCodeDocId(teacherId, code))
      );
      if (snap.exists()) {
        const data = snap.data() as {
          studentCode: string;
          studentName: string;
          classId?: string;
          className: string;
          teacherId: string;
        };
        return {
          studentCode: data.studentCode,
          studentName: data.studentName,
          classId: data.classId,
          className: data.className,
          teacherId: data.teacherId,
        };
      }
    } catch {
      // Ignore permission or network miss for a single teacher candidate
    }
  }

  // Fallback to built-in sample roster (HS1201..HS1209)
  for (const cls of SEED_CLASSES) {
    const hit = cls.students.find(
      (s) => normalizeStudentCode(s.studentCode) === code
    );
    if (hit) {
      return {
        studentCode: normalizeStudentCode(hit.studentCode),
        studentName: hit.fullName,
        classId: cls.idSuffix,
        className: cls.name,
        teacherId: 'sample_teacher',
      };
    }
  }

  return null;
}

export async function lookupClassRosterByJoinCode(
  rawJoinCode: string
): Promise<ClassRoster | null> {
  const code = normalizeJoinCode(rawJoinCode);
  if (code.length < 3) return null;

  try {
    const snap = await getDoc(doc(db, 'classRosters', code));
    if (snap.exists()) {
      const data = snap.data() as ClassRoster;
      return {
        ...data,
        studentEntries: Array.isArray(data.studentEntries)
          ? [...data.studentEntries].sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
          : [],
      };
    }
  } catch {
    // Fallback below for built-in sample classes
  }

  const sampleHit = SEED_CLASSES.find(
    (c) => normalizeJoinCode(c.joinCode) === code
  );
  if (sampleHit) {
    return {
      id: sampleHit.joinCode,
      teacherId: 'sample_teacher',
      classId: sampleHit.idSuffix,
      className: sampleHit.name,
      subject: sampleHit.subject,
      joinCode: sampleHit.joinCode,
      studentEntries: [...sampleHit.students]
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
        .map((s, idx) => ({
          id: `sample_${sampleHit.idSuffix}_${idx + 1}`,
          fullName: s.fullName,
          studentCode: normalizeStudentCode(s.studentCode),
        })),
    };
  }

  return null;
}

export async function listPublishedExams(): Promise<Exam[]> {
  try {
    const snap = await getDocs(query(collection(db, 'exams'), where('isPublished', '==', true)));
    return snap.docs.map((d) => d.data() as Exam);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'exams');
  }
}

async function fitSubmissionAnswersToBudget(
  rawAnswers: StudentAnswer[]
): Promise<StudentAnswer[]> {
  const sliced = rawAnswers.slice(0, 100);
  const imgIndices = sliced
    .map((a, idx) => (a.imageDataUrl ? idx : -1))
    .filter((idx) => idx >= 0);

  const TOTAL_IMAGE_CHAR_BUDGET = 680000;
  const currentTotalChars = imgIndices.reduce(
    (sum, idx) => sum + (sliced[idx].imageDataUrl?.length || 0),
    0
  );

  const perImageBudget =
    currentTotalChars > TOTAL_IMAGE_CHAR_BUDGET
      ? Math.max(45000, Math.floor(TOTAL_IMAGE_CHAR_BUDGET / Math.max(1, imgIndices.length)))
      : 220000;

  return Promise.all(
    sliced.map(async (a) => {
      let nextImage = a.imageDataUrl;
      if (nextImage && nextImage.length > perImageBudget) {
        nextImage = await recompressDataUrlToBudget(nextImage, perImageBudget);
      }

      const cleaned: StudentAnswer = {
        ...a,
        ...(a.textAnswer !== undefined ? { textAnswer: a.textAnswer.slice(0, 6000) } : {}),
        ...(a.recognizedText !== undefined
          ? { recognizedText: a.recognizedText.slice(0, 4000) }
          : {}),
        ...(a.aiFeedback !== undefined ? { aiFeedback: a.aiFeedback.slice(0, 2000) } : {}),
      };
      if (nextImage && nextImage.length <= 240000) {
        cleaned.imageDataUrl = nextImage;
      } else {
        delete cleaned.imageDataUrl;
      }
      return cleaned;
    })
  );
}

export async function submitStudentExam(input: {
  exam: Exam;
  studentUid: string;
  studentCode?: string;
  classJoinCode?: string;
  studentName: string;
  className: string;
  durationSeconds: number;
  violationCount: number;
  answers: StudentAnswer[];
}): Promise<Submission> {
  const id = makeSafeId('sub');
  const maxScore = Number(
    input.exam.questions.reduce((acc, q) => acc + q.maxScore, 0).toFixed(2)
  );
  const totalScore = Number(
    input.answers.reduce((acc, a) => acc + a.score, 0).toFixed(2)
  );
  const sanitizedAnswers = await fitSubmissionAnswersToBudget(input.answers);
  const hasUngradedLongText = sanitizedAnswers.some(
    (a) =>
      ((a.type === 'essay' &&
        ((a.textAnswer ?? '').trim().length > 0 || Boolean(a.imageDataUrl))) ||
        (a.type === 'short_answer' &&
          ((a.textAnswer ?? '').trim().length > 25 || Boolean(a.imageDataUrl)))) &&
      a.score === 0 &&
      !a.aiFeedback
  );

  const normCode = normalizeStudentCode(input.studentCode);
  const normJoinCode = normalizeJoinCode(input.classJoinCode);

  const resolvedUid =
    normCode && input.studentUid.startsWith('code_')
      ? `code_${normCode}`
      : input.studentUid;

  const payload = {
    id,
    examId: input.exam.id,
    examTitle: clampStr(input.exam.title, 200),
    teacherId: input.exam.teacherId,
    studentUid: resolvedUid,
    ...(normCode ? { studentCode: normCode } : {}),
    ...(normJoinCode.length >= 3 ? { classJoinCode: normJoinCode } : {}),
    studentName: clampStr(input.studentName, 120) || 'Học sinh',
    className: clampStr(input.className, 80),
    durationSeconds: Math.max(0, Math.round(input.durationSeconds)),
    violationCount: Math.max(0, Math.round(input.violationCount)),
    status: hasUngradedLongText ? ('pending_essay' as const) : ('graded' as const),
    totalScore,
    maxScore: maxScore > 0 ? maxScore : 10,
    teacherComment: '',
    aiAnalysis: '',
    parentPhone: '',
    answers: sanitizedAnswers,
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'submissions', id), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `submissions/${id}`);
  }
}

export async function updateSubmissionGrading(
  submissionId: string,
  patch: {
    totalScore: number;
    teacherComment: string;
    aiAnalysis: string;
    status: 'graded' | 'pending_essay';
    answers: StudentAnswer[];
    parentPhone: string;
  }
): Promise<void> {
  const path = `submissions/${submissionId}`;
  try {
    const fittedAnswers = await fitSubmissionAnswersToBudget(patch.answers);
    await updateDoc(doc(db, 'submissions', submissionId), {
      totalScore: Number(Math.max(0, Math.min(100, patch.totalScore)).toFixed(2)),
      teacherComment: clampStr(patch.teacherComment, 2000),
      aiAnalysis: clampStr(patch.aiAnalysis, 4000),
      status: patch.status,
      answers: fittedAnswers,
      parentPhone: clampStr(patch.parentPhone, 30),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteSubmission(
  submissionId: string,
  teacherId?: string
): Promise<void> {
  const path = `submissions/${submissionId}`;
  try {
    if (teacherId) {
      try {
        const msgSnap = await getDocs(
          query(
            collection(db, 'parentMessages'),
            where('teacherId', '==', teacherId),
            where('submissionId', '==', submissionId)
          )
        );
        if (!msgSnap.empty) {
          const msgBatch = writeBatch(db);
          msgSnap.docs.forEach((d) => msgBatch.delete(d.ref));
          await msgBatch.commit();
        }
      } catch (msgErr) {
        console.warn('Could not clean up parentMessages for deleted submission:', msgErr);
      }
    }
    await deleteDoc(doc(db, 'submissions', submissionId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function deleteSubmissionsBulk(
  submissionIds: string[],
  teacherId?: string
): Promise<number> {
  const uniqueIds = Array.from(new Set(submissionIds.filter(Boolean)));
  if (uniqueIds.length === 0) return 0;

  try {
    if (teacherId) {
      try {
        const msgSnap = await getDocs(
          query(collection(db, 'parentMessages'), where('teacherId', '==', teacherId))
        );
        const targetSet = new Set(uniqueIds);
        const linkedMsgs = msgSnap.docs.filter((d) =>
          targetSet.has(String((d.data() as ParentMessage).submissionId || ''))
        );
        for (let i = 0; i < linkedMsgs.length; i += 400) {
          const batch = writeBatch(db);
          linkedMsgs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (msgErr) {
        console.warn('Could not clean up parentMessages in bulk delete:', msgErr);
      }
    }

    for (let i = 0; i < uniqueIds.length; i += 400) {
      const batch = writeBatch(db);
      uniqueIds.slice(i, i + 400).forEach((id) => {
        batch.delete(doc(db, 'submissions', id));
      });
      await batch.commit();
    }
    return uniqueIds.length;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, 'submissions/bulk');
  }
}

export async function saveParentMessage(input: {
  teacherId: string;
  submissionId: string;
  studentName: string;
  className: string;
  examTitle: string;
  parentPhone: string;
  content: string;
  status: 'draft' | 'sent';
}): Promise<string> {
  const id = makeSafeId('msg');
  try {
    await setDoc(doc(db, 'parentMessages', id), {
      id,
      teacherId: input.teacherId,
      submissionId: clampStr(input.submissionId, 128),
      studentName: clampStr(input.studentName, 120),
      className: clampStr(input.className, 80),
      examTitle: clampStr(input.examTitle, 200),
      parentPhone: clampStr(input.parentPhone, 30),
      content: clampStr(input.content, 2000),
      status: input.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `parentMessages/${id}`);
  }
}

export async function updateParentMessageStatus(
  messageId: string,
  patch: { status?: 'draft' | 'sent'; content?: string; parentPhone?: string }
): Promise<void> {
  const path = `parentMessages/${messageId}`;
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.status) updatePayload.status = patch.status;
  if (patch.content !== undefined) updatePayload.content = clampStr(patch.content, 2000);
  if (patch.parentPhone !== undefined) updatePayload.parentPhone = clampStr(patch.parentPhone, 30);

  try {
    await updateDoc(doc(db, 'parentMessages', messageId), updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteParentMessage(messageId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'parentMessages', messageId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `parentMessages/${messageId}`);
  }
}

export async function upsertParentMessageByRef(input: {
  teacherId: string;
  refId: string;
  studentName: string;
  className: string;
  examTitle: string;
  parentPhone: string;
  content: string;
  existingMessages?: ParentMessage[];
}): Promise<string> {
  const safeRef = input.refId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const hit = input.existingMessages?.find((m) => m.submissionId === safeRef);
  if (hit) {
    await updateParentMessageStatus(hit.id, {
      content: input.content,
      parentPhone: input.parentPhone,
    });
    return hit.id;
  }
  return saveParentMessage({
    teacherId: input.teacherId,
    submissionId: safeRef,
    studentName: input.studentName,
    className: input.className,
    examTitle: input.examTitle,
    parentPhone: input.parentPhone,
    content: input.content,
    status: 'draft',
  });
}

// ==========================================
// Homework Check-in Sessions (STT Grid & Multi-Session Matrix)
// ==========================================

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (typeof (ts as { seconds?: number }).seconds === 'number') {
    return Number((ts as { seconds: number }).seconds) * 1000;
  }
  return 0;
}

export function subscribeHomeworkSessions(
  teacherId: string,
  onSessions: (items: HomeworkSession[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'homeworkSessions';
  return onSnapshot(
    query(collection(db, path), where('teacherId', '==', teacherId)),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as HomeworkSession);
      rows.sort((a, b) => {
        const dateCmp = (b.dateLabel || '').localeCompare(a.dateLabel || '');
        if (dateCmp !== 0) return dateCmp;
        return toMillis(b.createdAt) - toMillis(a.createdAt);
      });
      onSessions(rows);
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function createHomeworkSession(input: {
  teacherId: string;
  classId: string;
  className: string;
  title: string;
  dateLabel: string;
  statuses?: Record<string, HomeworkStatus>;
}): Promise<HomeworkSession> {
  const id = makeSafeId('hw');
  const cleanStatuses: Record<string, HomeworkStatus> = {};
  if (input.statuses) {
    Object.entries(input.statuses)
      .slice(0, 200)
      .forEach(([k, v]) => {
        if (v === 'submitted' || v === 'missing' || v === 'incomplete') {
          cleanStatuses[clampStr(k, 128)] = v;
        }
      });
  }

  const payload = {
    id,
    teacherId: input.teacherId,
    classId: clampStr(input.classId, 128),
    className: clampStr(input.className, 100) || 'Lớp học',
    title: clampStr(input.title, 160) || 'Kiểm tra bài tập',
    dateLabel: clampStr(input.dateLabel, 30) || new Date().toISOString().slice(0, 10),
    statuses: cleanStatuses,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'homeworkSessions', id), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `homeworkSessions/${id}`);
  }
}

export async function updateHomeworkSessionStatuses(
  sessionId: string,
  statuses: Record<string, HomeworkStatus>
): Promise<void> {
  const cleanStatuses: Record<string, HomeworkStatus> = {};
  Object.entries(statuses)
    .slice(0, 200)
    .forEach(([k, v]) => {
      if (k && (v === 'submitted' || v === 'missing' || v === 'incomplete')) {
        cleanStatuses[clampStr(k, 128)] = v;
      }
    });

  try {
    await updateDoc(doc(db, 'homeworkSessions', sessionId), {
      statuses: cleanStatuses,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `homeworkSessions/${sessionId}`);
  }
}

export async function updateHomeworkSessionMeta(
  sessionId: string,
  patch: { title?: string; dateLabel?: string; className?: string }
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.title !== undefined) updatePayload.title = clampStr(patch.title, 160);
  if (patch.dateLabel !== undefined) updatePayload.dateLabel = clampStr(patch.dateLabel, 30);
  if (patch.className !== undefined) updatePayload.className = clampStr(patch.className, 100);

  try {
    await updateDoc(doc(db, 'homeworkSessions', sessionId), updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `homeworkSessions/${sessionId}`);
  }
}

export async function deleteHomeworkSession(sessionId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'homeworkSessions', sessionId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `homeworkSessions/${sessionId}`);
  }
}

// ==========================================
// Handwritten Oral/Quiz AI Checks
// ==========================================

export function subscribeHandwrittenChecks(
  teacherId: string,
  onChecks: (items: HandwrittenCheck[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'handwrittenChecks';
  return onSnapshot(
    query(collection(db, path), where('teacherId', '==', teacherId)),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as HandwrittenCheck);
      rows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onChecks(rows);
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function saveHandwrittenCheck(input: {
  teacherId: string;
  classId?: string;
  className?: string;
  studentId?: string;
  studentName: string;
  studentCode?: string;
  promptText?: string;
  score: number;
  maxScore: number;
  recognizedText: string;
  strengths?: string;
  mistakes?: string;
  teacherComment: string;
  breakdown: EssayCriterionResult[];
}): Promise<HandwrittenCheck> {
  const id = makeSafeId('chk');
  const maxScore = Math.min(Math.max(Number(input.maxScore || 10), 0.25), 100);
  const score = Number(Math.min(Math.max(Number(input.score || 0), 0), maxScore).toFixed(2));
  const cleanBreakdown = (input.breakdown || []).slice(0, 12).map((b) => ({
    criterion: clampStr(b.criterion, 300),
    score: Number(Number(b.score || 0).toFixed(2)),
    maxScore: Number(Number(b.maxScore || 0).toFixed(2)),
    met: Boolean(b.met),
  }));

  const payload = {
    id,
    teacherId: input.teacherId,
    classId: clampStr(input.classId, 128),
    className: clampStr(input.className, 100),
    studentId: clampStr(input.studentId, 128),
    studentName: clampStr(input.studentName, 120) || 'Học sinh',
    studentCode: clampStr(input.studentCode, 40),
    promptText: clampStr(input.promptText, 1000),
    score,
    maxScore,
    recognizedText: clampStr(input.recognizedText, 4000),
    strengths: clampStr(input.strengths, 1000),
    mistakes: clampStr(input.mistakes, 1000),
    teacherComment: clampStr(input.teacherComment, 1000),
    breakdown: cleanBreakdown,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'handwrittenChecks', id), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `handwrittenChecks/${id}`);
  }
}

export async function updateHandwrittenCheck(
  checkId: string,
  patch: { score?: number; teacherComment?: string }
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.score !== undefined) {
    updatePayload.score = Number(Math.min(Math.max(Number(patch.score || 0), 0), 100).toFixed(2));
  }
  if (patch.teacherComment !== undefined) {
    updatePayload.teacherComment = clampStr(patch.teacherComment, 1000);
  }
  try {
    await updateDoc(doc(db, 'handwrittenChecks', checkId), updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `handwrittenChecks/${checkId}`);
  }
}

export async function deleteHandwrittenCheck(checkId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'handwrittenChecks', checkId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `handwrittenChecks/${checkId}`);
  }
}

