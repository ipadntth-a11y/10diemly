import {
  ArrowDown,
  ArrowUp,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  extractFriendlyFirestoreError,
  regradeExamSubmissions,
  updateExam,
} from '../services/firestoreService';
import type { Exam, ExamQuestion, QuestionType, Submission } from '../types';
import { compressExamPhoto } from '../utils/imageUtils';
import { containsLatexFormula, MathText } from './MathText';

type EditorFilter = 'all' | QuestionType;

interface ExamEditorModalProps {
  exam: Exam;
  examSubmissions?: Submission[];
  initialFilter?: EditorFilter;
  initialQuestionId?: string | null;
  onClose: () => void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const QUICK_LATEX_SNIPPETS: { label: string; tex: string }[] = [
  { label: 'Phân số', tex: '$\\frac{a}{b}$' },
  { label: 'Căn bậc 2', tex: '$\\sqrt{x}$' },
  { label: 'Số mũ', tex: '$x^{2}$' },
  { label: 'Tích phân', tex: '$\\int_{a}^{b} f(x)\\,dx$' },
  { label: 'Vectơ', tex: '$\\overrightarrow{AB}$' },
  { label: 'Hệ PT', tex: '$$\\begin{cases} x + y = 1 \\\\ x - y = 0 \\end{cases}$$' },
];

const SUBJECT_SUGGESTIONS = [
  'Vật lí',
  'Toán học',
  'Hóa học',
  'Sinh học',
  'Tiếng Anh',
  'Ngữ văn',
  'Khoa học tự nhiên',
  'Lịch sử',
  'Địa lí',
];

function createDefaultQuestion(type: QuestionType, nextIdx: number): ExamQuestion {
  const baseId = `q_${type}_${Date.now().toString(36)}_${nextIdx}`;
  if (type === 'mcq') {
    return {
      id: baseId,
      index: nextIdx,
      type: 'mcq',
      prompt: '',
      options: ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
      correctOption: 0,
      maxScore: 0.25,
      explanation: '',
    };
  }
  if (type === 'true_false') {
    return {
      id: baseId,
      index: nextIdx,
      type: 'true_false',
      prompt: '',
      statements: [
        { text: 'Phát biểu a', isTrue: true },
        { text: 'Phát biểu b', isTrue: false },
        { text: 'Phát biểu c', isTrue: true },
        { text: 'Phát biểu d', isTrue: false },
      ],
      maxScore: 1.0,
      explanation: '',
    };
  }
  if (type === 'short_answer') {
    return {
      id: baseId,
      index: nextIdx,
      type: 'short_answer',
      prompt: '',
      correctAnswer: '',
      maxScore: 0.5,
      explanation: '',
    };
  }
  return {
    id: baseId,
    index: nextIdx,
    type: 'essay',
    prompt: '',
    maxScore: 1.0,
    correctAnswer: '',
    explanation: '',
  };
}

export function ExamEditorModal({
  exam,
  examSubmissions = [],
  initialFilter = 'all',
  initialQuestionId = null,
  onClose,
}: ExamEditorModalProps) {
  const [title, setTitle] = useState(exam.title);
  const [subject, setSubject] = useState(exam.subject);
  const [durationMinutes, setDurationMinutes] = useState(exam.durationMinutes);
  const [questions, setQuestions] = useState<ExamQuestion[]>(() =>
    exam.questions.map((q) => ({
      ...q,
      imageUrls: q.imageUrls ? [...q.imageUrls] : undefined,
      explanationImageUrls: q.explanationImageUrls ? [...q.explanationImageUrls] : undefined,
      options: q.options ? [...q.options] : undefined,
      statements: q.statements ? q.statements.map((s) => ({ ...s })) : undefined,
    }))
  );
  const [filterMode, setFilterMode] = useState<EditorFilter>(initialFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [regradeExisting, setRegradeExisting] = useState(examSubmissions.length > 0);
  const [saving, setSaving] = useState(false);
  const [generatingExplanations, setGeneratingExplanations] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const questionCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!initialQuestionId) return;
    const timer = window.setTimeout(() => {
      const targetEl = questionCardRefs.current[initialQuestionId];
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [initialQuestionId]);

  const mcqCount = questions.filter((q) => q.type === 'mcq').length;
  const tfCount = questions.filter((q) => q.type === 'true_false').length;
  const shortCount = questions.filter((q) => q.type === 'short_answer').length;
  const essayCount = questions.filter((q) => q.type === 'essay').length;
  const totalExamPoints = Number(
    questions.reduce((sum, q) => sum + (Number(q.maxScore) || 0), 0).toFixed(2)
  );
  const missingExplanationCount = questions.filter((q) => !q.explanation.trim()).length;

  const normalizedQuery = searchTerm.trim().toLowerCase();
  const displayedIndices = questions
    .map((q, idx) => ({ q, idx }))
    .filter(({ q, idx }) => {
      if (filterMode !== 'all' && q.type !== filterMode) return false;
      if (!normalizedQuery) return true;
      const numMatch =
        `câu ${idx + 1}`.includes(normalizedQuery) ||
        String(idx + 1) === normalizedQuery;
      const promptMatch = q.prompt.toLowerCase().includes(normalizedQuery);
      const ansMatch = (q.correctAnswer || '').toLowerCase().includes(normalizedQuery);
      const optMatch = (q.options || []).some((o) =>
        o.toLowerCase().includes(normalizedQuery)
      );
      return numMatch || promptMatch || ansMatch || optMatch;
    });

  const handleGenerateExplanations = async () => {
    setGeneratingExplanations(true);
    setError(null);
    try {
      const overwriteAll = missingExplanationCount === 0;
      const res = await fetch('/api/ai/generate-explanations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          subject,
          overwriteAll,
          questions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể dùng AI viết lời giải từ đáp án.');
      }
      const expMap = new Map<string, string>();
      if (Array.isArray(data.explanations)) {
        for (const item of data.explanations) {
          if (item?.id && item?.explanation) {
            expMap.set(String(item.id), String(item.explanation));
          }
        }
      }
      setQuestions((prev) =>
        prev.map((q) => {
          const generated = expMap.get(q.id);
          return generated ? { ...q, explanation: generated } : q;
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi khi gọi AI tạo lời giải.');
    } finally {
      setGeneratingExplanations(false);
    }
  };

  const updateQuestionAt = (
    idx: number,
    updater: (prev: ExamQuestion) => ExamQuestion
  ) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? updater(q) : q)));
  };

  const handleAddQuestion = (type: QuestionType) => {
    const newQ = createDefaultQuestion(type, questions.length + 1);
    setQuestions((prev) => [...prev, newQ]);
    if (filterMode !== 'all' && filterMode !== type) {
      setFilterMode('all');
    }
    setSearchTerm('');
    window.setTimeout(() => {
      const el = questionCardRefs.current[newQ.id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (listContainerRef.current) {
        listContainerRef.current.scrollTop = listContainerRef.current.scrollHeight;
      }
    }, 60);
  };

  const handleMoveQuestion = (idx: number, direction: -1 | 1) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= questions.length) return;
    setQuestions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(targetIdx, 0, moved);
      return next.map((q, i) => ({ ...q, index: i + 1 }));
    });
  };

  const handleDeleteQuestion = (idx: number) => {
    if (questions.length <= 1) {
      setError('Đề kiểm tra phải giữ lại ít nhất 1 câu hỏi.');
      return;
    }
    setError(null);
    setQuestions((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((q, newIdx) => ({ ...q, index: newIdx + 1 }))
    );
  };

  const handleUploadImage = async (
    idx: number,
    targetField: 'imageUrls' | 'explanationImageUrls',
    file: File | undefined
  ) => {
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressExamPhoto(file);
      updateQuestionAt(idx, (prev) => ({
        ...prev,
        [targetField]: [...(prev[targetField] || []), compressed.storageDataUrl],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xử lý ảnh tải lên.');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const emptyIndices = questions
      .map((q, idx) => (!q.prompt.trim() ? idx + 1 : null))
      .filter((v): v is number => v !== null);

    if (emptyIndices.length > 0) {
      setError(
        `Vui lòng nhập nội dung đề bài cho Câu ${emptyIndices.join(', ')} (hoặc xoá câu trống).`
      );
      setFilterMode('all');
      setSearchTerm('');
      return;
    }

    setSaving(true);
    try {
      await updateExam(exam.id, {
        title: title.trim() || exam.title,
        subject: subject.trim() || exam.subject,
        durationMinutes,
        questions,
      });
      if (regradeExisting && examSubmissions.length > 0) {
        await regradeExamSubmissions(examSubmissions, questions);
      }
      onClose();
    } catch (err) {
      setError(extractFriendlyFirestoreError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#082B23]/45 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-[#DAE5E0] max-w-5xl w-full p-6 space-y-4 my-4 max-h-[94vh] flex flex-col shadow-xl">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 shrink-0 pb-2 border-b border-[#EDF3F0]">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.08em] text-[#8A630D] uppercase">
              Chỉnh sửa đề thi, đáp án &amp; barem điểm
            </div>
            <div className="flex flex-wrap items-baseline gap-3 mt-0.5">
              <h3 className="font-serif text-2xl font-semibold text-[#0D221D]">
                Chỉnh sửa đề thi &amp; đáp án
              </h3>
              <span className="text-xs font-semibold text-[#0F4C3F] tabular-nums">
                {questions.length} câu · Tổng {totalExamPoints} điểm
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#597169] hover:bg-[#EFF7F3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 min-h-0 flex flex-col space-y-3.5">
          {/* Exam Title, Subject & Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 shrink-0">
            <div className="sm:col-span-6">
              <label className="block text-xs font-medium text-[#3A524A] mb-1">
                Tên đề kiểm tra
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-[#3A524A] mb-1">
                Môn học
              </label>
              <input
                type="text"
                list="exam-subject-suggestions"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              />
              <datalist id="exam-subject-suggestions">
                {SUBJECT_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#3A524A] mb-1">
                Thời gian (phút)
              </label>
              <input
                type="number"
                min={5}
                max={180}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] text-sm text-[#0D221D] tabular-nums focus:outline-none focus:border-[#0F4C3F]"
              />
            </div>
          </div>

          {/* Filter Tabs + Search + Add Question Toolbar */}
          <div className="flex flex-col gap-2.5 pb-2.5 border-b border-[#EBF1EE] shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex flex-wrap p-1 rounded-xl bg-[#E6EEEA] gap-1">
                {(
                  [
                    { id: 'all', label: `Tất cả (${questions.length})` },
                    { id: 'mcq', label: `Trắc nghiệm (${mcqCount})` },
                    { id: 'true_false', label: `Đúng / Sai (${tfCount})` },
                    { id: 'short_answer', label: `Trả lời ngắn (${shortCount})` },
                    { id: 'essay', label: `Tự luận (${essayCount})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterMode(tab.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer tabular-nums whitespace-nowrap ${
                      filterMode === tab.id
                        ? 'bg-white text-[#0F4C3F] font-semibold shadow-sm'
                        : 'text-[#4A615A] hover:text-[#0D221D]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-[#698078] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm số câu hoặc từ khóa..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-[#597169] mr-1">
                  Thêm câu mới:
                </span>
                <button
                  type="button"
                  onClick={() => handleAddQuestion('mcq')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#CEDCD6] bg-white text-[#0D221D] text-xs font-medium hover:border-[#0F4C3F] hover:text-[#0F4C3F] whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Trắc nghiệm</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddQuestion('true_false')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#CEDCD6] bg-white text-[#0D221D] text-xs font-medium hover:border-[#0F4C3F] hover:text-[#0F4C3F] whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Đúng / Sai</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddQuestion('short_answer')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#CEDCD6] bg-white text-[#0D221D] text-xs font-medium hover:border-[#0F4C3F] hover:text-[#0F4C3F] whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Trả lời ngắn</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddQuestion('essay')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#0F4C3F] bg-[#EFF7F3] text-[#0F4C3F] text-xs font-semibold hover:bg-[#DCECE4] whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Tự luận</span>
                </button>
              </div>

              <button
                type="button"
                disabled={generatingExplanations}
                onClick={handleGenerateExplanations}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-[#7A580B] text-xs font-semibold hover:bg-[#FAF1D6] disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#C89B2B]" />
                <span>
                  {generatingExplanations
                    ? 'AI đang viết lời giải...'
                    : missingExplanationCount > 0
                      ? `AI viết lời giải từ đáp án (${missingExplanationCount})`
                      : 'AI viết lại lời giải từ đáp án'}
                </span>
              </button>
            </div>
          </div>

          {/* Question List */}
          <div
            ref={listContainerRef}
            className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1"
          >
            {displayedIndices.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[#F8FAF9] border border-[#DAE5E0] text-center space-y-3">
                <p className="text-sm text-[#4A615A]">
                  Không có câu hỏi nào khớp bộ lọc hoặc từ khóa đang chọn.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterMode('all');
                      setSearchTerm('');
                    }}
                    className="px-4 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#3A524A] hover:bg-[#EFF7F3] cursor-pointer"
                  >
                    Hiện tất cả câu hỏi ({questions.length})
                  </button>
                  {filterMode !== 'all' && (
                    <button
                      type="button"
                      onClick={() => handleAddQuestion(filterMode)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#E5C665]" />
                      <span>Thêm câu loại này</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              displayedIndices.map(({ q, idx }) => {
                const isInitialFocus = initialQuestionId === q.id;
                return (
                  <div
                    key={q.id}
                    ref={(el) => {
                      questionCardRefs.current[q.id] = el;
                    }}
                    className={`p-4 rounded-2xl border space-y-3 transition-colors ${
                      isInitialFocus
                        ? 'bg-[#EFF7F3] border-[#0F4C3F] ring-2 ring-[#C89B2B]/30'
                        : 'bg-[#F8FAF9] border-[#DAE5E0]'
                    }`}
                  >
                    {/* Card Top Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[#0D221D]">
                          Câu {idx + 1}
                        </span>
                        <select
                          value={q.type}
                          onChange={(e) => {
                            const nextType = e.target.value as QuestionType;
                            updateQuestionAt(idx, (prev) => ({
                              ...prev,
                              type: nextType,
                              maxScore:
                                nextType === 'essay'
                                  ? prev.type === 'essay'
                                    ? prev.maxScore
                                    : 1.0
                                  : nextType === 'true_false'
                                    ? 1.0
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
                              correctOption:
                                nextType === 'mcq' ? prev.correctOption ?? 0 : prev.correctOption,
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
                          className="px-2.5 py-1 rounded-lg border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                        >
                          <option value="mcq">Trắc nghiệm</option>
                          <option value="true_false">Đúng / Sai</option>
                          <option value="short_answer">Trả lời ngắn (4 ô số)</option>
                          <option value="essay">Tự luận</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs">
                        <label className="text-[#4A615A]">Điểm:</label>
                        <input
                          type="number"
                          step="0.05"
                          min={0.1}
                          max={10}
                          value={q.maxScore}
                          onChange={(e) =>
                            updateQuestionAt(idx, (prev) => ({
                              ...prev,
                              maxScore: Number(e.target.value) || 0.25,
                            }))
                          }
                          className="w-16 px-2 py-1 rounded-lg border border-[#CEDCD6] bg-white text-center font-mono text-[#0D221D] tabular-nums focus:outline-none focus:border-[#0F4C3F]"
                        />

                        <button
                          type="button"
                          onClick={() => handleMoveQuestion(idx, -1)}
                          disabled={idx === 0}
                          title="Chuyển lên trước"
                          className="p-1.5 rounded-lg text-[#4A615A] hover:bg-white disabled:opacity-35 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveQuestion(idx, 1)}
                          disabled={idx === questions.length - 1}
                          title="Chuyển xuống sau"
                          className="p-1.5 rounded-lg text-[#4A615A] hover:bg-white disabled:opacity-35 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteQuestion(idx)}
                          title="Xoá câu này"
                          className="p-1.5 rounded-lg text-[#597169] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Prompt Editor */}
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <label className="text-xs font-medium text-[#3A524A]">
                          Nội dung đề bài (hỗ trợ LaTeX <code className="font-mono">$...$</code> /{' '}
                          <code className="font-mono">$$...$$</code>)
                        </label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {QUICK_LATEX_SNIPPETS.map((snip) => (
                            <button
                              key={snip.label}
                              type="button"
                              onClick={() =>
                                updateQuestionAt(idx, (prev) => ({
                                  ...prev,
                                  prompt: prev.prompt
                                    ? `${prev.prompt}${prev.prompt.endsWith(' ') ? '' : ' '}${snip.tex}`
                                    : snip.tex,
                                }))
                              }
                              className="px-1.5 py-0.5 rounded border border-[#CEDCD6] bg-white text-[10px] font-medium text-[#0F4C3F] hover:bg-[#EFF7F3] cursor-pointer"
                              title={`Chèn mẫu ${snip.tex}`}
                            >
                              + {snip.label}
                            </button>
                          ))}
                          <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[#CEDCD6] bg-white text-[11px] font-medium text-[#3A524A] hover:text-[#0F4C3F] cursor-pointer">
                            <ImageIcon className="w-3 h-3" />
                            <span>+ Ảnh đề bài</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                handleUploadImage(idx, 'imageUrls', e.target.files?.[0]);
                                e.target.value = '';
                              }}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>
                      <textarea
                        rows={q.type === 'essay' ? 3 : 2}
                        value={q.prompt}
                        onChange={(e) =>
                          updateQuestionAt(idx, (prev) => ({
                            ...prev,
                            prompt: e.target.value,
                          }))
                        }
                        placeholder="Nhập nội dung đề bài câu hỏi (dùng $...$ cho công thức toán, VD: $\frac{1}{2}mv^2$)..."
                        className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                      />
                      {containsLatexFormula(q.prompt) && (
                        <div className="mt-1.5 p-2.5 rounded-xl bg-white border border-[#DAE5E0] text-sm text-[#0D221D]">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#0F4C3F] mb-0.5">
                            Hiển thị công thức
                          </div>
                          <MathText text={q.prompt} className="whitespace-pre-line leading-relaxed" />
                        </div>
                      )}
                    </div>

                    {/* Prompt Images */}
                    {q.imageUrls && q.imageUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {q.imageUrls.map((url, imgIdx) => (
                          <div key={imgIdx} className="relative group">
                            <img
                              src={url}
                              alt={`Hình đề câu ${idx + 1}`}
                              className="max-h-28 rounded-lg border border-[#CEDCD6] object-contain bg-white"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateQuestionAt(idx, (prev) => ({
                                  ...prev,
                                  imageUrls: (prev.imageUrls || []).filter((_, i) => i !== imgIdx),
                                }))
                              }
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#B91C1C] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              title="Xoá ảnh"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Type-specific fields */}
                    {q.type === 'mcq' && q.options && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] text-[#4A615A]">
                          Sửa nội dung phương án hoặc bấm vào nút{' '}
                          <strong className="text-[#0D221D]">A / B / C / D</strong> để chọn lại đáp án đúng:
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {q.options.map((opt, optIdx) => {
                            const isCorrect = (q.correctOption ?? 0) === optIdx;
                            return (
                              <div
                                key={optIdx}
                                className={`flex items-center gap-2 p-2 rounded-xl border bg-white ${
                                  isCorrect ? 'border-[#0F6D4F] ring-1 ring-[#0F6D4F]/20' : 'border-[#CEDCD6]'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateQuestionAt(idx, (prev) => ({
                                      ...prev,
                                      correctOption: optIdx,
                                    }))
                                  }
                                  className={`w-6 h-6 rounded-md text-xs font-bold shrink-0 cursor-pointer ${
                                    isCorrect
                                      ? 'bg-[#0F6D4F] text-white'
                                      : 'bg-[#EFF7F3] text-[#4A615A] hover:bg-[#DAE5E0]'
                                  }`}
                                  title="Chọn làm đáp án đúng"
                                >
                                  {OPTION_LETTERS[optIdx]}
                                </button>
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) =>
                                    updateQuestionAt(idx, (prev) => ({
                                      ...prev,
                                      options: (prev.options || []).map((o, i2) =>
                                        i2 === optIdx ? e.target.value : o
                                      ),
                                    }))
                                  }
                                  className="flex-1 min-w-0 text-xs text-[#0D221D] focus:outline-none"
                                />
                                {containsLatexFormula(opt) && (
                                  <span className="text-xs text-[#0F4C3F] shrink-0 max-w-[45%] truncate">
                                    <MathText text={opt} inline />
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {q.type === 'true_false' && q.statements && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] text-[#4A615A]">
                          Bấm nút <strong className="text-[#0D221D]">Đúng / Sai</strong> ở cuối mỗi ý để đổi đáp án chuẩn:
                        </div>
                        {q.statements.map((st, sIdx) => (
                          <div
                            key={sIdx}
                            className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-xl border border-[#CEDCD6]"
                          >
                            <span className="text-xs font-bold text-[#4A615A] w-5 shrink-0">
                              {'abcd'[sIdx]})
                            </span>
                            <input
                              type="text"
                              value={st.text}
                              onChange={(e) =>
                                updateQuestionAt(idx, (prev) => ({
                                  ...prev,
                                  statements: (prev.statements || []).map((item, i2) =>
                                    i2 === sIdx ? { ...item, text: e.target.value } : item
                                  ),
                                }))
                              }
                              className="flex-1 min-w-0 text-xs text-[#0D221D] focus:outline-none"
                            />
                            {containsLatexFormula(st.text) && (
                              <span className="text-xs text-[#0F4C3F] shrink-0 max-w-[40%] truncate">
                                <MathText text={st.text} inline />
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                updateQuestionAt(idx, (prev) => ({
                                  ...prev,
                                  statements: (prev.statements || []).map((item, i2) =>
                                    i2 === sIdx ? { ...item, isTrue: !item.isTrue } : item
                                  ),
                                }))
                              }
                              className={`px-2.5 py-0.5 rounded text-[11px] font-semibold shrink-0 cursor-pointer ${
                                st.isTrue
                                  ? 'bg-[#EFF7F3] text-[#0F6D4F] border border-[#C5DDD3]'
                                  : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]'
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
                        <span className="font-medium text-[#3A524A]">
                          Đáp số đúng (tối đa 4 ký tự):
                        </span>
                        <input
                          type="text"
                          maxLength={4}
                          value={q.correctAnswer || ''}
                          onChange={(e) =>
                            updateQuestionAt(idx, (prev) => ({
                              ...prev,
                              correctAnswer: e.target.value,
                            }))
                          }
                          placeholder="VD: 2,5"
                          className="w-24 px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white font-mono font-semibold text-[#0F4C3F] focus:outline-none focus:border-[#0F4C3F]"
                        />
                        <span className="text-[11px] text-[#597169]">
                          (Hệ thống tự chấp nhận dấu chấm hoặc phẩy thập phân khi chấm)
                        </span>
                      </div>
                    )}

                    {q.type === 'essay' && (
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <label className="text-xs font-medium text-[#3A524A]">
                            Đáp án chuẩn / Barem chấm (Công thức · Thay số · Đáp số · Đơn vị)
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const m = Number(q.maxScore || 1);
                              const s1 = Number((m * 0.25).toFixed(2));
                              const s2 = Number((m * 0.25).toFixed(2));
                              const s3 = Number((m * 0.25).toFixed(2));
                              const s4 = Number((m - s1 - s2 - s3).toFixed(2));
                              const template = `Công thức áp dụng (${s1}đ); Thay số & đổi đơn vị (${s2}đ); Đáp số (${s3}đ); Đơn vị đầy đủ (${s4}đ)`;
                              updateQuestionAt(idx, (prev) => ({
                                ...prev,
                                correctAnswer: prev.correctAnswer?.trim()
                                  ? `${prev.correctAnswer.trim()} | ${template}`
                                  : template,
                              }));
                            }}
                            className="px-2 py-0.5 rounded-lg border border-[#EAD8A6] bg-[#FDF8EB] text-[11px] font-semibold text-[#8A630D] hover:bg-[#FAF1D6] cursor-pointer"
                          >
                            + Mẫu Barem 4 bước
                          </button>
                        </div>
                        <input
                          type="text"
                          value={q.correctAnswer || ''}
                          onChange={(e) =>
                            updateQuestionAt(idx, (prev) => ({
                              ...prev,
                              correctAnswer: e.target.value,
                            }))
                          }
                          placeholder="VD: Công thức Q=λm (0,25đ); Đổi đơn vị & thay số (0,25đ); Đáp số 668 (0,25đ); Đơn vị kJ (0,25đ)"
                          className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                        />
                        {containsLatexFormula(q.correctAnswer) && (
                          <div className="mt-1.5 p-2 rounded-lg bg-white border border-[#DAE5E0] text-xs text-[#0D221D]">
                            <MathText text={q.correctAnswer} inline />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Explanation / Solution Guide */}
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <label className="text-xs font-medium text-[#3A524A]">
                          {q.type === 'essay'
                            ? 'Hướng dẫn giải chi tiết (Tự luận)'
                            : 'Lời giải / ghi chú'}
                        </label>
                        <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[#CEDCD6] bg-white text-[11px] font-medium text-[#3A524A] hover:text-[#0F4C3F] cursor-pointer">
                          <ImageIcon className="w-3 h-3" />
                          <span>+ Ảnh lời giải</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              handleUploadImage(idx, 'explanationImageUrls', e.target.files?.[0]);
                              e.target.value = '';
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>
                      <textarea
                        rows={q.type === 'essay' ? 3 : 2}
                        value={q.explanation}
                        onChange={(e) =>
                          updateQuestionAt(idx, (prev) => ({
                            ...prev,
                            explanation: e.target.value,
                          }))
                        }
                        placeholder="Nhập các bước giải chi tiết hoặc hướng dẫn chấm (hỗ trợ $...$ LaTeX)..."
                        className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                      />
                      {containsLatexFormula(q.explanation) && (
                        <div className="mt-1.5 p-2.5 rounded-xl bg-[#F0FBF6] border border-[#C5DDD3] text-xs text-[#0D221D]">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#0F6D4F] mb-0.5">
                            Hiển thị công thức lời giải
                          </div>
                          <MathText
                            text={q.explanation}
                            className="whitespace-pre-line leading-relaxed"
                          />
                        </div>
                      )}

                      {q.explanationImageUrls && q.explanationImageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {q.explanationImageUrls.map((url, imgIdx) => (
                            <div key={imgIdx} className="relative group">
                              <img
                                src={url}
                                alt={`Ảnh lời giải câu ${idx + 1}`}
                                className="max-h-24 rounded-lg border border-[#CEDCD6] object-contain bg-white"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateQuestionAt(idx, (prev) => ({
                                    ...prev,
                                    explanationImageUrls: (prev.explanationImageUrls || []).filter(
                                      (_, i) => i !== imgIdx
                                    ),
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
                );
              })
            )}
          </div>

          {examSubmissions.length > 0 && (
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-xs text-[#7A580B] cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={regradeExisting}
                onChange={(e) => setRegradeExisting(e.target.checked)}
                className="mt-0.5 rounded border-[#C89B2B] text-[#0F4C3F] focus:ring-[#0F4C3F]"
              />
              <span className="leading-relaxed">
                <strong className="inline-flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 text-[#C89B2B]" />
                  Tự động chấm lại điểm cho {examSubmissions.length} bài học sinh đã nộp
                </strong>{' '}
                theo đáp án &amp; thang điểm mới vừa sửa (áp dụng cho Trắc nghiệm, Đúng/Sai, Trả lời ngắn; giữ nguyên điểm &amp; nhận xét Tự luận đã chấm).
              </span>
            </label>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C] shrink-0">
              {error}
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[#EBF1EE] shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-sm font-medium text-[#3A524A] hover:bg-[#EFF7F3] cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer shadow-xs"
            >
              <Save className="w-4 h-4 text-[#E5C665]" />
              <span>
                {saving
                  ? regradeExisting && examSubmissions.length > 0
                    ? 'Đang lưu & chấm lại...'
                    : 'Đang lưu...'
                  : regradeExisting && examSubmissions.length > 0
                    ? `Lưu đề & chấm lại ${examSubmissions.length} bài`
                    : 'Lưu thay đổi đề thi'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
