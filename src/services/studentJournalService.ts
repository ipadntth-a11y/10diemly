import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';
import type {
  Exam,
  StudentAttemptTypeStat,
  StudentJournal,
  StudentJournalEntry,
  StudentReviewSummary,
  Submission,
} from '../types';
import { getSubmissionScore10 } from '../utils/classStats';
import { analyzeSubmissionEffort } from '../utils/effortAnalysis';

const LOCAL_JOURNAL_STORAGE_KEY = 'diem10_student_journal_v1';
const MAX_LOCAL_ENTRIES = 120;
const MAX_FIRESTORE_ENTRIES = 60;

function sanitizeIdPart(raw: string | undefined | null): string {
  return (raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');
}

function normalizeCodeAscii(raw: string | undefined | null): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40);
}

function timestampToMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof ts === 'object') {
    const rec = ts as { toMillis?: () => number; seconds?: number };
    if (typeof rec.toMillis === 'function') {
      try {
        return rec.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof rec.seconds === 'number') {
      return rec.seconds * 1000;
    }
  }
  return 0;
}

export function resolveStudentKey(params: {
  studentCode?: string;
  studentUid?: string;
  studentName?: string;
  className?: string;
}): string {
  const code = normalizeCodeAscii(params.studentCode);
  if (code.length > 0) {
    return `code_${code}`.slice(0, 90);
  }
  const uid = sanitizeIdPart(params.studentUid);
  if (uid && uid !== 'guest') {
    return uid.slice(0, 90);
  }
  const clsPart = normalizeCodeAscii(params.className || 'LOP').slice(0, 20) || 'LOP';
  const namePart = normalizeCodeAscii(params.studentName || 'HOCSINH').slice(0, 40) || 'HOCSINH';
  return `name_${clsPart}_${namePart}`.slice(0, 90);
}

export function buildJournalDocId(teacherId: string, studentKey: string): string {
  const cleanTeacher = sanitizeIdPart(teacherId).slice(0, 48);
  const cleanKey = sanitizeIdPart(studentKey).slice(0, 75);
  return `${cleanTeacher}_${cleanKey}`.slice(0, 128);
}

export function buildStudentJournalEntry(
  submission: Submission,
  exam?: Exam,
  aiReview?: StudentReviewSummary
): StudentJournalEntry {
  const effort = analyzeSubmissionEffort(submission, exam);
  const submittedMs =
    timestampToMs(submission.submittedAt) || Date.now();

  const buckets: Array<{
    key: StudentAttemptTypeStat['type'];
    label: string;
  }> = [
    { key: 'mcq', label: 'Trắc nghiệm' },
    { key: 'true_false', label: 'Đúng / Sai' },
    { key: 'short_answer', label: 'Trả lời ngắn' },
    { key: 'essay', label: 'Tự luận' },
  ];

  const typeStats = buckets
    .map((b): StudentAttemptTypeStat | null => {
      const items = submission.answers.filter((a) => a.type === b.key);
      if (items.length === 0) return null;
      const earned = Number(
        items.reduce((s, a) => s + Number(a.score || 0), 0).toFixed(2)
      );
      const max = Number(
        items.reduce((s, a) => s + Number(a.maxScore || 0), 0).toFixed(2)
      );
      return {
        type: b.key,
        label: b.label,
        count: items.length,
        earned,
        max,
      };
    })
    .filter((x): x is StudentAttemptTypeStat => x !== null);

  const normCode = normalizeCodeAscii(submission.studentCode);

  return {
    submissionId: submission.id,
    examId: submission.examId,
    examCode: exam?.examCode || '',
    examTitle: submission.examTitle,
    subject: exam?.subject || 'Tổng hợp',
    teacherId: submission.teacherId,
    studentUid: submission.studentUid,
    ...(normCode ? { studentCode: normCode } : {}),
    studentName: submission.studentName,
    className: submission.className,
    totalScore: Number(Number(submission.totalScore || 0).toFixed(2)),
    maxScore: Number(Number(submission.maxScore || 10).toFixed(2)),
    score10: Number(getSubmissionScore10(submission).toFixed(2)),
    durationSeconds: Math.max(0, Math.round(submission.durationSeconds || 0)),
    violationCount: Math.max(0, Math.round(submission.violationCount || 0)),
    status: submission.status,
    effortLevel: effort.level,
    effortRiskScore: effort.riskScore,
    effortReasons: effort.reasons.slice(0, 4),
    typeStats,
    teacherComment: (submission.teacherComment || '').slice(0, 600),
    submittedAtIso: new Date(submittedMs).toISOString(),
    ...(aiReview ? { aiReview } : {}),
  };
}

