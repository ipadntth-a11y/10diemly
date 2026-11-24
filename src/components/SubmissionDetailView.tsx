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
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
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

  const questionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setAnswers(submission.answers);
    setTeacherComment(submission.teacherComment);
    setAiAnalysis(submission.aiAnalysis);
    setParentPhone(submission.parentPhone);
    setPendingAiImages({});
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

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-[#434D49] hover:text-[#16231F] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kết quả đề</span>
        </button>
      </div>

      {/* Student Header */}
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-semibold text-[#16231F]">
          {submission.studentName}
        </h1>
        <div className="text-sm text-[#5C6561] flex flex-wrap items-center gap-2 tabular-nums">
          {submission.studentCode && (
            <>
              <span className="font-mono font-medium text-[#1E4D43]">
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
                  ? 'text-[#B45309] font-medium'
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
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-[#FEF3C7] text-[#92400E] text-xs font-medium">
            {fastGuessCount} câu trả lời dưới 5s – nghi chọn đại
          </div>
        )}
      </div>

      {/* NEW: Per-question & Response-Time Data Analytics Card */}
      <section className="bg-white border border-[#E7E5DF] rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#16231F] flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[#1E4D43]" />
              <span>Phân tích dữ liệu từng câu hỏi &amp; thời gian trả lời</span>
            </h2>
            <p className="text-xs text-[#66706C] mt-0.5">
              Bấm vào từng cột câu hỏi để cuộn xuống chi tiết câu và so sánh với tốc độ trung bình lớp.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowTimingTable((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#DCD9D0] bg-[#FAF9F6] text-xs font-medium text-[#16231F] hover:bg-[#F0EEE8] self-start sm:self-auto cursor-pointer"
          >
            <Table2 className="w-3.5 h-3.5 text-[#1E4D43]" />
            <span>{showTimingTable ? 'Ẩn bảng chi tiết' : 'Xem bảng dữ liệu từng câu'}</span>
          </button>
        </div>

        {/* 4 Behavior Summary Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#ECEAE4]">
            <div className="text-[11px] font-medium text-[#66706C] uppercase">
              Thời gian TB / câu
            </div>
            <div className="font-serif text-2xl font-semibold text-[#16231F] mt-1 tabular-nums">
              {analytics.avgStudentSec}s
            </div>
            <div className="text-xs text-[#66706C] mt-0.5 tabular-nums">
              TB lớp: {analytics.avgClassSec}s / câu
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#ECEAE4]">
            <div className="text-[11px] font-medium text-[#66706C] uppercase">
              Trả lời nhanh (&lt;5s)
            </div>
            <div className="font-serif text-2xl font-semibold text-[#B45309] mt-1 tabular-nums">
              {fastGuessCount} câu
            </div>
            <div className="text-xs text-[#66706C] mt-0.5 tabular-nums">
              {fastGuessCount > 0
                ? `Đúng ${analytics.fastCorrect}/${fastGuessCount} câu nhanh`
                : 'Không có câu khoanh vội'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#ECEAE4]">
            <div className="text-[11px] font-medium text-[#66706C] uppercase">
              Câu dừng lâu nhất
            </div>
            <div className="font-serif text-2xl font-semibold text-[#16231F] mt-1 tabular-nums">
              Câu {analytics.slowestIdx + 1} · {analytics.slowestSec}s
            </div>
            <div className="text-xs text-[#66706C] mt-0.5">
              {analytics.slowestAnswer?.isCorrect ? 'Kết quả: Đúng' : 'Kết quả: Sai / Chưa trọn điểm'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#ECEAE4]">
            <div className="text-[11px] font-medium text-[#66706C] uppercase">
              Nhịp độ Đúng vs Sai
            </div>
            <div className="font-serif text-2xl font-semibold text-[#1E4D43] mt-1 tabular-nums">
              {analytics.avgCorrectSec}s / {analytics.avgWrongSec}s
            </div>
            <div className="text-xs text-[#66706C] mt-0.5">
              TB câu đúng vs câu sai
            </div>
          </div>
        </div>

        {/* Interactive Per-Question Response-Time Bar Chart */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#66706C]">
            <span>Biểu đồ thời gian từng câu (giây)</span>
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#16A34A]" />
                <span>Đúng</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#DC2626]" />
                <span>Sai / Thiếu điểm</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#D98218]" />
                <span>Nghi chọn đại (&lt;5s)</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto pb-1">
            <div className="min-w-[560px] h-40 relative flex items-end gap-1.5 pt-6 pb-6 border-b border-[#E7E5DF]">
              {/* 5s fast-guess threshold line */}
              <div
                style={{
                  bottom: `${24 + Math.min(100, (5 / analytics.maxBarSec) * 100) * 0.85}px`,
                }}
                className="absolute left-0 right-0 border-t border-dashed border-[#D98218]/70 pointer-events-none flex justify-end"
              >
                <span className="text-[10px] font-mono text-[#B45309] bg-white px-1 -mt-2">
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
                  ? 'bg-[#D98218] hover:bg-[#B45309]'
                  : ans.isCorrect
                    ? 'bg-[#16A34A] hover:bg-[#15803D]'
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
                    <span className="text-[10px] font-mono text-[#434D49] mb-1 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                      {ans.timeSpentSeconds}s
                    </span>
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full max-w-6 rounded-t-md transition-all ${barBg}`}
                    />
                    <span className="absolute -bottom-5 text-[10px] font-mono text-[#5C6561] tabular-nums">
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
          <div className="overflow-x-auto border border-[#E7E5DF] rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF9F6] border-b border-[#E7E5DF] text-[#66706C] uppercase">
                  <th className="py-2.5 px-3">Câu</th>
                  <th className="py-2.5 px-3">Loại</th>
                  <th className="py-2.5 px-3">Thời gian HS</th>
                  <th className="py-2.5 px-3">TB lớp</th>
                  <th className="py-2.5 px-3">Tỉ lệ đúng lớp</th>
                  <th className="py-2.5 px-3">Điểm HS</th>
                  <th className="py-2.5 px-3">Nhận định tốc độ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE8]">
                {answers.map((ans, idx) => {
                  const q = exam?.questions.find((qq) => qq.id === ans.questionId);
                  const cls = classStatsByQId.get(ans.questionId);
                  const diff = ans.timeSpentSeconds - (cls?.avgSeconds || 0);
                  const isFast = ans.timeSpentSeconds > 0 && ans.timeSpentSeconds < 5;
                  return (
                    <tr
                      key={ans.questionId}
                      onClick={() => scrollToQuestion(ans.questionId)}
                      className="hover:bg-[#FAF9F6] cursor-pointer"
                    >
                      <td className="py-2.5 px-3 font-semibold text-[#16231F]">
                        Câu {q?.index ?? idx + 1}
                      </td>
                      <td className="py-2.5 px-3 text-[#5C6561]">
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
                      <td className="py-2.5 px-3 font-mono tabular-nums text-[#66706C]">
                        {formatDurationMMSS(cls?.avgSeconds || 0)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-[#434D49]">
                        {cls?.correctPct ?? 0}%
                      </td>
                      <td className="py-2.5 px-3 font-semibold tabular-nums">
                        <span
                          className={
                            ans.isCorrect ? 'text-[#16A34A]' : 'text-[#DC2626]'
                          }
                        >
                          {ans.score}/{ans.maxScore}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {isFast ? (
                          <span className="text-[#B45309] font-medium">
                            Quá nhanh (&lt;5s)
                          </span>
                        ) : diff > 15 ? (
                          <span className="text-[#5C6561]">
                            Chậm hơn TB +{diff}s
                          </span>
                        ) : diff < -10 ? (
                          <span className="text-[#1E4D43]">
                            Nhanh hơn TB {Math.abs(diff)}s
                          </span>
                        ) : (
                          <span className="text-[#66706C]">Bình thường</span>
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
                className="bg-white border border-[#E7E5DF] rounded-2xl p-6 space-y-4"
              >
                {/* Question header row */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-xs font-medium text-[#5C6561]">
                      Câu {question?.index ?? idx + 1} · {typeLabel}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono tabular-nums ${
                        isFastGuess
                          ? 'bg-[#FEF3C7] text-[#B45309] font-semibold'
                          : 'bg-[#F0EEE8] text-[#5C6561]'
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      <span>
                        {formatDurationMMSS(ans.timeSpentSeconds)}
                        {isFastGuess ? ' · chọn đại?' : ''}
                      </span>
                    </span>

                    {clsStat && (
                      <span className="text-[11px] text-[#66706C] tabular-nums">
                        TB lớp: {formatDurationMMSS(clsStat.avgSeconds)} · {clsStat.correctPct}% đúng
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-[#5C6561]">
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
                      className="w-16 px-2.5 py-1 rounded-full border border-[#DCD9D0] bg-white text-center text-xs font-semibold text-[#16231F] tabular-nums focus:outline-none focus:border-[#1E4D43]"
                    />
                    <span className="tabular-nums">/ {ans.maxScore}</span>
                  </div>
                </div>

                {/* Question prompt & embedded images */}
                {question && (
                  <div className="space-y-3">
                    <MathText
                      text={question.prompt}
                      className="text-sm sm:text-[15px] text-[#16231F] leading-relaxed whitespace-pre-line"
                    />
                    {question.imageUrls && question.imageUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2.5">
                        {question.imageUrls.map((url, uIdx) => (
                          <button
                            key={uIdx}
                            type="button"
                            onClick={() => setZoomImageUrl(url)}
                            className="cursor-zoom-in rounded-xl border border-[#DCD9D0] bg-[#FAF9F6] p-1.5 hover:border-[#1E4D43]"
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

                      let boxStyle = 'border-[#E7E5DF] bg-white text-[#434D49]';
                      let badgeStyle = 'bg-[#F0EEE8] text-[#5C6561]';

                      if (isCorrectOpt) {
                        boxStyle = 'border-[#34A853] bg-[#F2FBF5] text-[#16231F] font-medium';
                        badgeStyle = 'bg-[#22A05B] text-white';
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
                  <div className="divide-y divide-[#F0EEE8] border border-[#E7E5DF] rounded-xl overflow-hidden">
                    {question.statements.map((st, sIdx) => {
                      const studentVal = ans.statementAnswers?.[sIdx];
                      const matched = studentVal === st.isTrue;
                      return (
                        <div
                          key={sIdx}
                          className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs sm:text-sm bg-[#FAF9F6]"
                        >
                          <div className="text-[#16231F]">
                            <span className="font-semibold mr-1.5">
                              {TF_LETTERS[sIdx]})
                            </span>
                            <MathText text={st.text} inline />
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-xs">
                            <span className="text-[#5C6561]">
                              HS chọn:{' '}
                              <strong className={matched ? 'text-[#16A34A]' : 'text-[#DC2626]'}>
                                {studentVal === true
                                  ? 'Đúng'
                                  : studentVal === false
                                    ? 'Sai'
                                    : 'Chưa chọn'}
                              </strong>
                            </span>
                            <span className="text-[#1E4D43] font-medium">
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
                  <div className="p-4 rounded-xl bg-[#FAF9F6] border border-[#E7E5DF] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#66706C]">
                        Phiếu điền số học sinh (4 ô)
                      </span>
                      {question?.correctAnswer && (
                        <span className="text-xs text-[#1E4D43] font-semibold font-mono">
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
                                ? 'border-[#34A853] text-[#166534]'
                                : 'border-[#DCD9D0] text-[#16231F]'
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
                    <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#E7E5DF] text-sm space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[#66706C]">
                          Bài làm tự luận của học sinh
                        </span>
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#DCD9D0] bg-white text-xs font-medium text-[#16231F] hover:bg-[#F5F4F0] cursor-pointer">
                            <Camera className="w-3.5 h-3.5 text-[#1E4D43]" />
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
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#E5ECE7] text-[#1E4D43] text-xs font-semibold hover:bg-[#D5E3DA] disabled:opacity-60 cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
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
                          className="text-[#16231F] whitespace-pre-line leading-relaxed"
                        />
                      ) : (
                        !ans.imageDataUrl && (
                          <div className="italic text-[#8C9590]">(Bỏ trống)</div>
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
                              className="max-h-52 rounded-xl border border-[#DCD9D0] object-contain bg-white"
                            />
                            <span className="text-[11px] text-[#1E4D43] mt-1 inline-block group-hover:underline">
                              Nhấn để phóng to ảnh bài làm
                            </span>
                          </button>
                        </div>
                      )}
                    </div>

                    {ans.recognizedText && (
                      <div className="p-3 rounded-xl bg-white border border-[#E7E5DF] space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#66706C]">
                          Nội dung AI đọc được từ ảnh
                        </div>
                        <MathText
                          text={ans.recognizedText}
                          className="text-xs text-[#16231F] whitespace-pre-line leading-relaxed"
                        />
                      </div>
                    )}

                    {ans.aiBreakdown && ans.aiBreakdown.length > 0 && (
                      <div className="p-3 rounded-xl bg-white border border-[#E7E5DF] space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#66706C]">
                          Chi tiết chấm theo Barem 4 bước (AI)
                        </div>
                        {ans.aiBreakdown.map((b, bIdx) => (
                          <div
                            key={bIdx}
                            className="flex items-start justify-between gap-2 text-xs"
                          >
                            <div className="flex items-start gap-1.5 text-[#16231F]">
                              {b.met ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />
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
                      <div className="text-xs text-[#434D49]">
                        <span className="font-semibold">Đáp án chuẩn:</span>{' '}
                        <MathText text={question.correctAnswer} inline />
                      </div>
                    )}

                    {ans.aiFeedback && (
                      <div className="p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E]">
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
                  <div className="p-4 rounded-xl bg-[#F4FAF6] border border-[#D4ECDC] space-y-2">
                    <div className="text-[11px] font-bold tracking-[0.06em] text-[#1E7E48] uppercase">
                      {ans.type === 'essay' ? 'Hướng dẫn giải' : 'Lời giải'}
                    </div>
                    {question.explanation && (
                      <MathText
                        text={question.explanation}
                        className="text-sm text-[#1F3A2B] leading-relaxed whitespace-pre-line"
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
                              className="max-h-40 rounded-lg border border-[#BBF7D0] object-contain bg-white"
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
          <div className="bg-white border border-[#E7E5DF] rounded-2xl p-6 space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <span className="font-serif text-4xl font-semibold text-[#16231F] tabular-nums">
                  {formatScore(computedTotal)}
                </span>
                <span className="text-sm text-[#66706C] ml-1 tabular-nums">
                  /{formatScore(submission.maxScore)}
                </span>
              </div>

              <span
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                  tier.tone === 'high'
                    ? 'bg-[#E5ECE7] text-[#1E4D43]'
                    : tier.tone === 'mid'
                      ? 'bg-[#FEF3C7] text-[#92400E]'
                      : 'bg-[#FEE2E2] text-[#991B1B]'
                }`}
              >
                {tier.label}
              </span>
            </div>

            <div>
              <label
                htmlFor="teacher-comment-box"
                className="block text-xs font-semibold text-[#16231F] mb-1.5"
              >
                Lời phê
              </label>
              <textarea
                id="teacher-comment-box"
                rows={3}
                value={teacherComment}
                onChange={(e) => setTeacherComment(e.target.value)}
                placeholder="Nhận xét ngắn gọn cho học sinh..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD9D0] bg-white text-sm text-[#16231F] focus:outline-none focus:border-[#1E4D43]"
              />
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#1E4D43] text-white text-sm font-medium hover:bg-[#163B33] transition-colors disabled:opacity-60 cursor-pointer"
              >
                {savedNotice ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Đã lưu điểm</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>{saving ? 'Đang lưu...' : 'Lưu điểm'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={analyzingAi}
                onClick={handleAnalyzeStudent}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-[#DCD9D0] bg-white text-[#16231F] text-sm font-medium hover:bg-[#FAF9F6] transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#1E4D43]" />
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
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-[#DCD9D0] bg-white text-[#16231F] text-sm font-medium hover:bg-[#FAF9F6] transition-colors disabled:opacity-60 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#D98218]" />
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
              <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#E7E5DF] space-y-1.5">
                <div className="text-xs font-semibold text-[#1E4D43]">
                  Phân tích học lực theo từng câu &amp; tốc độ (AI)
                </div>
                <p className="text-xs text-[#434D49] leading-relaxed whitespace-pre-line">
                  {aiAnalysis}
                </p>
              </div>
            )}
          </div>

          {/* Parent Message Card */}
          <div className="bg-white border border-[#E7E5DF] rounded-2xl p-6 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#16231F]">
                <MessageSquare className="w-4 h-4 text-[#1E4D43]" />
                <span>Tin nhắn phụ huynh</span>
              </div>
              <span className="text-xs text-[#66706C]">
                {parentPhone.trim() ? parentPhone : 'chưa có SĐT'}
              </span>
            </div>

            <input
              type="text"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              placeholder="Nhập SĐT phụ huynh (09xxxxxxxx)..."
              className="w-full px-3 py-2 rounded-xl border border-[#DCD9D0] bg-[#FAF9F6] text-xs font-mono text-[#16231F] focus:outline-none focus:border-[#1E4D43]"
            />

            <textarea
              rows={5}
              value={parentMessageText}
              onChange={(e) => setParentMessageText(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E5DF] bg-[#FAF9F6] text-xs text-[#434D49] leading-relaxed focus:outline-none focus:border-[#1E4D43]"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopyMessage}
                className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-[#DCD9D0] bg-white text-xs font-medium text-[#16231F] hover:bg-[#FAF9F6] cursor-pointer"
              >
                {copiedMsg ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#16A34A]" />
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
                className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#E5ECE7] text-[#1E4D43] text-xs font-semibold hover:bg-[#D5E3DA] cursor-pointer"
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
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setZoomImageUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white text-[#16231F] cursor-pointer"
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
