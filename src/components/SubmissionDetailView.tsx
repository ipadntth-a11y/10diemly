import {
  ArrowLeft,
  BarChart2,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  MessageSquare,
  Save,
  Sparkles,
  Table2,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteSubmission,
  extractFriendlyFirestoreError,
  saveParentMessage,
  updateSubmissionGrading,
} from '../services/firestoreService';
import type { EssayCriterionResult, Exam, StudentAnswer, Submission } from '../types';
import {
  buildDefaultParentMessage,
  formatDurationMMSS,
  formatScore,
  getScoreTier,
} from '../utils/formatters';
import { compressExamPhoto } from '../utils/imageUtils';
import { MathText } from './MathText';

interface SubmissionDetailViewProps {
  teacherId: string;
  submission: Submission;
  exam: Exam | undefined;
  allExamSubmissions?: Submission[];
  onBack: () => void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const TF_LETTERS = ['a', 'b', 'c', 'd'];

export function SubmissionDetailView({
  teacherId,
  submission,
  exam,
  allExamSubmissions = [],
  onBack,
}: SubmissionDetailViewProps) {
  const [answers, setAnswers] = useState<StudentAnswer[]>(submission.answers);
  const [teacherComment, setTeacherComment] = useState(submission.teacherComment);
  const [aiAnalysis, setAiAnalysis] = useState(submission.aiAnalysis);
  const [parentPhone, setParentPhone] = useState(submission.parentPhone);
  const [parentMessageText, setParentMessageText] = useState(() =>
    buildDefaultParentMessage(
      submission.studentName,
      submission.examTitle,
      submission.totalScore,
      submission.maxScore,
      submission.teacherComment
    )
  );

  // Store high-res base64 temporarily for newly uploaded photos before saving
  const [pendingAiImages, setPendingAiImages] = useState<
    Record<string, { base64: string; mimeType: string }>
  >({});
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [showTimingTable, setShowTimingTable] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [gradingEssayAi, setGradingEssayAi] = useState(false);
  const [gradingSingleId, setGradingSingleId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [savedMsgLog, setSavedMsgLog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingSub, setDeletingSub] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const questionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setAnswers(submission.answers);
    setTeacherComment(submission.teacherComment);
    setAiAnalysis(submission.aiAnalysis);
    setParentPhone(submission.parentPhone);
    setPendingAiImages({});
    setConfirmDelete(false);
    setDeletingSub(false);
    setDeleteError(null);
    setParentMessageText(
      buildDefaultParentMessage(
        submission.studentName,
        submission.examTitle,
        submission.totalScore,
        submission.maxScore,
        submission.teacherComment
      )
    );
  }, [submission]);

  // Compute class average timing & accuracy per question for comparison
  const classStatsByQId = useMemo(() => {
    const map = new Map<
      string,
      { avgSeconds: number; correctPct: number; sampleSize: number }
    >();
    const pool = allExamSubmissions.length > 0 ? allExamSubmissions : [submission];
    answers.forEach((ans) => {
      let totalTime = 0;
      let count = 0;
      let rightCount = 0;
      pool.forEach((s) => {
        const hit = s.answers.find((a) => a.questionId === ans.questionId);
        if (hit) {
          totalTime += hit.timeSpentSeconds || 0;
          count++;
          if (hit.isCorrect || (hit.maxScore > 0 && hit.score >= hit.maxScore)) {
            rightCount++;
          }
        }
      });
      map.set(ans.questionId, {
        avgSeconds: count > 0 ? Math.round(totalTime / count) : 0,
        correctPct: count > 0 ? Math.round((rightCount / count) * 100) : 0,
        sampleSize: count,
      });
    });
    return map;
  }, [allExamSubmissions, submission, answers]);

  // Student-level timing & accuracy analytics
  const analytics = useMemo(() => {
    const count = answers.length || 1;
    const totalQSeconds = answers.reduce((sum, a) => sum + (a.timeSpentSeconds || 0), 0);
    const avgStudentSec = Math.round(totalQSeconds / count);

    let classTotalAvg = 0;
    answers.forEach((a) => {
      classTotalAvg += classStatsByQId.get(a.questionId)?.avgSeconds || 0;
    });
    const avgClassSec = Math.round(classTotalAvg / count);

    const fastGuesses = answers.filter(
      (a) => a.timeSpentSeconds > 0 && a.timeSpentSeconds < 5
    );
    const fastCorrect = fastGuesses.filter((a) => a.isCorrect).length;

    const correctAns = answers.filter((a) => a.isCorrect);
    const wrongAns = answers.filter((a) => !a.isCorrect);
    const avgCorrectSec =
      correctAns.length > 0
        ? Math.round(
            correctAns.reduce((s, a) => s + a.timeSpentSeconds, 0) / correctAns.length
          )
        : 0;
    const avgWrongSec =
      wrongAns.length > 0
        ? Math.round(
            wrongAns.reduce((s, a) => s + a.timeSpentSeconds, 0) / wrongAns.length
          )
        : 0;

    let slowestIdx = 0;
    let slowestSec = -1;
    answers.forEach((a, idx) => {
      if (a.timeSpentSeconds > slowestSec) {
        slowestSec = a.timeSpentSeconds;
        slowestIdx = idx;
      }
    });

    const maxBarSec = Math.max(
      15,
      ...answers.map((a) => a.timeSpentSeconds || 0),
      ...Array.from(classStatsByQId.values()).map((v) => v.avgSeconds)
    );

    return {
      avgStudentSec,
      avgClassSec,
      fastGuesses,
      fastCorrect,
      avgCorrectSec,
      avgWrongSec,
      slowestIdx,
      slowestSec,
      slowestAnswer: answers[slowestIdx],
      maxBarSec,
    };
  }, [answers, classStatsByQId]);