interface LocalJournalBucket {
  studentKey: string;
  entries: StudentJournalEntry[];
}

function readLocalBuckets(): Record<string, LocalJournalBucket> {
  try {
    const raw = window.localStorage.getItem(LOCAL_JOURNAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LocalJournalBucket>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalBuckets(buckets: Record<string, LocalJournalBucket>): void {
  try {
    window.localStorage.setItem(LOCAL_JOURNAL_STORAGE_KEY, JSON.stringify(buckets));
  } catch {
    // Ignore storage quota errors safely
  }
}

export function upsertLocalJournalEntry(entry: StudentJournalEntry): void {
  const key = resolveStudentKey({
    studentCode: entry.studentCode,
    studentUid: entry.studentUid,
    studentName: entry.studentName,
    className: entry.className,
  });
  const buckets = readLocalBuckets();
  const existing = buckets[key]?.entries || [];
  const idx = existing.findIndex((e) => e.submissionId === entry.submissionId);
  let nextEntries: StudentJournalEntry[];
  if (idx >= 0) {
    nextEntries = existing.map((e, i) =>
      i === idx
        ? {
            ...entry,
            aiReview: entry.aiReview || e.aiReview,
          }
        : e
    );
  } else {
    nextEntries = [entry, ...existing];
  }
  nextEntries.sort(
    (a, b) => Date.parse(b.submittedAtIso) - Date.parse(a.submittedAtIso)
  );
  buckets[key] = {
    studentKey: key,
    entries: nextEntries.slice(0, MAX_LOCAL_ENTRIES),
  };
  writeLocalBuckets(buckets);
}

export function attachAiReviewToLocalJournalEntry(
  submissionId: string,
  identity: {
    studentCode?: string;
    studentUid?: string;
    studentName?: string;
    className?: string;
  },
  aiReview: StudentReviewSummary
): void {
  const key = resolveStudentKey(identity);
  const buckets = readLocalBuckets();
  const targetBucket = buckets[key];
  if (targetBucket) {
    targetBucket.entries = targetBucket.entries.map((e) =>
      e.submissionId === submissionId ? { ...e, aiReview } : e
    );
    writeLocalBuckets(buckets);
    return;
  }

  // Scan all buckets if key shifted slightly (e.g. local_preview)
  let updated = false;
  Object.values(buckets).forEach((bucket) => {
    bucket.entries = bucket.entries.map((e) => {
      if (e.submissionId === submissionId) {
        updated = true;
        return { ...e, aiReview };
      }
      return e;
    });
  });
  if (updated) {
    writeLocalBuckets(buckets);
  }
}

export function loadLocalJournalEntriesForStudent(identity: {
  studentCode?: string;
  studentUid?: string;
  studentName?: string;
  className?: string;
}): StudentJournalEntry[] {
  const buckets = readLocalBuckets();
  const primaryKey = resolveStudentKey(identity);
  const normCode = normalizeCodeAscii(identity.studentCode);
  const normName = (identity.studentName || '').trim().toLowerCase();
  const normClass = (identity.className || '').trim().toLowerCase();
  const normUid = sanitizeIdPart(identity.studentUid);

  const collected = new Map<string, StudentJournalEntry>();

  const primary = buckets[primaryKey]?.entries || [];
  primary.forEach((e) => collected.set(e.submissionId, e));

  Object.values(buckets).forEach((bucket) => {
    bucket.entries.forEach((e) => {
      const matchCode = Boolean(normCode && normalizeCodeAscii(e.studentCode) === normCode);
      const matchUid = Boolean(normUid && normUid !== 'guest' && sanitizeIdPart(e.studentUid) === normUid);
      const matchNameClass = Boolean(
        normName &&
          e.studentName.trim().toLowerCase() === normName &&
          (!normClass || e.className.trim().toLowerCase() === normClass)
      );
      if (matchCode || matchUid || matchNameClass) {
        if (!collected.has(e.submissionId)) {
          collected.set(e.submissionId, e);
        }
      }
    });
  });

  return Array.from(collected.values()).sort(
    (a, b) => Date.parse(b.submittedAtIso) - Date.parse(a.submittedAtIso)
  );
}

export async function listSubmissionsForSignedInStudent(
  uid: string
): Promise<Submission[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'submissions'), where('studentUid', '==', uid))
    );
    return snap.docs.map((d) => d.data() as Submission);
  } catch (err) {
    console.warn('Could not query signed-in student submissions:', err);
    return [];
  }
}

