import {
  Check,
  CheckCircle2,
  Copy,
  MessageSquare,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import {
  deleteParentMessage,
  saveParentMessage,
  updateParentMessageStatus,
} from '../services/firestoreService';
import type { Exam, ParentMessage, Submission } from '../types';
import { buildDefaultParentMessage } from '../utils/formatters';

interface ParentMessagesViewProps {
  teacherId: string;
  messages: ParentMessage[];
  submissions: Submission[];
  exams: Exam[];
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

  const handleCopy = (msg: ParentMessage) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleBatchGenerate = async () => {
    const examId = selectedBatchExamId || exams[0]?.id;
    if (!examId) return;
    const examSubs = submissions.filter((s) => s.examId === examId);
    const existingSubIds = new Set(messages.map((m) => m.submissionId));
    const missing = examSubs.filter((s) => !existingSubIds.has(s.id));
    if (missing.length === 0) return;

    setBatchGenerating(true);
    try {
      for (const sub of missing) {
        await saveParentMessage({
          teacherId,
          submissionId: sub.id,
          studentName: sub.studentName,
          className: sub.className,
          examTitle: sub.examTitle,
          parentPhone: sub.parentPhone,
          content: buildDefaultParentMessage(
            sub.studentName,
            sub.examTitle,
            sub.totalScore,
            sub.maxScore,
            sub.teacherComment
          ),
          status: 'draft',
        });
      }
    } finally {
      setBatchGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium tracking-[0.08em] text-[#66706C] uppercase">
            Liên lạc gia đình
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#16231F] mt-1">
            Tin nhắn phụ huynh
          </h1>
          <p className="text-sm text-[#5C6561] mt-1">
            Soạn nhanh báo cáo kết quả học tập, sao chép gửi Zalo/SMS và theo dõi trạng thái.
          </p>
        </div>

        {exams.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedBatchExamId || exams[0]?.id || ''}
              onChange={(e) => setSelectedBatchExamId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[#DCD9D0] bg-white text-xs font-medium text-[#16231F] max-w-56 truncate"
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
              onClick={handleBatchGenerate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E4D43] text-white text-xs font-medium hover:bg-[#163B33] disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {batchGenerating ? 'Đang tạo...' : 'Tạo tin từ bài nộp'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-[#F0EEE8] rounded-xl self-start">
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
                  ? 'bg-white text-[#1E4D43] shadow-sm'
                  : 'text-[#5C6561] hover:text-[#16231F]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-[#7C8581] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm học sinh, SĐT, đề..."
            className="pl-9 pr-3.5 py-2 rounded-xl border border-[#DCD9D0] bg-white text-sm focus:outline-none focus:border-[#1E4D43] w-full sm:w-64"
          />
        </div>
      </div>

      {/* Message Cards */}
      {filteredMessages.length === 0 ? (
        <div className="bg-white border border-[#E7E5DF] rounded-2xl p-12 text-center space-y-3">
          <MessageSquare className="w-8 h-8 text-[#7C8581] mx-auto" />
          <h2 className="font-serif text-xl font-semibold text-[#16231F]">
            Chưa có tin nhắn nào
          </h2>
          <p className="text-sm text-[#5C6561] max-w-md mx-auto">
            Nhấn &ldquo;Tạo tin từ bài nộp&rdquo; ở góc trên hoặc lưu tin nhắn trực tiếp từ trang chấm bài học sinh.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredMessages.map((msg) => (
            <article
              key={msg.id}
              className="bg-white border border-[#E7E5DF] rounded-2xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-base text-[#16231F] truncate">
                      {msg.studentName}
                    </h3>
                    <div className="text-xs text-[#66706C] flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span>{msg.className ? `Lớp ${msg.className}` : 'Học sinh'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{msg.examTitle}</span>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${
                      msg.status === 'sent'
                        ? 'bg-[#E5ECE7] text-[#1E4D43]'
                        : 'bg-[#FEF3C7] text-[#92400E]'
                    }`}
                  >
                    {msg.status === 'sent' ? 'Đã gửi' : 'Chờ gửi'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[#66706C] shrink-0">SĐT:</span>
                  <input
                    type="text"
                    defaultValue={msg.parentPhone}
                    onBlur={(e) => {
                      if (e.target.value !== msg.parentPhone) {
                        updateParentMessageStatus(msg.id, {
                          parentPhone: e.target.value,
                        });
                      }
                    }}
                    placeholder="chưa có SĐT"
                    className="flex-1 px-2.5 py-1 rounded-lg border border-[#ECEAE4] bg-[#FAF9F6] font-mono text-xs text-[#16231F] focus:outline-none focus:border-[#1E4D43]"
                  />
                </div>

                <textarea
                  rows={4}
                  defaultValue={msg.content}
                  onBlur={(e) => {
                    if (e.target.value !== msg.content && e.target.value.trim()) {
                      updateParentMessageStatus(msg.id, { content: e.target.value });
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-[#ECEAE4] bg-[#FAF9F6] text-xs text-[#434D49] leading-relaxed focus:outline-none focus:border-[#1E4D43]"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#F0EEE8]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(msg)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCD9D0] bg-white text-xs font-medium text-[#16231F] hover:bg-[#FAF9F6] cursor-pointer"
                  >
                    {copiedId === msg.id ? (
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
                    onClick={() =>
                      updateParentMessageStatus(msg.id, {
                        status: msg.status === 'sent' ? 'draft' : 'sent',
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5ECE7] text-[#1E4D43] text-xs font-medium hover:bg-[#D5E3DA] cursor-pointer"
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
                  className="p-1.5 rounded-lg text-[#7C8581] hover:text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