  const computedTotal = Number(
    answers.reduce((sum, a) => sum + Number(a.score || 0), 0).toFixed(2)
  );
  const tier = getScoreTier(computedTotal, submission.maxScore);
  const fastGuessCount = analytics.fastGuesses.length;

  const handleScoreChange = (questionId: string, newScoreRaw: string, max: number) => {
    const num = parseFloat(newScoreRaw.replace(',', '.'));
    const clamped = Number.isNaN(num) ? 0 : Math.min(Math.max(num, 0), max);
    setAnswers((prev) =>
      prev.map((a) =>
        a.questionId === questionId
          ? { ...a, score: clamped, isCorrect: clamped >= a.maxScore }
          : a
      )
    );
  };

  const handleAttachPhotoToQuestion = async (
    questionId: string,
    file: File | undefined
  ) => {
    if (!file) return;
    setAiError(null);
    try {
      const compressed = await compressExamPhoto(file);
      setPendingAiImages((prev) => ({
        ...prev,
        [questionId]: {
          base64: compressed.aiBase64,
          mimeType: compressed.aiMimeType,
        },
      }));
      setAnswers((prev) =>
        prev.map((a) =>
          a.questionId === questionId
            ? { ...a, imageDataUrl: compressed.storageDataUrl }
            : a
        )
      );
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Không thể đọc tệp ảnh.');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setAiError(null);
    try {
      await updateSubmissionGrading(submission.id, {
        totalScore: computedTotal,
        teacherComment,
        aiAnalysis,
        status: 'graded',
        answers,
        parentPhone,
      });
      setParentMessageText(
        buildDefaultParentMessage(
          submission.studentName,
          submission.examTitle,
          computedTotal,
          submission.maxScore,
          teacherComment
        )
      );
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2200);
    } finally {
      setSaving(false);
    }
  };