export async function fetchStudentJournalDoc(
  teacherId: string,
  studentKey: string
): Promise<StudentJournal | null> {
  if (!teacherId || !studentKey || teacherId === 'sample_teacher') return null;
  const journalId = buildJournalDocId(teacherId, studentKey);
  try {
    const snap = await getDoc(doc(db, 'studentJournals', journalId));
    if (!snap.exists()) return null;
    return snap.data() as StudentJournal;
  } catch {
    return null;
  }
}

export async function loadStudentLearningHistory(params: {
  user: User | null;
  teacherIds: string[];
  examsById: Map<string, Exam>;
  studentCode?: string;
  studentUid?: string;
  studentName?: string;
  className?: string;
}): Promise<StudentJournalEntry[]> {
  const localEntries = loadLocalJournalEntriesForStudent({
    studentCode: params.studentCode,
    studentUid: params.studentUid || params.user?.uid,
    studentName: params.studentName,
    className: params.className,
  });

  const localReviewMap = new Map<string, StudentReviewSummary>();
  localEntries.forEach((e) => {
    if (e.aiReview) {
      localReviewMap.set(e.submissionId, e.aiReview);
    }
  });

  const mergedMap = new Map<string, StudentJournalEntry>();
  localEntries.forEach((e) => mergedMap.set(e.submissionId, e));

  // 1. If user is authenticated via Google, pull live submissions directly
  if (params.user?.uid) {
    const remoteSubs = await listSubmissionsForSignedInStudent(params.user.uid);
    remoteSubs.forEach((sub) => {
      const entry = buildStudentJournalEntry(
        sub,
        params.examsById.get(sub.examId),
        localReviewMap.get(sub.id)
      );
      mergedMap.set(sub.id, entry);
    });
  }

  // 2. Pull teacher-synced non-PII StudentJournal snapshots across candidate teachers
  const uniqueTeachers = Array.from(
    new Set(params.teacherIds.filter((t) => Boolean(t) && t !== 'sample_teacher'))
  );
  const candidateKeys = Array.from(
    new Set(
      [
        resolveStudentKey({
          studentCode: params.studentCode,
          studentUid: params.studentUid || params.user?.uid,
          studentName: params.studentName,
          className: params.className,
        }),
        params.studentUid ? sanitizeIdPart(params.studentUid) : '',
        params.user?.uid ? sanitizeIdPart(params.user.uid) : '',
      ].filter((k) => Boolean(k) && k !== 'guest')
    )
  );

  const cloudSnapshots: StudentJournal[] = [];
  await Promise.all(
    uniqueTeachers.flatMap((tId) =>
      candidateKeys.map(async (sKey) => {
        const journal = await fetchStudentJournalDoc(tId, sKey);
        if (journal) {
          cloudSnapshots.push(journal);
        }
      })
    )
  );

  // Track which teachers already have a newer synced journal so deleted submissions stay gone
  const cloudUpdatedByTeacher = new Map<string, number>();
  const cloudIdsByTeacher = new Map<string, Set<string>>();

  cloudSnapshots.forEach((journal) => {
    const updatedMs = timestampToMs(journal.updatedAt);
    const prevMs = cloudUpdatedByTeacher.get(journal.teacherId) || 0;
    if (updatedMs > prevMs) {
      cloudUpdatedByTeacher.set(journal.teacherId, updatedMs);
    }
    const idSet = cloudIdsByTeacher.get(journal.teacherId) || new Set<string>();
    (journal.entries || []).forEach((cloudEntry) => {
      idSet.add(cloudEntry.submissionId);
      const localAi = localReviewMap.get(cloudEntry.submissionId);
      mergedMap.set(cloudEntry.submissionId, {
        ...cloudEntry,
        ...(localAi ? { aiReview: localAi } : {}),
      });
    });
    cloudIdsByTeacher.set(journal.teacherId, idSet);
  });

  // Prune stale local Firestore-backed entries that teacher explicitly deleted
  for (const [subId, entry] of Array.from(mergedMap.entries())) {
    if (subId === 'local_preview') continue;
    const syncedAtMs = cloudUpdatedByTeacher.get(entry.teacherId) || 0;
    const submittedMs = Date.parse(entry.submittedAtIso) || 0;
    const cloudIds = cloudIdsByTeacher.get(entry.teacherId);
    if (
      syncedAtMs > 0 &&
      submittedMs > 0 &&
      syncedAtMs - submittedMs > 15_000 &&
      cloudIds &&
      !cloudIds.has(subId)
    ) {
      mergedMap.delete(subId);
    }
  }

  return Array.from(mergedMap.values()).sort(
    (a, b) => Date.parse(b.submittedAtIso) - Date.parse(a.submittedAtIso)
  );
}

