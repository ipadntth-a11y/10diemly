import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { MathText } from './MathText';

export interface PracticeStatement {
  text: string;
  isTrue: boolean;
}

export interface PracticeQuestion {
  id: string;
  index: number;
  sourceQuestionIndex: number;
  focusTopic: string;
  type: 'mcq' | 'true_false' | 'short_answer';
  prompt: string;
  options?: string[];
  correctOption?: number;
  statements?: PracticeStatement[];
  correctAnswer?: string;
  explanation: string;
}

export interface RemedialPracticeData {
  focusSummary: string;
  practiceQuestions: PracticeQuestion[];
}

interface RemedialPracticePanelProps {
  practiceData: RemedialPracticeData | null;
  loading: boolean;
  error: string | null;
  wrongCount: number;
  onRegenerate: () => void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const TF_LETTERS = ['a', 'b', 'c', 'd'];

function normalizeNumeric(val: string): string {
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

export function RemedialPracticePanel({
  practiceData,
  loading,
  error,
  wrongCount,
  onRegenerate,
}: RemedialPracticePanelProps) {
  const [mcqPicks, setMcqPicks] = useState<Record<string, number>>({});
  const [tfPicks, setTfPicks] = useState<Record<string, (boolean | null)[]>>({});
  const [shortInputs, setShortInputs] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);

  // Reset user answers whenever a fresh practice set arrives
  useEffect(() => {
    setMcqPicks({});
    setTfPicks({});
    setShortInputs({});
    setChecked(false);
  }, [practiceData]);

  const handleResetAttempt = () => {
    setMcqPicks({});
    setTfPicks({});
    setShortInputs({});
    setChecked(false);
  };

  if (wrongCount === 0) {
    return (
      <div className="bg-white border border-[#E7E5DF] rounded-2xl p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-[#E5ECE7] text-[#1E4D43] flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h3 className="font-serif text-xl font-semibold text-[#16231F]">
          Bạn không có câu sai nào ở phần tự chấm!
        </h3>
        <p className="text-sm text-[#5C6561] max-w-md mx-auto">
          Toàn bộ các câu trắc nghiệm, đúng/sai và trả lời ngắn bạn đều đã đạt điểm tối đa.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white border border-[#E7E5DF] rounded-2xl p-8 sm:p-10 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#EEF5F1] text-[#1E4D43] flex items-center justify-center mx-auto">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
        <div className="space-y-1">
          <h3 className="font-serif text-xl font-semibold text-[#16231F]">
            AI đang phân tích {wrongCount} câu sai và soạn câu hỏi ôn tập...
          </h3>
          <p className="text-sm text-[#5C6561] max-w-lg mx-auto">
            Hệ thống đang tạo các câu hỏi tương tự sát với phần kiến thức bạn vừa nhầm lẫn để bạn luyện tập ngay.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-[#FECACA] rounded-2xl p-6 space-y-3">
        <div className="flex items-start gap-3 text-[#991B1B]">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="text-sm font-semibold">Không thể tạo bộ câu hỏi ôn tập AI</div>
            <p className="text-xs text-[#7F1D1D]">{error}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E4D43] text-white text-xs font-semibold hover:bg-[#163B33] cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Thử tạo lại</span>
        </button>
      </div>
    );
  }

  if (!practiceData || practiceData.practiceQuestions.length === 0) {
    return (
      <div className="bg-white border border-[#E7E5DF] rounded-2xl p-8 text-center space-y-4">
        <p className="text-sm text-[#5C6561]">
          Chưa có bộ câu hỏi ôn tập. Nhấn nút bên dưới để AI soạn câu hỏi dựa trên các câu bạn đã sai.
        </p>
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1E4D43] text-white text-sm font-semibold hover:bg-[#163B33] cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          <span>Tạo câu hỏi ôn tập bằng AI</span>
        </button>
      </div>
    );
  }

  const questions = practiceData.practiceQuestions;

  const isQuestionCorrect = (pq: PracticeQuestion): boolean => {
    if (pq.type === 'mcq') {
      return mcqPicks[pq.id] !== undefined && mcqPicks[pq.id] === pq.correctOption;
    }
    if (pq.type === 'true_false') {
      const picks = tfPicks[pq.id] || [null, null, null, null];
      const sts = pq.statements || [];
      return sts.length > 0 && sts.every((st, i) => picks[i] === st.isTrue);
    }
    const ans = normalizeNumeric(shortInputs[pq.id] || '');
    const key = normalizeNumeric(pq.correctAnswer || '');
    return key.length > 0 && ans.length > 0 && ans === key;
  };

  const correctTotal = checked ? questions.filter(isQuestionCorrect).length : 0;

  return (
    <div className="space-y-5">
      {/* AI Summary Header */}
      <div className="bg-[#EEF5F1] border border-[#CFE0D7] rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#1E4D43]">
            <Sparkles className="w-4 h-4" />
            <span>Bài ôn tập cá nhân hoá từ AI</span>
          </div>
          <MathText
            text={practiceData.focusSummary}
            className="text-sm text-[#16231F] leading-relaxed"
          />
        </div>
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#BFD5C9] bg-white text-xs font-semibold text-[#1E4D43] hover:bg-[#F5F9F7] shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Tạo bộ câu mới</span>
        </button>
      </div>

      {/* Checked Score & Analysis Banner */}
      {checked && (() => {
        const masteredTopics = Array.from(
          new Set(questions.filter(isQuestionCorrect).map((q) => q.focusTopic))
        );
        const remainingTopics = Array.from(
          new Set(questions.filter((q) => !isQuestionCorrect(q)).map((q) => q.focusTopic))
        );
        return (
          <div
            className={`rounded-2xl border p-5 space-y-3 ${
              correctTotal === questions.length
                ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                : 'bg-white border-[#E7E5DF] text-[#16231F]'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {correctTotal === questions.length ? (
                  <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0" />
                ) : (
                  <Sparkles className="w-5 h-5 text-[#1E4D43] shrink-0" />
                )}
                <div>
                  <div className="text-sm font-semibold tabular-nums">
                    Kết quả ôn tập: {correctTotal} / {questions.length} câu đúng hoàn toàn
                  </div>
                  <div className="text-xs text-[#5C6561]">
                    {correctTotal === questions.length
                      ? 'Tuyệt vời! Bạn đã khắc phục được các dạng kiến thức từng làm sai.'
                      : 'Xem phân tích lời giải từng câu bên dưới, sau đó bấm Làm lại hoặc Tạo bộ câu mới để luyện thêm.'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleResetAttempt}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#DCD9D0] bg-white text-xs font-semibold text-[#16231F] hover:bg-[#FAF9F6] shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Làm lại bộ này</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs pt-1 border-t border-[#E7E5DF]/70">
              <div className="p-2.5 rounded-xl bg-[#F4FAF6] border border-[#D4ECDC] text-[#1F3A2B]">
                <span className="font-semibold text-[#1E7E48]">Đã nắm vững: </span>
                <span>
                  {masteredTopics.length > 0 ? masteredTopics.join(', ') : 'Chưa có chuyên đề đạt 100%'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E]">
                <span className="font-semibold">Cần luyện thêm: </span>
                <span>
                  {remainingTopics.length > 0
                    ? remainingTopics.join(', ')
                    : 'Không còn chuyên đề nào sai — làm rất tốt!'}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Interactive Questions */}
      <div className="space-y-4">
        {questions.map((pq, idx) => {
          const right = checked ? isQuestionCorrect(pq) : false;
          const typeLabel =
            pq.type === 'mcq'
              ? 'Trắc nghiệm'
              : pq.type === 'true_false'
                ? 'Đúng / Sai'
                : 'Trả lời ngắn';

          return (
            <div
              key={pq.id}
              className={`bg-white border rounded-2xl p-5 space-y-4 ${
                checked
                  ? right
                    ? 'border-[#86EFAC]'
                    : 'border-[#FCA5A5]'
                  : 'border-[#E7E5DF]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-[#5C6561]">
                  <span className="font-semibold text-[#1E4D43]">
                    Câu ôn {idx + 1} · {typeLabel}
                  </span>
                  <span>· Luyện lại từ Câu {pq.sourceQuestionIndex}</span>
                  <span className="px-2 py-0.5 rounded-md bg-[#F5F4F0] text-[#434D49] font-medium">
                    {pq.focusTopic}
                  </span>
                </div>
                {checked && (
                  <span
                    className={`inline-flex items-center gap-1 font-semibold ${
                      right ? 'text-[#15803D]' : 'text-[#B91C1C]'
                    }`}
                  >
                    {right ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Đúng</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Chưa đúng</span>
                      </>
                    )}
                  </span>
                )}
              </div>

              <MathText
                text={pq.prompt}
                className="text-sm text-[#16231F] whitespace-pre-line leading-relaxed font-medium"
              />

              {/* MCQ */}
              {pq.type === 'mcq' && pq.options && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {pq.options.map((opt, optIdx) => {
                    const picked = mcqPicks[pq.id] === optIdx;
                    const isKey = pq.correctOption === optIdx;
                    let cls =
                      'border-[#DCD9D0] bg-white text-[#16231F] hover:border-[#1E4D43]';
                    if (checked) {
                      if (isKey) {
                        cls = 'border-[#16A34A] bg-[#F0FDF4] text-[#14532D] font-medium';
                      } else if (picked && !isKey) {
                        cls = 'border-[#DC2626] bg-[#FEF2F2] text-[#7F1D1D]';
                      } else {
                        cls = 'border-[#E7E5DF] bg-[#FAF9F6] text-[#66706C]';
                      }
                    } else if (picked) {
                      cls = 'border-[#1E4D43] bg-[#EEF5F1] text-[#16231F] font-medium';
                    }

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        disabled={checked}
                        onClick={() =>
                          setMcqPicks((prev) => ({ ...prev, [pq.id]: optIdx }))
                        }
                        className={`text-left p-3 rounded-xl border text-sm transition-colors flex items-start gap-2.5 ${
                          checked ? 'cursor-default' : 'cursor-pointer'
                        } ${cls}`}
                      >
                        <span className="font-mono font-bold shrink-0">
                          {OPTION_LETTERS[optIdx]}.
                        </span>
                        <MathText text={opt} className="leading-relaxed" inline />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* True / False */}
              {pq.type === 'true_false' && pq.statements && (
                <div className="space-y-2">
                  {pq.statements.map((st, sIdx) => {
                    const picks = tfPicks[pq.id] || [null, null, null, null];
                    const picked = picks[sIdx];
                    const stRight = checked && picked === st.isTrue;
                    return (
                      <div
                        key={sIdx}
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          checked
                            ? stRight
                              ? 'border-[#BBF7D0] bg-[#F0FDF4]'
                              : 'border-[#FECACA] bg-[#FEF2F2]'
                            : 'border-[#E7E5DF] bg-[#FAF9F6]'
                        }`}
                      >
                        <div className="flex items-start gap-2 text-sm text-[#16231F]">
                          <span className="font-mono font-bold shrink-0">
                            {TF_LETTERS[sIdx]})
                          </span>
                          <MathText text={st.text} className="leading-relaxed" inline />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {[true, false].map((val) => {
                            const active = picked === val;
                            return (
                              <button
                                key={String(val)}
                                type="button"
                                disabled={checked}
                                onClick={() =>
                                  setTfPicks((prev) => {
                                    const cur = [...(prev[pq.id] || [null, null, null, null])];
                                    cur[sIdx] = val;
                                    return { ...prev, [pq.id]: cur };
                                  })
                                }
                                className={`px-3 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                                  checked ? 'cursor-default' : 'cursor-pointer'
                                } ${
                                  active
                                    ? 'bg-[#1E4D43] text-white border-[#1E4D43]'
                                    : 'bg-white text-[#434D49] border-[#DCD9D0] hover:border-[#1E4D43]'
                                }`}
                              >
                                {val ? 'Đúng' : 'Sai'}
                              </button>
                            );
                          })}
                          {checked && (
                            <span className="text-[11px] font-semibold text-[#1E4D43] ml-1">
                              Đáp án: {st.isTrue ? 'Đúng' : 'Sai'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Short Answer */}
              {pq.type === 'short_answer' && (
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    disabled={checked}
                    value={shortInputs[pq.id] || ''}
                    onChange={(e) =>
                      setShortInputs((prev) => ({
                        ...prev,
                        [pq.id]: e.target.value,
                      }))
                    }
                    placeholder="Nhập đáp số của bạn (tối đa 4 ký tự)..."
                    maxLength={8}
                    className="px-3.5 py-2 rounded-xl border border-[#DCD9D0] bg-white font-mono text-sm font-semibold text-[#16231F] w-64 focus:outline-none focus:border-[#1E4D43]"
                  />
                  {checked && pq.correctAnswer && (
                    <span className="text-xs text-[#1E4D43] font-semibold">
                      Đáp số đúng:{' '}
                      <span className="font-mono px-2 py-0.5 rounded bg-[#E5ECE7]">
                        {pq.correctAnswer}
                      </span>
                    </span>
                  )}
                </div>
              )}

              {/* Explanation shown after checking */}
              {checked && pq.explanation && (
                <div className="p-3.5 rounded-xl bg-[#F4FAF6] border border-[#D4ECDC] text-xs text-[#1F3A2B] space-y-1.5">
                  <div className="uppercase tracking-wider font-bold text-[#1E7E48]">
                    Lời giải câu ôn tập:
                  </div>
                  <MathText
                    text={pq.explanation}
                    className="whitespace-pre-line leading-relaxed"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Check / Retry Bar */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        {!checked ? (
          <button
            type="button"
            onClick={() => setChecked(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1E4D43] text-white text-sm font-semibold hover:bg-[#163B33] cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Kiểm tra kết quả ôn tập</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleResetAttempt}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#DCD9D0] bg-white text-sm font-medium text-[#16231F] hover:bg-[#FAF9F6] cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Làm lại bộ này</span>
            </button>
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1E4D43] text-white text-sm font-semibold hover:bg-[#163B33] cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tạo bộ câu hỏi ôn tập mới</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
