import {
  AlertTriangle,
  ArrowLeft,
  BarChart2,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  Flag,
  KeyRound,
  Loader2,
  Maximize2,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { PHYSICS_12_QUESTIONS } from '../data/seedData';
import {
  listPublishedExams,
  lookupClassRosterByJoinCode,
  lookupStudentByCode,
  normalizeJoinCode,
  normalizeShortNumeric,
  normalizeStudentCode,
  submitStudentExam,
  updateSubmissionGrading,
} from '../services/firestoreService';
import {
  generateRemedialPracticeWithAi,
  generateStudentReviewWithAi,
  gradeEssayWithAi,
} from '../services/geminiService';
import {
  fetchActiveReferenceMaterialsForTeacher,
  selectRelevantReferenceContext,
} from '../services/referenceBankService';
import {
  attachAiReviewToLocalJournalEntry,
  buildStudentJournalEntry,
  loadStudentLearningHistory,
  upsertLocalJournalEntry,
} from '../services/studentJournalService';
import type {
  ClassRoster,
  ClassRosterEntry,
  Classroom,
  Exam,
  ExamQuestion,
  ReferenceMaterial,
  StudentAnswer,
  StudentJournalEntry,
  Submission,
} from '../types';
import { getSubmissionScore10 } from '../utils/classStats';
import { analyzeSubmissionEffort } from '../utils/effortAnalysis';
import { formatDurationMMSS, formatScore } from '../utils/formatters';
import { compressExamPhoto } from '../utils/imageUtils';
import {
  containsLatexFormula,
  MathText,
} from './MathText';
import {
  RemedialPracticePanel,
  type RemedialPracticeData,
} from './RemedialPracticePanel';
import { StudentProgressView } from './StudentProgressView';
import {
  isExamAssignedToClass,
  isExamRestrictedToClasses,
  resolveAssignedClassLabels,
} from '../utils/examAssignment';

interface StudentExamViewProps {
  user: User | null;
  initialExamCode?: string;
  initialStudentCode?: string;
  initialClassCode?: string;
  teacherExams?: Exam[];
  teacherClasses?: Classroom[];
  teacherReferenceMaterials?: ReferenceMaterial[];
  isTeacherPreview?: boolean;
  onExit: () => void;
  onSignInRequest: () => Promise<void>;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const TF_LETTERS = ['a', 'b', 'c', 'd'];

function buildFallbackSampleExam(): Exam {
  return {
    id: 'sample_vl12',
    teacherId: 'sample_teacher',
    title: 'Đề ôn số 1 — Vật lí 12 (HK1)',
    subject: 'Vật lí',
    examCode: 'VL12HK1',
    durationMinutes: 50,
    isPublished: true,
    questionCount: PHYSICS_12_QUESTIONS.length,
    questions: PHYSICS_12_QUESTIONS,
  };
}

const VALID_SHORT_CHAR = /^[0-9\-,.]$/;

export function StudentExamView({
  user,
  initialExamCode,
  initialStudentCode,
  initialClassCode,
  teacherExams = [],
  teacherClasses = [],
  teacherReferenceMaterials,
  isTeacherPreview = false,
  onExit,
  onSignInRequest,
}: StudentExamViewProps) {
  const [availableExams, setAvailableExams] = useState<Exam[]>([]);
  const [loadingExams, setLoadingExams] = useState(false);

  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [examCodeInput, setExamCodeInput] = useState(initialExamCode || '');
  const [entryMode, setEntryMode] = useState<'class' | 'code' | 'manual'>(() => {
    if (initialClassCode) return 'class';
    if (initialStudentCode && !user) return 'code';
    return 'class';
  });
  const [classCodeInput, setClassCodeInput] = useState(initialClassCode || '');
  const [lookingUpClass, setLookingUpClass] = useState(false);
  const [loadedRoster, setLoadedRoster] = useState<ClassRoster | null>(null);
  const [classLookupError, setClassLookupError] = useState<string | null>(null);
  const [rosterSearch, setRosterSearch] = useState('');
  const [selectedRosterEntry, setSelectedRosterEntry] = useState<ClassRosterEntry | null>(null);

  const [studentCodeInput, setStudentCodeInput] = useState(initialStudentCode || '');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [verifiedStudent, setVerifiedStudent] = useState<{
    studentCode: string;
    studentName: string;
    classId?: string;
    className: string;
    teacherId: string;
  } | null>(null);
  const [studentCodeError, setStudentCodeError] = useState<string | null>(null);
  const [studentName, setStudentName] = useState(
    isTeacherPreview ? 'Nguyễn Hoàng Minh (Thử nghiệm)' : user?.displayName || ''
  );
  const [className, setClassName] = useState(user ? '12A1' : '');

  // Exam-taking state
  const [phase, setPhase] = useState<'setup' | 'taking' | 'result'>('setup');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(50 * 60);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [violationCount, setViolationCount] = useState(0);
  const [violationBanner, setViolationBanner] = useState(false);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  const [mcqSelections, setMcqSelections] = useState<Record<string, number>>({});
  const [tfSelections, setTfSelections] = useState<Record<string, (boolean | null)[]>>({});
  const [shortBoxes, setShortBoxes] = useState<
    Record<string, [string, string, string, string]>
  >({});
  const [shortAnswers, setShortAnswers] = useState<Record<string, string>>({});
  const [shortAnswerImages, setShortAnswerImages] = useState<Record<string, string>>({});
  const [essayAiImages, setEssayAiImages] = useState<
    Record<string, { base64: string; mimeType: string }>
  >({});
  const [questionSeconds, setQuestionSeconds] = useState<Record<string, number>>({});
  const [zoomImgUrl, setZoomImgUrl] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submittingNote, setSubmittingNote] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] = useState<Submission | null>(null);
  const [forcedReason, setForcedReason] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<'wrong_review' | 'ai_practice' | 'all'>('all');
  const [studentReview, setStudentReview] = useState<{
    overallComment: string;
    strengths: string;
    weaknesses: string;
    pacingNote: string;
    studyPlan: string;
  } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [practiceData, setPracticeData] = useState<RemedialPracticeData | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [essayAutoError, setEssayAutoError] = useState<string | null>(null);
  const [retryingEssayAi, setRetryingEssayAi] = useState(false);

  // Student learning overview & journal state
  const [studentPage, setStudentPage] = useState<'exam' | 'progress'>('exam');
  const [journalEntries, setJournalEntries] = useState<StudentJournalEntry[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);

  // Fullscreen & anti-cheat state
  const MAX_ALLOWED_EXITS = 3;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showViolationModal, setShowViolationModal] = useState(false);
  const [needsPhotoReturnFullscreen, setNeedsPhotoReturnFullscreen] = useState(false);

  const shortBoxRefs = useRef<Record<string, (HTMLInputElement | null)[]>>({});
  const currentQRef = useRef<string>('');
  const violationCountRef = useRef(0);
  const photoExemptRef = useRef(false);
  const photoExemptTimerRef = useRef<number | null>(null);
  const lastViolationAtRef = useRef(0);
  const isSubmittingRef = useRef(false);
  const phaseRef = useRef(phase);
  const handleSubmitRef = useRef<
    (overrideViolations?: number, reason?: string) => Promise<void>
  >(async () => {});

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (selectedExam && selectedExam.questions[currentIdx]) {
      currentQRef.current = selectedExam.questions[currentIdx].id;
    }
  }, [selectedExam, currentIdx]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingExams(true);
      try {
        const pub = await listPublishedExams();
        if (!active) return;
        const mergedMap = new Map<string, Exam>();
        teacherExams.forEach((e) => mergedMap.set(e.id, e));
        pub.forEach((e) => mergedMap.set(e.id, e));
        const list = Array.from(mergedMap.values());
        setAvailableExams(list.length > 0 ? list : [buildFallbackSampleExam()]);
      } catch {
        if (!active) return;
        setAvailableExams(
          teacherExams.length > 0 ? teacherExams : [buildFallbackSampleExam()]
        );
      } finally {
        if (active) setLoadingExams(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [user, teacherExams]);

  useEffect(() => {
    if (!selectedExam && availableExams.length > 0) {
      if (initialExamCode) {
        const match = availableExams.find(
          (e) => e.examCode.toLowerCase() === initialExamCode.toLowerCase()
        );
        setSelectedExam(match || availableExams[0]);
      } else {
        setSelectedExam(availableExams[0]);
      }
    }
  }, [availableExams, initialExamCode, selectedExam]);

  const resolvedGuestStudentUid = useMemo(() => {
    if (verifiedStudent) return `code_${verifiedStudent.studentCode}`;
    if (loadedRoster && selectedRosterEntry) {
      const cleanId = selectedRosterEntry.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
      return `cls_${loadedRoster.joinCode}_${cleanId}`;
    }
    return undefined;
  }, [verifiedStudent, loadedRoster, selectedRosterEntry]);

  const resolvedStudentCode = useMemo(
    () => verifiedStudent?.studentCode || selectedRosterEntry?.studentCode || undefined,
    [verifiedStudent, selectedRosterEntry]
  );

  const examsByIdMap = useMemo(() => {
    const map = new Map<string, Exam>();
    availableExams.forEach((e) => map.set(e.id, e));
    return map;
  }, [availableExams]);

  const refreshStudentJournal = useCallback(async () => {
    const hasIdentity = Boolean(
      user?.uid ||
        resolvedStudentCode ||
        resolvedGuestStudentUid ||
        (studentName.trim() && !isTeacherPreview)
    );
    if (!hasIdentity) {
      setJournalEntries([]);
      return;
    }
    setJournalLoading(true);
    try {
      const teacherIds = Array.from(
        new Set([
          ...(loadedRoster?.teacherId ? [loadedRoster.teacherId] : []),
          ...(verifiedStudent?.teacherId ? [verifiedStudent.teacherId] : []),
          ...(selectedExam?.teacherId ? [selectedExam.teacherId] : []),
          ...availableExams.map((e) => e.teacherId),
        ])
      );
      const list = await loadStudentLearningHistory({
        user,
        teacherIds,
        examsById: examsByIdMap,
        studentCode: resolvedStudentCode,
        studentUid: resolvedGuestStudentUid,
        studentName: studentName.trim(),
        className: className.trim(),
      });
      setJournalEntries(list);
    } finally {
      setJournalLoading(false);
    }
  }, [
    user,
    resolvedStudentCode,
    resolvedGuestStudentUid,
    studentName,
    className,
    isTeacherPreview,
    loadedRoster,
    verifiedStudent,
    selectedExam,
    availableExams,
    examsByIdMap,
  ]);

  useEffect(() => {
    if (phase === 'taking') return;
    void refreshStudentJournal();
  }, [
    phase,
    studentPage,
    user?.uid,
    resolvedStudentCode,
    resolvedGuestStudentUid,
    refreshStudentJournal,
  ]);

  const verifyStudentCode = async (rawCode?: string) => {
    const code = normalizeStudentCode(rawCode ?? studentCodeInput);
    if (!code) {
      setVerifiedStudent(null);
      setStudentCodeError(
        'Vui lòng nhập Mã học sinh tương ứng để làm bài không cần đăng nhập.'
      );
      return null;
    }

    setVerifyingCode(true);
    setStudentCodeError(null);
    try {
      const candidateTeachers = [
        ...(selectedExam ? [selectedExam.teacherId] : []),
        ...availableExams.map((e) => e.teacherId),
      ];
      const hit = await lookupStudentByCode(code, candidateTeachers);
      if (!hit) {
        setVerifiedStudent(null);
        setStudentName('');
        setClassName('');
        setStudentCodeError(
          `Không tìm thấy Mã học sinh "${code}" trong danh sách lớp. Vui lòng kiểm tra lại (ví dụ: HS1201) hoặc đăng nhập Google.`
        );
        return null;
      }

      setVerifiedStudent(hit);
      setStudentCodeInput(hit.studentCode);
      setStudentName(hit.studentName);
      setClassName(hit.className);
      setStudentCodeError(null);

      // Auto-select matching exam assigned to this student's class
      if (hit.teacherId !== 'sample_teacher') {
        const classMatchExam = availableExams.find(
          (e) =>
            e.teacherId === hit.teacherId &&
            isExamAssignedToClass(e, { classId: hit.classId, className: hit.className })
        );
        if (classMatchExam) {
          setSelectedExam(classMatchExam);
        }
      }
      return hit;
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleSelectRosterStudent = (
    entry: ClassRosterEntry,
    rosterOverride?: ClassRoster
  ) => {
    const activeRoster = rosterOverride || loadedRoster;
    if (!activeRoster) return;
    setSelectedRosterEntry(entry);
    setStudentName(entry.fullName);
    setClassName(activeRoster.className);
    setClassLookupError(null);

    if (entry.studentCode) {
      setStudentCodeInput(entry.studentCode);
      setVerifiedStudent({
        studentCode: entry.studentCode,
        studentName: entry.fullName,
        classId: activeRoster.classId,
        className: activeRoster.className,
        teacherId: activeRoster.teacherId,
      });
    } else {
      setVerifiedStudent(null);
    }
  };

  const lookupClassByCode = async (rawCode?: string) => {
    const code = normalizeJoinCode(rawCode ?? classCodeInput);
    if (code.length < 3) {
      setLoadedRoster(null);
      setSelectedRosterEntry(null);
      setClassLookupError('Vui lòng nhập Mã lớp hợp lệ (tối thiểu 3 ký tự, VD: LY12A1).');
      return null;
    }

    setLookingUpClass(true);
    setClassLookupError(null);
    try {
      const hit = await lookupClassRosterByJoinCode(code);
      if (!hit) {
        setLoadedRoster(null);
        setSelectedRosterEntry(null);
        setClassLookupError(
          `Không tìm thấy lớp học có mã "${code}". Vui lòng kiểm tra lại Mã lớp từ thầy cô (hoặc thử mã mẫu: LY12A1).`
        );
        return null;
      }

      setLoadedRoster(hit);
      setClassCodeInput(hit.joinCode);
      setClassName(hit.className);
      setRosterSearch('');
      setClassLookupError(null);

      // Auto-select matching student if initialStudentCode or signed-in displayName matches
      const normStuHint = normalizeStudentCode(studentCodeInput);
      const matchedEntry =
        (normStuHint
          ? hit.studentEntries.find((s) => normalizeStudentCode(s.studentCode) === normStuHint)
          : undefined) ||
        (user?.displayName
          ? hit.studentEntries.find(
              (s) => s.fullName.trim().toLowerCase() === user.displayName!.trim().toLowerCase()
            )
          : undefined) ||
        null;

      if (matchedEntry) {
        handleSelectRosterStudent(matchedEntry, hit);
      } else {
        setSelectedRosterEntry(null);
        if (!user) {
          setStudentName('');
          setVerifiedStudent(null);
        }
      }

      if (hit.teacherId !== 'sample_teacher') {
        const classMatchExam = availableExams.find(
          (e) =>
            e.teacherId === hit.teacherId &&
            isExamAssignedToClass(e, { classId: hit.classId, className: hit.className })
        );
        if (classMatchExam) {
          setSelectedExam(classMatchExam);
        }
      }

      return hit;
    } finally {
      setLookingUpClass(false);
    }
  };

  useEffect(() => {
    if (initialClassCode && availableExams.length > 0 && !loadedRoster) {
      void lookupClassByCode(initialClassCode);
    } else if (!user && initialStudentCode && availableExams.length > 0 && !verifiedStudent) {
      void verifyStudentCode(initialStudentCode);
    }
  }, [user, initialClassCode, initialStudentCode, availableExams]);

  const activeStudentClass =
    entryMode === 'class' && loadedRoster
      ? {
          teacherId: loadedRoster.teacherId,
          classId: loadedRoster.classId,
          className: loadedRoster.className,
        }
      : entryMode === 'code' && verifiedStudent
        ? {
            teacherId: verifiedStudent.teacherId,
            classId: verifiedStudent.classId,
            className: verifiedStudent.className,
          }
        : entryMode === 'manual' && className.trim()
          ? {
              teacherId: undefined,
              classId: undefined,
              className: className.trim(),
            }
          : null;

  const isRealTeacherClass =
    Boolean(activeStudentClass?.teacherId) &&
    activeStudentClass?.teacherId !== 'sample_teacher';

  const displayedExams = availableExams.filter((ex) => {
    if (isRealTeacherClass && activeStudentClass) {
      return (
        ex.teacherId === activeStudentClass.teacherId &&
        isExamAssignedToClass(ex, {
          classId: activeStudentClass.classId,
          className: activeStudentClass.className,
        })
      );
    }
    if (activeStudentClass?.className && isExamRestrictedToClasses(ex)) {
      return isExamAssignedToClass(ex, {
        classId: activeStudentClass.classId,
        className: activeStudentClass.className,
      });
    }
    return true;
  });

  const examRestrictedMismatch = Boolean(
    selectedExam &&
      activeStudentClass &&
      ((isRealTeacherClass && selectedExam.teacherId !== activeStudentClass.teacherId) ||
        (isExamRestrictedToClasses(selectedExam) &&
          !isExamAssignedToClass(selectedExam, {
            classId: activeStudentClass.classId,
            className: activeStudentClass.className,
          })))
  );

  useEffect(() => {
    if (!isRealTeacherClass || examCodeInput.trim()) return;
    if (displayedExams.length > 0) {
      const stillValid = selectedExam && displayedExams.some((e) => e.id === selectedExam.id);
      if (!stillValid) {
        setSelectedExam(displayedExams[0]);
      }
    }
  }, [isRealTeacherClass, loadedRoster?.classId, verifiedStudent?.studentCode, availableExams]);

  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(Boolean(document.fullscreenElement));
      setNeedsPhotoReturnFullscreen(false);
    } catch {
      // Browser/iframe may restrict fullscreen without direct gesture
    }
  };

  const exitFullscreenSafe = async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore exit errors
    }
  };

  const beginPhotoCaptureExemption = () => {
    photoExemptRef.current = true;
    if (photoExemptTimerRef.current) {
      window.clearTimeout(photoExemptTimerRef.current);
    }
    // Safety fallback if OS file picker is left open for long
    photoExemptTimerRef.current = window.setTimeout(() => {
      photoExemptRef.current = false;
    }, 60000);
  };

  const endPhotoCaptureExemption = () => {
    window.setTimeout(() => {
      photoExemptRef.current = false;
      if (photoExemptTimerRef.current) {
        window.clearTimeout(photoExemptTimerRef.current);
        photoExemptTimerRef.current = null;
      }
      if (!document.fullscreenElement && phaseRef.current === 'taking') {
        setNeedsPhotoReturnFullscreen(true);
      }
    }, 1200);
  };

  const recordViolation = () => {
    if (phaseRef.current !== 'taking' || isSubmittingRef.current) return;
    if (photoExemptRef.current) return;

    const now = Date.now();
    if (now - lastViolationAtRef.current < 1500) return;
    lastViolationAtRef.current = now;

    const nextCount = violationCountRef.current + 1;
    violationCountRef.current = nextCount;
    setViolationCount(nextCount);
    setViolationBanner(true);

    if (nextCount > MAX_ALLOWED_EXITS) {
      setShowViolationModal(false);
      handleSubmitRef.current(
        nextCount,
        `Bài thi đã bị ép buộc nộp tự động do bạn đã thoát khỏi chế độ toàn màn hình / cửa sổ làm bài ${nextCount} lần (vượt quá giới hạn tối đa ${MAX_ALLOWED_EXITS} lần).`
      );
    } else {
      setShowViolationModal(true);
    }
  };

  // Countdown + per-question timer (+ auto-submit on timeout)
  useEffect(() => {
    if (phase !== 'taking') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (!isSubmittingRef.current) {
            handleSubmitRef.current(
              violationCountRef.current,
              'Hết thời gian làm bài, hệ thống đã tự động thu bài.'
            );
          }
          return 0;
        }
        return prev - 1;
      });
      const qId = currentQRef.current;
      if (qId) {
        setQuestionSeconds((prev) => ({ ...prev, [qId]: (prev[qId] || 0) + 1 }));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Fullscreen + anti-tab-switch + window-blur monitoring
  useEffect(() => {
    if (phase !== 'taking') return;

    const onVisibility = () => {
      if (document.hidden) {
        recordViolation();
      }
    };

    const onFullscreenChange = () => {
      const activeFs = Boolean(document.fullscreenElement);
      setIsFullscreen(activeFs);
      if (!activeFs && !isSubmittingRef.current) {
        if (photoExemptRef.current) {
          setNeedsPhotoReturnFullscreen(true);
        } else {
          recordViolation();
        }
      }
    };

    const onWindowBlur = () => {
      if (photoExemptRef.current) return;
      // Only record blur when not already handled recently
      recordViolation();
    };

    const onWindowFocus = () => {
      if (photoExemptRef.current) {
        endPhotoCaptureExemption();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [phase]);

  const handleStartExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExam) return;

    if (entryMode === 'class' && !(isTeacherPreview && !classCodeInput.trim() && studentName.trim())) {
      let activeRoster = loadedRoster;
      if (!activeRoster || normalizeJoinCode(classCodeInput) !== activeRoster.joinCode) {
        activeRoster = await lookupClassByCode(classCodeInput);
        if (!activeRoster) return;
        if (!user) {
          setClassLookupError('Đã tải danh sách lớp. Vui lòng bấm chọn tên của bạn ở dưới rồi bắt đầu.');
          return;
        }
      }
      if (!selectedRosterEntry && !user) {
        setClassLookupError('Vui lòng bấm chọn đúng họ và tên của bạn trong danh sách lớp.');
        return;
      }
      if (!studentName.trim()) {
        setClassLookupError('Vui lòng chọn tên của bạn trong danh sách lớp.');
        return;
      }
    } else if (entryMode === 'code' && !user) {
      const normalizedInput = normalizeStudentCode(studentCodeInput);
      let activeVerified = verifiedStudent;
      if (!activeVerified || activeVerified.studentCode !== normalizedInput) {
        activeVerified = await verifyStudentCode(studentCodeInput);
      }
      if (!activeVerified) return;
    } else if (!studentName.trim()) {
      return;
    }

    if (examRestrictedMismatch && !isTeacherPreview) {
      setClassLookupError(
        `Đề "${selectedExam.title}" không được giao cho Lớp ${activeStudentClass?.className || ''}. Vui lòng chọn đề khác trong danh sách đề của lớp.`
      );
      return;
    }

    setRemainingSeconds(selectedExam.durationMinutes * 60);
    setElapsedSeconds(0);
    setViolationCount(0);
    violationCountRef.current = 0;
    lastViolationAtRef.current = 0;
    photoExemptRef.current = false;
    isSubmittingRef.current = false;
    setForcedReason(null);
    setShowViolationModal(false);
    setNeedsPhotoReturnFullscreen(false);
    setViolationBanner(false);
    setCurrentIdx(0);
    setMcqSelections({});
    setTfSelections({});
    setShortBoxes({});
    setShortAnswers({});
    setShortAnswerImages({});
    setEssayAiImages({});
    setQuestionSeconds({});
    setFlaggedIds(new Set());
    setStudentReview(null);
    setReviewError(null);
    setReviewLoading(false);
    setEssayAutoError(null);
    setRetryingEssayAi(false);
    setPracticeData(null);
    setPracticeError(null);
    setPracticeLoading(false);
    setResultTab('all');
    setPhase('taking');
    await enterFullscreen();
  };

  const fetchStudentReview = async (
    exam: Exam,
    answers: StudentAnswer[],
    totalScore: number,
    maxScore: number,
    durationSeconds: number,
    submissionIdForCache?: string
  ) => {
    setReviewLoading(true);
    setReviewError(null);
    try {
      const questionResults = exam.questions.map((q, idx) => {
        const a = answers[idx];
        return {
          index: q.index,
          type: q.type,
          promptSnippet: q.prompt.slice(0, 140),
          score: a?.score ?? 0,
          maxScore: q.maxScore,
          isCorrect: Boolean(a?.isCorrect),
          timeSpentSeconds: a?.timeSpentSeconds ?? 0,
          ...(a?.aiFeedback ? { aiBaremFeedback: a.aiFeedback.slice(0, 260) } : {}),
        };
      });

      const data = await generateStudentReviewWithAi({
        studentName: studentName.trim() || 'em',
        subject: exam.subject,
        examTitle: exam.title,
        totalScore,
        maxScore,
        durationSeconds,
        questionResults,
      });
      const nextReview = {
        overallComment: String(data.overallComment || ''),
        strengths: String(data.strengths || ''),
        weaknesses: String(data.weaknesses || ''),
        pacingNote: String(data.pacingNote || ''),
        studyPlan: String(data.studyPlan || ''),
      };
      setStudentReview(nextReview);
      if (submissionIdForCache) {
        attachAiReviewToLocalJournalEntry(
          submissionIdForCache,
          {
            studentCode: resolvedStudentCode,
            studentUid: user ? user.uid : resolvedGuestStudentUid,
            studentName: studentName.trim(),
            className: className.trim(),
          },
          nextReview
        );
        void refreshStudentJournal();
      }
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : 'Lỗi kết nối khi phân tích nhận xét.'
      );
    } finally {
      setReviewLoading(false);
    }
  };

  const buildWrongQuestionsPayload = (exam: Exam, answers: StudentAnswer[]) => {
    const items: Array<{
      index: number;
      type: string;
      prompt: string;
      studentAnswer: string;
      correctAnswer: string;
      explanation: string;
    }> = [];
    exam.questions.forEach((q, idx) => {
      if (items.length >= 8) return;
      const ans = answers[idx];
      if (!ans) return;
      const isEssayWrong = q.type === 'essay' && Boolean(ans.aiFeedback) && ans.score < q.maxScore;
      const isAutoWrong = q.type !== 'essay' && ans.score < q.maxScore;
      if (!isEssayWrong && !isAutoWrong) return;

      let studentAnswer = '(bỏ trống)';
      let correctAnswer = '';

      if (q.type === 'mcq' && q.options) {
        const picked = ans.selectedOption;
        studentAnswer =
          picked !== null && picked !== undefined
            ? `${OPTION_LETTERS[picked]}. ${q.options[picked] || ''}`
            : '(chưa chọn)';
        correctAnswer =
          q.correctOption !== undefined
            ? `${OPTION_LETTERS[q.correctOption]}. ${q.options[q.correctOption] || ''}`
            : '';
      } else if (q.type === 'true_false' && q.statements) {
        const picks = ans.statementAnswers || [null, null, null, null];
        studentAnswer = q.statements
          .map(
            (st, sIdx) =>
              `${TF_LETTERS[sIdx]}) ${st.text} -> HS chọn: ${
                picks[sIdx] === true ? 'Đúng' : picks[sIdx] === false ? 'Sai' : 'Chưa chọn'
              }`
          )
          .join(' | ');
        correctAnswer = q.statements
          .map((st, sIdx) => `${TF_LETTERS[sIdx]}) ${st.isTrue ? 'Đúng' : 'Sai'}`)
          .join(' | ');
      } else if (q.type === 'short_answer') {
        studentAnswer = ans.textAnswer?.trim() || '(bỏ trống)';
        correctAnswer = q.correctAnswer || '';
      } else if (q.type === 'essay') {
        studentAnswer =
          ans.recognizedText?.trim() || ans.textAnswer?.trim() || '(bài làm ảnh/tự luận)';
        correctAnswer = q.correctAnswer || q.explanation || '';
      }

      items.push({
        index: q.index,
        type: q.type,
        prompt: q.prompt.slice(0, 600),
        studentAnswer: studentAnswer.slice(0, 400),
        correctAnswer: correctAnswer.slice(0, 400),
        explanation: (q.explanation || ans.aiFeedback || '').slice(0, 500),
      });
    });
    return items;
  };

  const fetchRemedialPractice = async (exam: Exam, answers: StudentAnswer[]) => {
    const wrongQuestions = buildWrongQuestionsPayload(exam, answers);
    if (wrongQuestions.length === 0) return;

    setPracticeLoading(true);
    setPracticeError(null);
    try {
      const activeMaterials =
        isTeacherPreview && teacherReferenceMaterials
          ? teacherReferenceMaterials.filter((m) => m.isActiveForAi)
          : await fetchActiveReferenceMaterialsForTeacher(exam.teacherId);

      const referenceContext = selectRelevantReferenceContext({
        materials: activeMaterials,
        subject: exam.subject,
        examTitle: exam.title,
        queryTexts: wrongQuestions.map((w) => `${w.prompt} ${w.explanation}`),
        maxItems: 8,
      });

      const data = await generateRemedialPracticeWithAi({
        subject: exam.subject,
        examTitle: exam.title,
        wrongQuestions,
        referenceContext,
      });
      setPracticeData({
        focusSummary: String(data.focusSummary || ''),
        practiceQuestions: Array.isArray(data.practiceQuestions)
          ? (data.practiceQuestions as RemedialPracticeData['practiceQuestions'])
          : [],
        ...(data.referenceSources ? { referenceSources: data.referenceSources } : {}),
      });
    } catch (err) {
      setPracticeError(
        err instanceof Error ? err.message : 'Lỗi kết nối khi tạo bài ôn tập AI.'
      );
    } finally {
      setPracticeLoading(false);
    }
  };

  const handleSubmitExam = async (
    overrideViolations?: number,
    reason?: string
  ) => {
    if (!selectedExam || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSubmitting(true);
    setSubmittingNote('Đang nộp bài...');
    const finalViolations = overrideViolations ?? violationCountRef.current;
    try {
      let gradedAnswers: StudentAnswer[] = selectedExam.questions.map((q) => {
        const timeSpent = questionSeconds[q.id] || 0;
        if (q.type === 'mcq') {
          const picked = mcqSelections[q.id] ?? null;
          const isRight = picked !== null && picked === q.correctOption;
          return {
            questionId: q.id,
            type: 'mcq',
            selectedOption: picked,
            timeSpentSeconds: timeSpent,
            score: isRight ? q.maxScore : 0,
            maxScore: q.maxScore,
            isCorrect: isRight,
          };
        }

        if (q.type === 'true_false') {
          const picks = tfSelections[q.id] || [null, null, null, null];
          const statements = q.statements || [];
          let rightCount = 0;
          statements.forEach((st, idx) => {
            if (picks[idx] === st.isTrue) rightCount++;
          });
          // Vietnamese 2025 scoring rule for 4-statement True/False: 1->10%, 2->25%, 3->50%, 4->100%
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
          return {
            questionId: q.id,
            type: 'true_false',
            statementAnswers: picks,
            timeSpentSeconds: timeSpent,
            score,
            maxScore: q.maxScore,
            isCorrect: rightCount === statements.length,
          };
        }

        if (q.type === 'essay') {
          const textAns = shortAnswers[q.id] || '';
          const imgUrl = shortAnswerImages[q.id];
          return {
            questionId: q.id,
            type: 'essay',
            textAnswer: textAns,
            ...(imgUrl ? { imageDataUrl: imgUrl } : {}),
            timeSpentSeconds: timeSpent,
            score: 0,
            maxScore: q.maxScore,
            isCorrect: false,
          };
        }

        const boxArr = shortBoxes[q.id];
        const textAns = boxArr ? boxArr.join('').trim() : shortAnswers[q.id] || '';
        const normStudent = normalizeShortNumeric(textAns);
        const normKey = normalizeShortNumeric(q.correctAnswer || '');
        const isExactNumeric =
          normKey.length > 0 &&
          normStudent.length > 0 &&
          normStudent === normKey;
        const score = isExactNumeric ? q.maxScore : 0;
        return {
          questionId: q.id,
          type: 'short_answer',
          textAnswer: textAns,
          timeSpentSeconds: timeSpent,
          score,
          maxScore: q.maxScore,
          isCorrect: isExactNumeric,
        };
      });

      // Automatically grade ALL essay questions immediately upon submission (parallel AI grading for text/photo + instant 0đ barem for blank essays)
      const allEssayTargets = selectedExam.questions.filter((q) => q.type === 'essay');
      let pendingEssayFailMsg: string | null = null;

      if (allEssayTargets.length > 0) {
        const answeredCount = allEssayTargets.filter(
          (q) =>
            (shortAnswers[q.id] || '').trim().length > 0 ||
            Boolean(shortAnswerImages[q.id] || essayAiImages[q.id])
        ).length;
        setSubmittingNote(
          answeredCount > 0
            ? `AI đang tự động chấm ${answeredCount} câu tự luận theo Barem 4 bước...`
            : 'Đang hoàn tất chấm điểm bài thi...'
        );
        try {
          const itemsPayload = allEssayTargets.map((q) => {
            const aiImg = essayAiImages[q.id];
            return {
              questionId: q.id,
              prompt: q.prompt,
              correctAnswer: q.correctAnswer || '',
              explanation: q.explanation || '',
              studentAnswer: shortAnswers[q.id] || '',
              imageBase64: aiImg?.base64,
              imageMimeType: aiImg?.mimeType,
              imageDataUrl: !aiImg ? shortAnswerImages[q.id] : undefined,
              maxScore: q.maxScore,
            };
          });

          const aiData = await gradeEssayWithAi({
            studentName: studentName.trim() || 'Học sinh',
            examTitle: selectedExam.title,
            items: itemsPayload,
          });
          const resultMap = new Map<
            string,
            {
              proposedScore: number;
              recognizedText: string;
              feedback: string;
              breakdown: { criterion: string; score: number; maxScore: number; met: boolean }[];
            }
          >();
          if (Array.isArray(aiData.results)) {
            aiData.results.forEach((r) => {
              resultMap.set(r.questionId, r);
            });
          }

          gradedAnswers = gradedAnswers.map((ans) => {
            const hit = resultMap.get(ans.questionId);
            if (!hit) return ans;
            const clamped = Math.min(
              Math.max(Number(hit.proposedScore || 0), 0),
              ans.maxScore
            );
            return {
              ...ans,
              score: Number(clamped.toFixed(2)),
              isCorrect: clamped >= ans.maxScore,
              recognizedText: hit.recognizedText || '',
              aiFeedback: hit.feedback || '',
              aiBreakdown: Array.isArray(hit.breakdown) ? hit.breakdown : [],
            };
          });

          if (aiData.failedQuestionIds && aiData.failedQuestionIds.length > 0) {
            pendingEssayFailMsg =
              'Một số câu tự luận chưa thể chấm tự động do gián đoạn mạng. Bạn có thể bấm "AI tự chấm tự luận ngay" bên dưới.';
          }
        } catch (err) {
          pendingEssayFailMsg =
            err instanceof Error
              ? err.message
              : 'Không thể tự chấm tự luận do kết nối AI tạm gián đoạn. Bấm "AI tự chấm tự luận ngay" để thử lại.';
        }
      }
      setEssayAutoError(pendingEssayFailMsg);

      setSubmittingNote('Đang lưu kết quả bài làm...');

      const canPersistByCode =
        !user &&
        Boolean(verifiedStudent) &&
        selectedExam.id !== 'sample_vl12' &&
        verifiedStudent!.teacherId === selectedExam.teacherId;

      const canPersistByClass =
        !user &&
        Boolean(loadedRoster && selectedRosterEntry) &&
        selectedExam.id !== 'sample_vl12' &&
        loadedRoster!.teacherId === selectedExam.teacherId;

      let finalResult: Submission;
      if ((user && selectedExam.id !== 'sample_vl12') || canPersistByCode || canPersistByClass) {
        const cleanRosterStuId = selectedRosterEntry
          ? selectedRosterEntry.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
          : 'stu';
        const resolvedGuestUid = verifiedStudent
          ? `code_${verifiedStudent.studentCode}`
          : `cls_${loadedRoster!.joinCode}_${cleanRosterStuId}`;
        const saved = await submitStudentExam({
          exam: selectedExam,
          studentUid: user ? user.uid : resolvedGuestUid,
          studentCode: verifiedStudent?.studentCode || selectedRosterEntry?.studentCode || undefined,
          classJoinCode: loadedRoster?.joinCode,
          studentName: studentName.trim(),
          className: className.trim(),
          durationSeconds: elapsedSeconds,
          violationCount: finalViolations,
          answers: gradedAnswers,
        });
        finalResult = saved;
        setSubmittedResult(saved);
      } else {
        const total = Number(
          gradedAnswers.reduce((sum, a) => sum + a.score, 0).toFixed(2)
        );
        const max = Number(
          selectedExam.questions.reduce((sum, q) => sum + q.maxScore, 0).toFixed(2)
        );
        const stillHasPendingEssay = gradedAnswers.some(
          (a) =>
            a.type === 'essay' &&
            ((a.textAnswer ?? '').trim().length > 0 || Boolean(a.imageDataUrl)) &&
            !a.aiFeedback
        );
        finalResult = {
          id: `local_${Date.now().toString(36)}`,
          examId: selectedExam.id,
          examTitle: selectedExam.title,
          teacherId: selectedExam.teacherId,
          studentUid: verifiedStudent ? `code_${verifiedStudent.studentCode}` : 'guest',
          ...(verifiedStudent ? { studentCode: verifiedStudent.studentCode } : {}),
          studentName: studentName.trim(),
          className: className.trim(),
          durationSeconds: elapsedSeconds,
          violationCount: finalViolations,
          status: stillHasPendingEssay ? 'pending_essay' : 'graded',
          totalScore: total,
          maxScore: max,
          teacherComment: '',
          aiAnalysis: '',
          parentPhone: '',
          answers: gradedAnswers,
        };
        setSubmittedResult(finalResult);
      }

      upsertLocalJournalEntry(buildStudentJournalEntry(finalResult, selectedExam));
      void refreshStudentJournal();

      if (reason) setForcedReason(reason);
      setShowViolationModal(false);
      setNeedsPhotoReturnFullscreen(false);
      await exitFullscreenSafe();

      const hasWrongOrPartial = selectedExam.questions.some((q, idx) => {
        const a = gradedAnswers[idx];
        if (!a) return false;
        if (q.type === 'essay') {
          return Boolean(a.aiFeedback) && a.score < q.maxScore;
        }
        return a.score < q.maxScore;
      });
      setStudentReview(null);
      setReviewError(null);
      setPracticeData(null);
      setPracticeError(null);
      setResultTab(hasWrongOrPartial ? 'wrong_review' : 'all');
      setPhase('result');

      void (async () => {
        await fetchStudentReview(
          selectedExam,
          gradedAnswers,
          finalResult.totalScore,
          finalResult.maxScore,
          finalResult.durationSeconds,
          finalResult.id
        );
        if (hasWrongOrPartial) {
          await fetchRemedialPractice(selectedExam, gradedAnswers);
        }
      })();
    } finally {
      setSubmitting(false);
      setSubmittingNote(null);
      isSubmittingRef.current = false;
    }
  };

  const handleRetryAutoGradeEssays = async () => {
    if (!selectedExam || !submittedResult || retryingEssayAi) return;
    const ungradedEssays = selectedExam.questions.filter((q, idx) => {
      if (q.type !== 'essay') return false;
      const ans = submittedResult.answers[idx];
      return !ans?.aiFeedback;
    });
    if (ungradedEssays.length === 0) return;

    setRetryingEssayAi(true);
    setEssayAutoError(null);
    try {
      const itemsPayload = ungradedEssays.map((q) => {
        const ans = submittedResult.answers.find((a) => a.questionId === q.id);
        const aiImg = essayAiImages[q.id];
        return {
          questionId: q.id,
          prompt: q.prompt,
          correctAnswer: q.correctAnswer || '',
          explanation: q.explanation || '',
          studentAnswer: ans?.textAnswer || '',
          imageBase64: aiImg?.base64,
          imageMimeType: aiImg?.mimeType,
          imageDataUrl: !aiImg ? ans?.imageDataUrl : undefined,
          maxScore: q.maxScore,
        };
      });

      const aiData = await gradeEssayWithAi({
        studentName: submittedResult.studentName || 'Học sinh',
        examTitle: selectedExam.title,
        items: itemsPayload,
      });

      const resultMap = new Map(
        (aiData.results || []).map((r) => [r.questionId, r])
      );
      const nextAnswers = submittedResult.answers.map((ans) => {
        const hit = resultMap.get(ans.questionId);
        if (!hit) return ans;
        const clamped = Math.min(Math.max(Number(hit.proposedScore || 0), 0), ans.maxScore);
        return {
          ...ans,
          score: Number(clamped.toFixed(2)),
          isCorrect: clamped >= ans.maxScore,
          recognizedText: hit.recognizedText || '',
          aiFeedback: hit.feedback || '',
          aiBreakdown: Array.isArray(hit.breakdown) ? hit.breakdown : [],
        };
      });
      const nextTotal = Number(
        nextAnswers.reduce((s, a) => s + Number(a.score || 0), 0).toFixed(2)
      );
      const stillPending = nextAnswers.some(
        (a) =>
          a.type === 'essay' &&
          ((a.textAnswer ?? '').trim().length > 0 || Boolean(a.imageDataUrl)) &&
          !a.aiFeedback
      );
      const nextResult: Submission = {
        ...submittedResult,
        totalScore: nextTotal,
        status: stillPending ? 'pending_essay' : 'graded',
        answers: nextAnswers,
      };
      setSubmittedResult(nextResult);

      if (user?.uid && user.uid === nextResult.teacherId && !nextResult.id.startsWith('local_')) {
        await updateSubmissionGrading(nextResult.id, {
          totalScore: nextTotal,
          teacherComment: nextResult.teacherComment || '',
          aiAnalysis: nextResult.aiAnalysis || '',
          status: nextResult.status,
          answers: nextAnswers,
          parentPhone: nextResult.parentPhone || '',
        });
      }

      upsertLocalJournalEntry(buildStudentJournalEntry(nextResult, selectedExam));
      void refreshStudentJournal();
      await fetchStudentReview(
        selectedExam,
        nextAnswers,
        nextTotal,
        nextResult.maxScore,
        nextResult.durationSeconds,
        nextResult.id
      );
    } catch (err) {
      setEssayAutoError(
        err instanceof Error ? err.message : 'Vẫn chưa thể kết nối AI chấm tự luận.'
      );
    } finally {
      setRetryingEssayAi(false);
    }
  };

  handleSubmitRef.current = handleSubmitExam;

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#0D221D] flex flex-col">
      {/* Top Preview / Student Bar — Deep Imperial Jade & Champagne Gold */}
      <header className="bg-[#0A362C] text-white border-b border-[#C89B2B]/35 px-4 sm:px-6 h-14 flex items-center justify-between gap-4 sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={async () => {
              await exitFullscreenSafe();
              onExit();
            }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#F7E5A9] hover:text-white whitespace-nowrap cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-[#E5C665]" />
            <span>
              {isTeacherPreview ? 'Quay lại giao diện Giáo viên' : 'Về trang đăng nhập'}
            </span>
          </button>
          {isTeacherPreview ? (
            <span className="hidden sm:inline text-xs text-[#A3C2B8]">
              · Đang xem thử chế độ Học sinh
            </span>
          ) : user?.email ? (
            <span className="hidden sm:inline text-xs text-[#A3C2B8] truncate">
              · {user.email}
            </span>
          ) : null}
        </div>

        {phase !== 'taking' && (
          <div className="flex items-center gap-1.5 bg-[#124E40] p-1 rounded-xl border border-[#C89B2B]/35 shrink-0">
            <button
              type="button"
              onClick={() => setStudentPage('exam')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                studentPage === 'exam'
                  ? 'bg-[#FDF8EB] text-[#0A362C]'
                  : 'text-[#E3EFEA] hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Phòng thi</span>
            </button>
            <button
              type="button"
              onClick={() => setStudentPage('progress')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                studentPage === 'progress'
                  ? 'bg-[#FDF8EB] text-[#0A362C]'
                  : 'text-[#E3EFEA] hover:text-white'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>
                Tiến độ &amp; Tổng quan
                {journalEntries.length > 0 ? ` (${journalEntries.length})` : ''}
              </span>
            </button>
          </div>
        )}

        {phase === 'taking' && (
          <div className="flex items-center gap-3 shrink-0">
            {!isFullscreen && (
              <button
                type="button"
                onClick={enterFullscreen}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#124E40] border border-[#C89B2B]/40 text-[#F7E5A9] text-xs font-semibold hover:bg-[#176150] whitespace-nowrap cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5 text-[#E5C665]" />
                <span>Bật toàn màn hình</span>
              </button>
            )}
            <span
              className={`text-xs font-semibold tabular-nums ${
                violationCount > 0 ? 'text-[#FCD34D]' : 'text-[#A3C2B8]'
              }`}
            >
              Thoát: {violationCount}/{MAX_ALLOWED_EXITS} lần
            </span>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#124E40] border border-[#C89B2B]/45 font-mono text-sm font-semibold text-[#F7E5A9] tabular-nums">
              <Clock className="w-3.5 h-3.5 text-[#E5C665]" />
              <span>{formatDurationMMSS(remainingSeconds)}</span>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {phase !== 'taking' && studentPage === 'progress' ? (
          <StudentProgressView
            studentName={studentName.trim() || user?.displayName || ''}
            className={className.trim()}
            studentCode={resolvedStudentCode}
            entries={journalEntries}
            loading={journalLoading}
            onRefresh={() => void refreshStudentJournal()}
            onGoToExamRoom={() => {
              setStudentPage('exam');
              setPhase('setup');
            }}
            onRetakeExam={(examId, examCode) => {
              const found =
                availableExams.find((e) => e.id === examId) ||
                (examCode
                  ? availableExams.find(
                      (e) => e.examCode.toLowerCase() === examCode.toLowerCase()
                    )
                  : undefined);
              if (found) {
                setSelectedExam(found);
              }
              setStudentPage('exam');
              setPhase('setup');
            }}
          />
        ) : (
          <>
            {/* PHASE 1: SETUP */}
            {phase === 'setup' && (
              <div className="max-w-2xl mx-auto space-y-4">
                {journalEntries.length > 0 && (
                  <div className="rounded-2xl border border-[#C5DDD3] bg-gradient-to-r from-[#EFF7F3] to-[#FDF8EB] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5 text-xs">
                      <div className="font-semibold text-[#0F4C3F] flex items-center gap-1.5">
                        <BarChart2 className="w-4 h-4 text-[#C89B2B]" />
                        <span>
                          Hồ sơ học tập của {studentName.trim() || 'bạn'}: đã ghi nhận{' '}
                          {journalEntries.length} lần làm bài
                        </span>
                      </div>
                      <p className="text-[#4A615A] tabular-nums">
                        Điểm TB:{' '}
                        <strong className="text-[#0D221D]">
                          {(
                            journalEntries.reduce((s, e) => s + e.score10, 0) /
                            journalEntries.length
                          ).toFixed(2)}
                          /10
                        </strong>{' '}
                        · Gần nhất: {journalEntries[0].examTitle} (
                        {journalEntries[0].score10.toFixed(2)}/10)
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStudentPage('progress')}
                      className="px-3.5 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] whitespace-nowrap cursor-pointer shrink-0"
                    >
                      Xem tiến độ &amp; nhật ký
                    </button>
                  </div>
                )}
              <div className="bg-white border border-[#DAE5E0] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-[#EDF3F0]">
              <div>
                <div className="text-xs font-semibold tracking-[0.08em] text-[#8A630D] uppercase">
                  Phòng thi trực tuyến
                </div>
                <h1 className="font-serif text-3xl font-semibold text-[#0D221D] mt-1">
                  Vào lớp &amp; chọn tên làm bài
                </h1>
                <p className="text-sm text-[#4A615A] mt-1">
                  Nhập mã lớp do thầy cô cung cấp, bấm chọn đúng tên của bạn rồi chọn đề để bắt đầu.
                </p>
              </div>
              {!user && (
                <button
                  type="button"
                  onClick={onSignInRequest}
                  className="px-3.5 py-2 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-[#0D221D] text-xs font-medium hover:bg-[#EFF7F3] whitespace-nowrap cursor-pointer self-start"
                >
                  Đăng nhập Google
                </button>
              )}
            </div>

            <form onSubmit={handleStartExam} className="space-y-5">
              {/* Entry Mode Switcher */}
              <div className="inline-flex flex-wrap p-1 rounded-xl bg-[#E6EEEA] gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEntryMode('class');
                    setStudentCodeError(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    entryMode === 'class'
                      ? 'bg-white text-[#0F4C3F] font-semibold shadow-sm'
                      : 'text-[#4A615A] hover:text-[#0D221D]'
                  }`}
                >
                  1. Vào lớp chọn tên
                </button>
                {!user && (
                  <button
                    type="button"
                    onClick={() => {
                      setEntryMode('code');
                      setClassLookupError(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      entryMode === 'code'
                        ? 'bg-white text-[#0F4C3F] font-semibold shadow-sm'
                        : 'text-[#4A615A] hover:text-[#0D221D]'
                    }`}
                  >
                    2. Nhập Mã học sinh
                  </button>
                )}
                {user && (
                  <button
                    type="button"
                    onClick={() => {
                      setEntryMode('manual');
                      setClassLookupError(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      entryMode === 'manual'
                        ? 'bg-white text-[#0F4C3F] font-semibold shadow-sm'
                        : 'text-[#4A615A] hover:text-[#0D221D]'
                    }`}
                  >
                    2. Tự điền họ tên
                  </button>
                )}
              </div>

              {/* MODE 1: JOIN CLASS & PICK STUDENT NAME */}
              {entryMode === 'class' && (
                <div className="p-4 sm:p-5 rounded-2xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-4">
                  <div>
                    <label
                      htmlFor="setup-class-code"
                      className="block text-xs font-semibold text-[#0D221D] mb-1.5"
                    >
                      Bước 1: Nhập Mã lớp học *
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Users className="w-4 h-4 text-[#698078] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          id="setup-class-code"
                          type="text"
                          value={classCodeInput}
                          onChange={(e) => {
                            const nextVal = e.target.value;
                            setClassCodeInput(nextVal);
                            if (classLookupError) setClassLookupError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void lookupClassByCode(classCodeInput);
                            }
                          }}
                          placeholder="Ví dụ: 12A1_XXXX hoặc LY12A1..."
                          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#CEDCD6] bg-white text-sm font-mono uppercase text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={lookingUpClass}
                        onClick={() => void lookupClassByCode(classCodeInput)}
                        className="px-4 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] whitespace-nowrap disabled:opacity-60 cursor-pointer"
                      >
                        {lookingUpClass ? 'Đang mở lớp...' : 'Vào lớp'}
                      </button>
                    </div>

                    {/* Quick class shortcuts for teacher preview or demo */}
                    {isTeacherPreview && teacherClasses.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-[#597169]">Lớp của thầy cô:</span>
                        {teacherClasses.slice(0, 6).map((cls) => (
                          <button
                            key={cls.id}
                            type="button"
                            onClick={() => void lookupClassByCode(cls.joinCode)}
                            className={`px-2 py-0.5 rounded-md border text-xs font-medium cursor-pointer ${
                              loadedRoster?.joinCode === cls.joinCode
                                ? 'border-[#0F4C3F] bg-[#EFF7F3] text-[#0F4C3F]'
                                : 'border-[#CEDCD6] bg-white text-[#3A524A] hover:border-[#0F4C3F]'
                            }`}
                          >
                            {cls.name} ({cls.joinCode})
                          </button>
                        ))}
                      </div>
                    ) : !loadedRoster ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[#597169]">
                        <span>Chưa có mã lớp? Thử lớp mẫu:</span>
                        {(['LY12A1', 'LY12A2', 'LY12A5'] as const).map((sampleCode) => (
                          <button
                            key={sampleCode}
                            type="button"
                            onClick={() => void lookupClassByCode(sampleCode)}
                            className="px-2 py-0.5 rounded-md border border-[#EAD8A6] bg-[#FDF8EB] font-mono text-[#8A630D] hover:bg-[#FAF1D6] cursor-pointer"
                          >
                            {sampleCode}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {classLookupError && (
                    <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                      {classLookupError}
                    </div>
                  )}

                  {loadedRoster && (
                    <div className="space-y-3 pt-2 border-t border-[#DAE5E0]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-[#0F6D4F] font-semibold flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>
                            Đã vào Lớp {loadedRoster.className} · {loadedRoster.subject} (
                            {loadedRoster.studentEntries.length} học sinh)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setLoadedRoster(null);
                            setSelectedRosterEntry(null);
                            setClassCodeInput('');
                            if (!user) {
                              setStudentName('');
                              setClassName('');
                              setVerifiedStudent(null);
                            }
                          }}
                          className="text-[11px] font-medium text-[#4A615A] hover:text-[#0D221D] underline cursor-pointer"
                        >
                          Đổi lớp khác
                        </button>
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <label className="text-xs font-semibold text-[#0D221D]">
                            Bước 2: Chọn tên của bạn trong lớp *
                          </label>
                          <div className="relative w-full sm:w-56">
                            <Search className="w-3.5 h-3.5 text-[#698078] absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={rosterSearch}
                              onChange={(e) => setRosterSearch(e.target.value)}
                              placeholder="Tìm nhanh tên bạn..."
                              className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                            />
                          </div>
                        </div>

                        {loadedRoster.studentEntries.length === 0 ? (
                          <div className="p-4 rounded-xl bg-white border border-[#DAE5E0] text-xs text-[#597169] text-center">
                            Lớp {loadedRoster.className} hiện chưa có tên học sinh nào trong danh sách. Hãy nhờ thầy cô thêm danh sách học sinh hoặc đăng nhập Google để làm bài.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                            {loadedRoster.studentEntries
                              .filter((s) => {
                                const q = rosterSearch.trim().toLowerCase();
                                if (!q) return true;
                                return (
                                  s.fullName.toLowerCase().includes(q) ||
                                  (s.studentCode || '').toLowerCase().includes(q)
                                );
                              })
                              .map((stu, sIdx) => {
                                const isPicked = selectedRosterEntry?.id === stu.id;
                                return (
                                  <button
                                    key={stu.id}
                                    type="button"
                                    onClick={() => handleSelectRosterStudent(stu)}
                                    className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                                      isPicked
                                        ? 'bg-[#EFF7F3] border-[#0F4C3F] ring-1 ring-[#C89B2B]/45'
                                        : 'bg-white border-[#CEDCD6] hover:border-[#0F4C3F]/60'
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-[#0D221D] truncate">
                                        {sIdx + 1}. {stu.fullName}
                                      </div>
                                      {stu.studentCode && (
                                        <div className="text-[11px] font-mono text-[#4A615A]">
                                          Mã HS: {stu.studentCode}
                                        </div>
                                      )}
                                    </div>
                                    {isPicked && (
                                      <CheckCircle2 className="w-4 h-4 text-[#0F4C3F] shrink-0" />
                                    )}
                                  </button>
                                );
                              })}
                          </div>
                        )}
                      </div>

                      {selectedRosterEntry && (
                        <div className="p-2.5 rounded-xl bg-[#F0FBF6] border border-[#C5DDD3] text-xs text-[#0A362C] flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-[#0F6D4F] shrink-0" />
                          <span>
                            Bạn đã chọn: <strong>{selectedRosterEntry.fullName}</strong> · Lớp{' '}
                            <strong>{loadedRoster.className}</strong>
                            {selectedRosterEntry.studentCode
                              ? ` (Mã HS: ${selectedRosterEntry.studentCode})`
                              : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* MODE 2 (Guest fallback): STUDENT CODE */}
              {entryMode === 'code' && !user && (
                <div className="p-4 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-3">
                  <div>
                    <label
                      htmlFor="setup-student-code"
                      className="block text-xs font-semibold text-[#0D221D] mb-1.5"
                    >
                      Mã học sinh *
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <KeyRound className="w-4 h-4 text-[#698078] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          id="setup-student-code"
                          type="text"
                          required
                          value={studentCodeInput}
                          onChange={(e) => {
                            const nextVal = e.target.value;
                            setStudentCodeInput(nextVal);
                            if (
                              verifiedStudent &&
                              normalizeStudentCode(nextVal) !== verifiedStudent.studentCode
                            ) {
                              setVerifiedStudent(null);
                              setStudentName('');
                              setClassName('');
                            }
                            if (studentCodeError) setStudentCodeError(null);
                          }}
                          placeholder="Ví dụ: HS1201..."
                          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm font-mono uppercase text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={verifyingCode}
                        onClick={() => verifyStudentCode(studentCodeInput)}
                        className="px-3.5 py-2 rounded-xl border border-[#0F4C3F] bg-white text-[#0F4C3F] text-xs font-semibold hover:bg-[#EFF7F3] whitespace-nowrap disabled:opacity-60 cursor-pointer"
                      >
                        {verifyingCode ? 'Đang kiểm tra...' : 'Kiểm tra mã'}
                      </button>
                    </div>

                    {verifiedStudent && (
                      <div className="mt-2 p-2.5 rounded-lg bg-[#F0FBF6] border border-[#C5DDD3] text-xs text-[#0A362C] flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-[#0F6D4F] shrink-0" />
                        <span>
                          Đã xác thực mã <strong>{verifiedStudent.studentCode}</strong>:{' '}
                          <strong>{verifiedStudent.studentName}</strong> · Lớp{' '}
                          <strong>{verifiedStudent.className}</strong>
                        </span>
                      </div>
                    )}

                    {studentCodeError && (
                      <div className="mt-2 p-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                        {studentCodeError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* MODE 3 (Signed-in user manual fallback) */}
              {entryMode === 'manual' && user && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                      Họ và tên học sinh *
                    </label>
                    <input
                      type="text"
                      required
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      placeholder="Nguyễn Văn An"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                      Lớp
                    </label>
                    <input
                      type="text"
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      placeholder="12A1"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                    />
                  </div>
                </div>
              )}

              {/* Step 3: Select Exam */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                    Chọn đề kiểm tra
                    {isRealTeacherClass && activeStudentClass?.className
                      ? ` (Lớp ${activeStudentClass.className})`
                      : ''}
                  </label>
                  {loadingExams ? (
                    <div className="text-xs text-[#597169] py-2">Đang tải danh sách đề...</div>
                  ) : displayedExams.length === 0 ? (
                    <div className="px-3.5 py-2.5 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-xs text-[#8A630D]">
                      Lớp {activeStudentClass?.className || 'này'} hiện chưa được giao đề mở nào. Bạn có thể nhập trực tiếp Mã đề ở ô bên cạnh (nếu có).
                    </div>
                  ) : (
                    <select
                      value={
                        selectedExam && displayedExams.some((ex) => ex.id === selectedExam.id)
                          ? selectedExam.id
                          : ''
                      }
                      onChange={(e) => {
                        const hit = displayedExams.find((ex) => ex.id === e.target.value);
                        if (hit) setSelectedExam(hit);
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                    >
                      {!displayedExams.some((ex) => ex.id === selectedExam?.id) && (
                        <option value="">-- Chọn đề của lớp --</option>
                      )}
                      {displayedExams.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.title} ({ex.questionCount} câu · {ex.durationMinutes} phút)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                    Tìm mã đề (tuỳ chọn)
                  </label>
                  <input
                    type="text"
                    value={examCodeInput}
                    onChange={(e) => {
                      setExamCodeInput(e.target.value);
                      const found = availableExams.find(
                        (ex) =>
                          ex.examCode.toLowerCase() === e.target.value.trim().toLowerCase()
                      );
                      if (found) setSelectedExam(found);
                    }}
                    placeholder="VD: VL12HK1"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm font-mono uppercase text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
              </div>

              {selectedExam && (
                <div className="p-4 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-xs text-[#4A615A] space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-[#0D221D]">{selectedExam.title}</div>
                    <span className="font-mono font-semibold text-[#8A630D]">
                      Mã đề: {selectedExam.examCode}
                    </span>
                  </div>
                  <div className="text-[#8A630D] font-medium flex flex-wrap items-center gap-2">
                    <span>
                      {selectedExam.subject} · {selectedExam.questionCount} câu ·{' '}
                      {selectedExam.durationMinutes} phút
                    </span>
                    {isExamRestrictedToClasses(selectedExam) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#0F4C3F]">
                          Giao cho: Lớp{' '}
                          {resolveAssignedClassLabels(selectedExam, teacherClasses).join(', ')}
                        </span>
                      </>
                    )}
                  </div>
                  {examRestrictedMismatch && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs ${
                        isTeacherPreview
                          ? 'bg-white border-[#C89B2B] text-[#8A630D]'
                          : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C] font-medium'
                      }`}
                    >
                      {isTeacherPreview
                        ? `Lưu ý (chế độ xem thử Giáo viên): Đề này đang chỉ giao cho ${
                            resolveAssignedClassLabels(selectedExam, teacherClasses).length > 0
                              ? `Lớp ${resolveAssignedClassLabels(selectedExam, teacherClasses).join(', ')}`
                              : 'lớp khác'
                          }, không nằm trong danh sách lớp ${activeStudentClass?.className || ''}.`
                        : `Đề này chỉ được giao cho ${
                            resolveAssignedClassLabels(selectedExam, teacherClasses).length > 0
                              ? `Lớp ${resolveAssignedClassLabels(selectedExam, teacherClasses).join(', ')}`
                              : 'lớp khác'
                          }. Vui lòng chọn đề đúng lớp ${activeStudentClass?.className || 'của bạn'}.`}
                    </div>
                  )}
                  <div className="pt-1.5 border-t border-[#EAD8A6]/70 text-[#3A524A] leading-relaxed">
                    <strong>Quy chế phòng thi:</strong> Hệ thống sẽ bật{' '}
                    <strong>toàn màn hình</strong> khi bắt đầu. Thoát toàn màn hình hoặc
                    chuyển cửa sổ sẽ bị ghi nhận (chỉ miễn khi{' '}
                    <strong>chụp ảnh câu tự luận</strong>). Cho phép thoát tối đa{' '}
                    <strong>{MAX_ALLOWED_EXITS} lần</strong> — quá {MAX_ALLOWED_EXITS}{' '}
                    lần sẽ <strong>ép buộc nộp bài</strong>.
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={!selectedExam || (examRestrictedMismatch && !isTeacherPreview)}
                className="w-full py-3 px-4 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] transition-colors disabled:opacity-60 cursor-pointer shadow-xs"
              >
                Bắt đầu làm bài (Bật toàn màn hình)
              </button>
            </form>
          </div>
          </div>
        )}

        {/* PHASE 2: TAKING EXAM */}
        {phase === 'taking' && selectedExam && (
          <div className="space-y-5">
            {violationBanner && (
              <div className="p-3.5 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] flex flex-wrap items-center justify-between gap-3 text-xs text-[#7A580B]">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#C89B2B] shrink-0" />
                  <span>
                    Hệ thống đã ghi nhận bạn thoát toàn màn hình / rời cửa sổ làm bài (
                    <strong className="tabular-nums">
                      {violationCount}/{MAX_ALLOWED_EXITS} lần
                    </strong>
                    ). Thoát quá {MAX_ALLOWED_EXITS} lần sẽ bị ép buộc nộp bài.
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {!isFullscreen && (
                    <button
                      type="button"
                      onClick={enterFullscreen}
                      className="px-2.5 py-1 rounded-lg bg-[#8A630D] text-white font-semibold cursor-pointer"
                    >
                      Bật toàn màn hình
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setViolationBanner(false)}
                    className="font-semibold underline cursor-pointer"
                  >
                    Đã hiểu
                  </button>
                </div>
              </div>
            )}

            {needsPhotoReturnFullscreen && !isFullscreen && !showViolationModal && (
              <div className="p-3.5 rounded-xl bg-[#F0FBF6] border border-[#C5DDD3] flex flex-wrap items-center justify-between gap-3 text-xs text-[#0A362C]">
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[#0F6D4F] shrink-0" />
                  <span>
                    Đã hoàn tất bước chụp ảnh câu tự luận (được miễn ghi nhận vi phạm).
                    Vui lòng bật lại toàn màn hình để tiếp tục làm bài.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={enterFullscreen}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F4C3F] text-white font-semibold hover:bg-[#0A362C] cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-[#E5C665]" />
                  <span>Bật lại toàn màn hình</span>
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Active Question Card */}
              <div className="lg:col-span-8 bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-6 shadow-2xs">
                {(() => {
                  const q = selectedExam.questions[currentIdx];
                  if (!q) return null;
                  const typeLabel =
                    q.type === 'mcq'
                      ? 'Trắc nghiệm'
                      : q.type === 'true_false'
                        ? 'Đúng / Sai'
                        : q.type === 'short_answer'
                          ? 'Trả lời ngắn'
                          : 'Tự luận';
                  const isFlagged = flaggedIds.has(q.id);

                  return (
                    <>
                      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#EDF3F0]">
                        <div className="text-xs font-medium text-[#4A615A]">
                          <span className="font-semibold text-[#0F4C3F]">
                            Câu {q.index}/{selectedExam.questions.length}
                          </span>{' '}
                          · {typeLabel} ·{' '}
                          <span className="tabular-nums text-[#8A630D] font-semibold">
                            {q.maxScore} điểm
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setFlaggedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(q.id)) next.delete(q.id);
                              else next.add(q.id);
                              return next;
                            });
                          }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                            isFlagged
                              ? 'bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D]'
                              : 'text-[#597169] hover:bg-[#EFF7F3]'
                          }`}
                        >
                          <Flag className="w-3.5 h-3.5" />
                          <span>{isFlagged ? 'Đã đánh dấu' : 'Xem lại sau'}</span>
                        </button>
                      </div>

                      <MathText
                        text={q.prompt}
                        className="text-base text-[#0D221D] leading-relaxed whitespace-pre-line"
                      />

                      {q.imageUrls && q.imageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                          {q.imageUrls.map((imgUrl, imgIdx) => (
                            <button
                              key={imgIdx}
                              type="button"
                              onClick={() => setZoomImgUrl(imgUrl)}
                              className="group relative rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] p-2 hover:border-[#0F4C3F] transition-colors cursor-zoom-in"
                            >
                              <img
                                src={imgUrl}
                                alt={`Hình minh hoạ câu ${q.index}`}
                                className="max-h-64 max-w-full rounded-lg object-contain bg-white"
                              />
                              <span className="block text-[11px] text-[#4A615A] mt-1 group-hover:text-[#0F4C3F]">
                                Bấm để phóng to hình
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {q.type === 'mcq' && q.options && (
                        <div className="grid grid-cols-1 gap-3">
                          {q.options.map((opt, optIdx) => {
                            const selected = mcqSelections[q.id] === optIdx;
                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() =>
                                  setMcqSelections((prev) => ({
                                    ...prev,
                                    [q.id]: optIdx,
                                  }))
                                }
                                className={`w-full text-left px-4 py-3.5 rounded-xl border flex items-center gap-3 text-sm transition-colors cursor-pointer ${
                                  selected
                                    ? 'border-[#0F4C3F] bg-[#EFF7F3] text-[#0D221D] font-medium ring-1 ring-[#C89B2B]/40'
                                    : 'border-[#DAE5E0] bg-white text-[#3A524A] hover:bg-[#F8FAF9]'
                                }`}
                              >
                                <span
                                  className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 ${
                                    selected
                                      ? 'bg-[#0F4C3F] text-[#F7E5A9]'
                                      : 'bg-[#E6EEEA] text-[#4A615A]'
                                  }`}
                                >
                                  {OPTION_LETTERS[optIdx]}
                                </span>
                                <MathText text={opt} inline className="flex-1" />
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {q.type === 'true_false' && q.statements && (
                        <div className="divide-y divide-[#EBF1EE] border border-[#DAE5E0] rounded-xl overflow-hidden">
                          {q.statements.map((st, sIdx) => {
                            const currentPicks = tfSelections[q.id] || [
                              null,
                              null,
                              null,
                              null,
                            ];
                            const val = currentPicks[sIdx];
                            return (
                              <div
                                key={sIdx}
                                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white"
                              >
                                <div className="text-sm text-[#0D221D]">
                                  <span className="font-semibold mr-1.5">
                                    {TF_LETTERS[sIdx]})
                                  </span>
                                  <MathText text={st.text} inline />
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {[
                                    { bool: true, label: 'Đúng' },
                                    { bool: false, label: 'Sai' },
                                  ].map((btn) => (
                                    <button
                                      key={btn.label}
                                      type="button"
                                      onClick={() => {
                                        const nextArr = [...currentPicks];
                                        nextArr[sIdx] = btn.bool;
                                        setTfSelections((prev) => ({
                                          ...prev,
                                          [q.id]: nextArr,
                                        }));
                                      }}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                                        val === btn.bool
                                          ? 'bg-[#0F4C3F] text-white border-[#0F4C3F]'
                                          : 'bg-[#F8FAF9] text-[#3A524A] border-[#CEDCD6] hover:bg-[#EFF7F3]'
                                      }`}
                                    >
                                      {btn.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {q.type === 'short_answer' && (() => {
                        const boxes: [string, string, string, string] =
                          shortBoxes[q.id] || ['', '', '', ''];
                        const joinedVal = boxes.join('').trim();

                        const updateBoxes = (
                          nextBoxes: [string, string, string, string]
                        ) => {
                          setShortBoxes((prev) => ({
                            ...prev,
                            [q.id]: nextBoxes,
                          }));
                          setShortAnswers((prev) => ({
                            ...prev,
                            [q.id]: nextBoxes.join('').trim(),
                          }));
                        };

                        return (
                          <div className="p-5 rounded-2xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="text-xs font-semibold text-[#0D221D] uppercase tracking-wider">
                                Phiếu điền số (4 ô)
                              </label>
                              <span className="text-xs text-[#4A615A]">
                                Cho phép nhập chữ số{' '}
                                <span className="font-mono font-semibold">0–9</span>, dấu{' '}
                                <span className="font-mono font-semibold">-</span> và dấu{' '}
                                <span className="font-mono font-semibold">,</span>
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              {[0, 1, 2, 3].map((boxIdx) => (
                                <input
                                  key={boxIdx}
                                  ref={(el) => {
                                    if (!shortBoxRefs.current[q.id]) {
                                      shortBoxRefs.current[q.id] = [
                                        null,
                                        null,
                                        null,
                                        null,
                                      ];
                                    }
                                    shortBoxRefs.current[q.id][boxIdx] = el;
                                  }}
                                  type="text"
                                  inputMode="decimal"
                                  maxLength={1}
                                  aria-label={`Ô số ${boxIdx + 1} câu ${q.index}`}
                                  value={boxes[boxIdx]}
                                  onChange={(e) => {
                                    const rawChar = e.target.value.slice(-1);
                                    if (rawChar && !VALID_SHORT_CHAR.test(rawChar)) {
                                      return;
                                    }
                                    const next: [string, string, string, string] = [
                                      ...boxes,
                                    ] as [string, string, string, string];
                                    next[boxIdx] = rawChar;
                                    updateBoxes(next);
                                    if (rawChar && boxIdx < 3) {
                                      shortBoxRefs.current[q.id]?.[boxIdx + 1]?.focus();
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Backspace') {
                                      e.preventDefault();
                                      const next: [string, string, string, string] = [
                                        ...boxes,
                                      ] as [string, string, string, string];
                                      if (next[boxIdx]) {
                                        next[boxIdx] = '';
                                        updateBoxes(next);
                                      } else if (boxIdx > 0) {
                                        next[boxIdx - 1] = '';
                                        updateBoxes(next);
                                        shortBoxRefs.current[q.id]?.[boxIdx - 1]?.focus();
                                      }
                                    } else if (e.key === 'ArrowLeft' && boxIdx > 0) {
                                      e.preventDefault();
                                      shortBoxRefs.current[q.id]?.[boxIdx - 1]?.focus();
                                    } else if (e.key === 'ArrowRight' && boxIdx < 3) {
                                      e.preventDefault();
                                      shortBoxRefs.current[q.id]?.[boxIdx + 1]?.focus();
                                    }
                                  }}
                                  onPaste={(e) => {
                                    e.preventDefault();
                                    const pasted = e.clipboardData
                                      .getData('text')
                                      .replace(/\s+/g, '')
                                      .split('')
                                      .filter((ch) => VALID_SHORT_CHAR.test(ch))
                                      .slice(0, 4);
                                    const next: [string, string, string, string] = [
                                      '',
                                      '',
                                      '',
                                      '',
                                    ];
                                    pasted.forEach((ch, idx) => {
                                      next[idx] = ch;
                                    });
                                    updateBoxes(next);
                                    const focusIdx = Math.min(3, pasted.length);
                                    shortBoxRefs.current[q.id]?.[focusIdx]?.focus();
                                  }}
                                  placeholder="·"
                                  className="w-14 h-14 rounded-xl border-2 border-[#CEDCD6] bg-white text-center font-mono text-2xl font-bold text-[#0D221D] tabular-nums focus:outline-none focus:border-[#0F4C3F] focus:ring-2 focus:ring-[#C89B2B]/30 transition-all"
                                />
                              ))}

                              {joinedVal && (
                                <button
                                  type="button"
                                  onClick={() => updateBoxes(['', '', '', ''])}
                                  className="px-2.5 py-1.5 rounded-lg text-xs text-[#597169] hover:text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                                >
                                  Xoá
                                </button>
                              )}
                            </div>

                            <div className="text-xs text-[#3A524A] tabular-nums">
                              Đáp số đã điền:{' '}
                              <strong className="font-mono text-sm text-[#0F4C3F]">
                                {joinedVal || '(chưa điền)'}
                              </strong>
                            </div>
                          </div>
                        );
                      })()}

                      {q.type === 'essay' && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-[#4A615A] mb-1.5">
                              Bài làm tự luận của bạn
                            </label>
                            <textarea
                              rows={4}
                              value={shortAnswers[q.id] || ''}
                              onChange={(e) =>
                                setShortAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                              placeholder="Trình bày lời giải chi tiết (hỗ trợ $công thức$ LaTeX) hoặc chụp ảnh vở làm bài bên dưới..."
                              className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                            />
                            {containsLatexFormula(shortAnswers[q.id]) && (
                              <div className="mt-2 p-2.5 rounded-lg bg-white border border-[#DAE5E0] text-xs text-[#0D221D]">
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#0F4C3F] mb-1">
                                  Xem trước công thức đã nhập
                                </div>
                                <MathText
                                  text={shortAnswers[q.id]}
                                  className="whitespace-pre-line leading-relaxed"
                                />
                              </div>
                            )}
                          </div>

                          <div className="p-3.5 rounded-xl border border-dashed border-[#CEDCD6] bg-[#F8FAF9] space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="space-y-0.5">
                                <span className="text-xs text-[#4A615A] block">
                                  Chụp / tải ảnh bài giải viết tay (AI chấm theo barem: công thức, thay số, đáp số, đơn vị)
                                </span>
                                <span className="text-[11px] text-[#0F4C3F] font-medium block">
                                  Ảnh được nén tự động gọn nhẹ (~70 KB/ảnh) tránh tràn dung lượng và miễn ghi nhận thoát màn hình khi mở camera.
                                </span>
                              </div>
                              <label
                                onClick={beginPhotoCaptureExemption}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#CEDCD6] text-xs font-semibold text-[#0F4C3F] hover:bg-[#EFF7F3] cursor-pointer shrink-0"
                              >
                                <Camera className="w-3.5 h-3.5 text-[#C89B2B]" />
                                <span>
                                  {shortAnswerImages[q.id] ? 'Đổi ảnh bài làm' : 'Chụp / chọn ảnh'}
                                </span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (!file) {
                                      endPhotoCaptureExemption();
                                      return;
                                    }
                                    try {
                                      const compressed = await compressExamPhoto(file);
                                      setShortAnswerImages((prev) => ({
                                        ...prev,
                                        [q.id]: compressed.storageDataUrl,
                                      }));
                                      setEssayAiImages((prev) => ({
                                        ...prev,
                                        [q.id]: {
                                          base64: compressed.aiBase64,
                                          mimeType: compressed.aiMimeType,
                                        },
                                      }));
                                    } finally {
                                      endPhotoCaptureExemption();
                                    }
                                  }}
                                  className="hidden"
                                />
                              </label>
                            </div>

                            {shortAnswerImages[q.id] && (
                              <div className="flex items-start gap-3 pt-1">
                                <img
                                  src={shortAnswerImages[q.id]}
                                  alt="Ảnh bài làm đã chọn"
                                  className="max-h-40 rounded-lg border border-[#CEDCD6] bg-white object-contain"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShortAnswerImages((prev) => {
                                      const next = { ...prev };
                                      delete next[q.id];
                                      return next;
                                    });
                                    setEssayAiImages((prev) => {
                                      const next = { ...prev };
                                      delete next[q.id];
                                      return next;
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Xoá ảnh</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-4 border-t border-[#EDF3F0]">
                        <button
                          type="button"
                          disabled={currentIdx === 0}
                          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                          className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-sm font-medium text-[#3A524A] hover:bg-[#EFF7F3] disabled:opacity-40 cursor-pointer"
                        >
                          Câu trước
                        </button>
                        <button
                          type="button"
                          disabled={currentIdx === selectedExam.questions.length - 1}
                          onClick={() =>
                            setCurrentIdx((i) =>
                              Math.min(selectedExam.questions.length - 1, i + 1)
                            )
                          }
                          className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] disabled:opacity-40 cursor-pointer"
                        >
                          Câu tiếp theo
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Question Palette Sidebar */}
              <aside className="lg:col-span-4 bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-5 lg:sticky lg:top-20 shadow-2xs">
                <div>
                  <div className="text-sm font-semibold text-[#0D221D]">
                    {studentName}
                  </div>
                  <div className="text-xs text-[#597169] mt-0.5">
                    {verifiedStudent ? `Mã HS: ${verifiedStudent.studentCode} · ` : ''}
                    Lớp {className || '—'} · {selectedExam.title}
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2">
                  {selectedExam.questions.map((q, idx) => {
                    const isAnswered =
                      q.type === 'mcq'
                        ? mcqSelections[q.id] !== undefined
                        : q.type === 'true_false'
                          ? (tfSelections[q.id] || []).some((v) => v !== null)
                          : (shortAnswers[q.id] || '').trim().length > 0 ||
                            Boolean(shortAnswerImages[q.id]);
                    const isCurrent = idx === currentIdx;
                    const isFlagged = flaggedIds.has(q.id);

                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setCurrentIdx(idx)}
                        className={`h-9 rounded-lg text-xs font-semibold tabular-nums border transition-colors cursor-pointer ${
                          isCurrent
                            ? 'border-[#0F4C3F] ring-2 ring-[#C89B2B]/45 bg-[#0F4C3F] text-[#F7E5A9]'
                            : isFlagged
                              ? 'border-[#C89B2B] bg-[#FDF8EB] text-[#8A630D]'
                              : isAnswered
                                ? 'border-[#C5DDD3] bg-[#EFF7F3] text-[#0F4C3F]'
                                : 'border-[#DAE5E0] bg-[#F8FAF9] text-[#4A615A]'
                        }`}
                      >
                        {q.index}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSubmitExam()}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] transition-colors disabled:opacity-60 cursor-pointer shadow-xs"
                >
                  <Send className="w-4 h-4 text-[#E5C665]" />
                  <span>{submitting ? submittingNote || 'Đang nộp bài...' : 'Nộp bài ngay'}</span>
                </button>
              </aside>
            </div>
          </div>
        )}

        {/* VIOLATION WARNING MODAL (EXITS 1..3) */}
        {phase === 'taking' && showViolationModal && (
          <div className="fixed inset-0 z-50 bg-[#082B23]/65 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white border border-[#DAE5E0] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
                    Cảnh báo rời màn hình thi
                  </h2>
                  <div className="text-xs font-semibold text-[#8A630D] tabular-nums">
                    Lần thoát thứ {violationCount}/{MAX_ALLOWED_EXITS}
                  </div>
                </div>
              </div>

              <p className="text-sm text-[#3A524A] leading-relaxed">
                {violationCount >= MAX_ALLOWED_EXITS ? (
                  <>
                    Bạn đã sử dụng hết{' '}
                    <strong className="text-[#B91C1C]">
                      {MAX_ALLOWED_EXITS}/{MAX_ALLOWED_EXITS} lần
                    </strong>{' '}
                    thoát màn hình cho phép. Nếu thoát thêm một lần nữa, hệ thống sẽ{' '}
                    <strong className="text-[#B91C1C]">
                      ép buộc nộp bài ngay lập tức
                    </strong>
                    !
                  </>
                ) : (
                  <>
                    Hệ thống đã ghi nhận bạn thoát chế độ toàn màn hình hoặc chuyển
                    cửa sổ. Bạn chỉ còn{' '}
                    <strong className="text-[#0D221D] tabular-nums">
                      {MAX_ALLOWED_EXITS - violationCount} lần
                    </strong>{' '}
                    cảnh báo — thoát quá {MAX_ALLOWED_EXITS} lần sẽ bị ép buộc nộp
                    bài.
                  </>
                )}
              </p>

              <button
                type="button"
                onClick={async () => {
                  await enterFullscreen();
                  setShowViolationModal(false);
                }}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] cursor-pointer"
              >
                <Maximize2 className="w-4 h-4 text-[#E5C665]" />
                <span>Quay lại toàn màn hình &amp; tiếp tục làm bài</span>
              </button>
            </div>
          </div>
        )}

        {/* PHASE 3: RESULT SUMMARY */}
        {phase === 'result' && submittedResult && selectedExam && (() => {
          const wrongEntries = selectedExam.questions
            .map((q, idx) => ({ q, ans: submittedResult.answers[idx], idx }))
            .filter(({ q, ans }) => {
              if (!ans) return false;
              if (q.type === 'essay') return Boolean(ans.aiFeedback) && ans.score < q.maxScore;
              return ans.score < q.maxScore;
            });
          const allEntries = selectedExam.questions.map((q, idx) => ({
            q,
            ans: submittedResult.answers[idx],
            idx,
          }));
          const visibleEntries =
            resultTab === 'wrong_review' ? wrongEntries : allEntries;

          const renderQuestionReviewCard = ({
            q,
            ans,
          }: {
            q: ExamQuestion;
            ans: StudentAnswer | undefined;
            idx: number;
          }) => {
            const typeLabel =
              q.type === 'mcq'
                ? 'Trắc nghiệm'
                : q.type === 'true_false'
                  ? 'Đúng / Sai'
                  : q.type === 'short_answer'
                    ? 'Trả lời ngắn'
                    : 'Tự luận';
            const essayGradedByAi = q.type === 'essay' && Boolean(ans?.aiFeedback);
            const isPerfect =
              (q.type !== 'essay' || essayGradedByAi) && ans && ans.score >= q.maxScore;
            const isWrong =
              (q.type !== 'essay' || essayGradedByAi) && ans && ans.score < q.maxScore;

            return (
              <div
                key={q.id}
                className={`bg-white border rounded-2xl p-5 space-y-3 ${
                  isWrong
                    ? 'border-[#FCA5A5]'
                    : isPerfect
                      ? 'border-[#C5DDD3]'
                      : 'border-[#DAE5E0]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4A615A]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#0D221D]">
                      Câu {q.index} · {typeLabel}
                    </span>
                    <span>
                      · Thời gian:{' '}
                      <strong className="font-mono">
                        {formatDurationMMSS(ans?.timeSpentSeconds || 0)}
                      </strong>
                    </span>
                    {isWrong && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FEF2F2] text-[#B91C1C] font-semibold">
                        <XCircle className="w-3 h-3" />
                        <span>Cần ôn lại</span>
                      </span>
                    )}
                    {isPerfect && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F0FBF6] text-[#0F6D4F] font-semibold">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{q.type === 'essay' ? 'Đạt tối đa (AI chấm barem)' : 'Đúng'}</span>
                      </span>
                    )}
                    {q.type === 'essay' && !essayGradedByAi && (
                      <span className="px-2 py-0.5 rounded-md bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] font-semibold">
                        Chờ giáo viên chấm tự luận
                      </span>
                    )}
                    {essayGradedByAi && !isPerfect && (
                      <span className="px-2 py-0.5 rounded-md bg-[#EFF7F3] text-[#0F4C3F] font-semibold">
                        AI đã chấm theo barem (GV có thể điều chỉnh)
                      </span>
                    )}
                  </div>
                  <span className="font-semibold text-[#0D221D] tabular-nums">
                    {formatScore(ans?.score || 0)} / {q.maxScore} điểm
                  </span>
                </div>

                <MathText
                  text={q.prompt}
                  className="text-sm text-[#0D221D] whitespace-pre-line leading-relaxed"
                />

                {q.imageUrls && q.imageUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {q.imageUrls.map((url, uIdx) => (
                      <img
                        key={uIdx}
                        src={url}
                        alt={`Hình câu ${q.index}`}
                        onClick={() => setZoomImgUrl(url)}
                        className="max-h-44 rounded-lg border border-[#CEDCD6] object-contain bg-white cursor-zoom-in"
                      />
                    ))}
                  </div>
                )}

                {/* MCQ answer breakdown */}
                {q.type === 'mcq' && q.options && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {q.options.map((opt, optIdx) => {
                      const picked = ans?.selectedOption === optIdx;
                      const isKey = q.correctOption === optIdx;
                      let cls = 'border-[#DAE5E0] bg-[#F8FAF9] text-[#3A524A]';
                      if (isKey) {
                        cls = 'border-[#0F6D4F] bg-[#F0FBF6] text-[#0A362C] font-semibold';
                      } else if (picked && !isKey) {
                        cls = 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B] font-semibold';
                      }
                      return (
                        <div
                          key={optIdx}
                          className={`p-2.5 rounded-xl border flex items-start justify-between gap-2 ${cls}`}
                        >
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="font-mono font-bold shrink-0">
                              {OPTION_LETTERS[optIdx]}.
                            </span>
                            <MathText text={opt} className="leading-relaxed" inline />
                          </div>
                          {isKey && (
                            <span className="text-[10px] uppercase tracking-wider shrink-0 text-[#0F6D4F]">
                              Đáp án đúng
                            </span>
                          )}
                          {picked && !isKey && (
                            <span className="text-[10px] uppercase tracking-wider shrink-0 text-[#DC2626]">
                              Bạn chọn
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* True/False statement breakdown */}
                {q.type === 'true_false' && q.statements && (
                  <div className="space-y-1.5 text-xs">
                    {q.statements.map((st, sIdx) => {
                      const picked = ans?.statementAnswers?.[sIdx];
                      const right = picked === st.isTrue;
                      return (
                        <div
                          key={sIdx}
                          className={`p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                            right
                              ? 'border-[#C5DDD3] bg-[#F0FBF6] text-[#0A362C]'
                              : 'border-[#FECACA] bg-[#FEF2F2] text-[#7F1D1D]'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className="font-mono font-bold shrink-0">
                              {TF_LETTERS[sIdx]})
                            </span>
                            <MathText text={st.text} className="leading-relaxed" inline />
                          </div>
                          <div className="flex items-center gap-3 shrink-0 font-medium">
                            <span>
                              Bạn chọn:{' '}
                              <strong>
                                {picked === true ? 'Đúng' : picked === false ? 'Sai' : 'Chưa chọn'}
                              </strong>
                            </span>
                            <span>
                              Đáp án: <strong>{st.isTrue ? 'Đúng' : 'Sai'}</strong>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Short Answer breakdown */}
                {q.type === 'short_answer' && (
                  <div className="text-xs text-[#3A524A] flex flex-wrap gap-4">
                    <span>
                      Bạn điền:{' '}
                      <strong
                        className={`font-mono ${
                          isWrong ? 'text-[#B91C1C]' : 'text-[#0F6D4F]'
                        }`}
                      >
                        {ans?.textAnswer || '(bỏ trống)'}
                      </strong>
                    </span>
                    {q.correctAnswer && (
                      <span>
                        Đáp số chuẩn:{' '}
                        <strong className="font-mono text-[#0F4C3F]">
                          <MathText text={q.correctAnswer} inline />
                        </strong>
                      </span>
                    )}
                  </div>
                )}

                {/* Essay student response & AI Barem breakdown */}
                {q.type === 'essay' && (
                  <div className="space-y-2.5 text-xs text-[#3A524A]">
                    <div>
                      <span className="font-semibold text-[#0D221D]">Bài làm của bạn: </span>
                      <span>{ans?.textAnswer?.trim() || '(Chưa nhập chữ)'}</span>
                    </div>
                    {ans?.imageDataUrl && (
                      <img
                        src={ans.imageDataUrl}
                        alt={`Ảnh bài tự luận câu ${q.index}`}
                        onClick={() => setZoomImgUrl(ans.imageDataUrl!)}
                        className="max-h-40 rounded-lg border border-[#CEDCD6] object-contain bg-white cursor-zoom-in"
                      />
                    )}
                    {ans?.recognizedText && (
                      <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                          Nội dung AI đọc được từ bài làm / ảnh chụp
                        </div>
                        <MathText
                          text={ans.recognizedText}
                          className="text-xs text-[#0D221D] whitespace-pre-line leading-relaxed"
                        />
                      </div>
                    )}
                    {ans?.aiBreakdown && ans.aiBreakdown.length > 0 && (
                      <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0F4C3F]">
                          Chấm theo Barem 4 bước (Công thức · Thay số · Đáp số · Đơn vị)
                        </div>
                        {ans.aiBreakdown.map((b, bIdx) => (
                          <div
                            key={bIdx}
                            className="flex items-start justify-between gap-2 text-xs"
                          >
                            <div className="flex items-start gap-1.5 text-[#0D221D]">
                              {b.met ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#0F6D4F] shrink-0 mt-0.5" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-[#DC2626] shrink-0 mt-0.5" />
                              )}
                              <MathText text={b.criterion} inline />
                            </div>
                            <span className="font-mono font-semibold tabular-nums shrink-0 text-[#0D221D]">
                              {b.score}/{b.maxScore}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {ans?.aiFeedback && (
                      <div className="p-3 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-xs text-[#7A580B]">
                        <span className="font-semibold">Nhận xét chấm barem AI: </span>
                        <MathText text={ans.aiFeedback} inline />
                      </div>
                    )}
                  </div>
                )}

                {(q.explanation ||
                  (q.explanationImageUrls && q.explanationImageUrls.length > 0)) && (
                  <div className="p-3.5 rounded-xl bg-[#F0FBF6] border border-[#C5DDD3] text-xs text-[#0D221D] space-y-2">
                    <div className="uppercase tracking-wider font-bold text-[#0F6D4F]">
                      {q.type === 'essay' ? 'Hướng dẫn giải:' : 'Lời giải:'}
                    </div>
                    {q.explanation && (
                      <MathText
                        text={q.explanation}
                        className="whitespace-pre-line leading-relaxed"
                      />
                    )}
                    {q.explanationImageUrls && q.explanationImageUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {q.explanationImageUrls.map((u, uIdx) => (
                          <img
                            key={uIdx}
                            src={u}
                            alt={`Hướng dẫn giải câu ${q.index}`}
                            onClick={() => setZoomImgUrl(u)}
                            className="max-h-44 rounded-lg border border-[#C5DDD3] object-contain bg-white cursor-zoom-in"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          };

          const hasEssaysInExam = selectedExam.questions.some((q) => q.type === 'essay');
          const hasPendingEssays =
            submittedResult.status === 'pending_essay' ||
            selectedExam.questions.some(
              (q, idx) => q.type === 'essay' && !submittedResult.answers[idx]?.aiFeedback
            );
          const resultEffort = analyzeSubmissionEffort(submittedResult, selectedExam);
          const resultScore10 = getSubmissionScore10(submittedResult);

          return (
            <div className="space-y-6">
              {(forcedReason || submittedResult.violationCount > MAX_ALLOWED_EXITS) && (
                <div className="p-4 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-3 text-sm text-[#991B1B]">
                  <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-[#DC2626]" />
                  <div className="space-y-0.5">
                    <div className="font-semibold">
                      {submittedResult.violationCount > MAX_ALLOWED_EXITS
                        ? 'Bài thi đã bị ép buộc nộp bài'
                        : 'Hệ thống đã tự động thu bài'}
                    </div>
                    <p className="text-xs leading-relaxed">
                      {forcedReason ||
                        `Bạn đã thoát quá ${MAX_ALLOWED_EXITS} lần trong lúc làm bài (${submittedResult.violationCount} lần), hệ thống đã ép buộc nộp bài tự động.`}
                    </p>
                  </div>
                </div>
              )}

              {(essayAutoError || hasPendingEssays) && (
                <div className="p-4 rounded-2xl bg-[#FDF8EB] border border-[#EAD8A6] flex flex-wrap items-center justify-between gap-3 text-xs text-[#7A580B]">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#B0831A]" />
                    <div className="space-y-0.5">
                      <div className="font-semibold text-[#0D221D]">
                        Tự luận chưa hoàn tất chấm tự động
                      </div>
                      <p>
                        {essayAutoError ||
                          'Một số câu tự luận chưa được AI chấm điểm. Bấm nút bên phải để AI tự chấm theo Barem 4 bước ngay lập tức.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={retryingEssayAi}
                    onClick={() => void handleRetryAutoGradeEssays()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F4C3F] text-white font-semibold hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer shrink-0"
                  >
                    {retryingEssayAi ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E5C665]" />
                        <span>AI đang chấm tự luận...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-[#E5C665]" />
                        <span>AI tự chấm tự luận ngay</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Result Score Hero Card — Jade & Champagne Gold Highlight */}
              <div className="bg-gradient-to-br from-white via-white to-[#FDF8EB] border border-[#EAD8A6] rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-xs">
                <div className="space-y-1.5">
                  <div
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase ${
                      submittedResult.violationCount > MAX_ALLOWED_EXITS
                        ? 'text-[#B91C1C]'
                        : 'text-[#8A630D]'
                    }`}
                  >
                    {submittedResult.violationCount > MAX_ALLOWED_EXITS ? (
                      <>
                        <ShieldAlert className="w-4 h-4" />
                        <span>Đã ép buộc nộp bài</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-[#0F6D4F]" />
                        <span>Đã nộp bài thành công</span>
                      </>
                    )}
                  </div>
                  <h1 className="font-serif text-3xl font-semibold text-[#0D221D]">
                    {submittedResult.studentName}
                  </h1>
                  <p className="text-sm text-[#4A615A] tabular-nums">
                    {submittedResult.studentCode ? `Mã HS: ${submittedResult.studentCode} · ` : ''}
                    {submittedResult.className ? `Lớp ${submittedResult.className} · ` : ''}
                    {submittedResult.examTitle} · Thời gian làm:{' '}
                    {formatDurationMMSS(submittedResult.durationSeconds)} ·{' '}
                    {submittedResult.violationCount > MAX_ALLOWED_EXITS
                      ? `${submittedResult.violationCount} lần thoát (ép buộc nộp)`
                      : `${submittedResult.violationCount} lần thoát / vi phạm`}
                  </p>
                </div>

                <div className="text-left sm:text-right shrink-0 space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#8A630D]">
                    {hasPendingEssays
                      ? 'Điểm tạm tính'
                      : hasEssaysInExam
                        ? 'Điểm chính thức (AI đã tự chấm)'
                        : 'Điểm chính thức'}
                  </div>
                  <div className="font-serif text-4xl font-semibold text-[#0F4C3F] tabular-nums">
                    {formatScore(submittedResult.totalScore)}/
                    {formatScore(submittedResult.maxScore)}
                  </div>
                  <div className="text-xs text-[#597169] tabular-nums">
                    Quy đổi thang 10: <strong className="text-[#0D221D]">{resultScore10.toFixed(2)}/10</strong>
                  </div>
                  <div className="flex flex-wrap sm:justify-end gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setStudentPage('progress')}
                      className="text-xs font-semibold text-[#8A630D] hover:underline cursor-pointer"
                    >
                      Xem tiến độ học tập
                    </button>
                    <button
                      type="button"
                      onClick={() => setPhase('setup')}
                      className="text-xs font-semibold text-[#0F4C3F] hover:text-[#8A630D] hover:underline cursor-pointer"
                    >
                      Làm lại đề khác
                    </button>
                  </div>
                </div>
              </div>

              {/* Post-exam Student Analysis & Feedback Card */}
              {(() => {
                const typeStats = (
                  [
                    { key: 'mcq', label: 'Trắc nghiệm' },
                    { key: 'true_false', label: 'Đúng / Sai' },
                    { key: 'short_answer', label: 'Trả lời ngắn' },
                    { key: 'essay', label: 'Tự luận' },
                  ] as const
                )
                  .map((item) => {
                    const list = selectedExam.questions
                      .map((q, i) => ({ q, a: submittedResult.answers[i] }))
                      .filter((pair) => pair.q.type === item.key);
                    if (list.length === 0) return null;
                    const earned = list.reduce((s, p) => s + (p.a?.score || 0), 0);
                    const max = list.reduce((s, p) => s + p.q.maxScore, 0);
                    return {
                      ...item,
                      count: list.length,
                      earned: Number(earned.toFixed(2)),
                      max: Number(max.toFixed(2)),
                    };
                  })
                  .filter(Boolean) as Array<{
                  key: string;
                  label: string;
                  count: number;
                  earned: number;
                  max: number;
                }>;

                return (
                  <section className="bg-white border border-[#DAE5E0] rounded-2xl p-5 sm:p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#C89B2B]" />
                        <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
                          Phân tích &amp; Nhận xét bài làm của bạn
                        </h2>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#4A615A] tabular-nums">
                        <span>Tốc độ TB: {resultEffort.metrics.avgSecondsPerQuestion}s/câu</span>
                        {resultEffort.metrics.fastGuessCount > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] font-semibold">
                            {resultEffort.metrics.fastGuessCount} câu chọn nhanh (&lt;5s)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Student Effort & Pacing Diagnostic Banner */}
                    <div
                      className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        resultEffort.level === 'perfunctory'
                          ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                          : resultEffort.level === 'watch'
                            ? 'bg-[#FDF8EB] border-[#EAD8A6] text-[#7A580B]'
                            : 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0A362C]'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="font-bold flex items-center gap-1.5">
                          {resultEffort.level === 'perfunctory' ? (
                            <ShieldAlert className="w-4 h-4 shrink-0" />
                          ) : resultEffort.level === 'watch' ? (
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-[#0F6D4F] shrink-0" />
                          )}
                          <span>
                            Đánh giá thái độ &amp; nhịp độ làm bài: {resultEffort.label}
                          </span>
                        </div>
                        {resultEffort.reasons.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-0.5 leading-relaxed">
                            {resultEffort.reasons.map((r, rIdx) => (
                              <li key={rIdx}>{r}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="leading-relaxed">
                            Bạn phân bổ thời gian hợp lý, hoàn thành đầy đủ các phần thi và không có dấu hiệu làm vội đối phó.
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setStudentPage('progress')}
                        className="px-3 py-1.5 rounded-lg bg-white border border-current/25 font-semibold whitespace-nowrap cursor-pointer self-start sm:self-center"
                      >
                        Đối chiếu lịch sử tiến độ
                      </button>
                    </div>

                    {/* Instant section-by-section score breakdown */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {typeStats.map((st) => (
                        <div
                          key={st.key}
                          className="p-3 rounded-xl bg-[#F8FAF9] border border-[#EBF1EE]"
                        >
                          <div className="text-[11px] font-medium text-[#597169]">
                            {st.label} ({st.count} câu)
                          </div>
                          <div className="font-serif text-lg font-semibold text-[#0D221D] mt-0.5 tabular-nums">
                            {formatScore(st.earned)}/{formatScore(st.max)} đ
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI Personalized Commentary */}
                    {reviewLoading ? (
                      <div className="p-4 rounded-xl bg-[#EFF7F3] border border-[#DCECE4] flex items-center gap-3 text-xs text-[#0F4C3F]">
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span>AI đang phân tích chi tiết bài làm và viết nhận xét cho bạn...</span>
                      </div>
                    ) : reviewError ? (
                      <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex flex-wrap items-center justify-between gap-2 text-xs text-[#991B1B]">
                        <span>{reviewError}</span>
                        <button
                          type="button"
                          onClick={() =>
                            fetchStudentReview(
                              selectedExam,
                              submittedResult.answers,
                              submittedResult.totalScore,
                              submittedResult.maxScore,
                              submittedResult.durationSeconds,
                              submittedResult.id
                            )
                          }
                          className="px-3 py-1 rounded-lg bg-white border border-[#FCA5A5] font-semibold text-[#991B1B] hover:bg-[#FEF2F2] cursor-pointer"
                        >
                          Tải lại nhận xét
                        </button>
                      </div>
                    ) : studentReview ? (
                      <div className="space-y-3 text-xs sm:text-sm">
                        <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] text-[#0D221D] leading-relaxed">
                          <MathText text={studentReview.overallComment} className="leading-relaxed" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div className="p-3.5 rounded-xl bg-[#F0FBF6] border border-[#C5DDD3] text-[#0D221D] space-y-1">
                            <div className="font-bold uppercase tracking-wider text-[#0F6D4F]">
                              Điểm làm tốt
                            </div>
                            <MathText text={studentReview.strengths} className="leading-relaxed" />
                          </div>

                          <div className="p-3.5 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-[#7A580B] space-y-1">
                            <div className="font-bold uppercase tracking-wider text-[#8A630D]">
                              Lỗi cần khắc phục
                            </div>
                            <MathText text={studentReview.weaknesses} className="leading-relaxed" />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#EBF1EE] text-[#3A524A] space-y-1">
                            <div className="font-semibold text-[#0D221D]">Nhịp độ làm bài</div>
                            <MathText text={studentReview.pacingNote} className="leading-relaxed" />
                          </div>

                          <div className="p-3 rounded-xl bg-[#EFF7F3] border border-[#DCECE4] text-[#0D221D] space-y-1">
                            <div className="font-semibold text-[#0F4C3F]">Gợi ý ôn tập ngay</div>
                            <MathText text={studentReview.studyPlan} className="leading-relaxed" />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })()}

              {/* Navigation Tabs for Post-Exam Review & AI Practice */}
              <div className="flex flex-wrap items-center gap-2 border-b border-[#DAE5E0] pb-3">
                {wrongEntries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setResultTab('wrong_review')}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                      resultTab === 'wrong_review'
                        ? 'bg-[#B91C1C] text-white'
                        : 'bg-white border border-[#DAE5E0] text-[#991B1B] hover:bg-[#FEF2F2]'
                    }`}
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Ôn tập các câu đã sai ({wrongEntries.length})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setResultTab('ai_practice');
                    if (
                      wrongEntries.length > 0 &&
                      !practiceData &&
                      !practiceLoading &&
                      !practiceError
                    ) {
                      void fetchRemedialPractice(selectedExam, submittedResult.answers);
                    }
                  }}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                    resultTab === 'ai_practice'
                      ? 'bg-[#0F4C3F] text-white'
                      : 'bg-white border border-[#DAE5E0] text-[#0F4C3F] hover:bg-[#EFF7F3]'
                  }`}
                >
                  {practiceLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#E5C665]" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-[#C89B2B]" />
                  )}
                  <span>
                    Luyện câu ôn tập AI
                    {practiceData?.practiceQuestions.length
                      ? ` (${practiceData.practiceQuestions.length})`
                      : ''}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setResultTab('all')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                    resultTab === 'all'
                      ? 'bg-[#0A362C] text-[#F7E5A9]'
                      : 'bg-white border border-[#DAE5E0] text-[#3A524A] hover:bg-[#EFF7F3]'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Tất cả câu trong đề ({allEntries.length})</span>
                </button>
              </div>

              {/* Tab Content */}
              {resultTab === 'ai_practice' ? (
                <RemedialPracticePanel
                  practiceData={practiceData}
                  loading={practiceLoading}
                  error={practiceError}
                  wrongCount={wrongEntries.length}
                  onRegenerate={() =>
                    fetchRemedialPractice(selectedExam, submittedResult.answers)
                  }
                />
              ) : (
                <div className="space-y-4">
                  {resultTab === 'wrong_review' && wrongEntries.length > 0 && (
                    <div className="bg-gradient-to-r from-[#EFF7F3] to-[#FDF8EB] border border-[#DCECE4] rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-[#0D221D]">
                          Bạn có {wrongEntries.length} câu làm sai hoặc chưa đủ điểm tối đa
                        </div>
                        <p className="text-xs text-[#3A524A] leading-relaxed">
                          Xem lại đáp án đúng và lời giải chi tiết ở bên dưới, sau đó chuyển sang phần AI luyện câu tương tự để củng cố ngay kiến thức vừa hổng.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setResultTab('ai_practice')}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] shrink-0 cursor-pointer shadow-xs"
                      >
                        {practiceLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[#E5C665]" />
                        ) : (
                          <Sparkles className="w-4 h-4 text-[#E5C665]" />
                        )}
                        <span>
                          {practiceLoading
                            ? 'AI đang soạn câu ôn tập...'
                            : 'Làm câu ôn tập AI ngay'}
                        </span>
                      </button>
                    </div>
                  )}

                  {visibleEntries.map(renderQuestionReviewCard)}
                </div>
              )}
            </div>
          );
        })()}
          </>
        )}
      </main>

      {zoomImgUrl && (
        <div
          onClick={() => setZoomImgUrl(null)}
          className="fixed inset-0 z-50 bg-[#082B23]/85 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img
            src={zoomImgUrl}
            alt="Hình câu hỏi phóng to"
            className="max-w-full max-h-[90vh] rounded-xl bg-white object-contain"
          />
        </div>
      )}
    </div>
  );
}