// ---------------- Teacher-side Firestore Journal Sync ----------------

let lastSyncDigestByTeacher = new Map<string, string>();

function stripUndefinedEntries(entry: StudentJournalEntry): StudentJournalEntry {
  return {
    submissionId: entry.submissionId,
    examId: entry.examId,
    examCode: (entry.examCode || '').slice(0, 30),
    examTitle: (entry.examTitle || '').slice(0, 200),
    subject: (entry.subject || 'Tổng hợp').slice(0, 80),
    teacherId: entry.teacherId,
    studentUid: entry.studentUid,
    ...(entry.studentCode ? { studentCode: entry.studentCode } : {}),
    studentName: (entry.studentName || 'Học sinh').slice(0, 120),
    className: (entry.className || '').slice(0, 80),
    totalScore: Number(Number(entry.totalScore || 0).toFixed(2)),
    maxScore: Number(Number(entry.maxScore || 10).toFixed(2)),
    score10: Number(Number(entry.score10 || 0).toFixed(2)),
    durationSeconds: Math.max(0, Math.round(entry.durationSeconds || 0)),
    violationCount: Math.max(0, Math.round(entry.violationCount || 0)),
    status: entry.status,
    effortLevel: entry.effortLevel,
    effortRiskScore: Math.max(0, Math.min(100, Math.round(entry.effortRiskScore || 0))),
    effortReasons: (entry.effortReasons || []).slice(0, 4).map((r) => r.slice(0, 200)),
    typeStats: (entry.typeStats || []).slice(0, 4),
    teacherComment: (entry.teacherComment || '').slice(0, 600),
    submittedAtIso: entry.submittedAtIso,
  };
}