  const handleAnalyzeStudent = async () => {
    setAnalyzingAi(true);
    setAiError(null);
    try {
      const summaries = answers.map((a, idx) => {
        const q = exam?.questions.find((qq) => qq.id === a.questionId);
        const clsStat = classStatsByQId.get(a.questionId);
        return {
          questionNumber: q?.index ?? idx + 1,
          type: a.type,
          promptSnippet: q?.prompt?.slice(0, 120) || '',
          timeSpentSeconds: a.timeSpentSeconds,
          classAvgSeconds: clsStat?.avgSeconds ?? 0,
          classCorrectPct: clsStat?.correctPct ?? 0,
          score: a.score,
          maxScore: a.maxScore,
          isCorrect: a.isCorrect,
          suspectedFastGuess: a.timeSpentSeconds > 0 && a.timeSpentSeconds < 5,
        };
      });
      const res = await fetch('/api/ai/analyze-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: submission.studentName,
          examTitle: submission.examTitle,
          totalScore: computedTotal,
          maxScore: submission.maxScore,
          durationSeconds: submission.durationSeconds,
          violationCount: submission.violationCount,
          questionSummaries: summaries,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể phân tích học lực.');
      setAiAnalysis(data.analysis || '');
      if (!teacherComment.trim() && data.suggestedComment) {
        setTeacherComment(data.suggestedComment);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Lỗi kết nối Gemini.');
    } finally {
      setAnalyzingAi(false);
    }
  };

  const runEssayGradingForTargets = async (targetAnswers: StudentAnswer[]) => {
    const items = targetAnswers.map((a) => {
      const q = exam?.questions.find((qq) => qq.id === a.questionId);
      const pendingImg = pendingAiImages[a.questionId];
      return {
        questionId: a.questionId,
        prompt: q?.prompt || '',
        correctAnswer: q?.correctAnswer || '',
        explanation: q?.explanation || '',
        studentAnswer: a.textAnswer || '',
        imageBase64: pendingImg?.base64,
        imageMimeType: pendingImg?.mimeType,
        imageDataUrl: !pendingImg ? a.imageDataUrl : undefined,
        maxScore: a.maxScore,
      };
    });

    const res = await fetch('/api/ai/grade-essay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName: submission.studentName,
        examTitle: submission.examTitle,
        items,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Không thể chấm tự luận bằng AI.');

    const resultMap = new Map<
      string,
      {
        proposedScore: number;
        recognizedText: string;
        feedback: string;
        breakdown: EssayCriterionResult[];
      }
    >();
    (data.results || []).forEach(
      (r: {
        questionId: string;
        proposedScore: number;
        recognizedText: string;
        feedback: string;
        breakdown: EssayCriterionResult[];
      }) => {
        resultMap.set(r.questionId, r);
      }
    );

    setAnswers((prev) =>
      prev.map((a) => {
        const hit = resultMap.get(a.questionId);
        if (!hit) return a;
        const clamped = Math.min(Math.max(Number(hit.proposedScore || 0), 0), a.maxScore);
        return {
          ...a,
          score: Number(clamped.toFixed(2)),
          isCorrect: clamped >= a.maxScore,
          recognizedText: hit.recognizedText || a.recognizedText,
          aiFeedback: hit.feedback,
          aiBreakdown: hit.breakdown,
        };
      })
    );

    if (data.overallNote && !teacherComment.trim()) {
      setTeacherComment(data.overallNote);
    }
  };

  const handleGradeAllEssaysAI = async () => {
    const shortAnswers = answers.filter(
      (a) =>
        a.type === 'essay' ||
        a.type === 'short_answer' ||
        Boolean(a.imageDataUrl)
    );
    if (shortAnswers.length === 0) {
      setAiError('Bài thi này không có câu tự luận hoặc ảnh bài làm.');
      return;
    }

    setGradingEssayAi(true);
    setAiError(null);
    try {
      await runEssayGradingForTargets(shortAnswers);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Lỗi kết nối Gemini.');
    } finally {
      setGradingEssayAi(false);
    }
  };

  const handleGradeSingleQuestionAI = async (ans: StudentAnswer) => {
    setGradingSingleId(ans.questionId);
    setAiError(null);
    try {
      await runEssayGradingForTargets([ans]);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Lỗi kết nối Gemini.');
    } finally {
      setGradingSingleId(null);
    }
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(parentMessageText);
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 1800);
  };

  const handleSaveToParentLog = async () => {
    await saveParentMessage({
      teacherId,
      submissionId: submission.id,
      studentName: submission.studentName,
      className: submission.className,
      examTitle: submission.examTitle,
      parentPhone,
      content: parentMessageText,
      status: parentPhone.trim() ? 'sent' : 'draft',
    });
    setSavedMsgLog(true);
    setTimeout(() => setSavedMsgLog(false), 2200);
  };

  const scrollToQuestion = (questionId: string) => {
    const el = questionRefs.current[questionId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleDeleteCurrentSubmission = async () => {
    setDeletingSub(true);
    setDeleteError(null);
    try {
      await deleteSubmission(submission.id, teacherId);
      onBack();
    } catch (err) {
      setDeleteError(extractFriendlyFirestoreError(err));
      setDeletingSub(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#3A524A] hover:text-[#0A362C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kết quả đề</span>
        </button>

        {!confirmDelete && (
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#FECACA] bg-white text-[#B91C1C] text-xs font-semibold hover:bg-[#FEF2F2] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xoá bài làm này</span>
          </button>
        )}
      </div>

      {confirmDelete && (
        <div className="p-4 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] flex flex-wrap items-center justify-between gap-3 text-xs text-[#991B1B]">
          <div>
            Xác nhận xoá bài làm của <strong>{submission.studentName}</strong> để thu số liệu chuẩn? Sau khi xoá, điểm TB và biểu đồ của đề sẽ tự động cập nhật lại.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={deletingSub}
              onClick={handleDeleteCurrentSubmission}
              className="px-3.5 py-1.5 rounded-xl bg-[#B91C1C] text-white font-semibold hover:bg-[#991B1B] disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              {deletingSub ? 'Đang xoá...' : 'Xác nhận xoá bài'}
            </button>
            <button
              type="button"
              disabled={deletingSub}
              onClick={() => setConfirmDelete(false)}
              className="px-3.5 py-1.5 rounded-xl border border-[#FECACA] bg-white text-[#991B1B] font-medium hover:bg-[#FEF2F2] whitespace-nowrap cursor-pointer"
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      {deleteError && (
        <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
          {deleteError}
        </div>
      )}

      {/* Student Header */}
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-semibold text-[#0D221D]">
          {submission.studentName}
        </h1>
        <div className="text-sm text-[#4A615A] flex flex-wrap items-center gap-2 tabular-nums">
          {submission.studentCode && (
            <>
              <span className="font-mono font-semibold text-[#0F4C3F]">
                Mã HS: {submission.studentCode}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{submission.examTitle}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDurationMMSS(submission.durationSeconds)}</span>
          <span aria-hidden="true">·</span>
          <span
            className={
              submission.violationCount > 3
                ? 'text-[#B91C1C] font-semibold'
                : submission.violationCount > 0
                  ? 'text-[#8A630D] font-medium'
                  : ''
            }
          >
            {submission.violationCount > 3
              ? `${submission.violationCount} vi phạm · Ép buộc nộp (thoát quá 3 lần)`
              : submission.violationCount > 0
                ? `${submission.violationCount} vi phạm chuyển tab`
                : 'không vi phạm'}
          </span>
        </div>

        {fastGuessCount > 0 && (
          <div className="inline-flex items-center px-3 py-1 rounded-lg bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] text-xs font-semibold">
            {fastGuessCount} câu trả lời dưới 5s – nghi chọn đại
          </div>
        )}
      </div>

      {/* Per-question & Response-Time Data Analytics Card */}
      <section className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-5 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#0D221D] flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[#0F4C3F]" />
              <span>Phân tích dữ liệu từng câu hỏi &amp; thời gian trả lời</span>
            </h2>
            <p className="text-xs text-[#597169] mt-0.5">
              Bấm vào từng cột câu hỏi để cuộn xuống chi tiết câu và so sánh với tốc độ trung bình lớp.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowTimingTable((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-xs font-medium text-[#0D221D] hover:bg-[#EFF7F3] self-start sm:self-auto cursor-pointer"
          >
            <Table2 className="w-3.5 h-3.5 text-[#0F4C3F]" />
            <span>{showTimingTable ? 'Ẩn bảng chi tiết' : 'Xem bảng dữ liệu từng câu'}</span>
          </button>
        </div>

        {/* 4 Behavior Summary Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#EBF1EE]">
            <div className="text-[11px] font-medium text-[#597169] uppercase">
              Thời gian TB / câu
            </div>
            <div className="font-serif text-2xl font-semibold text-[#0D221D] mt-1 tabular-nums">
              {analytics.avgStudentSec}s
            </div>
            <div className="text-xs text-[#597169] mt-0.5 tabular-nums">
              TB lớp: {analytics.avgClassSec}s / câu
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6]">
            <div className="text-[11px] font-medium text-[#8A630D] uppercase">
              Trả lời nhanh (&lt;5s)
            </div>
            <div className="font-serif text-2xl font-semibold text-[#8A630D] mt-1 tabular-nums">
              {fastGuessCount} câu
            </div>
            <div className="text-xs text-[#7A580B] mt-0.5 tabular-nums">
              {fastGuessCount > 0
                ? `Đúng ${analytics.fastCorrect}/${fastGuessCount} câu nhanh`
                : 'Không có câu khoanh vội'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#EBF1EE]">
            <div className="text-[11px] font-medium text-[#597169] uppercase">
              Câu dừng lâu nhất
            </div>
            <div className="font-serif text-2xl font-semibold text-[#0D221D] mt-1 tabular-nums">
              Câu {analytics.slowestIdx + 1} · {analytics.slowestSec}s
            </div>
            <div className="text-xs text-[#597169] mt-0.5">
              {analytics.slowestAnswer?.isCorrect ? 'Kết quả: Đúng' : 'Kết quả: Sai / Chưa trọn điểm'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#EBF1EE]">
            <div className="text-[11px] font-medium text-[#597169] uppercase">
              Nhịp độ Đúng vs Sai
            </div>
            <div className="font-serif text-2xl font-semibold text-[#0F4C3F] mt-1 tabular-nums">
              {analytics.avgCorrectSec}s / {analytics.avgWrongSec}s
            </div>
            <div className="text-xs text-[#597169] mt-0.5">
              TB câu đúng vs câu sai
            </div>
          </div>
        </div>

        {/* Interactive Per-Question Response-Time Bar Chart */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#597169]">
            <span>Biểu đồ thời gian từng câu (giây)</span>
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#0F4C3F]" />
                <span>Đúng</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#DC2626]" />
                <span>Sai / Thiếu điểm</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#C89B2B]" />
                <span>Nghi chọn đại (&lt;5s)</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto pb-1">
            <div className="min-w-[560px] h-40 relative flex items-end gap-1.5 pt-6 pb-6 border-b border-[#DAE5E0]">
              {/* 5s fast-guess threshold line */}
              <div
                style={{
                  bottom: `${24 + Math.min(100, (5 / analytics.maxBarSec) * 100) * 0.85}px`,
                }}
                className="absolute left-0 right-0 border-t border-dashed border-[#C89B2B]/80 pointer-events-none flex justify-end"
              >
                <span className="text-[10px] font-mono text-[#8A630D] bg-white px-1 -mt-2">
                  ngưỡng 5s
                </span>
              </div>

              {answers.map((ans, idx) => {
                const isFast = ans.timeSpentSeconds > 0 && ans.timeSpentSeconds < 5;
                const heightPct = Math.max(
                  6,
                  Math.round((ans.timeSpentSeconds / analytics.maxBarSec) * 100)
                );
                const clsAvg = classStatsByQId.get(ans.questionId)?.avgSeconds || 0;
                const barBg = isFast
                  ? 'bg-[#C89B2B] hover:bg-[#9E7514]'
                  : ans.isCorrect
                    ? 'bg-[#0F4C3F] hover:bg-[#0A362C]'
                    : 'bg-[#DC2626] hover:bg-[#B91C1C]';

                return (
                  <button
                    key={ans.questionId}
                    type="button"
                    onClick={() => scrollToQuestion(ans.questionId)}
                    title={`Câu ${idx + 1}: ${ans.timeSpentSeconds}s (TB lớp ${clsAvg}s) · ${
                      ans.isCorrect ? 'Đúng' : `${ans.score}/${ans.maxScore}đ`
                    }`}
                    className="flex-1 h-full flex flex-col justify-end items-center group cursor-pointer relative"
                  >
                    <span className="text-[10px] font-mono text-[#3A524A] mb-1 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                      {ans.timeSpentSeconds}s
                    </span>
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full max-w-6 rounded-t-md transition-all ${barBg}`}
                    />
                    <span className="absolute -bottom-5 text-[10px] font-mono text-[#4A615A] tabular-nums">
                      C{idx + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Toggleable Detailed Matrix */}
        {showTimingTable && (
          <div className="overflow-x-auto border border-[#DAE5E0] rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F8FAF9] border-b border-[#DAE5E0] text-[#597169] uppercase">
                  <th className="py-2.5 px-3">Câu</th>
                  <th className="py-2.5 px-3">Loại</th>
                  <th className="py-2.5 px-3">Thời gian HS</th>
                  <th className="py-2.5 px-3">TB lớp</th>
                  <th className="py-2.5 px-3">Tỉ lệ đúng lớp</th>
                  <th className="py-2.5 px-3">Điểm HS</th>
                  <th className="py-2.5 px-3">Nhận định tốc độ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDF3F0]">
                {answers.map((ans, idx) => {
                  const q = exam?.questions.find((qq) => qq.id === ans.questionId);
                  const cls = classStatsByQId.get(ans.questionId);
                  const diff = ans.timeSpentSeconds - (cls?.avgSeconds || 0);
                  const isFast = ans.timeSpentSeconds > 0 && ans.timeSpentSeconds < 5;
                  return (
                    <tr
                      key={ans.questionId}
                      onClick={() => scrollToQuestion(ans.questionId)}
                      className="hover:bg-[#EFF7F3] cursor-pointer"
                    >
                      <td className="py-2.5 px-3 font-semibold text-[#0D221D]">
                        Câu {q?.index ?? idx + 1}
                      </td>
                      <td className="py-2.5 px-3 text-[#4A615A]">
                        {ans.type === 'mcq'
                          ? 'Trắc nghiệm'
                          : ans.type === 'true_false'
                            ? 'Đúng/Sai'
                            : ans.type === 'short_answer'
                              ? 'Trả lời ngắn'
                              : 'Tự luận'}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums font-medium">
                        {formatDurationMMSS(ans.timeSpentSeconds)}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-[#597169]">
                        {formatDurationMMSS(cls?.avgSeconds || 0)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-[#3A524A]">
                        {cls?.correctPct ?? 0}%
                      </td>
                      <td className="py-2.5 px-3 font-semibold tabular-nums">
                        <span
                          className={
                            ans.isCorrect ? 'text-[#0F6D4F]' : 'text-[#DC2626]'
                          }
                        >
                          {ans.score}/{ans.maxScore}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {isFast ? (
                          <span className="text-[#8A630D] font-medium">
                            Quá nhanh (&lt;5s)
                          </span>
                        ) : diff > 15 ? (
                          <span className="text-[#4A615A]">
                            Chậm hơn TB +{diff}s
                          </span>
                        ) : diff < -10 ? (
                          <span className="text-[#0F4C3F]">
                            Nhanh hơn TB {Math.abs(diff)}s
                          </span>
                        ) : (
                          <span className="text-[#597169]">Bình thường</span>
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

      {/* Main 2-column grading layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Question-by-question breakdown */}
        <div className="lg:col-span-8 space-y-4">
          {answers.map((ans, idx) => {
            const question = exam?.questions.find((q) => q.id === ans.questionId);
            const clsStat = classStatsByQId.get(ans.questionId);
            const isFastGuess = ans.timeSpentSeconds > 0 && ans.timeSpentSeconds < 5;
            const typeLabel =
              ans.type === 'mcq'
                ? 'Trắc nghiệm'
                : ans.type === 'true_false'
                  ? 'Đúng / Sai'
                  : ans.type === 'short_answer'
                    ? 'Trả lời ngắn'
                    : 'Tự luận';

            return (
              <article
                key={ans.questionId}
                ref={(el) => {
                  questionRefs.current[ans.questionId] = el;
                }}
                className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-4 shadow-[0_1px_2px_rgba(10,54,44,0.03)]"
              >
                {/* Question header row */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-xs font-semibold text-[#0F4C3F]">
                      Câu {question?.index ?? idx + 1} · {typeLabel}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-mono tabular-nums ${
                        isFastGuess
                          ? 'bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] font-semibold'
                          : 'bg-[#EFF7F3] text-[#3A524A]'
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      <span>
                        {formatDurationMMSS(ans.timeSpentSeconds)}
                        {isFastGuess ? ' · chọn đại?' : ''}
                      </span>
                    </span>

                    {clsStat && (
                      <span className="text-[11px] text-[#597169] tabular-nums">
                        TB lớp: {formatDurationMMSS(clsStat.avgSeconds)} · {clsStat.correctPct}% đúng
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-[#4A615A]">
                    <span>Điểm</span>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      max={ans.maxScore}
                      value={ans.score}
                      onChange={(e) =>
                        handleScoreChange(ans.questionId, e.target.value, ans.maxScore)
                      }
                      className="w-16 px-2.5 py-1 rounded-lg border border-[#CEDCD6] bg-white text-center text-xs font-semibold text-[#0D221D] tabular-nums focus:outline-none focus:border-[#0F4C3F]"
                    />
                    <span className="tabular-nums">/ {ans.maxScore}</span>
                  </div>
                </div>

                {/* Question prompt & embedded images */}
                {question && (
                  <div className="space-y-3">
                    <MathText
                      text={question.prompt}
                      className="text-sm sm:text-[15px] text-[#0D221D] leading-relaxed whitespace-pre-line"
                    />
                    {question.imageUrls && question.imageUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2.5">
                        {question.imageUrls.map((url, uIdx) => (
                          <button
                            key={uIdx}
                            type="button"
                            onClick={() => setZoomImageUrl(url)}
                            className="cursor-zoom-in rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] p-1.5 hover:border-[#0F4C3F]"
                          >
                            <img
                              src={url}
                              alt={`Hình câu ${question.index}`}
                              className="max-h-44 rounded-lg object-contain bg-white"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* MCQ Options */}
                {ans.type === 'mcq' && question?.options && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {question.options.map((opt, optIdx) => {
                      const isCorrectOpt = question.correctOption === optIdx;
                      const isStudentOpt = ans.selectedOption === optIdx;
                      const isWrongPick = isStudentOpt && !isCorrectOpt;

                      let boxStyle = 'border-[#DAE5E0] bg-white text-[#3A524A]';
                      let badgeStyle = 'bg-[#EBF1EE] text-[#4A615A]';

                      if (isCorrectOpt) {
                        boxStyle = 'border-[#0F6D4F] bg-[#F0FBF6] text-[#0D221D] font-medium';
                        badgeStyle = 'bg-[#0F6D4F] text-white';
                      } else if (isWrongPick) {
                        boxStyle = 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B] font-medium';
                        badgeStyle = 'bg-[#DC2626] text-white';
                      }

                      return (
                        <div
                          key={optIdx}
                          className={`px-3.5 py-3 rounded-xl border flex items-center gap-3 text-sm ${boxStyle}`}
                        >
                          <span
                            className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 ${badgeStyle}`}
                          >
                            {OPTION_LETTERS[optIdx]}
                          </span>
                          <MathText text={opt} inline className="flex-1" />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* True / False Statements */}
                {ans.type === 'true_false' && question?.statements && (
                  <div className="divide-y divide-[#EDF3F0] border border-[#DAE5E0] rounded-xl overflow-hidden">
                    {question.statements.map((st, sIdx) => {
                      const studentVal = ans.statementAnswers?.[sIdx];
                      const matched = studentVal === st.isTrue;
                      return (
                        <div
                          key={sIdx}
                          className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs sm:text-sm bg-[#F8FAF9]"
                        >
                          <div className="text-[#0D221D]">
                            <span className="font-semibold mr-1.5">
                              {TF_LETTERS[sIdx]})
                            </span>
                            <MathText text={st.text} inline />
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-xs">
                            <span className="text-[#4A615A]">
                              HS chọn:{' '}
                              <strong className={matched ? 'text-[#0F6D4F]' : 'text-[#DC2626]'}>
                                {studentVal === true
                                  ? 'Đúng'
                                  : studentVal === false
                                    ? 'Sai'
                                    : 'Chưa chọn'}
                              </strong>
                            </span>
                            <span className="text-[#0F4C3F] font-medium">
                              Đáp án: {st.isTrue ? 'Đúng' : 'Sai'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 4-Box Short Answer Display */}
                {ans.type === 'short_answer' && (
                  <div className="p-4 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#597169]">
                        Phiếu điền số học sinh (4 ô)
                      </span>
                      {question?.correctAnswer && (
                        <span className="text-xs text-[#0F4C3F] font-semibold font-mono">
                          Đáp số chuẩn: {question.correctAnswer}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {[0, 1, 2, 3].map((boxIdx) => {
                        const ch = (ans.textAnswer || '').trim()[boxIdx] || '';
                        return (
                          <div
                            key={boxIdx}
                            className={`w-11 h-11 rounded-xl border-2 flex items-center justify-center font-mono text-lg font-bold tabular-nums bg-white ${
                              ans.isCorrect
                                ? 'border-[#0F6D4F] text-[#0A362C]'
                                : 'border-[#CEDCD6] text-[#0D221D]'
                            }`}
                          >
                            {ch || '·'}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Essay + Photo Upload & Per-Question AI Grading */}
                {ans.type === 'essay' && (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] text-sm space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[#597169]">
                          Bài làm tự luận của học sinh
                        </span>
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] hover:bg-[#EFF7F3] cursor-pointer">
                            <Camera className="w-3.5 h-3.5 text-[#0F4C3F]" />
                            <span>
                              {ans.imageDataUrl ? 'Đổi ảnh bài làm' : 'Tải ảnh bài làm'}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={(e) =>
                                handleAttachPhotoToQuestion(
                                  ans.questionId,
                                  e.target.files?.[0]
                                )
                              }
                              className="hidden"
                            />
                          </label>

                          <button
                            type="button"
                            disabled={gradingSingleId === ans.questionId}
                            onClick={() => handleGradeSingleQuestionAI(ans)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] text-xs font-semibold hover:bg-[#FAF1D6] disabled:opacity-60 cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-[#B0831A]" />
                            <span>
                              {gradingSingleId === ans.questionId
                                ? 'Đang chấm barem...'
                                : 'Chấm theo Barem AI'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {ans.textAnswer?.trim() ? (
                        <MathText
                          text={ans.textAnswer}
                          className="text-[#0D221D] whitespace-pre-line leading-relaxed"
                        />
                      ) : (
                        !ans.imageDataUrl && (
                          <div className="italic text-[#698078]">(Bỏ trống)</div>
                        )
                      )}

                      {ans.imageDataUrl && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => setZoomImageUrl(ans.imageDataUrl || null)}
                            className="block group cursor-zoom-in"
                          >
                            <img
                              src={ans.imageDataUrl}
                              alt={`Ảnh bài làm câu ${question?.index ?? idx + 1}`}
                              className="max-h-52 rounded-xl border border-[#CEDCD6] object-contain bg-white"
                            />
                            <span className="text-[11px] text-[#0F4C3F] mt-1 inline-block group-hover:underline">
                              Nhấn để phóng to ảnh bài làm
                            </span>
                          </button>
                        </div>
                      )}
                    </div>

                    {ans.recognizedText && (
                      <div className="p-3 rounded-xl bg-white border border-[#DAE5E0] space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                          Nội dung AI đọc được từ ảnh
                        </div>
                        <MathText
                          text={ans.recognizedText}
                          className="text-xs text-[#0D221D] whitespace-pre-line leading-relaxed"
                        />
                      </div>
                    )}

                    {ans.aiBreakdown && ans.aiBreakdown.length > 0 && (
                      <div className="p-3 rounded-xl bg-white border border-[#DAE5E0] space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                          Chi tiết chấm theo Barem 4 bước (AI)
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
                            <span className="font-mono font-semibold tabular-nums shrink-0">
                              {b.score}/{b.maxScore}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {question?.correctAnswer && (
                      <div className="text-xs text-[#3A524A]">
                        <span className="font-semibold">Đáp án chuẩn:</span>{' '}
                        <MathText text={question.correctAnswer} inline />
                      </div>
                    )}

                    {ans.aiFeedback && (
                      <div className="p-3 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-xs text-[#7A580B]">
                        <span className="font-semibold">Nhận xét AI:</span>{' '}
                        <MathText text={ans.aiFeedback} inline />
                      </div>
                    )}
                  </div>
                )}

                {/* HƯỚNG DẪN GIẢI / LỜI GIẢI box */}
                {(question?.explanation ||
                  (question?.explanationImageUrls &&
                    question.explanationImageUrls.length > 0)) && (
                  <div className="p-4 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] space-y-2">
                    <div className="text-[11px] font-bold tracking-[0.06em] text-[#0F4C3F] uppercase">
                      {ans.type === 'essay' ? 'Hướng dẫn giải' : 'Lời giải'}
                    </div>
                    {question.explanation && (
                      <MathText
                        text={question.explanation}
                        className="text-sm text-[#0D221D] leading-relaxed whitespace-pre-line"
                      />
                    )}
                    {question.explanationImageUrls &&
                      question.explanationImageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {question.explanationImageUrls.map((u, uIdx) => (
                            <img
                              key={uIdx}
                              src={u}
                              alt={`Hướng dẫn giải câu ${question.index}`}
                              className="max-h-40 rounded-lg border border-[#C5DDD3] object-contain bg-white"
                            />
                          ))}
                        </div>
                      )}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {/* Right Sticky Grading & Parent Messaging Sidebar */}
        <aside className="lg:col-span-4 space-y-5 lg:sticky lg:top-6">
          {/* Score & AI Controls Card */}
          <div className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-4 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <span className="font-serif text-4xl font-semibold text-[#0A362C] tabular-nums">
                  {formatScore(computedTotal)}
                </span>
                <span className="text-sm text-[#597169] ml-1 tabular-nums">
                  /{formatScore(submission.maxScore)}
                </span>
              </div>

              <span
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                  tier.tone === 'high'
                    ? 'bg-[#EFF7F3] border border-[#C5DDD3] text-[#0F4C3F]'
                    : tier.tone === 'mid'
                      ? 'bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D]'
                      : 'bg-[#FEE2E2] text-[#991B1B]'
                }`}
              >
                {tier.label}
              </span>
            </div>

            <div>
              <label
                htmlFor="teacher-comment-box"
                className="block text-xs font-semibold text-[#0D221D] mb-1.5"
              >
                Lời phê
              </label>
              <textarea
                id="teacher-comment-box"
                rows={3}
                value={teacherComment}
                onChange={(e) => setTeacherComment(e.target.value)}
                placeholder="Nhận xét ngắn gọn cho học sinh..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              />
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] transition-colors disabled:opacity-60 cursor-pointer"
              >
                {savedNotice ? (
                  <>
                    <Check className="w-4 h-4 text-[#E5C665]" />
                    <span>Đã lưu điểm</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 text-[#E5C665]" />
                    <span>{saving ? 'Đang lưu...' : 'Lưu điểm'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={analyzingAi}
                onClick={handleAnalyzeStudent}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-[#CEDCD6] bg-white text-[#0D221D] text-sm font-medium hover:bg-[#EFF7F3] transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#0F4C3F]" />
                <span>
                  {analyzingAi
                    ? 'Đang phân tích dữ liệu câu...'
                    : 'Phân tích học lực & thời gian'}
                </span>
              </button>

              <button
                type="button"
                disabled={gradingEssayAi}
                onClick={handleGradeAllEssaysAI}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-[#8A630D] text-sm font-semibold hover:bg-[#FAF1D6] transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#B0831A]" />
                <span>
                  {gradingEssayAi
                    ? 'AI đang chấm theo Barem...'
                    : 'Chấm tự luận & ảnh theo Barem (AI)'}
                </span>
              </button>
            </div>

            {aiError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {aiError}
              </div>
            )}

            {aiAnalysis && (
              <div className="p-3.5 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] space-y-1.5">
                <div className="text-xs font-semibold text-[#0F4C3F]">
                  Phân tích học lực theo từng câu &amp; tốc độ (AI)
                </div>
                <p className="text-xs text-[#3A524A] leading-relaxed whitespace-pre-line">
                  {aiAnalysis}
                </p>
              </div>
            )}
          </div>

          {/* Parent Message Card */}
          <div className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-3.5 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0D221D]">
                <MessageSquare className="w-4 h-4 text-[#8A630D]" />
                <span>Tin nhắn phụ huynh</span>
              </div>
              <span className="text-xs text-[#597169]">
                {parentPhone.trim() ? parentPhone : 'chưa có SĐT'}
              </span>
            </div>

            <input
              type="text"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              placeholder="Nhập SĐT phụ huynh (09xxxxxxxx)..."
              className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-xs font-mono text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
            />

            <textarea
              rows={5}
              value={parentMessageText}
              onChange={(e) => setParentMessageText(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#DAE5E0] bg-[#F8FAF9] text-xs text-[#3A524A] leading-relaxed focus:outline-none focus:border-[#0F4C3F]"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopyMessage}
                className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] hover:bg-[#F8FAF9] cursor-pointer"
              >
                {copiedMsg ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#0F6D4F]" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSaveToParentLog}
                className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#EFF7F3] text-[#0F4C3F] text-xs font-semibold hover:bg-[#DCECE4] cursor-pointer"
              >
                {savedMsgLog ? 'Đã lưu nhật ký' : 'Lưu nhật ký gửi'}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Image Zoom Lightbox */}
      {zoomImageUrl && (
        <div
          onClick={() => setZoomImageUrl(null)}
          className="fixed inset-0 z-50 bg-[#082B23]/80 flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setZoomImageUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white text-[#0D221D] cursor-pointer"
            aria-label="Đóng ảnh"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={zoomImageUrl}
            alt="Ảnh bài làm phóng to"
            className="max-w-full max-h-[88vh] rounded-xl object-contain bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
