import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Sparkles,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { EssayCriterionResult, Exam } from '../types';
import { compressExamPhoto } from '../utils/imageUtils';
import { MathText } from './MathText';

interface PhotoEssayGraderModalProps {
  exams: Exam[];
  onClose: () => void;
}

interface PhotoGradeResult {
  recognizedText: string;
  score: number;
  breakdown: EssayCriterionResult[];
  strengths: string;
  mistakes: string;
  teacherComment: string;
}

export function PhotoEssayGraderModal({
  exams,
  onClose,
}: PhotoEssayGraderModalProps) {
  const shortQuestions = exams.flatMap((ex) =>
    ex.questions
      .filter((q) => q.type === 'essay' || q.type === 'short_answer')
      .map((q) => ({ examTitle: ex.title, question: q }))
  );

  const [selectedQuestionKey, setSelectedQuestionKey] = useState<string>('custom');
  const [promptText, setPromptText] = useState('');
  const [rubricText, setRubricText] = useState('');
  const [maxScore, setMaxScore] = useState(2);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [aiBase64, setAiBase64] = useState<string | null>(null);
  const [aiMimeType, setAiMimeType] = useState<string>('image/jpeg');

  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PhotoGradeResult | null>(null);
  const [copiedComment, setCopiedComment] = useState(false);

  const handleSelectQuestion = (key: string) => {
    setSelectedQuestionKey(key);
    if (key === 'custom') return;
    const idx = Number(key);
    const match = shortQuestions[idx];
    if (match) {
      setPromptText(match.question.prompt);
      setRubricText(
        `${match.question.correctAnswer ? `Đáp án: ${match.question.correctAnswer}\n` : ''}${match.question.explanation || ''}`
      );
      setMaxScore(match.question.maxScore);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const compressed = await compressExamPhoto(file);
      setPreviewUrl(compressed.storageDataUrl);
      setAiBase64(compressed.aiBase64);
      setAiMimeType(compressed.aiMimeType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xử lý ảnh.');
    }
  };

  const handleGradePhoto = async () => {
    if (!aiBase64) {
      setError('Vui lòng chọn hoặc chụp ảnh bài làm tự luận trước.');
      return;
    }
    setGrading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/grade-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: aiBase64,
          imageMimeType: aiMimeType,
          promptText,
          rubricText,
          maxScore,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể chấm ảnh bài làm.');
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi kết nối AI.');
    } finally {
      setGrading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#082B23]/45 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-[#DAE5E0] max-w-4xl w-full p-6 space-y-5 my-6 max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#EBF1EE] pb-4">
          <div>
            <div className="text-xs font-semibold tracking-[0.08em] text-[#8A630D] uppercase">
              Gemini Vision · OCR &amp; Barem điểm
            </div>
            <h2 className="font-serif text-2xl font-semibold text-[#0D221D] mt-0.5">
              Chấm bài tự luận từ ảnh chụp
            </h2>
            <p className="text-xs text-[#4A615A] mt-1">
              Tải ảnh bài làm viết tay của học sinh để AI nhận diện chữ viết, chấm từng bước giải và gợi ý lời phê.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#597169] hover:bg-[#EFF7F3] cursor-pointer"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Photo upload + prompt/rubric */}
          <div className="lg:col-span-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                Ảnh chụp bài làm viết tay *
              </label>
              <label className="block border-2 border-dashed border-[#CEDCD6] hover:border-[#0F4C3F] rounded-2xl p-4 text-center bg-[#F8FAF9] transition-colors cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {previewUrl ? (
                  <div className="space-y-2">
                    <img
                      src={previewUrl}
                      alt="Ảnh bài làm học sinh"
                      className="max-h-60 mx-auto rounded-xl object-contain border border-[#DAE5E0]"
                    />
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F4C3F]">
                      <Camera className="w-3.5 h-3.5" />
                      <span>Nhấn để đổi ảnh khác</span>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 space-y-2">
                    <Upload className="w-7 h-7 text-[#0F4C3F] mx-auto" />
                    <div className="text-sm font-semibold text-[#0D221D]">
                      Chọn ảnh hoặc chụp trực tiếp bài giấy
                    </div>
                    <div className="text-xs text-[#597169]">
                      Hỗ trợ chữ viết tay, công thức Toán / Vật lí / Hoá học
                    </div>
                  </div>
                )}
              </label>
            </div>

            {shortQuestions.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Lấy đề &amp; barem từ câu trong ngân hàng đề (tuỳ chọn)
                </label>
                <select
                  value={selectedQuestionKey}
                  onChange={(e) => handleSelectQuestion(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                >
                  <option value="custom">Tự nhập đề bài &amp; thang điểm riêng</option>
                  {shortQuestions.map((item, idx) => (
                    <option key={`${item.question.id}_${idx}`} value={String(idx)}>
                      {item.examTitle} — Câu {item.question.index} ({item.question.maxScore}đ)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Đề bài (tuỳ chọn)
                </label>
                <input
                  type="text"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Ví dụ: Tính nhiệt lượng làm nóng chảy 2kg nước đá..."
                  className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Thang điểm
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="100"
                  value={maxScore}
                  onChange={(e) => setMaxScore(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] text-xs text-[#0D221D] tabular-nums focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="text-xs font-medium text-[#3A524A]">
                  Đáp án chuẩn / Barem điểm (tuỳ chọn)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const m = Number(maxScore || 2);
                    const s1 = Number((m * 0.25).toFixed(2));
                    const s2 = Number((m * 0.25).toFixed(2));
                    const s3 = Number((m * 0.25).toFixed(2));
                    const s4 = Number((m - s1 - s2 - s3).toFixed(2));
                    const tpl = `- Công thức áp dụng: ${s1}đ\n- Thay số & đổi đơn vị chuẩn: ${s2}đ\n- Đáp số chính xác: ${s3}đ\n- Đơn vị đầy đủ & kết luận: ${s4}đ`;
                    setRubricText((prev) => (prev.trim() ? `${prev.trim()}\n${tpl}` : tpl));
                  }}
                  className="px-2 py-0.5 rounded-lg border border-[#EAD8A6] bg-[#FDF8EB] text-[11px] font-semibold text-[#8A630D] hover:bg-[#FAF1D6] cursor-pointer"
                >
                  + Mẫu Barem 4 bước
                </button>
              </div>
              <textarea
                rows={3}
                value={rubricText}
                onChange={(e) => setRubricText(e.target.value)}
                placeholder="Ví dụ: Công thức Q = λ.m (+0.5đ); Đổi đơn vị & thay số (+0.5đ); Đáp số 668 (+0.5đ); Ghi đủ đơn vị kJ (+0.5đ)..."
                className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={grading || !aiBase64}
              onClick={handleGradePhoto}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] disabled:opacity-50 transition-colors cursor-pointer shadow-xs"
            >
              <Sparkles className="w-4 h-4 text-[#E5C665]" />
              <span>{grading ? 'AI đang đọc & chấm bài...' : 'Chấm bài chụp bằng AI'}</span>
            </button>
          </div>

          {/* Right: Structured AI Grading Output */}
          <div className="lg:col-span-6 bg-[#F8FAF9] border border-[#DAE5E0] rounded-2xl p-5 flex flex-col justify-between">
            {!result ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 space-y-2.5">
                <ImageIcon className="w-8 h-8 text-[#698078]" />
                <div className="text-sm font-semibold text-[#0D221D]">
                  Kết quả chấm chi tiết sẽ hiển thị tại đây
                </div>
                <p className="text-xs text-[#597169] max-w-xs">
                  AI sẽ chép lại bài làm viết tay, chấm điểm theo từng bước giải, chỉ ra lỗi sai đơn vị/công thức và gợi ý lời phê.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between gap-3 border-b border-[#DAE5E0] pb-3">
                  <div>
                    <div className="text-xs font-semibold text-[#8A630D] uppercase">
                      Điểm AI đề xuất
                    </div>
                    <div className="font-serif text-3xl font-semibold text-[#0F4C3F] tabular-nums">
                      {result.score}
                      <span className="text-base text-[#597169] font-normal ml-1">
                        /{maxScore}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(result.teacherComment);
                      setCopiedComment(true);
                      setTimeout(() => setCopiedComment(false), 1800);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] hover:bg-[#EFF7F3] cursor-pointer"
                  >
                    {copiedComment ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#0F6D4F]" />
                        <span>Đã chép lời phê</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Chép lời phê</span>
                      </>
                    )}
                  </button>
                </div>

                {/* OCR Recognized text */}
                <div className="bg-white border border-[#DAE5E0] rounded-xl p-3.5 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                    Nội dung đọc được từ ảnh
                  </div>
                  <MathText
                    text={result.recognizedText}
                    className="text-xs text-[#0D221D] whitespace-pre-line leading-relaxed"
                  />
                </div>

                {/* Rubric Breakdown */}
                {result.breakdown && result.breakdown.length > 0 && (
                  <div className="bg-white border border-[#DAE5E0] rounded-xl p-3.5 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                      Chấm theo từng ý
                    </div>
                    <div className="space-y-1.5">
                      {result.breakdown.map((b, i) => (
                        <div
                          key={i}
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
                          <span className="font-mono font-semibold text-[#0D221D] tabular-nums shrink-0">
                            {b.score}/{b.maxScore}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Strengths & Mistakes */}
                <div className="grid grid-cols-1 gap-2.5 text-xs">
                  {result.strengths && (
                    <div className="p-3 rounded-xl bg-[#F0FBF6] border border-[#C5DDD3] text-[#0D221D]">
                      <strong className="text-[#0F6D4F]">Điểm đạt:</strong>{' '}
                      <MathText text={result.strengths} inline />
                    </div>
                  )}
                  {result.mistakes && (
                    <div className="p-3 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-[#7A580B]">
                      <strong>Cần chỉnh sửa:</strong>{' '}
                      <MathText text={result.mistakes} inline />
                    </div>
                  )}
                </div>

                <div className="bg-white border border-[#DAE5E0] rounded-xl p-3.5 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0F4C3F]">
                    Lời phê gợi ý
                  </div>
                  <MathText
                    text={result.teacherComment}
                    className="text-xs text-[#0D221D] leading-relaxed"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