export async function syncStudentJournalsForTeacher(
  teacherId: string,
  submissions: Submission[],
  exams: Exam[],
  options?: { force?: boolean }
): Promise<void> {
  if (!teacherId || teacherId === 'sample_teacher') return;

  const examMap = new Map<string, Exam>();
  exams.forEach((e) => examMap.set(e.id, e));

  const grouped = new Map<
    string,
    {
      studentKey: string;
      studentName: string;
      className: string;
      studentCode?: string;
      entries: StudentJournalEntry[];
    }
  >();

  submissions.forEach((sub) => {
    const sKey = resolveStudentKey({
      studentCode: sub.studentCode,
      studentUid: sub.studentUid,
      studentName: sub.studentName,
      className: sub.className,
    });
    const entry = stripUndefinedEntries(
      buildStudentJournalEntry(sub, examMap.get(sub.examId))
    );
    const existing = grouped.get(sKey);
    if (existing) {
      existing.entries.push(entry);
      if (sub.studentCode && !existing.studentCode) {
        existing.studentCode = normalizeCodeAscii(sub.studentCode);
      }
      if (sub.studentName && !existing.studentName) {
        existing.studentName = sub.studentName;
      }
    } else {
      const code = normalizeCodeAscii(sub.studentCode);
      grouped.set(sKey, {
        studentKey: sKey,
        studentName: (sub.studentName || 'Học sinh').slice(0, 120),
        className: (sub.className || '').slice(0, 80),
        ...(code ? { studentCode: code } : {}),
        entries: [entry],
      });
    }
  });

  const digest = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, g]) => {
      const subParts = g.entries
        .map(
          (e) =>
            `${e.submissionId}:${e.totalScore}:${e.status}:${e.teacherComment.length}:${e.effortLevel}`
        )
        .sort()
        .join(',');
      return `${key}=[${subParts}]`;
    })
    .join('|');

  if (!options?.force && lastSyncDigestByTeacher.get(teacherId) === digest) {
    return;
  }
  lastSyncDigestByTeacher.set(teacherId, digest);

  try {
    const existingSnap = await getDocs(
      query(collection(db, 'studentJournals'), where('teacherId', '==', teacherId))
    );
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));
    const existingMap = new Map<string, StudentJournal>();
    existingSnap.docs.forEach((d) => existingMap.set(d.id, d.data() as StudentJournal));

    const targetIds = new Set<string>();
    const ops: Array<() => Promise<void>> = [];

    grouped.forEach((group) => {
      const journalId = buildJournalDocId(teacherId, group.studentKey);
      targetIds.add(journalId);
      const sortedEntries = [...group.entries]
        .sort((a, b) => Date.parse(b.submittedAtIso) - Date.parse(a.submittedAtIso))
        .slice(0, MAX_FIRESTORE_ENTRIES);

      const prev = existingMap.get(journalId);
      const prevHash = prev
        ? JSON.stringify({
            studentName: prev.studentName,
            className: prev.className,
            studentCode: prev.studentCode || '',
            entries: prev.entries.map((e) => ({
              id: e.submissionId,
              score: e.totalScore,
              status: e.status,
              comment: e.teacherComment,
              effort: e.effortLevel,
            })),
          })
        : '';
      const nextHash = JSON.stringify({
        studentName: group.studentName,
        className: group.className,
        studentCode: group.studentCode || '',
        entries: sortedEntries.map((e) => ({
          id: e.submissionId,
          score: e.totalScore,
          status: e.status,
          comment: e.teacherComment,
          effort: e.effortLevel,
        })),
      });

      if (prevHash === nextHash) return;

      ops.push(async () => {
        const ref = doc(db, 'studentJournals', journalId);
        if (existingIds.has(journalId)) {
          await updateDoc(ref, {
            studentName: group.studentName,
            className: group.className,
            ...(group.studentCode ? { studentCode: group.studentCode } : {}),
            entries: sortedEntries,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(ref, {
            id: journalId,
            teacherId,
            studentKey: group.studentKey,
            studentName: group.studentName,
            className: group.className,
            ...(group.studentCode ? { studentCode: group.studentCode } : {}),
            entries: sortedEntries,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
    });

    // Clean up journals whose submissions were all deleted
    const toDeleteIds = Array.from(existingIds).filter((id) => !targetIds.has(id));
    if (toDeleteIds.length > 0) {
      for (let i = 0; i < toDeleteIds.length; i += 400) {
        const batch = writeBatch(db);
        toDeleteIds.slice(i, i + 400).forEach((id) => {
          batch.delete(doc(db, 'studentJournals', id));
        });
        await batch.commit();
      }
    }

    if (ops.length > 0) {
      await Promise.all(ops.map((fn) => fn()));
    }
  } catch (err) {
    console.warn('Could not sync studentJournals to Firestore:', err);
  }
}
