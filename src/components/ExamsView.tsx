import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  FileText,
  Image as ImageIcon,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PHYSICS_12_QUESTIONS } from '../data/seedData';
import {
  createExam,
  deleteExam,
  deleteSubmission,
  deleteSubmissionsBulk,
  extractFriendlyFirestoreError,
  normalizeExamCode,
  toggleExamPublish,
  updateExam,
} from '../services/firestoreService';
import {
  batchAnalyzeSubmissionsWithAi,
  batchRegradeSubmissionsWithAi,
  type BatchAiProgress,
  type BatchAiResult,
} from '../services/batchGradingService';
import {
  generateExamWithAi,
  generateExplanationsWithAi,
  parseWordExamWithAi,
} from '../services/geminiService';
import { selectRelevantReferenceContext } from '../services/referenceBankService';
import type {
  Classroom,
  EffortLevel,
  Exam,
  ExamQuestion,
  ParentMessage,
  QuestionType,
  ReferenceMaterial,
  Submission,
} from '../types';
import {
  getSubmissionScore10,
  resolveClassForSubmission,
} from '../utils/classStats';
import { summarizeCohortEffort } from '../utils/effortAnalysis';
import {
  parseDocxExam,
  type DocxParseResult,
  type ParsedDocxQuestion,
} from '../utils/docxParser';
import { resolveAssignedClassLabels } from '../utils/examAssignment';
import { formatDurationMMSS, formatScore } from '../utils/formatters';
import { compressExamPhoto } from '../utils/imageUtils';
import { ClassStatsSection } from './ClassStatsSection';
import { ExamEditorModal } from './ExamEditorModal';
import { containsLatexFormula, MathText } from './MathText';
import { PhotoEssayGraderModal } from './PhotoEssayGraderModal';

interface ExamsViewProps {
  teacherId: string;
  classes?: Classroom[];
  exams: Exam[];
  submissions: Submission[];
  parentMessages?: ParentMessage[];
  referenceMaterials?: ReferenceMaterial[];
  selectedExamId: string | null;
  onSelectExam: (examId: string | null) => void;
  onSelectSubmission: (submissionId: string) => void;
  openCreateModalSignal?: number;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export function ExamsView({
  teacherId,
  classes = [],
  exams,
  submissions,
  parentMessages = [],
  referenceMaterials = [],
  selectedExamId,
  onSelectExam,
  onSelectSubmission,
  openCreateModalSignal = 0,
}: ExamsViewProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [searchSub, setSearchSub] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [effortFilter, setEffortFilter] = useState<'all' | EffortLevel>('all');
  const [inspectedQuestionId, setInspectedQuestionId] = useState<string | null>(null);
  const [showPhotoGrader, setShowPhotoGrader] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  // Quick Edit Exam Code & Class Assignment Modal
  const [assigningExam, setAssigningExam] = useState<Exam | null>(null);
  const [assignExamCode, setAssignExamCode] = useState('');
  const [assignClassIds, setAssignClassIds] = useState<string[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  // Create Exam Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState<'word' | 'ai' | 'template'>('word');
  const [newTitle, setNewTitle] = useState('');
  const [newSubject, setNewSubject] = useState('Vật lí');
  const [newExamCode, setNewExamCode] = useState('');
  const [newDuration, setNewDuration] = useState(45);
  const [newAssignedClassIds, setNewAssignedClassIds] = useState<string[]>([]);
  const [aiTopic, setAiTopic] = useState('Nhiệt học và Khí lí tưởng — Vật lí 12');
  const [aiMcqCount, setAiMcqCount] = useState(4);
  const [aiTfCount, setAiTfCount] = useState(1);
  const [aiShortCount, setAiShortCount] = useState(1);
  const [aiEssayCount, setAiEssayCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [previewQuestions, setPreviewQuestions] = useState<ExamQuestion[] | null>(null);

  // Word (.docx) import state
  const [wordFileName, setWordFileName] = useState('');
  const [wordResult, setWordResult] = useState<DocxParseResult | null>(null);
  const [wordQuestions, setWordQuestions] = useState<ParsedDocxQuestion[]>([]);
  const [wordFilterMode, setWordFilterMode] = useState<'all' | 'essay'>('all');
  const [autoGenerateWordExplanations, setAutoGenerateWordExplanations] = useState(true);
  const [generatingWordExplanations, setGeneratingWordExplanations] = useState(false);
  const [parsingWord, setParsingWord] = useState(false);
  const [refiningWordAi, setRefiningWordAi] = useState(false);

  // Submission deletion state (for pruning test runs / keeping clean analytics)
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmDeleteSubId, setConfirmDeleteSubId] = useState<string | null>(null);
  const [deletingSubId, setDeletingSubId] = useState<string | null>(null);
  const [subActionError, setSubActionError] = useState<string | null>(null);

  // Batch AI re-grading & batch analysis state
  const [batchPanelMode, setBatchPanelMode] = useState<'none' | 'regrade' | 'analyze'>('none');
  const [batchCustomBarem, setBatchCustomBarem] = useState('');
  const [batchAlsoAnalyze, setBatchAlsoAnalyze] = useState(true);
  const [batchOverwriteComment, setBatchOverwriteComment] = useState(true);
  const [batchSyncMessages, setBatchSyncMessages] = useState(true);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchAiProgress | null>(null);
  const [batchResult, setBatchResult] = useState<BatchAiResult | null>(null);
  const batchAbortRef = useRef(false);

  useEffect(() => {
    if (openCreateModalSignal > 0) {
      setShowCreateModal(true);
      setCreateMode('word');
    }
  }, [openCreateModalSignal]);

  useEffect(() => {
    setInspectedQuestionId(null);
    setClassFilter('all');
    setSelectedSubIds(new Set());
    setConfirmBulkDelete(false);
    setConfirmDeleteSubId(null);
    setSubActionError(null);
    setBatchPanelMode('none');
    setBatchResult(null);
    setBatchProgress(null);
    batchAbortRef.current = true;
  }, [selectedExamId]);

  const activeExam = exams.find((e) => e.id === selectedExamId) || null;

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1800);
  };

  const openQuickAssignModal = (exam: Exam) => {
    setAssignmentError(null);
    setAssigningExam(exam);
    setAssignExamCode(exam.examCode);
    setAssignClassIds(Array.isArray(exam.assignedClassIds) ? [...exam.assignedClassIds] : []);
  };

