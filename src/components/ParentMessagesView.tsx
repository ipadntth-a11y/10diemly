import {
  Check,
  CheckCircle2,
  Copy,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  analyzeSingleSubmissionWithAi,
  batchAnalyzeSubmissionsWithAi,
  type BatchAiProgress,
  type BatchAiResult,
} from '../services/batchGradingService';
import {
  deleteParentMessage,
  saveParentMessage,
  updateParentMessageStatus,
} from '../services/firestoreService';
import type { Exam, ParentMessage, Submission } from '../types';
import { analyzeSubmissionEffort } from '../utils/effortAnalysis';
import { buildDefaultParentMessage } from '../utils/formatters';

interface ParentMessagesViewProps {
  teacherId: string;
  messages: ParentMessage[];
  submissions: Submission[];
  exams: Exam[];
}

interface ParentMessageCardProps {
  msg: ParentMessage;
  linkedSub: Submission | undefined;
  linkedExam: Exam | undefined;
  allExamSubs: Submission[];
  copied: boolean;
  onCopy: (content: string, id: string) => void;
}

function ParentMessageCard({
  msg,
  linkedSub,
  linkedExam,
  allExamSubs,
  copied,
  onCopy,
}: ParentMessageCardProps) {
  const [draftPhone, setDraftPhone] = useState(msg.parentPhone);
  const [draftContent, setDraftContent] = useState(msg.content);
  const [refreshingAi, setRefreshingAi] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  useEffect(() => {
    setDraftPhone(msg.parentPhone);
  }, [msg.parentPhone]);

  useEffect(() => {
    setDraftContent(msg.content);
  }, [msg.content]);

  const handleAiRefreshCard = async () => {
    if (!linkedSub || refreshingAi) return;
    setRefreshingAi(true);
    setCardError(null);
    try {
      const res = await analyzeSingleSubmissionWithAi({
        submission: linkedSub,
        exam: linkedExam,
        allExamSubmissions: allExamSubs,
        overwriteComment: true,
        persistToFirestore: true,
      });
      const effort = analyzeSubmissionEffort(linkedSub, linkedExam);
      const effortWarning =
        effort.level === 'perfunctory'
          ? effort.reasons[0]
          : linkedSub.violationCount > 0
            ? `Chuyển tab ${linkedSub.violationCount} lần khi làm bài.`
            : undefined;
      const nextContent = buildDefaultParentMessage(
        linkedSub.studentName,
        linkedExam?.title || linkedSub.examTitle,
        linkedSub.totalScore,
        linkedSub.maxScore,
        res.teacherComment,
        { effortWarning }
      );
      setDraftContent(nextContent);
      await updateParentMessageStatus(msg.id, { content: nextContent });
    } catch (err) {
      setCardError(err instanceof Error ? err.message : 'Không thể tạo nhận xét AI.');
    } finally {
      setRefreshingAi(false);
    }
  };

  return (
    <article className="bg-white border border-[#DAE5E0] rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-2xs">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-base text-[#0D221D] truncate">
              {msg.studentName}
            </h3>
            <div className="text-xs text-[#597169] flex flex-wrap items-center gap-1.5 mt-0.5">
              <span>{msg.className ? `Lớp ${msg.className}` : 'Học sinh'}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{msg.examTitle}</span>
            </div>
          </div>

          <span
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 border ${
              msg.status === 'sent'
                ? 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0F4C3F]'
                : 'bg-[#FDF8EB] border-[#EAD8A6] text-[#8A630D]'
            }`}
          >
            {msg.status === 'sent' ? 'Đã gửi' : 'Chờ gửi'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#597169] shrink-0">SĐT:</span>
          <input
            type="text"
            value={draftPhone}
            onChange={(e) => setDraftPhone(e.target.value)}
            onBlur={() => {
              if (draftPhone !== msg.parentPhone) {
                updateParentMessageStatus(msg.id, {
                  parentPhone: draftPhone,
                });
              }
            }}
            placeholder="chưa có SĐT"
            className="flex-1 px-2.5 py-1 rounded-lg border border-[#EBF1EE] bg-[#F8FAF9] font-mono text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
          />
        </div>

        <div className="space-y-1">
          <textarea
            rows={4}
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            onBlur={() => {
              if (draftContent !== msg.content && draftContent.trim()) {
                updateParentMessageStatus(msg.id, { content: draftContent });
              }
            }}
            className="w-full px-3 py-2 rounded-xl border border-[#EBF1EE] bg-[#F8FAF9] text-xs text-[#3A524A] leading-relaxed focus:outline-none focus:border-[#0F4C3F]"
          />
          <div className="flex items-center justify-between gap-2 text-[11px] text-[#698078]">
            <span>{draftContent.length} ký tự (ngắn gọn cho Zalo/SMS)</span>
            {linkedSub && (
              <button
                type="button"
                disabled={refreshingAi}
                onClick={handleAiRefreshCard}
                className="inline-flex items-center gap-1 font-semibold text-[#0F4C3F] hover:text-[#0A362C] disabled:opacity-60 cursor-pointer"
              >
                <Sparkles className="w-3 h-3 text-[#B0831A]" />
                <span>{refreshingAi ? 'AI đang viết...' : 'AI viết nhận xét gọn'}</span>
              </button>
            )}
          </div>
          {cardError && (
            <div className="text-[11px] text-[#B91C1C]">{cardError}</div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#EDF3F0]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCopy(draftContent, msg.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] hover:bg-[#F8FAF9] whitespace-nowrap cursor-pointer"
          >
            {copied ? (
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
            onClick={() =>
              updateParentMessageStatus(msg.id, {
                status: msg.status === 'sent' ? 'draft' : 'sent',
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EFF7F3] border border-[#DCECE4] text-[#0F4C3F] text-xs font-semibold hover:bg-[#DCECE4] whitespace-nowrap cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>
              {msg.status === 'sent' ? 'Chuyển chờ gửi' : 'Đánh dấu đã gửi'}
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => deleteParentMessage(msg.id)}
          title="Xoá tin nhắn"
          className="p-1.5 rounded-lg text-[#698078] hover:text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
}

export function ParentMessagesView({
  teacherId,
  messages,
  submissions,
  exams,
}: ParentMessagesViewProps) {
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'sent'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedBatchExamId, setSelectedBatchExamId] = useState<string>(
    exams[0]?.id || ''
  );
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [useAiForRemarks, setUseAiForRemarks] = useState(true);
  const [batchProgress, setBatchProgress] = useState<BatchAiProgress | null>(null);
  const [batchResult, setBatchResult] = useState<BatchAiResult | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const subById = new Map(submissions.map((s) => [s.id, s]));
  const examById = new Map(exams.map((e) => [e.id, e]));

  const filteredMessages = messages.filter((m) => {
    if (filterStatus !== 'all' && m.status !== filterStatus) return false;
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      m.studentName.toLowerCase().includes(q) ||
      m.parentPhone.toLowerCase().includes(q) ||
      m.examTitle.toLowerCase().includes(q)
    );
  });

  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleBatchGenerate = async (regenerateAllInExam = false) => {
    const examId = selectedBatchExamId || exams[0]?.id;
    if (!examId || batchGenerating) return;
    const exam = examById.get(examId);
    const examSubs = submissions.filter((s) => s.examId === examId);
    const existingSubIds = new Set(messages.map((m) => m.submissionId));
    const targets = regenerateAllInExam
      ? examSubs
      : examSubs.filter((s) => !existingSubIds.has(s.id));

    if (targets.length === 0) return;

    abortRef.current = false;
    setBatchGenerating(true);
    setBatchResult(null);
    setBatchError(null);

    try {
      if (useAiForRemarks) {
        const subsNeedingAi = regenerateAllInExam
          ? targets
          : targets.filter((s) => !s.teacherComment?.trim());

        const subsWithComment = targets.filter(
          (s) => !subsNeedingAi.some((n) => n.id === s.id)
        );

        for (const sub of subsWithComment) {
          const effort = analyzeSubmissionEffort(sub, exam);
          const effortWarning =
            effort.level === 'perfunctory'
              ? effort.reasons[0]
              : sub.violationCount > 0
                ? `Chuyển tab ${sub.violationCount} lần khi làm bài.`
                : undefined;
          const content = buildDefaultParentMessage(
            sub.studentName,
            exam?.title || sub.examTitle,
            sub.totalScore,
            sub.maxScore,
            sub.teacherComment,
            { effortWarning }
          );
          const existing = messages.find((m) => m.submissionId === sub.id);
          if (existing) {
            await updateParentMessageStatus(existing.id, { content });
          } else {
            await saveParentMessage({
              teacherId,
              submissionId: sub.id,
              studentName: sub.studentName,
              className: sub.className,
              examTitle: sub.examTitle,
              parentPhone: sub.parentPhone,
              content,
              status: 'draft',
            });
          }
        }

        if (subsNeedingAi.length > 0) {
          const res = await batchAnalyzeSubmissionsWithAi({
            teacherId,
            exam,
            targetSubmissions: subsNeedingAi,
            allExamSubmissions: examSubs,
            overwriteComment: true,
            syncParentMessages: true,
            existingMessages: messages,
            shouldAbort: () => abortRef.current,
            onProgress: (p) => setBatchProgress(p),
          });
          setBatchResult({
            ...res,
            succeededCount: res.succeededCount + subsWithComment.length,
          });
        } else {
          setBatchResult({
            succeededCount: subsWithComment.length,
            failedItems: [],
            aborted: false,
          });
        }
      } else {
        for (const sub of targets) {
          const effort = analyzeSubmissionEffort(sub, exam);
          const effortWarning =
            effort.level === 'perfunctory'
              ? effort.reasons[0]
              : sub.violationCount > 0
                ? `Chuyển tab ${sub.violationCount} lần khi làm bài.`
                : undefined;
          const content = buildDefaultParentMessage(
            sub.studentName,
            sub.examTitle,
            sub.totalScore,
            sub.maxScore,
            sub.teacherComment,
            { effortWarning }
          );
          const existing = messages.find((m) => m.submissionId === sub.id);
          if (existing) {
            await updateParentMessageStatus(existing.id, { content });
          } else {
            await saveParentMessage({
              teacherId,
              submissionId: sub.id,
              studentName: sub.studentName,
              className: sub.className,
              examTitle: sub.examTitle,
              parentPhone: sub.parentPhone,
              content,
              status: 'draft',
            });
          }
        }
        setBatchResult({
          succeededCount: targets.length,
          failedItems: [],
          aborted: false,
        });
      }
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Lỗi khi tạo tin nhắn.');
    } finally {
      setBatchGenerating(false);
      setBatchProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-[0.08em] text-[#8A630D] uppercase">
            Liên lạc gia đình
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#0D221D] mt-1">
            Tin nhắn phụ huynh
          </h1>
          <p className="text-sm text-[#4A615A] mt-1">
            Mỗi tin nhắn gồm điểm và lời nhận xét ngắn gọn, đủ ý để sao chép gửi Zalo/SMS ngay.
          </p>
        </div>

        {exams.length > 0 && (
          <div className="flex flex-col sm:items-end gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedBatchExamId || exams[0]?.id || ''}
                onChange={(e) => setSelectedBatchExamId(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] max-w-56 truncate focus:outline-none focus:border-[#0F4C3F]"
              >
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={batchGenerating}
                onClick={() => handleBatchGenerate(false)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5 text-[#E5C665]" />
                <span>
                  {batchGenerating ? 'Đang xử lý...' : 'Tạo tin từ bài nộp'}
                </span>
              </button>

              <button
                type="button"
                disabled={batchGenerating}
                onClick={() => handleBatchGenerate(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-[#8A630D] text-xs font-semibold hover:bg-[#FAF1D6] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#B0831A]" />
                <span>Cập nhật lại tin cả đề</span>
              </button>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-[#4A615A] cursor-pointer">
              <input
                type="checkbox"
                checked={useAiForRemarks}
                onChange={(e) => setUseAiForRemarks(e.target.checked)}
                className="rounded border-[#CEDCD6] accent-[#0F4C3F]"
              />
              <span>Tự động dùng AI viết nhận xét ngắn gọn (1–2 câu) nếu thiếu</span>
            </label>
          </div>
        )}
      </div>

      {/* Live Batch Progress */}
      {batchGenerating && batchProgress && (
        <div className="p-4 rounded-2xl border border-[#EAD8A6] bg-[#FDF8EB] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#7A580B]">
              AI đang viết nhận xét ngắn &amp; cập nhật tin nhắn: {batchProgress.completed}/
              {batchProgress.total} ({batchProgress.currentStudentName})
            </span>
            <button
              type="button"
              onClick={() => {
                abortRef.current = true;
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#EAD8A6] bg-white text-[#8A630D] font-semibold cursor-pointer"
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

      {batchResult && !batchGenerating && (
        <div className="p-3.5 rounded-2xl border border-[#C5DDD3] bg-[#EFF7F3] text-xs text-[#0A362C] flex items-center justify-between gap-2">
          <div>
            <strong>
              {batchResult.aborted
                ? `Đã dừng — cập nhật ${batchResult.succeededCount} tin nhắn.`
                : `Đã tạo/cập nhật ${batchResult.succeededCount} tin nhắn ngắn gọn.`}
            </strong>
            {batchResult.failedItems.length > 0 && (
              <span className="text-[#991B1B] ml-2">
                Lỗi {batchResult.failedItems.length} bài:{' '}
                {batchResult.failedItems.map((f) => f.studentName).join(', ')}.
              </span>
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

      {batchError && (
        <div className="p-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] text-xs text-[#B91C1C]">
          {batchError}
        </div>
      )}

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-[#E6EEEA] rounded-xl self-start">
          {[
            { id: 'all' as const, label: `Tất cả (${messages.length})` },
            {
              id: 'draft' as const,
              label: `Chờ gửi (${messages.filter((m) => m.status === 'draft').length})`,
            },
            {
              id: 'sent' as const,
              label: `Đã gửi (${messages.filter((m) => m.status === 'sent').length})`,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                filterStatus === tab.id
                  ? 'bg-white text-[#0F4C3F] font-semibold shadow-sm'
                  : 'text-[#4A615A] hover:text-[#0D221D]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-[#698078] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm học sinh, SĐT, đề..."
            className="pl-9 pr-3.5 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F] w-full sm:w-64"
          />
        </div>
      </div>

      {/* Message Cards */}
      {filteredMessages.length === 0 ? (
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-12 text-center space-y-3">
          <MessageSquare className="w-8 h-8 text-[#698078] mx-auto" />
          <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
            Chưa có tin nhắn nào
          </h2>
          <p className="text-sm text-[#4A615A] max-w-md mx-auto">
            Nhấn &ldquo;Tạo tin từ bài nộp&rdquo; ở góc trên hoặc lưu tin nhắn trực tiếp từ trang chấm bài học sinh.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredMessages.map((msg) => {
            const linkedSub = subById.get(msg.submissionId);
            const linkedExam = linkedSub ? examById.get(linkedSub.examId) : undefined;
            const allExamSubs = linkedSub
              ? submissions.filter((s) => s.examId === linkedSub.examId)
              : [];
            return (
              <ParentMessageCard
                key={msg.id}
                msg={msg}
                linkedSub={linkedSub}
                linkedExam={linkedExam}
                allExamSubs={allExamSubs}
                copied={copiedId === msg.id}
                onCopy={handleCopy}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