  const handleSaveQuickAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningExam) return;
    const normalized = normalizeExamCode(assignExamCode);
    if (normalized.length < 3 || normalized.length > 30) {
      setAssignmentError(
        'Mã đề phải dài từ 3 đến 30 ký tự, chỉ gồm chữ không dấu, số, dấu gạch dưới (_) hoặc gạch ngang (-).'
      );
      return;
    }

    const classMap = new Map(classes.map((c) => [c.id, c.name]));
    const cleanIds = assignClassIds.filter((id) => classMap.has(id) || id.length > 0);
    const cleanNames = cleanIds.map((id) => classMap.get(id) || id);

    setSavingAssignment(true);
    setAssignmentError(null);
    try {
      await updateExam(assigningExam.id, {
        examCode: normalized,
        assignedClassIds: cleanIds,
        assignedClassNames: cleanNames,
      });
      setAssigningExam(null);
    } catch (err) {
      setAssignmentError(extractFriendlyFirestoreError(err));
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleGenerateWordExplanations = async (
    targetQuestions: ParsedDocxQuestion[],
    meta?: { title?: string; subject?: string; overwriteAll?: boolean }
  ) => {
    const overwriteAll = Boolean(meta?.overwriteAll);
    const missingCount = targetQuestions.filter((q) => !q.explanation?.trim()).length;
    if (!overwriteAll && missingCount === 0) return;

    setGeneratingWordExplanations(true);
    setCreateError(null);
    try {
      const data = await generateExplanationsWithAi({
        title: meta?.title ?? (newTitle.trim() || 'Đề kiểm tra từ file Word'),
        subject: meta?.subject ?? (newSubject.trim() || 'Tổng hợp'),
        overwriteAll,
        questions: targetQuestions.map((q) => ({
          id: q.id,
          index: q.index,
          type: q.type,
          prompt: q.prompt,
          ...(q.options ? { options: q.options } : {}),
          ...(typeof q.correctOption === 'number'
            ? { correctOption: q.correctOption }
            : {}),
          ...(q.statements ? { statements: q.statements } : {}),
          ...(q.correctAnswer ? { correctAnswer: q.correctAnswer } : {}),
          explanation: q.explanation || '',
        })),
      });
      const expMap = new Map<string, string>();
      if (Array.isArray(data.explanations)) {
        for (const item of data.explanations) {
          if (item?.id && item?.explanation) {
            expMap.set(String(item.id), String(item.explanation));
          }
        }
      }
      if (expMap.size > 0) {
        setWordQuestions((prev) =>
          prev.map((q) => {
            const generated = expMap.get(q.id);
            if (!generated) return q;
            return {
              ...q,
              explanation: generated,
              ...(q.type === 'essay' ? { needsReview: false } : {}),
            };
          })
        );
      }
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? `Đã đọc xong file Word, nhưng bước AI tạo lời giải gặp lỗi: ${err.message}`
          : 'Không thể tạo lời giải tự động bằng AI.'
      );
    } finally {
      setGeneratingWordExplanations(false);
    }
  };

  const handleWordFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setParsingWord(true);
    setCreateError(null);
    setWordFileName(file.name);
    try {
      const parsed = await parseDocxExam(file);
      setWordResult(parsed);
      setWordQuestions(parsed.questions);
      setNewTitle(parsed.title);
      setNewSubject(parsed.subject);
      setNewDuration(parsed.durationMinutes);
      if (parsed.questions.length === 0) {
        setCreateError(
          'Không nhận diện được cấu trúc "Câu 1: ..." tự động. Hãy bấm "Chuẩn hoá lại bằng AI" để Gemini phân tích toàn bộ nội dung và giữ nguyên hình ảnh.'
        );
      } else if (
        autoGenerateWordExplanations &&
        parsed.questions.some((q) => !q.explanation?.trim())
      ) {
        void handleGenerateWordExplanations(parsed.questions, {
          title: parsed.title,
          subject: parsed.subject,
          overwriteAll: false,
        });
      }
    } catch (err) {
      setWordResult(null);
      setWordQuestions([]);
      setCreateError(
        err instanceof Error ? err.message : 'Không thể đọc tệp Word (.docx).'
      );
    } finally {
      setParsingWord(false);
    }
  };

  const handleRefineWordWithAI = async () => {
    if (!wordResult?.annotatedTextForAi) return;
    setRefiningWordAi(true);
    setCreateError(null);
    try {
      const data = await parseWordExamWithAi({
        annotatedText: wordResult.annotatedTextForAi,
      });
      const pool = wordResult.imagePool;
      const mapped: ParsedDocxQuestion[] = (data.questions || []).map(
        (
          q: Partial<ExamQuestion> & {
            imageIndices?: number[];
            explanationImageIndices?: number[];
          },
          idx: number
        ) => {
          const type: QuestionType =
            q.type === 'true_false' ||
            q.type === 'short_answer' ||
            q.type === 'essay'
              ? q.type
              : 'mcq';
          const imageUrls = Array.isArray(q.imageIndices)
            ? q.imageIndices
                .map((i) => pool[i])
                .filter((u): u is string => Boolean(u))
            : undefined;
          const explanationImageUrls = Array.isArray(q.explanationImageIndices)
            ? q.explanationImageIndices
                .map((i) => pool[i])
                .filter((u): u is string => Boolean(u))
            : undefined;
          return {
            id: `q${idx + 1}`,
            index: idx + 1,
            type,
            prompt: q.prompt || `Câu hỏi ${idx + 1}`,
            maxScore: Number(
              q.maxScore ||
                (type === 'true_false'
                  ? 1
                  : type === 'essay'
                    ? 1
                    : type === 'short_answer'
                      ? 0.5
                      : 0.25)
            ),
            ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
            ...(type === 'mcq'
              ? {
                  options:
                    q.options && q.options.length > 0
                      ? q.options.slice(0, 4)
                      : ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
                  correctOption:
                    typeof q.correctOption === 'number' ? q.correctOption : 0,
                }
              : {}),
            ...(type === 'true_false'
              ? {
                  statements:
                    q.statements && q.statements.length > 0
                      ? q.statements.slice(0, 4)
                      : [
                          { text: 'Ý a', isTrue: true },
                          { text: 'Ý b', isTrue: false },
                          { text: 'Ý c', isTrue: true },
                          { text: 'Ý d', isTrue: false },
                        ],
                }
              : {}),
            ...(type === 'short_answer' || type === 'essay'
              ? { correctAnswer: q.correctAnswer || '' }
              : {}),
            explanation: q.explanation || '',
            ...(explanationImageUrls && explanationImageUrls.length > 0
              ? { explanationImageUrls }
              : {}),
            answerSource: 'explicit',
            needsReview: false,
          };
        }
      );

      if (mapped.length === 0) {
        throw new Error('AI không trích xuất được câu hỏi nào từ tệp Word.');
      }
      if (data.title && !newTitle.trim()) setNewTitle(data.title);
      if (data.subject) setNewSubject(data.subject);
      setWordQuestions(mapped);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Lỗi chuẩn hoá bằng AI.');
    } finally {
      setRefiningWordAi(false);
    }
  };

  const updateWordQuestion = (
    idx: number,
    updater: (prev: ParsedDocxQuestion) => ParsedDocxQuestion
  ) => {
    setWordQuestions((prev) => prev.map((q, i) => (i === idx ? updater(q) : q)));
  };

  const handleAddEssayToWordQuestions = () => {
    const nextIdx = wordQuestions.length + 1;
    setWordQuestions((prev) => [
      ...prev,
      {
        id: `q_essay_${Date.now().toString(36)}_${nextIdx}`,
        index: nextIdx,
        type: 'essay',
        prompt: '',
        maxScore: 1,
        correctAnswer: '',
        explanation: '',
        answerSource: 'explicit',
        needsReview: false,
      },
    ]);
    setWordFilterMode('essay');
  };

  const handleDeleteWordQuestion = (idx: number) => {
    setWordQuestions((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((q, newIdx) => ({ ...q, index: newIdx + 1 }))
    );
  };

  const handleAttachExtraImageToWordQuestion = async (
    qIdx: number,
    file: File | undefined,
    targetField: 'imageUrls' | 'explanationImageUrls' = 'imageUrls'
  ) => {
    if (!file) return;
    try {
      const compressed = await compressExamPhoto(file);
      updateWordQuestion(qIdx, (prev) => ({
        ...prev,
        [targetField]: [...(prev[targetField] || []), compressed.storageDataUrl],
      }));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Không thể đọc ảnh.');
    }
  };

  const handleGenerateWithAI = async () => {
    setGenerating(true);
    setCreateError(null);
    try {
      const referenceContext = selectRelevantReferenceContext({
        materials: referenceMaterials,
        subject: newSubject,
        examTitle: aiTopic,
        queryTexts: [aiTopic, newTitle].filter(Boolean),
        maxItems: 8,
      });
      const data = await generateExamWithAi({
        subject: newSubject,
        topic: aiTopic,
        mcqCount: aiMcqCount,
        tfCount: aiTfCount,
        shortCount: aiShortCount,
        essayCount: aiEssayCount,
        referenceContext,
      });
      const normalized: ExamQuestion[] = (data.questions || []).map(
        (q: Partial<ExamQuestion>, idx: number) => {
          const type: QuestionType =
            q.type === 'true_false' ||
            q.type === 'short_answer' ||
            q.type === 'essay'
              ? q.type
              : 'mcq';
          return {
            id: `q${idx + 1}`,
            index: idx + 1,
            type,
            prompt: q.prompt || `Câu hỏi ${idx + 1}`,
            maxScore: Number(
              q.maxScore ||
                (type === 'true_false'
                  ? 1
                  : type === 'essay'
                    ? 1
                    : type === 'short_answer'
                      ? 0.5
                      : 0.25)
            ),
            options: q.options,
            correctOption: q.correctOption ?? 0,
            statements: q.statements,
            correctAnswer: q.correctAnswer || '',
            explanation: q.explanation || 'Xem lại kiến thức trọng tâm trong bài.',
          };
        }
      );
      if (normalized.length === 0) {
        throw new Error('AI không trả về câu hỏi nào. Vui lòng thử mô tả rõ hơn.');
      }
      if (!newTitle.trim() && data.title) {
        setNewTitle(data.title);
      }
      setPreviewQuestions(normalized);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Lỗi không xác định.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveNewExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    const questionsToUse =
      createMode === 'template'
        ? PHYSICS_12_QUESTIONS
        : createMode === 'word'
          ? wordQuestions
          : previewQuestions || [];

    if (questionsToUse.length === 0) {
      setCreateError(
        createMode === 'word'
          ? 'Vui lòng tải lên tệp Word (.docx) chứa câu hỏi trước khi lưu.'
          : 'Vui lòng nhấn "Sinh câu hỏi bằng AI" hoặc chọn tab Đề mẫu.'
      );
      return;
    }

    const classMap = new Map(classes.map((c) => [c.id, c.name]));
    const cleanClassIds = newAssignedClassIds.filter((id) => classMap.has(id) || id.length > 0);
    const cleanClassNames = cleanClassIds.map((id) => classMap.get(id) || id);

    setGenerating(true);
    try {
      const id = await createExam(teacherId, {
        title:
          newTitle.trim() ||
          (createMode === 'template'
            ? 'Đề ôn tập mẫu — Vật lí 12'
            : `Đề kiểm tra ${newSubject}`),
        subject: newSubject.trim() || 'Vật lí',
        ...(newExamCode.trim() ? { examCode: newExamCode.trim() } : {}),
        durationMinutes: newDuration,
        isPublished: true,
        questions: questionsToUse,
        assignedClassIds: cleanClassIds,
        assignedClassNames: cleanClassNames,
      });
      setShowCreateModal(false);
      setPreviewQuestions(null);
      setWordResult(null);
      setWordQuestions([]);
      setWordFileName('');
      setNewTitle('');
      setNewExamCode('');
      setNewAssignedClassIds([]);
      onSelectExam(id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Không thể lưu đề.');
    } finally {
      setGenerating(false);
    }
  };

  // ---------------- EXAM ANALYTICS VIEW (Screenshot 2 + Deep Question/Timing Drilldown) ----------------
  if (activeExam) {
    const allExamSubs = submissions.filter((s) => s.examId === activeExam.id);
    const getSubClassLabel = (s: Submission) => {
      const resolved = resolveClassForSubmission(s, classes);
      return (resolved?.name || s.className || 'Chưa ghi lớp').trim();
    };
    const examSubs =
      classFilter === 'all'
        ? allExamSubs
        : allExamSubs.filter(
            (s) => getSubClassLabel(s).toLowerCase() === classFilter.trim().toLowerCase()
          );
    const totalSubs = examSubs.length;
    const avgScore10 =
      totalSubs > 0
        ? examSubs.reduce((sum, s) => sum + getSubmissionScore10(s), 0) / totalSubs
        : 0;
    const avgRawScore =
      totalSubs > 0
        ? examSubs.reduce((sum, s) => sum + s.totalScore, 0) / totalSubs
        : 0;
    const avgRawMax =
      totalSubs > 0
        ? examSubs.reduce((sum, s) => sum + s.maxScore, 0) / totalSubs
        : 10;
    const passCount = examSubs.filter(
      (s) => s.maxScore > 0 && s.totalScore / s.maxScore >= 0.5
    ).length;
    const passRate = totalSubs > 0 ? Math.round((passCount / totalSubs) * 100) : 0;
    const pendingEssay = examSubs.filter((s) => s.status === 'pending_essay').length;

    const buckets = [
      { label: 'Dưới 40%', count: 0 },
      { label: '40–59%', count: 0 },
      { label: '60–74%', count: 0 },
      { label: '75–89%', count: 0 },
      { label: '90–100%', count: 0 },
    ];
    examSubs.forEach((s) => {
      const pct = s.maxScore > 0 ? (s.totalScore / s.maxScore) * 100 : 0;
      if (pct < 40) buckets[0].count++;
      else if (pct < 60) buckets[1].count++;
      else if (pct < 75) buckets[2].count++;
      else if (pct < 90) buckets[3].count++;
      else buckets[4].count++;
    });
    const maxBucketCount = Math.max(4, ...buckets.map((b) => b.count));
    const yAxisStep = Math.ceil(maxBucketCount / 4);
    const yAxisMax = yAxisStep * 4;

    const partGroups: { key: QuestionType; label: string }[] = [
      { key: 'mcq', label: 'Trắc nghiệm' },
      { key: 'true_false', label: 'Đúng / Sai' },
      { key: 'short_answer', label: 'Trả lời ngắn' },
      { key: 'essay', label: 'Tự luận' },
    ];
    const partStats = partGroups.map((grp) => {
      const qIds = new Set(
        activeExam.questions.filter((q) => q.type === grp.key).map((q) => q.id)
      );
      if (qIds.size === 0 || totalSubs === 0) {
        return { label: grp.label, pct: 0, hasQuestions: qIds.size > 0 };
      }
      let earned = 0;
      let max = 0;
      examSubs.forEach((sub) => {
        sub.answers.forEach((ans) => {
          if (qIds.has(ans.questionId)) {
            earned += ans.score;
            max += ans.maxScore;
          }
        });
      });
      const pct = max > 0 ? Math.round((earned / max) * 100) : 0;
      return { label: grp.label, pct, hasQuestions: true };
    });

    // Deep per-question + per-response-time analytics across all submissions
    const questionStats = activeExam.questions.map((q) => {
      let correctCount = 0;
      let earnedSum = 0;
      let maxSum = 0;
      let totalTimeSec = 0;
      let timeCount = 0;
      let rightTimeSum = 0;
      let rightTimeCount = 0;
      let wrongTimeSum = 0;
      let wrongTimeCount = 0;
      let fastGuessCount = 0;
      const optionCounts = [0, 0, 0, 0];
      const studentBreakdown: {
        submissionId: string;
        studentName: string;
        className: string;
        timeSpentSeconds: number;
        score: number;
        maxScore: number;
        isCorrect: boolean;
        isFast: boolean;
      }[] = [];

      examSubs.forEach((sub) => {
        const ans = sub.answers.find((a) => a.questionId === q.id);
        if (ans) {
          earnedSum += ans.score;
          maxSum += ans.maxScore;
          const isRight =
            ans.isCorrect || (ans.maxScore > 0 && ans.score >= ans.maxScore);
          if (isRight) correctCount++;

          const t = ans.timeSpentSeconds || 0;
          totalTimeSec += t;
          timeCount++;
          if (isRight) {
            rightTimeSum += t;
            rightTimeCount++;
          } else {
            wrongTimeSum += t;
            wrongTimeCount++;
          }

          const isFast = t > 0 && t < 5;
          if (isFast) fastGuessCount++;

          if (
            q.type === 'mcq' &&
            ans.selectedOption !== null &&
            ans.selectedOption !== undefined &&
            ans.selectedOption >= 0 &&
            ans.selectedOption < 4
          ) {
            optionCounts[ans.selectedOption]++;
          }

          studentBreakdown.push({
            submissionId: sub.id,
            studentName: sub.studentName,
            className: sub.className,
            timeSpentSeconds: t,
            score: ans.score,
            maxScore: ans.maxScore,
            isCorrect: isRight,
            isFast,
          });
        }
      });

      const pct =
        totalSubs > 0
          ? q.type === 'mcq'
            ? Math.round((correctCount / totalSubs) * 100)
            : maxSum > 0
              ? Math.round((earnedSum / maxSum) * 100)
              : 0
          : 0;
      const avgSec = timeCount > 0 ? Math.round(totalTimeSec / timeCount) : 0;
      const avgRightSec =
        rightTimeCount > 0 ? Math.round(rightTimeSum / rightTimeCount) : 0;
      const avgWrongSec =
        wrongTimeCount > 0 ? Math.round(wrongTimeSum / wrongTimeCount) : 0;
      const typeLabel =
        q.type === 'mcq'
          ? 'Trắc nghiệm'
          : q.type === 'true_false'
            ? 'Đúng / Sai'
            : q.type === 'short_answer'
              ? 'Trả lời ngắn'
              : 'Tự luận';

      return {
        question: q,
        typeLabel,
        correctCount,
        totalSubs,
        pct,
        avgSec,
        avgRightSec,
        avgWrongSec,
        fastGuessCount,
        optionCounts,
        studentBreakdown,
      };
    });

    const inspectedStat =
      questionStats.find((qs) => qs.question.id === inspectedQuestionId) || null;

    const classOptions = Array.from(
      new Set(allExamSubs.map((s) => getSubClassLabel(s)).filter(Boolean))
    );
    const cohortEffort = summarizeCohortEffort(examSubs, [activeExam]);
    const filteredSubs = examSubs.filter((s) => {
      const q = searchSub.trim().toLowerCase();
      if (q && !s.studentName.toLowerCase().includes(q)) return false;
      if (effortFilter !== 'all') {
        const eff = cohortEffort.bySubmissionId.get(s.id);
        if (!eff || eff.level !== effortFilter) return false;
      }
      return true;
    });

    const handleExportCSV = () => {
      const header =
        'Họ tên,Lớp,Thời gian (giây),Vi phạm,Điểm,Thang điểm,Trạng thái,Lời phê\n';
      const rows = examSubs
        .map((s) =>
          [
            `"${s.studentName.replace(/"/g, '""')}"`,
            `"${s.className}"`,
            s.durationSeconds,
            s.violationCount,
            s.totalScore,
            s.maxScore,
            s.status === 'pending_essay' ? 'Chờ chấm' : 'Đã chấm',
            `"${(s.teacherComment || '').replace(/"/g, '""')}"`,
          ].join(',')
        )
        .join('\n');
      const blob = new Blob(['\uFEFF' + header + rows], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeExam.examCode}_bang_diem.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const handleDeleteSingleSub = async (subId: string) => {
      setDeletingSubId(subId);
      setSubActionError(null);
      try {
        await deleteSubmission(subId, teacherId);
        setConfirmDeleteSubId(null);
        setSelectedSubIds((prev) => {
          if (!prev.has(subId)) return prev;
          const next = new Set(prev);
          next.delete(subId);
          return next;
        });
      } catch (err) {
        setSubActionError(extractFriendlyFirestoreError(err));
      } finally {
        setDeletingSubId(null);
      }
    };

    const handleBulkDeleteSubs = async () => {
      const ids = Array.from(selectedSubIds);
      if (ids.length === 0) return;
      setBulkDeleting(true);
      setSubActionError(null);
      try {
        await deleteSubmissionsBulk(ids, teacherId);
        setSelectedSubIds(new Set());
        setConfirmBulkDelete(false);
        setConfirmDeleteSubId(null);
      } catch (err) {
        setSubActionError(extractFriendlyFirestoreError(err));
      } finally {
        setBulkDeleting(false);
      }
    };

    const allFilteredSelected =
      filteredSubs.length > 0 && filteredSubs.every((s) => selectedSubIds.has(s.id));

    const targetBatchSubs =
      selectedSubIds.size > 0
        ? filteredSubs.filter((s) => selectedSubIds.has(s.id))
        : filteredSubs;

    const handleRunBatchRegrade = async () => {
      if (targetBatchSubs.length === 0 || batchRunning) return;
      batchAbortRef.current = false;
      setBatchRunning(true);
      setBatchResult(null);
      setSubActionError(null);
      setBatchProgress({
        completed: 0,
        total: targetBatchSubs.length,
        currentStudentName: targetBatchSubs[0].studentName,
        phase: 'regrading',
      });
      try {
        const res = await batchRegradeSubmissionsWithAi({
          teacherId,
          exam: activeExam,
          targetSubmissions: targetBatchSubs,
          allExamSubmissions: allExamSubs,
          customBarem: batchCustomBarem,
          alsoAnalyzeAfterRegrade: batchAlsoAnalyze,
          overwriteComment: batchOverwriteComment,
          syncParentMessages: batchSyncMessages,
          existingMessages: parentMessages,
          shouldAbort: () => batchAbortRef.current,
          onProgress: (p) => setBatchProgress(p),
        });
        setBatchResult(res);
        setBatchPanelMode('none');
      } catch (err) {
        setSubActionError(
          err instanceof Error ? err.message : 'Lỗi khi chấm lại hàng loạt bằng AI.'
        );
      } finally {
        setBatchRunning(false);
        setBatchProgress(null);
      }
    };

    const handleRunBatchAnalyze = async () => {
      if (targetBatchSubs.length === 0 || batchRunning) return;
      batchAbortRef.current = false;
      setBatchRunning(true);
      setBatchResult(null);
      setSubActionError(null);
      setBatchProgress({
        completed: 0,
        total: targetBatchSubs.length,
        currentStudentName: targetBatchSubs[0].studentName,
        phase: 'analyzing',
      });
      try {
        const res = await batchAnalyzeSubmissionsWithAi({
          teacherId,
          exam: activeExam,
          targetSubmissions: targetBatchSubs,
          allExamSubmissions: allExamSubs,
          overwriteComment: batchOverwriteComment,
          syncParentMessages: batchSyncMessages,
          existingMessages: parentMessages,
          shouldAbort: () => batchAbortRef.current,
          onProgress: (p) => setBatchProgress(p),
        });
        setBatchResult(res);
        setBatchPanelMode('none');
      } catch (err) {
        setSubActionError(
          err instanceof Error ? err.message : 'Lỗi khi phân tích hàng loạt bằng AI.'
        );
      } finally {
        setBatchRunning(false);
        setBatchProgress(null);
      }
    };

    return (
      <div className="space-y-6">
        {/* Top back link & actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelectExam(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#3A524A] hover:text-[#0A362C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Danh sách đề</span>
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setEditingQuestionId(null);
                setEditingExam(activeExam);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#0F4C3F] bg-white text-[#0F4C3F] text-xs font-semibold hover:bg-[#EFF7F3] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Sửa đề &amp; đáp án</span>
            </button>

            <button
              type="button"
              onClick={() => setShowPhotoGrader(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] text-xs font-semibold hover:bg-[#FAF1D6] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5 text-[#B0831A]" />
              <span>Chấm ảnh chụp bằng AI</span>
            </button>

            <button
              type="button"
              onClick={() => openQuickAssignModal(activeExam)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-xs font-semibold text-[#8A630D] hover:bg-[#FAF1D6] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#B0831A]" />
              <span>Mã đề &amp; Giao lớp</span>
            </button>

            <button
              type="button"
              onClick={() => handleCopyCode(activeExam.examCode)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-white text-xs font-mono text-[#0D221D] hover:bg-[#EFF7F3] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedCode === activeExam.examCode ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#0F6D4F]" />
                  <span>Đã chép mã {activeExam.examCode}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#597169]" />
                  <span>Mã đề: {activeExam.examCode}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] hover:bg-[#EFF7F3] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#0F4C3F]" />
              <span>Xuất CSV</span>
            </button>
          </div>
        </div>

        {/* Title & metadata */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] text-[#8A630D] uppercase">
              Phân tích kết quả bài thi
            </div>
            <h1 className="font-serif text-3xl font-semibold text-[#0D221D] mt-1">
              {activeExam.title}
            </h1>
            <div className="text-sm text-[#4A615A] mt-1.5 flex flex-wrap items-center gap-2 tabular-nums">
              <span>{activeExam.subject}</span>
              <span aria-hidden="true">·</span>
              <span>{activeExam.questionCount} câu</span>
              <span aria-hidden="true">·</span>
              <span>
                {classFilter === 'all'
                  ? `${allExamSubs.length} bài đã nộp`
                  : `${totalSubs}/${allExamSubs.length} bài (Lớp ${classFilter})`}
              </span>
              <span aria-hidden="true">·</span>
              <span>{activeExam.durationMinutes} phút</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-[#0F4C3F]">
                Giao cho:{' '}
                {(() => {
                  const labels = resolveAssignedClassLabels(activeExam, classes);
                  return labels.length > 0 ? `Lớp ${labels.join(', ')}` : 'Tất cả các lớp';
                })()}
              </span>
            </div>
          </div>

          {classOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <label className="text-xs font-medium text-[#597169]">Xem theo lớp:</label>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-semibold text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              >
                <option value="all">Tất cả các lớp ({allExamSubs.length} bài)</option>
                {classOptions.map((c) => (
                  <option key={c} value={c}>
                    Lớp {c}
                  </option>
                ))}
              </select>
              {classFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setClassFilter('all')}
                  className="px-2.5 py-2 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-xs font-semibold text-[#8A630D] hover:bg-[#F9EED2] cursor-pointer"
                >
                  Bỏ lọc lớp
                </button>
              )}
            </div>
          )}
        </div>

        {/* 4 KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-2 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div className="text-xs font-semibold tracking-[0.06em] text-[#597169] uppercase">
              Bài đã nộp
            </div>
            <div className="font-serif text-3xl font-semibold text-[#0D221D] tabular-nums">
              {totalSubs}
            </div>
            <div className="text-xs text-[#597169]">
              {classFilter === 'all'
                ? 'Dữ liệu thực tế đang ghi nhận'
                : `Đang lọc riêng Lớp ${classFilter}`}
            </div>
          </div>

          <div className="bg-gradient-to-br from-[#FFFFFF] via-[#FFFFFF] to-[#FDF8EB] border border-[#EAD8A6] rounded-2xl p-5 space-y-2 shadow-[0_1px_2px_rgba(200,155,43,0.08)]">
            <div className="text-xs font-semibold tracking-[0.06em] text-[#8A630D] uppercase">
              Điểm trung bình
            </div>
            <div className="font-serif text-3xl font-semibold text-[#0A362C] tabular-nums">
              {totalSubs > 0 ? avgScore10.toFixed(2) : '0'}/10
            </div>
            <div className="text-xs text-[#7A580B] tabular-nums">
              {totalSubs > 0 && Math.abs(avgRawMax - 10) > 0.01
                ? `Điểm gốc TB: ${formatScore(avgRawScore)}/${formatScore(avgRawMax)}`
                : 'Quy đổi thang 10 điểm'}
            </div>
          </div>

          <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-2 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div className="text-xs font-semibold tracking-[0.06em] text-[#597169] uppercase">
              Tỉ lệ đạt (≥50%)
            </div>
            <div className="font-serif text-3xl font-semibold text-[#0D221D] tabular-nums">
              {passRate}%
            </div>
            <div className="text-xs text-[#597169] tabular-nums">
              {passCount}/{totalSubs} em
            </div>
          </div>

          <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-2 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div className="text-xs font-semibold tracking-[0.06em] text-[#597169] uppercase">
              Chờ chấm tự luận
            </div>
            <div className="font-serif text-3xl font-semibold text-[#0D221D] tabular-nums">
              {pendingEssay}
            </div>
            <div className="text-xs text-[#597169]">
              {pendingEssay === 0 ? 'Đã chốt điểm' : 'Cần giáo viên duyệt'}
            </div>
          </div>
        </div>

        {/* Class-by-class Score Breakdown for this Exam */}
        <ClassStatsSection
          title={`Thống kê điểm theo từng lớp — ${activeExam.title}`}
          subtitle="Bấm «Lọc lớp» ở bất kỳ lớp nào để cập nhật toàn bộ biểu đồ, tỉ lệ từng câu và danh sách bài nộp bên dưới."
          classes={classes}
          submissions={allExamSubs}
          activeClassFilter={classFilter}
          onSelectClassFilter={setClassFilter}
          exportPrefix={activeExam.examCode}
        />

        {/* Perfunctory Behavior Detection Banner for this Exam */}
        {examSubs.length > 0 && (
          <section className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg font-semibold text-[#0D221D] flex items-center gap-2">
                  {cohortEffort.perfunctoryCount > 0 ? (
                    <ShieldAlert className="w-4 h-4 text-[#B91C1C]" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[#0F6D4F]" />
                  )}
                  <span>Phân tích học sinh làm bài đối phó trong đề này</span>
                </h2>
                <p className="text-xs text-[#597169] mt-0.5">
                  Đánh giá tự động dựa trên thời gian trả lời từng câu (&lt;5s), lặp đáp án A/B/C/D, bỏ trống tự luận và số lần vi phạm.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {(['all', 'perfunctory', 'watch', 'serious'] as const).map((lvl) => {
                  const count =
                    lvl === 'all'
                      ? examSubs.length
                      : lvl === 'perfunctory'
                        ? cohortEffort.perfunctoryCount
                        : lvl === 'watch'
                          ? cohortEffort.watchCount
                          : cohortEffort.seriousCount;
                  const label =
                    lvl === 'all'
                      ? 'Tất cả'
                      : lvl === 'perfunctory'
                        ? 'Đối phó'
                        : lvl === 'watch'
                          ? 'Cần lưu ý'
                          : 'Nghiêm túc';
                  const active = effortFilter === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setEffortFilter(lvl)}
                      className={`px-2.5 py-1 rounded-lg border font-semibold cursor-pointer tabular-nums ${
                        active
                          ? lvl === 'perfunctory'
                            ? 'bg-[#B91C1C] border-[#B91C1C] text-white'
                            : lvl === 'watch'
                              ? 'bg-[#8A630D] border-[#8A630D] text-white'
                              : 'bg-[#0F4C3F] border-[#0F4C3F] text-white'
                          : 'bg-[#F8FAF9] border-[#DAE5E0] text-[#3A524A] hover:bg-[#EFF7F3]'
                      }`}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
                {cohortEffort.perfunctoryCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSubIds(
                        new Set(cohortEffort.flaggedItems.map((it) => it.submission.id))
                      );
                      setEffortFilter('perfunctory');
                    }}
                    className="px-2.5 py-1 rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C] font-semibold hover:bg-[#FEE2E2] cursor-pointer"
                  >
                    Chọn {cohortEffort.perfunctoryCount} bài đối phó
                  </button>
                )}
              </div>
            </div>

            {cohortEffort.flaggedItems.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {cohortEffort.flaggedItems.slice(0, 6).map(({ submission: sub, analysis }) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => onSelectSubmission(sub.id)}
                    className="p-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2]/60 text-left hover:bg-[#FEE2E2]/60 transition-colors cursor-pointer space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#0D221D] truncate">
                        {sub.studentName} {sub.className ? `(${sub.className})` : ''}
                      </span>
                      <span className="font-mono font-semibold text-[#B91C1C] shrink-0">
                        {analysis.riskScore}%
                      </span>
                    </div>
                    <p className="text-[11px] text-[#991B1B] line-clamp-2">
                      {analysis.reasons.join(' · ')}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Chart 1: Phân bố điểm */}
          <div className="lg:col-span-7 bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-5 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div>
              <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                Phân bố điểm
              </h2>
              <p className="text-xs text-[#597169] mt-0.5">
                Số học sinh theo mức phần trăm điểm đạt được
              </p>
            </div>

            <div className="h-56 flex items-stretch gap-3 pt-2">
              <div className="flex flex-col justify-between text-[11px] text-[#597169] tabular-nums pb-7 text-right w-7 shrink-0">
                <span>{yAxisMax}</span>
                <span>{yAxisStep * 3}</span>
                <span>{yAxisStep * 2}</span>
                <span>{yAxisStep}</span>
                <span>0</span>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="relative flex-1 flex items-end justify-around gap-3 border-b border-[#DAE5E0] px-2">
                  {[0, 25, 50, 75, 100].map((topPct) => (
                    <div
                      key={topPct}
                      style={{ top: `${topPct}%` }}
                      className="absolute left-0 right-0 border-t border-dashed border-[#E6EEEA] pointer-events-none"
                    />
                  ))}

                  {buckets.map((b) => {
                    const heightPct =
                      yAxisMax > 0 ? Math.round((b.count / yAxisMax) * 100) : 0;
                    return (
                      <div
                        key={b.label}
                        className="relative z-10 flex-1 max-w-14 h-full flex flex-col justify-end items-center group"
                      >
                        <div className="text-[11px] font-semibold text-[#0F4C3F] mb-1 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                          {b.count} em
                        </div>
                        <div
                          style={{
                            height: b.count > 0 ? `${Math.max(heightPct, 6)}%` : '0%',
                          }}
                          className="w-full bg-[#0F4C3F] rounded-t-lg transition-all duration-200 group-hover:bg-[#0A362C]"
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-around gap-3 pt-2.5 text-xs text-[#4A615A]">
                  {buckets.map((b) => (
                    <span key={b.label} className="flex-1 text-center truncate">
                      {b.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Chart 2: Điểm trung bình theo phần */}
          <div className="lg:col-span-5 bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-5 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div>
              <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                Điểm trung bình theo phần
              </h2>
              <p className="text-xs text-[#597169] mt-0.5">
                Phần nào cả lớp còn yếu nhất
              </p>
            </div>

            <div className="h-56 flex items-stretch gap-3 pt-2">
              <div className="flex flex-col justify-between text-[11px] text-[#597169] tabular-nums pb-7 text-right w-9 shrink-0">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>

              <div className="flex-1 flex flex-col">
                <div className="relative flex-1 flex items-end justify-around gap-4 border-b border-[#DAE5E0] px-2">
                  {[0, 25, 50, 75, 100].map((topPct) => (
                    <div
                      key={topPct}
                      style={{ top: `${topPct}%` }}
                      className="absolute left-0 right-0 border-t border-dashed border-[#E6EEEA] pointer-events-none"
                    />
                  ))}

                  {partStats.map((part) => (
                    <div
                      key={part.label}
                      className="relative z-10 flex-1 max-w-14 h-full flex flex-col justify-end items-center group"
                    >
                      <div className="text-[11px] font-semibold text-[#8A630D] mb-1 tabular-nums">
                        {part.hasQuestions ? `${part.pct}%` : '—'}
                      </div>
                      <div
                        style={{
                          height: part.hasQuestions
                            ? `${Math.max(part.pct, 4)}%`
                            : '0%',
                        }}
                        className="w-full bg-gradient-to-t from-[#B0831A] to-[#D6AE45] rounded-t-lg transition-all duration-200 group-hover:from-[#8A630D] group-hover:to-[#C89B2B]"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-around gap-4 pt-2.5 text-xs text-[#4A615A]">
                  {partStats.map((part) => (
                    <span key={part.label} className="flex-1 text-center truncate">
                      {part.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Per-question accuracy & response time drilldown */}
        <section className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-5 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                Tỉ lệ đúng &amp; thời gian trả lời theo từng câu
              </h2>
              <p className="text-xs text-[#597169] mt-0.5">
                Bấm vào bất kỳ câu nào để xem phân bố lựa chọn A/B/C/D và tốc độ từng học sinh.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {questionStats.map((item) => {
              const barColor =
                item.pct >= 70
                  ? 'bg-[#0F6D4F]'
                  : item.pct >= 45
                    ? 'bg-[#C89B2B]'
                    : 'bg-[#DC2626]';
              const isSelected = inspectedQuestionId === item.question.id;
              return (
                <button
                  key={item.question.id}
                  type="button"
                  onClick={() =>
                    setInspectedQuestionId(isSelected ? null : item.question.id)
                  }
                  className={`text-left p-3 -mx-3 rounded-xl transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#EFF7F3] ring-1 ring-[#0F4C3F]/35'
                      : 'hover:bg-[#F8FAF9]'
                  }`}
                >
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-[#0D221D] font-medium">
                      Câu {item.question.index} · {item.typeLabel}
                    </span>
                    <span className="font-semibold text-[#0D221D] tabular-nums">
                      {item.pct}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#E6EEEA] overflow-hidden my-1.5">
                    <div
                      style={{ width: `${item.pct}%` }}
                      className={`h-full rounded-full ${barColor} transition-all duration-300`}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#597169] tabular-nums">
                    <span>
                      {item.question.type === 'mcq'
                        ? `${item.correctCount}/${item.totalSubs} em làm đúng`
                        : `Đạt TB ${item.pct}% (${item.totalSubs} bài)`}
                    </span>
                    <span className="inline-flex items-center gap-2 font-mono">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        TB {item.avgSec}s
                      </span>
                      {item.fastGuessCount > 0 && (
                        <span className="text-[#8A630D] font-sans font-semibold">
                          · {item.fastGuessCount} em &lt;5s
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Expanded Single Question Inspector */}
          {inspectedStat && (
            <div className="mt-4 p-5 rounded-2xl bg-[#F8FAF9] border border-[#CEDCD6] space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-[#0F4C3F] uppercase tracking-wider">
                    Chi tiết Câu {inspectedStat.question.index} · {inspectedStat.typeLabel}
                  </div>
                  <MathText
                    text={inspectedStat.question.prompt}
                    className="text-sm text-[#0D221D] mt-1 leading-relaxed whitespace-pre-line"
                  />
                  {inspectedStat.question.imageUrls &&
                    inspectedStat.question.imageUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {inspectedStat.question.imageUrls.map((url, uIdx) => (
                          <img
                            key={uIdx}
                            src={url}
                            alt={`Hình câu ${inspectedStat.question.index}`}
                            className="max-h-36 rounded-lg border border-[#CEDCD6] bg-white object-contain"
                          />
                        ))}
                      </div>
                    )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingQuestionId(inspectedStat.question.id);
                      setEditingExam(activeExam);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#0F4C3F] bg-white text-[#0F4C3F] text-xs font-semibold hover:bg-[#EFF7F3] whitespace-nowrap cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Sửa câu này</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInspectedQuestionId(null)}
                    className="p-1.5 rounded-lg text-[#597169] hover:bg-[#E6EEEA] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-white border border-[#DAE5E0] rounded-xl p-3">
                  <div className="text-[#597169]">Thời gian TB nhóm làm đúng</div>
                  <div className="font-mono text-lg font-semibold text-[#0F6D4F] mt-0.5 tabular-nums">
                    {formatDurationMMSS(inspectedStat.avgRightSec)}
                  </div>
                </div>
                <div className="bg-white border border-[#DAE5E0] rounded-xl p-3">
                  <div className="text-[#597169]">Thời gian TB nhóm làm sai</div>
                  <div className="font-mono text-lg font-semibold text-[#DC2626] mt-0.5 tabular-nums">
                    {formatDurationMMSS(inspectedStat.avgWrongSec)}
                  </div>
                </div>
                <div className="bg-white border border-[#DAE5E0] rounded-xl p-3">
                  <div className="text-[#597169]">Số lượt trả lời nhanh (&lt;5s)</div>
                  <div className="font-mono text-lg font-semibold text-[#8A630D] mt-0.5 tabular-nums">
                    {inspectedStat.fastGuessCount} em
                  </div>
                </div>
              </div>

              {inspectedStat.question.type === 'mcq' &&
                inspectedStat.question.options && (
                  <div className="bg-white border border-[#DAE5E0] rounded-xl p-4 space-y-2.5">
                    <div className="text-xs font-semibold text-[#0D221D]">
                      Phân bố lựa chọn A / B / C / D của cả lớp
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {inspectedStat.question.options.map((optText, oIdx) => {
                        const count = inspectedStat.optionCounts[oIdx] || 0;
                        const pct =
                          inspectedStat.totalSubs > 0
                            ? Math.round((count / inspectedStat.totalSubs) * 100)
                            : 0;
                        const isKey = inspectedStat.question.correctOption === oIdx;
                        return (
                          <div
                            key={oIdx}
                            className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                              isKey
                                ? 'border-[#0F6D4F] bg-[#F0FBF6]'
                                : 'border-[#EBF1EE] bg-[#F8FAF9]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-[#0D221D] min-w-0">
                                {OPTION_LETTERS[oIdx]}. <MathText text={optText} inline />
                              </span>
                              <span className="font-mono font-semibold tabular-nums shrink-0">
                                {count} em ({pct}%)
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-[#DAE5E0] rounded-full overflow-hidden">
                              <div
                                style={{ width: `${pct}%` }}
                                className={`h-full ${
                                  isKey ? 'bg-[#0F6D4F]' : 'bg-[#698078]'
                                }`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* Student-level timing list for this question */}
              <div className="bg-white border border-[#DAE5E0] rounded-xl p-4 space-y-2">
                <div className="text-xs font-semibold text-[#0D221D]">
                  Chi tiết thời gian &amp; kết quả từng học sinh ở Câu{' '}
                  {inspectedStat.question.index}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-52 overflow-y-auto">
                  {inspectedStat.studentBreakdown.map((sb) => (
                    <button
                      key={sb.submissionId}
                      type="button"
                      onClick={() => onSelectSubmission(sb.submissionId)}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[#EBF1EE] hover:border-[#0F4C3F] text-xs text-left cursor-pointer"
                    >
                      <span className="font-medium text-[#0D221D] truncate">
                        {sb.studentName}
                      </span>
                      <span className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                        <span
                          className={
                            sb.isFast ? 'text-[#8A630D] font-semibold' : 'text-[#4A615A]'
                          }
                        >
                          {sb.timeSpentSeconds}s{sb.isFast ? '!' : ''}
                        </span>
                        <span
                          className={
                            sb.isCorrect
                              ? 'text-[#0F6D4F] font-semibold'
                              : 'text-[#DC2626] font-semibold'
                          }
                        >
                          {sb.score}/{sb.maxScore}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Submissions list for this exam */}
        <section className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-4 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                Danh sách bài nộp ({filteredSubs.length})
              </h2>
              <p className="text-xs text-[#597169] mt-0.5">
                Tick chọn từng bài hoặc chạy hàng loạt để AI chấm lại chuẩn barem, phân tích học lực và tạo lời phê ngắn gọn.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {filteredSubs.length > 0 && (
                <>
                  <button
                    type="button"
                    disabled={batchRunning}
                    onClick={() => {
                      setBatchResult(null);
                      setBatchPanelMode((m) => (m === 'regrade' ? 'none' : 'regrade'));
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
                      batchPanelMode === 'regrade'
                        ? 'bg-[#B0831A] border-[#9A7113] text-white'
                        : 'bg-[#FDF8EB] border-[#EAD8A6] text-[#8A630D] hover:bg-[#FAF1D6]'
                    }`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>
                      Chấm lại AI (
                      {selectedSubIds.size > 0
                        ? `${selectedSubIds.size} bài chọn`
                        : `${filteredSubs.length} bài`}
                      )
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={batchRunning}
                    onClick={() => {
                      setBatchResult(null);
                      setBatchPanelMode((m) => (m === 'analyze' ? 'none' : 'analyze'));
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
                      batchPanelMode === 'analyze'
                        ? 'bg-[#0F4C3F] border-[#0A362C] text-white'
                        : 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0F4C3F] hover:bg-[#DCECE4]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      Phân tích AI (
                      {selectedSubIds.size > 0
                        ? `${selectedSubIds.size} bài chọn`
                        : `${filteredSubs.length} bài`}
                      )
                    </span>
                  </button>
                </>
              )}

              {selectedSubIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C] text-xs font-semibold hover:bg-[#FEE2E2] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Xoá {selectedSubIds.size} bài đã chọn</span>
                </button>
              )}

              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-xs font-medium text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              >
                <option value="all">Tất cả các lớp</option>
                {classOptions.map((c) => (
                  <option key={c} value={c}>
                    Lớp {c}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search className="w-4 h-4 text-[#698078] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchSub}
                  onChange={(e) => setSearchSub(e.target.value)}
                  placeholder="Tìm tên học sinh..."
                  className="pl-9 pr-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm focus:outline-none focus:border-[#0F4C3F] w-48"
                />
              </div>
            </div>
          </div>

          {/* Batch AI Options Strip */}
          {batchPanelMode !== 'none' && !batchRunning && targetBatchSubs.length > 0 && (
            <div className="p-4 rounded-xl border border-[#C5DDD3] bg-[#F8FAF9] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#0D221D] flex items-center gap-1.5">
                    {batchPanelMode === 'regrade' ? (
                      <>
                        <RefreshCw className="w-4 h-4 text-[#B0831A]" />
                        <span>
                          Chấm lại bằng AI cho {targetBatchSubs.length} bài nộp
                        </span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-[#0F4C3F]" />
                        <span>
                          Phân tích &amp; tạo nhận xét ngắn gọn bằng AI cho {targetBatchSubs.length} bài nộp
                        </span>
                      </>
                    )}
                  </h3>
                  <p className="text-xs text-[#597169] mt-0.5">
                    {batchPanelMode === 'regrade'
                      ? 'Tính lại điểm trắc nghiệm/Đúng-Sai/điền số theo đáp án mới nhất, đồng thời dùng AI chấm lại toàn bộ câu tự luận/ảnh theo barem 4 bước.'
                      : 'AI đối chiếu thời gian từng câu, tỉ lệ đúng của lớp và dấu hiệu đối phó để lưu phân tích chi tiết và lời phê ngắn gọn (1–2 câu).'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBatchPanelMode('none')}
                  className="p-1 rounded-lg text-[#597169] hover:text-[#0D221D] cursor-pointer"
                  aria-label="Đóng bảng tùy chọn AI"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {batchPanelMode === 'regrade' && (
                <div>
                  <label className="block text-xs font-medium text-[#3A524A] mb-1">
                    Ghi chú barem chấm tự luận bổ sung (tuỳ chọn)
                  </label>
                  <input
                    type="text"
                    value={batchCustomBarem}
                    onChange={(e) => setBatchCustomBarem(e.target.value)}
                    placeholder="VD: Thiếu đơn vị trừ 0.25đ; chấp nhận làm tròn 2 chữ số thập phân..."
                    className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#3A524A]">
                {batchPanelMode === 'regrade' && (
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchAlsoAnalyze}
                      onChange={(e) => setBatchAlsoAnalyze(e.target.checked)}
                      className="rounded border-[#CEDCD6] accent-[#0F4C3F]"
                    />
                    <span>Kèm phân tích học lực toàn bài bằng AI</span>
                  </label>
                )}
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={batchOverwriteComment}
                    onChange={(e) => setBatchOverwriteComment(e.target.checked)}
                    className="rounded border-[#CEDCD6] accent-[#0F4C3F]"
                  />
                  <span>Cập nhật lời phê ngắn gọn mới (dưới 195 ký tự)</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={batchSyncMessages}
                    onChange={(e) => setBatchSyncMessages(e.target.checked)}
                    className="rounded border-[#CEDCD6] accent-[#0F4C3F]"
                  />
                  <span>Đồng bộ sẵn vào Tin nhắn phụ huynh</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setBatchPanelMode('none')}
                  className="px-3.5 py-1.5 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#4A615A] hover:bg-[#EFF7F3] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  onClick={
                    batchPanelMode === 'regrade'
                      ? handleRunBatchRegrade
                      : handleRunBatchAnalyze
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#E5C665]" />
                  <span>
                    {batchPanelMode === 'regrade'
                      ? `Bắt đầu chấm lại (${targetBatchSubs.length} bài)`
                      : `Bắt đầu phân tích (${targetBatchSubs.length} bài)`}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Live Batch AI Progress */}
          {batchRunning && batchProgress && (
            <div className="p-4 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-semibold text-[#7A580B]">
                  {batchProgress.phase === 'regrading'
                    ? 'Đang chấm lại bằng AI'
                    : 'Đang phân tích bằng AI'}
                  : {batchProgress.completed}/{batchProgress.total} bài
                  {batchProgress.currentStudentName
                    ? ` — ${batchProgress.currentStudentName}`
                    : ''}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    batchAbortRef.current = true;
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#EAD8A6] bg-white text-[#8A630D] font-semibold hover:bg-[#FAF1D6] cursor-pointer"
                >
                  <Square className="w-3 h-3" />
                  <span>Dừng lại</span>
                </button>
              </div>
              <div className="h-2 w-full rounded-full bg-[#F3E6C3] overflow-hidden">
                <div
                  className="h-full bg-[#0F4C3F] transition-all duration-300"
                  style={{
                    width: `${
                      batchProgress.total > 0
                        ? Math.max(
                            6,
                            Math.round((batchProgress.completed / batchProgress.total) * 100)
                          )
                        : 100
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Batch Result Banner */}
          {batchResult && !batchRunning && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
                batchResult.failedItems.length > 0
                  ? 'bg-[#FDF8EB] border-[#EAD8A6] text-[#7A580B]'
                  : 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0A362C]'
              }`}
            >
              <div className="space-y-0.5">
                <div className="font-semibold">
                  {batchResult.aborted
                    ? `Đã dừng sớm — hoàn tất ${batchResult.succeededCount} bài.`
                    : `Hoàn tất xử lý AI cho ${batchResult.succeededCount} bài nộp.`}
                </div>
                {batchResult.failedItems.length > 0 && (
                  <div className="text-[#991B1B]">
                    Chưa xử lý được {batchResult.failedItems.length} bài:{' '}
                    {batchResult.failedItems
                      .map((f) => `${f.studentName} (${f.error})`)
                      .join('; ')}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setBatchResult(null)}
                className="p-1 rounded-lg hover:bg-black/5 cursor-pointer"
                aria-label="Đóng thông báo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {confirmBulkDelete && selectedSubIds.size > 0 && (
            <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex flex-wrap items-center justify-between gap-3 text-xs text-[#991B1B]">
              <span>
                Xác nhận xoá <strong>{selectedSubIds.size}</strong> bài nộp đã chọn để thu số liệu chuẩn? Điểm TB, biểu đồ phân bố và thống kê từng câu sẽ tự động tính lại.
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={bulkDeleting}
                  onClick={handleBulkDeleteSubs}
                  className="px-3 py-1.5 rounded-lg bg-[#B91C1C] text-white font-semibold hover:bg-[#991B1B] disabled:opacity-60 whitespace-nowrap cursor-pointer"
                >
                  {bulkDeleting ? 'Đang xoá...' : 'Xác nhận xoá'}
                </button>
                <button
                  type="button"
                  disabled={bulkDeleting}
                  onClick={() => setConfirmBulkDelete(false)}
                  className="px-3 py-1.5 rounded-lg border border-[#FECACA] bg-white text-[#991B1B] font-medium hover:bg-[#FEF2F2] whitespace-nowrap cursor-pointer"
                >
                  Huỷ
                </button>
              </div>
            </div>
          )}

          {subActionError && (
            <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
              {subActionError}
            </div>
          )}

          {filteredSubs.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#597169]">
              Chưa có bài nộp nào khớp bộ lọc.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DAE5E0] text-xs font-semibold text-[#597169] uppercase tracking-wider">
                    <th className="py-3 pr-3 w-8">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả bài nộp đang hiển thị"
                        checked={allFilteredSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSubIds(new Set(filteredSubs.map((s) => s.id)));
                          } else {
                            setSelectedSubIds(new Set());
                            setConfirmBulkDelete(false);
                          }
                        }}
                        className="rounded border-[#CEDCD6] accent-[#0F4C3F] cursor-pointer"
                      />
                    </th>
                    <th className="py-3 pr-4">Họ tên</th>
                    <th className="py-3 pr-4">Lớp</th>
                    <th className="py-3 pr-4">Thời gian</th>
                    <th className="py-3 pr-4">Cảnh báo</th>
                    <th className="py-3 pr-4">Điểm</th>
                    <th className="py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF3F0] text-sm">
                  {filteredSubs.map((sub) => {
                    const fastCount = sub.answers.filter(
                      (a) => a.timeSpentSeconds > 0 && a.timeSpentSeconds < 5
                    ).length;
                    const eff = cohortEffort.bySubmissionId.get(sub.id);
                    const isChecked = selectedSubIds.has(sub.id);
                    const isConfirming = confirmDeleteSubId === sub.id;
                    const isDeleting = deletingSubId === sub.id;
                    return (
                      <tr
                        key={sub.id}
                        onClick={() => onSelectSubmission(sub.id)}
                        className={`transition-colors cursor-pointer ${
                          isChecked ? 'bg-[#EFF7F3]' : 'hover:bg-[#F8FAF9]'
                        }`}
                      >
                        <td
                          className="py-3.5 pr-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Chọn bài của ${sub.studentName}`}
                            checked={isChecked}
                            onChange={(e) => {
                              setSelectedSubIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(sub.id);
                                else next.delete(sub.id);
                                if (next.size === 0) setConfirmBulkDelete(false);
                                return next;
                              });
                            }}
                            className="rounded border-[#CEDCD6] accent-[#0F4C3F] cursor-pointer"
                          />
                        </td>
                        <td className="py-3.5 pr-4 font-medium text-[#0D221D]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{sub.studentName}</span>
                            {eff && eff.level === 'perfunctory' && (
                              <span
                                title={eff.reasons.join(' • ')}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF2F2] border border-[#FECACA] text-[10px] font-semibold text-[#B91C1C]"
                              >
                                <ShieldAlert className="w-3 h-3" /> Đối phó ({eff.riskScore}%)
                              </span>
                            )}
                            {eff && eff.level === 'watch' && (
                              <span
                                title={eff.reasons.join(' • ')}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FDF8EB] border border-[#EAD8A6] text-[10px] font-semibold text-[#8A630D]"
                              >
                                <AlertTriangle className="w-3 h-3" /> Lưu ý
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#597169] mt-0.5">
                            {sub.studentCode && (
                              <span className="font-mono">Mã HS: {sub.studentCode}</span>
                            )}
                            {sub.aiAnalysis?.trim() && (
                              <span className="text-[#0F6D4F] font-medium">
                                Đã phân tích AI
                              </span>
                            )}
                          </div>
                          {sub.teacherComment?.trim() && (
                            <div
                              title={sub.teacherComment}
                              className="text-[11px] text-[#4A615A] truncate max-w-xs mt-0.5"
                            >
                              {sub.teacherComment}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 pr-4 text-[#4A615A]">
                          {sub.className || '—'}
                        </td>
                        <td className="py-3.5 pr-4 font-mono text-xs text-[#3A524A] tabular-nums">
                          {formatDurationMMSS(sub.durationSeconds)}
                        </td>
                        <td className="py-3.5 pr-4 text-xs">
                          {eff && eff.reasons.length > 0 ? (
                            <span
                              className={
                                eff.level === 'perfunctory'
                                  ? 'text-[#B91C1C] font-medium'
                                  : 'text-[#8A630D]'
                              }
                            >
                              {eff.reasons[0]}
                            </span>
                          ) : sub.violationCount > 3 ? (
                            <span className="text-[#B91C1C] font-semibold">
                              {sub.violationCount} vi phạm · Ép buộc nộp
                            </span>
                          ) : sub.violationCount > 0 ? (
                            <span className="text-[#8A630D] font-medium">
                              {sub.violationCount} vi phạm
                            </span>
                          ) : fastCount > 0 ? (
                            <span className="text-[#8A630D]">
                              {fastCount} câu &lt;5s
                            </span>
                          ) : (
                            <span className="text-[#0F6D4F]">Nghiêm túc</span>
                          )}
                        </td>
                        <td className="py-3.5 pr-4 font-semibold tabular-nums text-[#0D221D]">
                          {formatScore(sub.totalScore)}/{formatScore(sub.maxScore)}
                        </td>
                        <td
                          className="py-3.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isConfirming ? (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => handleDeleteSingleSub(sub.id)}
                                className="px-2.5 py-1 rounded-lg bg-[#B91C1C] text-white text-xs font-semibold hover:bg-[#991B1B] disabled:opacity-60 whitespace-nowrap cursor-pointer"
                              >
                                {isDeleting ? 'Đang xoá...' : 'Xoá'}
                              </button>
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => setConfirmDeleteSubId(null)}
                                className="px-2 py-1 rounded-lg border border-[#CEDCD6] bg-white text-xs font-medium text-[#4A615A] hover:bg-[#F8FAF9] whitespace-nowrap cursor-pointer"
                              >
                                Huỷ
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => onSelectSubmission(sub.id)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F4C3F] hover:text-[#0A362C] whitespace-nowrap cursor-pointer"
                              >
                                <span>Chi tiết</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSubActionError(null);
                                  setConfirmDeleteSubId(sub.id);
                                }}
                                title="Xoá bài làm này để thu số liệu chuẩn"
                                className="p-1.5 rounded-lg text-[#597169] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {showPhotoGrader && (
          <PhotoEssayGraderModal
            exams={exams}
            onClose={() => setShowPhotoGrader(false)}
          />
        )}

        {editingExam && (
          <ExamEditorModal
            exam={editingExam}
            classes={classes}
            examSubmissions={examSubs}
            initialFilter="all"
            initialQuestionId={editingQuestionId}
            onClose={() => {
              setEditingExam(null);
              setEditingQuestionId(null);
            }}
          />
        )}
      </div>
    );
  }

  // ---------------- EXAM LIST VIEW ----------------
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.12em] text-[#8A630D] uppercase">
            Ngân hàng đề &amp; chấm thi
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#0D221D] mt-1">
            Đề &amp; bài chấm
          </h1>
          <p className="text-sm text-[#4A615A] mt-1">
            Soạn đề mới, theo dõi phân bố điểm, thời gian trả lời từng câu và chấm bài chụp tự luận bằng AI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowPhotoGrader(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-[#8A630D] text-sm font-semibold hover:bg-[#FAF1D6] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Camera className="w-4 h-4 text-[#B0831A]" />
            <span>Chấm ảnh chụp bằng AI</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateMode('word');
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#CEDCD6] bg-white text-[#0D221D] text-sm font-medium hover:bg-[#EFF7F3] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileText className="w-4 h-4 text-[#0F4C3F]" />
            <span>Đẩy đề Word (.docx)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateMode('ai');
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#E5C665]" />
            <span>Soạn đề mới</span>
          </button>
        </div>
      </div>

      {exams.length === 0 ? (
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-12 text-center space-y-3">
          <BookOpen className="w-8 h-8 text-[#698078] mx-auto" />
          <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
            Chưa có đề kiểm tra nào
          </h2>
          <p className="text-sm text-[#4A615A]">
            Tạo đề mới từ đề mẫu Vật lí 12 hoặc dùng Gemini AI sinh câu hỏi theo chủ đề.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] cursor-pointer"
          >
            Soạn đề đầu tiên
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {exams.map((exam) => {
            const subCount = submissions.filter((s) => s.examId === exam.id).length;
            const avg =
              subCount > 0
                ? (
                    submissions
                      .filter((s) => s.examId === exam.id)
                      .reduce((sum, s) => sum + s.totalScore, 0) / subCount
                  ).toFixed(2)
                : '—';

            return (
              <div
                key={exam.id}
                className="bg-white border border-[#DAE5E0] rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:border-[#B5CEC3] transition-colors shadow-[0_1px_2px_rgba(10,54,44,0.03)]"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2
                      onClick={() => onSelectExam(exam.id)}
                      className="font-serif text-xl font-semibold text-[#0D221D] hover:text-[#0F4C3F] cursor-pointer"
                    >
                      {exam.title}
                    </h2>
                    <span
                      className={`text-xs font-semibold ${
                        exam.isPublished ? 'text-[#0F6D4F]' : 'text-[#8A630D]'
                      }`}
                    >
                      {exam.isPublished ? 'Đang mở' : 'Đã khoá'}
                    </span>
                  </div>

                  <div className="text-xs text-[#597169] flex flex-wrap items-center gap-2 tabular-nums">
                    <span>{exam.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span>{exam.questionCount} câu</span>
                    <span aria-hidden="true">·</span>
                    <span>{exam.durationMinutes} phút</span>
                    <span aria-hidden="true">·</span>
                    <span>{subCount} bài đã nộp</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-[#8A630D]">ĐTB: {avg}/10</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-[#0F4C3F]">
                      Giao cho:{' '}
                      {(() => {
                        const labels = resolveAssignedClassLabels(exam, classes);
                        return labels.length > 0 ? `Lớp ${labels.join(', ')}` : 'Tất cả các lớp';
                      })()}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyCode(exam.examCode)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-xs font-mono font-semibold text-[#8A630D] hover:bg-[#FAF1D6] cursor-pointer"
                  >
                    {copiedCode === exam.examCode ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#0F6D4F]" />
                        <span>Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-[#B0831A]" />
                        <span>{exam.examCode}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => openQuickAssignModal(exam)}
                    title="Chỉnh sửa mã đề và chọn lớp được giao làm bài"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-[#0D221D] text-xs font-semibold hover:border-[#0F4C3F] hover:bg-[#EFF7F3] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-[#8A630D]" />
                    <span>Mã đề &amp; Giao lớp</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingQuestionId(null);
                      setEditingExam(exam);
                    }}
                    title="Chỉnh sửa nội dung câu hỏi, đáp án, điểm số và tự luận"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#0F4C3F] bg-white text-[#0F4C3F] text-xs font-semibold hover:bg-[#EFF7F3] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Sửa đề &amp; đáp án</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleExamPublish(exam.id, !exam.isPublished)}
                    title={exam.isPublished ? 'Khoá đề' : 'Mở đề cho học sinh'}
                    className="p-2 rounded-xl border border-[#CEDCD6] bg-white text-[#3A524A] hover:bg-[#EFF7F3] cursor-pointer"
                  >
                    {exam.isPublished ? (
                      <Unlock className="w-4 h-4 text-[#0F4C3F]" />
                    ) : (
                      <Lock className="w-4 h-4 text-[#597169]" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteExam(exam.id)}
                    title="Xoá đề"
                    className="p-2 rounded-xl border border-[#CEDCD6] bg-white text-[#597169] hover:text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectExam(exam.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>Phân tích &amp; bài nộp</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#E5C665]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Exam Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-[#082B23]/45 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#DAE5E0] max-w-3xl w-full p-6 space-y-5 my-8 max-h-[92vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-2xl font-semibold text-[#0D221D]">
                Soạn &amp; đẩy đề kiểm tra mới
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-[#597169] hover:bg-[#EFF7F3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 bg-[#EFF7F3] rounded-xl">
              <button
                type="button"
                onClick={() => setCreateMode('word')}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  createMode === 'word'
                    ? 'bg-white text-[#0F4C3F] shadow-sm font-semibold'
                    : 'text-[#4A615A] hover:text-[#0D221D]'
                }`}
              >
                Tải đề file Word (.docx)
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('ai')}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  createMode === 'ai'
                    ? 'bg-white text-[#0F4C3F] shadow-sm font-semibold'
                    : 'text-[#4A615A] hover:text-[#0D221D]'
                }`}
              >
                Sinh đề theo chủ đề (AI)
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('template')}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  createMode === 'template'
                    ? 'bg-white text-[#0F4C3F] shadow-sm font-semibold'
                    : 'text-[#4A615A] hover:text-[#0D221D]'
                }`}
              >
                Dùng đề mẫu 20 câu
              </button>
            </div>

            <form onSubmit={handleSaveNewExam} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-6">
                  <label className="block text-xs font-medium text-[#3A524A] mb-1">
                    Tên đề kiểm tra
                  </label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder={
                      createMode === 'template'
                        ? 'Đề ôn tập mẫu — Vật lí 12'
                        : 'Ví dụ: Kiểm tra giữa kì I — Vật lí 12'
                    }
                    className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-xs font-medium text-[#3A524A] mb-1">
                    Mã đề (tuỳ chọn)
                  </label>
                  <input
                    type="text"
                    maxLength={30}
                    value={newExamCode}
                    onChange={(e) => setNewExamCode(e.target.value.toUpperCase())}
                    placeholder="Để trống tự tạo"
                    className="w-full px-3.5 py-2 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] font-mono text-sm font-semibold uppercase text-[#8A630D] focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#3A524A] mb-1">
                    Thời gian (phút)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={newDuration}
                    onChange={(e) => setNewDuration(Number(e.target.value))}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm tabular-nums focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
              </div>

              {/* Class assignment picker during exam creation */}
              <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[#3A524A] mr-1">
                  Phân đề cho lớp:
                </span>
                <button
                  type="button"
                  onClick={() => setNewAssignedClassIds([])}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    newAssignedClassIds.length === 0
                      ? 'bg-[#0F4C3F] text-white border-[#0F4C3F]'
                      : 'bg-white text-[#4A615A] border-[#CEDCD6] hover:border-[#0F4C3F]'
                  }`}
                >
                  Tất cả các lớp
                </button>
                {classes.map((cls) => {
                  const active = newAssignedClassIds.includes(cls.id);
                  return (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() =>
                        setNewAssignedClassIds((prev) =>
                          prev.includes(cls.id)
                            ? prev.filter((id) => id !== cls.id)
                            : [...prev, cls.id]
                        )
                      }
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#FDF8EB] text-[#8A630D] border-[#C89B2B] font-semibold'
                          : 'bg-white text-[#3A524A] border-[#CEDCD6] hover:border-[#0F4C3F]'
                      }`}
                    >
                      <span>Lớp {cls.name}</span>
                      <span className="text-[10px] font-mono opacity-75">({cls.joinCode})</span>
                    </button>
                  );
                })}
              </div>

              {createMode === 'word' && (
                <div className="p-4 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-[#0D221D]">
                        Đọc tự động đề thi từ Microsoft Word (.docx)
                      </div>
                      <ul className="text-[11px] text-[#4A615A] space-y-0.5 leading-relaxed">
                        <li>
                          • <strong>Hình ảnh trong câu hỏi:</strong> tự động cắt &amp; nhúng thẳng vào đề thi học sinh.
                        </li>
                        <li>
                          • <strong>Trắc nghiệm &amp; Đúng/Sai:</strong> tự động đọc đáp án bằng{' '}
                          <span className="underline font-semibold text-[#0F4C3F]">gạch chân</span>{' '}
                          (hoặc bảng đáp án cuối đề).
                        </li>
                        <li>
                          • <strong>Trả lời ngắn:</strong> hiển thị dạng <strong>4 ô điền số</strong>;{' '}
                          <strong>Tự luận:</strong> tự tách mục <em>Hướng dẫn giải / Lời giải</em>.
                        </li>
                      </ul>
                      <label className="inline-flex items-center gap-2 pt-1 text-[11px] font-medium text-[#0F4C3F] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autoGenerateWordExplanations}
                          onChange={(e) => setAutoGenerateWordExplanations(e.target.checked)}
                          className="rounded border-[#0F4C3F] accent-[#0F4C3F]"
                        />
                        <span>
                          Tự động dùng AI viết lời giải chi tiết dựa trên đáp án cho các câu chưa có giải thích
                        </span>
                      </label>
                    </div>

                    <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] cursor-pointer shrink-0 self-start sm:self-center">
                      <Upload className="w-4 h-4 text-[#E5C665]" />
                      <span>
                        {parsingWord
                          ? 'Đang đọc file...'
                          : wordFileName
                            ? 'Chọn file Word khác'
                            : 'Chọn file Word (.docx)'}
                      </span>
                      <input
                        type="file"
                        accept=".docx"
                        onChange={(e) => {
                          handleWordFileSelected(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {wordResult && (
                    <div className="pt-3 border-t border-[#DAE5E0] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-[#0D221D] flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[#0F4C3F]">
                            {wordFileName}
                          </span>
                          <span>·</span>
                          <span className="tabular-nums">
                            {wordQuestions.length} câu hỏi
                          </span>
                          <span>·</span>
                          <span className="tabular-nums">
                            {wordResult.imageCount} hình ảnh trích xuất
                          </span>
                          {wordResult.bottomAnswerCount > 0 && (
                            <>
                              <span>·</span>
                              <span className="tabular-nums text-[#0F6D4F] font-medium">
                                {wordResult.bottomAnswerCount} đáp án từ phần dưới đề
                              </span>
                            </>
                          )}
                          {wordResult.underlineAnswerCount > 0 && (
                            <>
                              <span>·</span>
                              <span className="tabular-nums text-[#0F6D4F] font-medium">
                                {wordResult.underlineAnswerCount} đáp án gạch chân
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {wordQuestions.length > 0 && (
                            <button
                              type="button"
                              disabled={generatingWordExplanations || refiningWordAi}
                              onClick={() => {
                                const hasMissing = wordQuestions.some(
                                  (q) => !q.explanation?.trim()
                                );
                                handleGenerateWordExplanations(wordQuestions, {
                                  overwriteAll: !hasMissing,
                                });
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] text-xs font-semibold hover:bg-[#FAF1D6] disabled:opacity-60 cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-[#B0831A]" />
                              <span>
                                {generatingWordExplanations
                                  ? 'AI đang viết lời giải...'
                                  : wordQuestions.some((q) => !q.explanation?.trim())
                                    ? `AI viết lời giải từ đáp án (${
                                        wordQuestions.filter((q) => !q.explanation?.trim()).length
                                      } câu)`
                                    : 'AI viết lại lời giải từ đáp án'}
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={refiningWordAi || generatingWordExplanations}
                            onClick={handleRefineWordWithAI}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#0F4C3F] bg-white text-[#0F4C3F] text-xs font-semibold hover:bg-[#EFF7F3] disabled:opacity-60 cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>
                              {refiningWordAi
                                ? 'AI đang chuẩn hoá...'
                                : 'Chuẩn hoá lại bằng AI'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {wordResult.warnings.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-[#FDF8EB] border border-[#EAD8A6] text-[11px] text-[#7A580B] space-y-1">
                          {wordResult.warnings.map((w, wIdx) => (
                            <div key={wIdx}>{w}</div>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#E6EEEA]">
                          <button
                            type="button"
                            onClick={() => setWordFilterMode('all')}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer ${
                              wordFilterMode === 'all'
                                ? 'bg-white text-[#0F4C3F] font-semibold shadow-sm'
                                : 'text-[#4A615A] hover:text-[#0D221D]'
                            }`}
                          >
                            Tất cả ({wordQuestions.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setWordFilterMode('essay')}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer ${
                              wordFilterMode === 'essay'
                                ? 'bg-white text-[#0F4C3F] font-semibold shadow-sm'
                                : 'text-[#4A615A] hover:text-[#0D221D]'
                            }`}
                          >
                            Câu Tự luận ({wordQuestions.filter((w) => w.type === 'essay').length})
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={handleAddEssayToWordQuestions}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#0F4C3F] bg-white text-[#0F4C3F] text-[11px] font-semibold hover:bg-[#EFF7F3] cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Thêm câu tự luận</span>
                        </button>
                      </div>

                      {wordQuestions.length > 0 && (
                        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                          {wordQuestions
                            .map((q, qIdx) => ({ q, qIdx }))
                            .filter(({ q }) =>
                              wordFilterMode === 'essay' ? q.type === 'essay' : true
                            )
                            .map(({ q, qIdx }) => (
                              <div
                                key={q.id}
                                className={`p-3.5 rounded-xl bg-white border space-y-2.5 ${
                                  q.needsReview
                                    ? 'border-[#C89B2B]'
                                    : 'border-[#DAE5E0]'
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-bold text-[#0D221D]">
                                      Câu {q.index}
                                    </span>
                                    <select
                                      value={q.type}
                                      onChange={(e) => {
                                        const nextType = e.target.value as QuestionType;
                                        updateWordQuestion(qIdx, (prev) => ({
                                          ...prev,
                                          type: nextType,
                                          maxScore:
                                            nextType === 'true_false'
                                              ? 1
                                              : nextType === 'essay'
                                                ? 1
                                                : nextType === 'short_answer'
                                                  ? 0.5
                                                  : 0.25,
                                          options:
                                            nextType === 'mcq'
                                              ? prev.options || [
                                                  'Phương án A',
                                                  'Phương án B',
                                                  'Phương án C',
                                                  'Phương án D',
                                                ]
                                              : prev.options,
                                          statements:
                                            nextType === 'true_false'
                                              ? prev.statements || [
                                                  { text: 'Ý a', isTrue: true },
                                                  { text: 'Ý b', isTrue: false },
                                                  { text: 'Ý c', isTrue: true },
                                                  { text: 'Ý d', isTrue: false },
                                                ]
                                              : prev.statements,
                                        }));
                                      }}
                                      className="px-2 py-1 rounded-lg border border-[#CEDCD6] bg-[#F8FAF9] text-[11px] font-medium text-[#0D221D]"
                                    >
                                      <option value="mcq">Trắc nghiệm</option>
                                      <option value="true_false">Đúng / Sai</option>
                                      <option value="short_answer">
                                        Trả lời ngắn (4 ô số)
                                      </option>
                                      <option value="essay">Tự luận</option>
                                    </select>

                                    {q.answerSource === 'underline' && (
                                      <span className="text-[11px] font-medium text-[#0F6D4F]">
                                        · Đọc từ gạch chân
                                      </span>
                                    )}
                                    {q.answerSource === 'table' && (
                                      <span className="text-[11px] font-medium text-[#0F6D4F]">
                                        · Đọc từ đáp án dưới đề
                                      </span>
                                    )}
                                    {q.answerSource === 'explicit' && (
                                      <span className="text-[11px] font-medium text-[#0F6D4F]">
                                        · Đọc từ đáp án/lời giải
                                      </span>
                                    )}
                                    {q.needsReview && (
                                      <span className="text-[11px] font-medium text-[#8A630D]">
                                        · Cần kiểm tra đáp án
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 text-[11px]">
                                    <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[#CEDCD6] bg-[#F8FAF9] text-[#3A524A] hover:text-[#0F4C3F] cursor-pointer">
                                      <ImageIcon className="w-3 h-3" />
                                      <span>+ Ảnh đề</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          handleAttachExtraImageToWordQuestion(
                                            qIdx,
                                            e.target.files?.[0],
                                            'imageUrls'
                                          );
                                          e.target.value = '';
                                        }}
                                        className="hidden"
                                      />
                                    </label>
                                    <input
                                      type="number"
                                      step="0.05"
                                      min={0.1}
                                      max={10}
                                      value={q.maxScore}
                                      onChange={(e) =>
                                        updateWordQuestion(qIdx, (prev) => ({
                                          ...prev,
                                          maxScore: Number(e.target.value) || 0.25,
                                        }))
                                      }
                                      className="w-14 px-1.5 py-1 rounded-lg border border-[#CEDCD6] text-center font-mono tabular-nums"
                                    />
                                    <span className="text-[#597169]">đ</span>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteWordQuestion(qIdx)}
                                      title="Xoá câu hỏi này"
                                      className="p-1 rounded-lg text-[#597169] hover:text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[11px] font-medium text-[#4A615A] mb-1">
                                    Nội dung câu hỏi:
                                  </label>
                                  <textarea
                                    rows={q.type === 'essay' ? 3 : 2}
                                    value={q.prompt}
                                    onChange={(e) =>
                                      updateWordQuestion(qIdx, (prev) => ({
                                        ...prev,
                                        prompt: e.target.value,
                                      }))
                                    }
                                    placeholder="Nhập hoặc chỉnh sửa nội dung đề bài (hỗ trợ $...$ LaTeX)..."
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-[#F8FAF9] text-xs text-[#0D221D] leading-relaxed focus:outline-none focus:border-[#0F4C3F]"
                                  />
                                  {containsLatexFormula(q.prompt) && (
                                    <div className="mt-1 p-2 rounded-lg bg-[#F8FAF9] border border-[#DAE5E0] text-xs text-[#0D221D]">
                                      <MathText
                                        text={q.prompt}
                                        className="whitespace-pre-line leading-relaxed"
                                      />
                                    </div>
                                  )}
                                </div>

                                {q.imageUrls && q.imageUrls.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {q.imageUrls.map((url, imgIdx) => (
                                      <div key={imgIdx} className="relative group">
                                        <img
                                          src={url}
                                          alt={`Ảnh câu ${q.index}`}
                                          className="max-h-28 rounded-lg border border-[#CEDCD6] object-contain bg-white"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateWordQuestion(qIdx, (prev) => ({
                                              ...prev,
                                              imageUrls: (prev.imageUrls || []).filter(
                                                (_, i) => i !== imgIdx
                                              ),
                                            }))
                                          }
                                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#B91C1C] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                          title="Xoá ảnh khỏi câu này"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {q.type === 'mcq' && q.options && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {q.options.map((opt, optIdx) => {
                                      const active = q.correctOption === optIdx;
                                      return (
                                        <button
                                          key={optIdx}
                                          type="button"
                                          onClick={() =>
                                            updateWordQuestion(qIdx, (prev) => ({
                                              ...prev,
                                              correctOption: optIdx,
                                              needsReview: false,
                                            }))
                                          }
                                          className={`text-left px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-1.5 cursor-pointer ${
                                            active
                                              ? 'border-[#0F6D4F] bg-[#F0FBF6] text-[#0A362C] font-semibold'
                                              : 'border-[#EBF1EE] bg-[#F8FAF9] text-[#3A524A]'
                                          }`}
                                        >
                                          <span className="font-mono font-bold">
                                            {OPTION_LETTERS[optIdx]}.
                                          </span>
                                          <MathText text={opt} inline className="min-w-0" />
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {q.type === 'true_false' && q.statements && (
                                  <div className="space-y-1">
                                    {q.statements.map((st, sIdx) => (
                                      <div
                                        key={sIdx}
                                        className="flex items-center justify-between gap-2 text-[11px] px-2.5 py-1.5 rounded-lg bg-[#F8FAF9] border border-[#EBF1EE]"
                                      >
                                        <span className="text-[#0D221D] min-w-0">
                                          <strong>{'abcd'[sIdx]})</strong>{' '}
                                          <MathText text={st.text} inline />
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateWordQuestion(qIdx, (prev) => ({
                                              ...prev,
                                              needsReview: false,
                                              statements: (prev.statements || []).map(
                                                (item, idx2) =>
                                                  idx2 === sIdx
                                                    ? { ...item, isTrue: !item.isTrue }
                                                    : item
                                              ),
                                            }))
                                          }
                                          className={`px-2 py-0.5 rounded font-semibold shrink-0 cursor-pointer ${
                                            st.isTrue
                                              ? 'bg-[#DCFCE7] text-[#0A362C]'
                                              : 'bg-[#FEE2E2] text-[#991B1B]'
                                          }`}
                                        >
                                          {st.isTrue ? 'Đúng' : 'Sai'}
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {q.type === 'short_answer' && (
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="text-[#4A615A]">
                                      Đáp số 4 ô:
                                    </span>
                                    <input
                                      type="text"
                                      maxLength={4}
                                      value={q.correctAnswer || ''}
                                      onChange={(e) =>
                                        updateWordQuestion(qIdx, (prev) => ({
                                          ...prev,
                                          correctAnswer: e.target.value,
                                          needsReview: !e.target.value.trim(),
                                        }))
                                      }
                                      placeholder="VD: 2,5"
                                      className="w-24 px-2.5 py-1 rounded-lg border border-[#CEDCD6] font-mono text-xs font-semibold text-[#0F4C3F]"
                                    />
                                  </div>
                                )}

                                {q.type === 'essay' && (
                                  <div>
                                    <label className="block text-[11px] font-medium text-[#4A615A] mb-1">
                                      Đáp án chuẩn / Barem chấm (AI dùng để chấm bài chụp):
                                    </label>
                                    <input
                                      type="text"
                                      value={q.correctAnswer || ''}
                                      onChange={(e) =>
                                        updateWordQuestion(qIdx, (prev) => ({
                                          ...prev,
                                          correctAnswer: e.target.value,
                                          needsReview: false,
                                        }))
                                      }
                                      placeholder="VD: p2 = 300 kPa; m = 12 g (ý a: 0,5đ, ý b: 0,5đ)"
                                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-[#F8FAF9] text-[11px] text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                                    />
                                  </div>
                                )}

                                <div>
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <label className="block text-[11px] font-medium text-[#4A615A]">
                                      {q.type === 'essay'
                                        ? 'Hướng dẫn giải chi tiết (Tự luận):'
                                        : 'Lời giải / ghi chú:'}
                                    </label>
                                    <label className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#CEDCD6] bg-[#F8FAF9] text-[10px] text-[#3A524A] hover:text-[#0F4C3F] cursor-pointer">
                                      <ImageIcon className="w-3 h-3" />
                                      <span>+ Ảnh lời giải</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          handleAttachExtraImageToWordQuestion(
                                            qIdx,
                                            e.target.files?.[0],
                                            'explanationImageUrls'
                                          );
                                          e.target.value = '';
                                        }}
                                        className="hidden"
                                      />
                                    </label>
                                  </div>
                                  <textarea
                                    rows={q.type === 'essay' ? 3 : 1}
                                    value={q.explanation}
                                    onChange={(e) =>
                                      updateWordQuestion(qIdx, (prev) => ({
                                        ...prev,
                                        explanation: e.target.value,
                                        needsReview:
                                          prev.type === 'essay'
                                            ? !e.target.value.trim()
                                            : prev.needsReview,
                                      }))
                                    }
                                    placeholder="Nhập hoặc chỉnh sửa hướng dẫn giải cho câu này (hỗ trợ $...$ LaTeX)..."
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-[#F8FAF9] text-[11px] focus:outline-none focus:border-[#0F4C3F]"
                                  />
                                  {containsLatexFormula(q.explanation) && (
                                    <div className="mt-1 p-2 rounded-lg bg-[#EFF7F3] border border-[#C5DDD3] text-[11px] text-[#0D221D]">
                                      <MathText
                                        text={q.explanation}
                                        className="whitespace-pre-line leading-relaxed"
                                      />
                                    </div>
                                  )}
                                  {q.explanationImageUrls &&
                                    q.explanationImageUrls.length > 0 && (
                                      <div className="flex flex-wrap gap-2 mt-2">
                                        {q.explanationImageUrls.map((url, imgIdx) => (
                                          <div key={imgIdx} className="relative group">
                                            <img
                                              src={url}
                                              alt={`Ảnh lời giải câu ${q.index}`}
                                              className="max-h-24 rounded-lg border border-[#CEDCD6] object-contain bg-white"
                                            />
                                            <button
                                              type="button"
                                              onClick={() =>
                                                updateWordQuestion(qIdx, (prev) => ({
                                                  ...prev,
                                                  explanationImageUrls: (
                                                    prev.explanationImageUrls || []
                                                  ).filter((_, i) => i !== imgIdx),
                                                }))
                                              }
                                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#B91C1C] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                              title="Xoá ảnh lời giải"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                </div>
                              </div>
                            ))}
                          {wordFilterMode === 'essay' &&
                            wordQuestions.filter((w) => w.type === 'essay').length === 0 && (
                              <div className="p-4 rounded-xl bg-white border border-[#DAE5E0] text-center text-xs text-[#4A615A]">
                                Chưa có câu tự luận nào trong danh sách. Bạn có thể chuyển loại câu hỏi sang &ldquo;Tự luận&rdquo; ở tab Tất cả hoặc nhấn &ldquo;+ Thêm câu tự luận&rdquo;.
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {createMode === 'ai' && (
                <div className="p-4 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#3A524A] mb-1">
                        Môn học
                      </label>
                      <input
                        type="text"
                        value={newSubject}
                        onChange={(e) => setNewSubject(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-[#3A524A] mb-1">
                        Chủ đề / Nội dung kiến thức
                      </label>
                      <input
                        type="text"
                        value={aiTopic}
                        onChange={(e) => setAiTopic(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-[#4A615A] mb-1">
                        Trắc nghiệm
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={aiMcqCount}
                        onChange={(e) => setAiMcqCount(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#4A615A] mb-1">
                        Đúng / Sai
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={4}
                        value={aiTfCount}
                        onChange={(e) => setAiTfCount(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#4A615A] mb-1">
                        Trả lời ngắn
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={4}
                        value={aiShortCount}
                        onChange={(e) => setAiShortCount(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#4A615A] mb-1">
                        Tự luận
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={4}
                        value={aiEssayCount}
                        onChange={(e) => setAiEssayCount(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={generating}
                    onClick={handleGenerateWithAI}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#EAD8A6] text-[#8A630D] bg-[#FDF8EB] text-xs font-semibold hover:bg-[#FAF1D6] transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#B0831A]" />
                    <span>
                      {generating ? 'Đang sinh câu hỏi...' : 'Sinh câu hỏi bằng AI'}
                    </span>
                  </button>

                  {previewQuestions && (
                    <div className="pt-3 space-y-2.5 max-h-72 overflow-y-auto border-t border-[#DAE5E0]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-[#0F4C3F]">
                          Đã sinh {previewQuestions.length} câu hỏi (chỉnh sửa trực tiếp nếu cần):
                        </div>
                      </div>
                      {previewQuestions.map((q, idx) => (
                        <div
                          key={q.id}
                          className="text-xs text-[#3A524A] bg-white p-3 rounded-lg border border-[#DAE5E0] space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[#0D221D]">
                              Câu {q.index} ·{' '}
                              {q.type === 'essay'
                                ? 'Tự luận'
                                : q.type === 'true_false'
                                  ? 'Đúng/Sai'
                                  : q.type === 'short_answer'
                                    ? 'Trả lời ngắn'
                                    : 'Trắc nghiệm'}
                            </span>
                            <span className="text-[11px] text-[#597169] tabular-nums">
                              {q.maxScore} điểm
                            </span>
                          </div>
                          <textarea
                            rows={q.type === 'essay' ? 2 : 1}
                            value={q.prompt}
                            onChange={(e) =>
                              setPreviewQuestions((prev) =>
                                prev
                                  ? prev.map((item, i) =>
                                      i === idx ? { ...item, prompt: e.target.value } : item
                                    )
                                  : prev
                              )
                            }
                            className="w-full px-2 py-1 rounded border border-[#CEDCD6] bg-[#F8FAF9] text-xs text-[#0D221D]"
                          />
                          {containsLatexFormula(q.prompt) && (
                            <div className="p-2 rounded bg-[#F8FAF9] border border-[#DAE5E0] text-xs text-[#0D221D]">
                              <MathText
                                text={q.prompt}
                                className="whitespace-pre-line leading-relaxed"
                              />
                            </div>
                          )}
                          {q.type === 'essay' && (
                            <div className="space-y-1.5">
                              <input
                                type="text"
                                value={q.correctAnswer || ''}
                                onChange={(e) =>
                                  setPreviewQuestions((prev) =>
                                    prev
                                      ? prev.map((item, i) =>
                                          i === idx
                                            ? { ...item, correctAnswer: e.target.value }
                                            : item
                                        )
                                      : prev
                                  )
                                }
                                placeholder="Đáp án chuẩn / Barem chấm tự luận..."
                                className="w-full px-2 py-1 rounded border border-[#CEDCD6] bg-[#F8FAF9] text-[11px]"
                              />
                              <textarea
                                rows={2}
                                value={q.explanation}
                                onChange={(e) =>
                                  setPreviewQuestions((prev) =>
                                    prev
                                      ? prev.map((item, i) =>
                                          i === idx
                                            ? { ...item, explanation: e.target.value }
                                            : item
                                        )
                                      : prev
                                  )
                                }
                                placeholder="Hướng dẫn giải chi tiết câu tự luận..."
                                className="w-full px-2 py-1 rounded border border-[#CEDCD6] bg-[#F8FAF9] text-[11px]"
                              />
                              {containsLatexFormula(q.explanation) && (
                                <div className="p-2 rounded bg-[#EFF7F3] border border-[#C5DDD3] text-[11px] text-[#0D221D]">
                                  <MathText
                                    text={q.explanation}
                                    className="whitespace-pre-line leading-relaxed"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {createMode === 'template' && (
                <div className="p-4 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] text-sm text-[#3A524A]">
                  Đề mẫu gồm <strong>20 câu Vật lí 12 (HK1)</strong> chuẩn cấu trúc mới: 12 câu Trắc nghiệm, 4 câu Đúng/Sai, 3 câu Trả lời ngắn (4 ô điền số) và 1 câu Tự luận có Hướng dẫn giải chi tiết.
                </div>
              )}

              {createError && (
                <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-sm font-medium text-[#3A524A] hover:bg-[#F8FAF9] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={
                    generating ||
                    parsingWord ||
                    refiningWordAi ||
                    generatingWordExplanations
                  }
                  className="px-5 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
                >
                  {generating
                    ? 'Đang xử lý...'
                    : generatingWordExplanations
                      ? 'Đang tạo lời giải...'
                      : 'Lưu và mở đề'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPhotoGrader && (
        <PhotoEssayGraderModal
          exams={exams}
          onClose={() => setShowPhotoGrader(false)}
        />
      )}

      {editingExam && (
        <ExamEditorModal
          exam={editingExam}
          classes={classes}
          examSubmissions={submissions.filter((s) => s.examId === editingExam.id)}
          initialFilter="all"
          initialQuestionId={editingQuestionId}
          onClose={() => {
            setEditingExam(null);
            setEditingQuestionId(null);
          }}
        />
      )}

      {/* Quick Modal: Edit Exam Code & Assign Classes */}
      {assigningExam && (
        <div className="fixed inset-0 z-50 bg-[#082B23]/45 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#DAE5E0] max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold tracking-[0.08em] text-[#8A630D] uppercase">
                  Cấu hình đề thi
                </div>
                <h3 className="font-serif text-xl font-semibold text-[#0D221D] mt-0.5">
                  Chỉnh mã đề &amp; phân đề cho lớp
                </h3>
                <p className="text-xs text-[#597169] mt-0.5 truncate max-w-sm">
                  {assigningExam.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssigningExam(null)}
                className="p-1.5 rounded-lg text-[#597169] hover:bg-[#EFF7F3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuickAssignment} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Mã đề (3–30 ký tự không dấu) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={30}
                  value={assignExamCode}
                  onChange={(e) => setAssignExamCode(e.target.value.toUpperCase())}
                  placeholder="VD: DE_CK1_VL12"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] font-mono text-sm font-semibold uppercase text-[#8A630D] focus:outline-none focus:border-[#0F4C3F]"
                />
                <p className="text-[11px] text-[#597169] mt-1">
                  Mã chuẩn hoá:{' '}
                  <strong className="font-mono text-[#0F4C3F]">
                    {normalizeExamCode(assignExamCode) || '—'}
                  </strong>
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-[#3A524A]">
                  Chọn lớp được giao đề này:
                </label>
                <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setAssignClassIds([])}
                    className={`w-full text-left px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between cursor-pointer ${
                      assignClassIds.length === 0
                        ? 'bg-[#0F4C3F] text-white border-[#0F4C3F]'
                        : 'bg-white text-[#3A524A] border-[#CEDCD6] hover:border-[#0F4C3F]'
                    }`}
                  >
                    <span>Tất cả các lớp (mặc định — không giới hạn lớp)</span>
                    {assignClassIds.length === 0 && <Check className="w-3.5 h-3.5 text-[#E5C665]" />}
                  </button>

                  {classes.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-0.5">
                      {classes.map((cls) => {
                        const checked = assignClassIds.includes(cls.id);
                        return (
                          <button
                            key={cls.id}
                            type="button"
                            onClick={() =>
                              setAssignClassIds((prev) =>
                                prev.includes(cls.id)
                                  ? prev.filter((id) => id !== cls.id)
                                  : [...prev, cls.id]
                              )
                            }
                            className={`px-3 py-2 rounded-xl border text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                              checked
                                ? 'bg-[#FDF8EB] text-[#8A630D] border-[#C89B2B] font-semibold'
                                : 'bg-white text-[#0D221D] border-[#CEDCD6] hover:border-[#0F4C3F]'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate">Lớp {cls.name}</div>
                              <div className="text-[10px] font-mono text-[#597169]">
                                Mã: {cls.joinCode}
                              </div>
                            </div>
                            {checked && <Check className="w-3.5 h-3.5 text-[#8A630D] shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-[#597169] text-center py-2">
                      Bạn chưa tạo lớp nào trong mục Lớp &amp; học sinh.
                    </div>
                  )}
                </div>
              </div>

              {assignmentError && (
                <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                  {assignmentError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssigningExam(null)}
                  className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-sm font-medium text-[#3A524A] hover:bg-[#F8FAF9] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={savingAssignment}
                  className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
                >
                  {savingAssignment ? 'Đang lưu...' : 'Lưu mã đề & phân lớp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
