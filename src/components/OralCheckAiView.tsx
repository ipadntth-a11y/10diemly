import {
  Camera,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Image as ImageIcon,
  MessageSquare,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  deleteHandwrittenCheck,
  extractFriendlyFirestoreError,
  saveHandwrittenCheck,
  subscribeClassStudents,
  subscribeHandwrittenChecks,
  upsertParentMessageByRef,
} from '../services/firestoreService';
import { gradePhotoWithAi, type GradePhotoOutput } from '../services/geminiService';
import type {
  Classroom,
  Exam,
  HandwrittenCheck,
  ParentMessage,
  StudentRecord,
} from '../types';
import { buildDefaultParentMessage, formatScore } from '../utils/formatters';
import { compressExamPhoto } from '../utils/imageUtils';
import { MathText } from './MathText';

interface OralCheckAiViewProps {
  teacherId: string;
  classes: Classroom[];
  exams: Exam[];
  parentMessages?: ParentMessage[];
  onOpenParentMessagesTab?: () => void;
}

export function OralCheckAiView({
  teacherId,
  classes,
  exams,
  parentMessages = [],
  onOpenParentMessagesTab,
}: OralCheckAiViewProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [sttLookup, setSttLookup] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [customStudentName, setCustomStudentName] = useState('');

  // Prompt, rubric & scale
  const shortQuestions = useMemo(
    () =>
      exams.flatMap((ex) =>
        ex.questions
          .filter((q) => q.type === 'essay' || q.type === 'short_answer')
          .map((q) => ({ examTitle: ex.title, question: q }))
      ),
    [exams]
  );
  const [selectedQuestionKey, setSelectedQuestionKey] = useState('custom');
  const [promptText, setPromptText] = useState('');
  const [rubricText, setRubricText] = useState('');
  const [maxScore, setMaxScore] = useState(10);

  // Photo state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [aiBase64, setAiBase64] = useState<string | null>(null);
  const [aiMimeType, setAiMimeType] = useState<string>('image/jpeg');

  // Grading & editing result state
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradePhotoOutput | null>(null);
  const [editedScore, setEditedScore] = useState<number>(0);
  const [editedComment, setEditedComment] = useState('');
  const [savingCheck, setSavingCheck] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Saved history
  const [checks, setChecks] = useState<HandwrittenCheck[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyClassFilter, setHistoryClassFilter] = useState('all');

  useEffect(() => {
    if (!selectedClassId && classes.length > 0) {
      setSelectedClassId(classes[0].id);
    }
  }, [classes, selectedClassId]);

  useEffect(() => {
    if (!teacherId) return;
    return subscribeHandwrittenChecks(teacherId, setChecks, (err) =>
      setErrorMsg(extractFriendlyFirestoreError(err))
    );
  }, [teacherId]);

  useEffect(() => {
    if (!selectedClassId) {
      setStudents([]);
      return;
    }
    return subscribeClassStudents(selectedClassId, teacherId, setStudents, (err) =>
      setErrorMsg(extractFriendlyFirestoreError(err))
    );
  }, [selectedClassId, teacherId]);

  // Listen for clipboard paste (Ctrl+V image)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            await processImageFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const activeClass = classes.find((c) => c.id === selectedClassId) || null;
  const activeStudent = students.find((s) => s.id === selectedStudentId) || null;

  const effectiveStudentName =
    activeStudent?.fullName || customStudentName.trim() || 'Học sinh khảo bài';

  const handleSttLookupChange = (val: string) => {
    setSttLookup(val);
    const trimmed = val.trim();
    if (!trimmed) return;
    if (/^\d{1,3}$/.test(trimmed)) {
      const stt = Number(trimmed);
      if (stt >= 1 && stt <= students.length) {
        setSelectedStudentId(students[stt - 1].id);
        return;
      }
    }
    const upper = trimmed.toUpperCase();
    const byCode = students.find(
      (s) => s.studentCode.trim().toUpperCase() === upper
    );
    if (byCode) {
      setSelectedStudentId(byCode.id);
    }
  };

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

  const processImageFile = async (file: File) => {
    setErrorMsg(null);
    setResult(null);
    setSavedNotice(null);
    try {
      const compressed = await compressExamPhoto(file);
      setPreviewUrl(compressed.storageDataUrl);
      setAiBase64(compressed.aiBase64);
      setAiMimeType(compressed.aiMimeType);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể xử lý ảnh.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processImageFile(file);
  };

  const handleGradePhoto = async () => {
    if (!aiBase64) {
      setErrorMsg('Vui lòng chụp, chọn hoặc dán (Ctrl+V) ảnh bài làm viết tay trước.');
      return;
    }
    setGrading(true);
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      const data = await gradePhotoWithAi({
        imageBase64: aiBase64,
        imageMimeType: aiMimeType,
        promptText,
        rubricText,
        maxScore,
      });
      setResult(data);
      setEditedScore(data.score);
      setEditedComment(data.teacherComment);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi kết nối Gemini.');
    } finally {
      setGrading(false);
    }
  };

  const handleSaveResult = async (alsoSendParentMsg: boolean) => {
    if (!result || savingCheck) return;
    setSavingCheck(true);
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      const saved = await saveHandwrittenCheck({
        teacherId,
        classId: activeClass?.id || '',
        className: activeClass?.name || '',
        studentId: activeStudent?.id || '',
        studentName: effectiveStudentName,
        studentCode: activeStudent?.studentCode || '',
        promptText: promptText.trim() || 'Khảo bài viết tay trên lớp',
        score: editedScore,
        maxScore,
        recognizedText: result.recognizedText,
        strengths: result.strengths,
        mistakes: result.mistakes,
        teacherComment: editedComment.trim() || result.teacherComment,
        breakdown: result.breakdown,
      });

      if (alsoSendParentMsg) {
        const msgContent = buildDefaultParentMessage(
          effectiveStudentName,
          promptText.trim() ? `Khảo bài: ${promptText.trim().slice(0, 60)}` : 'Khảo bài viết tay',
          editedScore,
          maxScore,
          editedComment.trim() || result.teacherComment
        );
        await upsertParentMessageByRef({
          teacherId,
          refId: saved.id,
          studentName: effectiveStudentName,
          className: activeClass?.name || '',
          examTitle: promptText.trim()
            ? `Khảo bài: ${promptText.trim().slice(0, 80)}`
            : 'Khảo bài viết tay',
          parentPhone: activeStudent?.parentPhone || '',
          content: msgContent,
          existingMessages: parentMessages,
        });
        setSavedNotice('Đã lưu kết quả khảo bài và tạo tin nhắn phụ huynh ngắn gọn.');
      } else {
        setSavedNotice('Đã lưu kết quả khảo bài viết tay vào lịch sử.');
      }
    } catch (err) {
      setErrorMsg(extractFriendlyFirestoreError(err));
    } finally {
      setSavingCheck(false);
    }
  };

  const handleCopyCheckSummary = (chk: HandwrittenCheck) => {
    const text = buildDefaultParentMessage(
      chk.studentName,
      chk.promptText || 'Khảo bài viết tay',
      chk.score,
      chk.maxScore,
      chk.teacherComment
    );
    navigator.clipboard.writeText(text);
    setCopiedId(chk.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const filteredChecks = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return checks.filter((c) => {
      if (historyClassFilter !== 'all' && c.classId !== historyClassFilter) {
        return false;
      }
      if (!q) return true;
      return (
        c.studentName.toLowerCase().includes(q) ||
        (c.className || '').toLowerCase().includes(q) ||
        (c.promptText || '').toLowerCase().includes(q)
      );
    });
  }, [checks, historySearch, historyClassFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-[0.08em] text-[#8A630D] uppercase">
            Gemini Vision · Chụp giấy là có điểm ngay
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#0D221D] mt-1">
            Khảo bài AI — Chấm bài viết tay
          </h1>
          <p className="text-sm text-[#4A615A] mt-1">
            Chụp vở/giấy nháp kiểm tra đầu giờ hoặc dán ảnh (Ctrl+V), gõ STT học sinh để AI đọc chữ viết tay, chấm barem và lưu điểm.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
          {errorMsg}
        </div>
      )}

      {/* Main 2-column Grading Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Student STT Picker + Photo + Prompt */}
        <section className="lg:col-span-6 bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
          {/* Student Fast Selector */}
          <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#EBF1EE] space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
              1. Gắn nhanh học sinh được khảo bài (tuỳ chọn)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <div className="sm:col-span-4">
                <select
                  value={selectedClassId}
                  onChange={(e) => {
                    setSelectedClassId(e.target.value);
                    setSelectedStudentId('');
                    setSttLookup('');
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-semibold text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                >
                  <option value="">Không chọn lớp</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      Lớp {cls.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <input
                  type="text"
                  value={sttLookup}
                  onChange={(e) => handleSttLookupChange(e.target.value)}
                  placeholder="Gõ STT..."
                  className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-mono text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>

              <div className="sm:col-span-5">
                {students.length > 0 ? (
                  <select
                    value={selectedStudentId}
                    onChange={(e) => {
                      setSelectedStudentId(e.target.value);
                      const idx = students.findIndex((s) => s.id === e.target.value);
                      setSttLookup(idx >= 0 ? String(idx + 1) : '');
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                  >
                    <option value="">-- Nhập tên tự do --</option>
                    {students.map((s, idx) => (
                      <option key={s.id} value={s.id}>
                        {String(idx + 1).padStart(2, '0')} · {s.fullName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={customStudentName}
                    onChange={(e) => setCustomStudentName(e.target.value)}
                    placeholder="Nhập tên học sinh..."
                    className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                  />
                )}
              </div>
            </div>

            {students.length > 0 && !selectedStudentId && (
              <input
                type="text"
                value={customStudentName}
                onChange={(e) => setCustomStudentName(e.target.value)}
                placeholder="Hoặc nhập tên học sinh khảo bài tại đây..."
                className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              />
            )}
          </div>

          {/* Photo Capture / Paste Zone */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="text-xs font-semibold text-[#0D221D]">
                2. Ảnh chụp bài viết tay *
              </label>
              <span className="inline-flex items-center gap-1 text-[11px] text-[#597169]">
                <ClipboardPaste className="w-3 h-3" /> Hỗ trợ dán ảnh Ctrl+V
              </span>
            </div>

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
                    alt="Ảnh bài viết tay"
                    className="max-h-64 mx-auto rounded-xl object-contain border border-[#DAE5E0] bg-white"
                  />
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F4C3F]">
                    <Camera className="w-3.5 h-3.5" />
                    <span>Chạm để chụp / đổi ảnh khác</span>
                  </div>
                </div>
              ) : (
                <div className="py-7 space-y-2">
                  <Upload className="w-8 h-8 text-[#0F4C3F] mx-auto" />
                  <div className="text-sm font-semibold text-[#0D221D]">
                    Chạm để chụp ảnh giấy làm bài hoặc tải ảnh từ máy
                  </div>
                  <div className="text-xs text-[#597169]">
                    AI đọc tốt chữ viết tay, công thức Toán · Vật lí · Hoá học
                  </div>
                </div>
              )}
            </label>
          </div>

          {/* Prompt & Barem */}
          {shortQuestions.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[#3A524A] mb-1">
                Lấy đề &amp; đáp án từ đề có sẵn (tuỳ chọn)
              </label>
              <select
                value={selectedQuestionKey}
                onChange={(e) => handleSelectQuestion(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              >
                <option value="custom">Chấm tự do theo đề trên giấy / tự nhập bên dưới</option>
                {shortQuestions.map((item, idx) => (
                  <option key={`${item.question.id}_${idx}`} value={String(idx)}>
                    {item.examTitle} — Câu {item.question.index} ({item.question.maxScore}đ)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-8">
              <label className="block text-xs font-medium text-[#3A524A] mb-1">
                Nội dung câu khảo bài (tuỳ chọn)
              </label>
              <input
                type="text"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="VD: Viết công thức và tính nhiệt lượng..."
                className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-[#3A524A] mb-1">
                Thang điểm
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="100"
                  value={maxScore}
                  onChange={(e) => setMaxScore(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#CEDCD6] text-xs text-[#0D221D] tabular-nums focus:outline-none focus:border-[#0F4C3F]"
                />
                {[10, 2].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setMaxScore(preset)}
                    className={`px-2 py-2 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                      maxScore === preset
                        ? 'bg-[#0F4C3F] border-[#0F4C3F] text-white'
                        : 'bg-white border-[#CEDCD6] text-[#4A615A]'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-xs font-medium text-[#3A524A]">
                Đáp án / Barem chấm (tuỳ chọn)
              </label>
              <button
                type="button"
                onClick={() => {
                  const m = Number(maxScore || 10);
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
              rows={2}
              value={rubricText}
              onChange={(e) => setRubricText(e.target.value)}
              placeholder="Để trống để AI tự chấm theo barem chuẩn 4 bước..."
              className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] text-xs text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
            />
          </div>

          <button
            type="button"
            disabled={grading || !aiBase64}
            onClick={handleGradePhoto}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#E5C665]" />
            <span>{grading ? 'AI đang đọc chữ viết tay & chấm...' : 'AI chấm bài viết tay ngay'}</span>
          </button>
        </section>

        {/* Right: Grading Output + Save & Parent Message */}
        <section className="lg:col-span-6 bg-white border border-[#DAE5E0] rounded-2xl p-5 flex flex-col justify-between shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
          {!result ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-4 space-y-2.5">
              <ImageIcon className="w-9 h-9 text-[#698078]" />
              <div className="text-base font-serif font-semibold text-[#0D221D]">
                Kết quả khảo bài AI sẽ hiện tại đây
              </div>
              <p className="text-xs text-[#597169] max-w-sm leading-relaxed">
                AI tự nhận diện chữ viết tay, chấm điểm chi tiết theo từng bước, chỉ lỗi thiếu đơn vị/sai công thức và tạo nhận xét ngắn gọn để lưu điểm hoặc gửi phụ huynh.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-[#EDF3F0]">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8A630D]">
                    {effectiveStudentName}
                    {activeClass ? ` · Lớp ${activeClass.name}` : ''}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-medium text-[#597169]">Điểm chốt:</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      max={maxScore}
                      value={editedScore}
                      onChange={(e) => setEditedScore(Number(e.target.value))}
                      className="w-24 px-2.5 py-1 rounded-lg border border-[#CEDCD6] font-serif text-2xl font-semibold text-[#0F4C3F] tabular-nums focus:outline-none focus:border-[#0F4C3F]"
                    />
                    <span className="text-sm text-[#597169]">/{maxScore}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={savingCheck}
                    onClick={() => handleSaveResult(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#0F4C3F] bg-white text-[#0F4C3F] text-xs font-semibold hover:bg-[#EFF7F3] disabled:opacity-60 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Lưu kết quả</span>
                  </button>

                  <button
                    type="button"
                    disabled={savingCheck}
                    onClick={() => handleSaveResult(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#E5C665]" />
                    <span>Lưu &amp; tạo tin PH</span>
                  </button>
                </div>
              </div>

              {savedNotice && (
                <div className="p-3 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] text-xs text-[#0A362C] flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{savedNotice}</span>
                  {onOpenParentMessagesTab && (
                    <button
                      type="button"
                      onClick={onOpenParentMessagesTab}
                      className="font-semibold text-[#0F4C3F] underline cursor-pointer"
                    >
                      Mở Tin nhắn PH
                    </button>
                  )}
                </div>
              )}

              <div className="bg-[#F8FAF9] border border-[#DAE5E0] rounded-xl p-3.5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                  Nội dung AI đọc được từ chữ viết tay
                </div>
                <MathText
                  text={result.recognizedText}
                  className="text-xs text-[#0D221D] whitespace-pre-line leading-relaxed"
                />
              </div>

              {result.breakdown && result.breakdown.length > 0 && (
                <div className="bg-[#F8FAF9] border border-[#DAE5E0] rounded-xl p-3.5 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                    Barem từng ý
                  </div>
                  <div className="space-y-1.5">
                    {result.breakdown.map((b, i) => (
                      <div key={i} className="flex items-start justify-between gap-2 text-xs">
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

              <div className="grid grid-cols-1 gap-2 text-xs">
                {result.strengths && (
                  <div className="p-3 rounded-xl bg-[#F0FBF6] border border-[#C5DDD3] text-[#0D221D]">
                    <strong className="text-[#0F6D4F]">Làm tốt:</strong>{' '}
                    <MathText text={result.strengths} inline />
                  </div>
                )}
                {result.mistakes && (
                  <div className="p-3 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-[#7A580B]">
                    <strong>Cần sửa:</strong>{' '}
                    <MathText text={result.mistakes} inline />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F4C3F] mb-1">
                  Nhận xét ngắn gọn (dùng gửi phụ huynh)
                </label>
                <textarea
                  rows={2}
                  value={editedComment}
                  onChange={(e) => setEditedComment(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] text-xs text-[#0D221D] leading-relaxed focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* History of Saved Handwritten Checks */}
      <section className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
              Nhật ký khảo bài viết tay đã lưu ({filteredChecks.length})
            </h2>
            <p className="text-xs text-[#597169] mt-0.5">
              Lưu điểm và lời phê ngắn gọn sau mỗi lượt chụp bài trên lớp.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {classes.length > 0 && (
              <select
                value={historyClassFilter}
                onChange={(e) => setHistoryClassFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-xs font-medium text-[#0D221D]"
              >
                <option value="all">Tất cả các lớp</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    Lớp {c.name}
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <Search className="w-4 h-4 text-[#698078] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Tìm tên HS..."
                className="pl-9 pr-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-xs w-44 focus:outline-none focus:border-[#0F4C3F]"
              />
            </div>
          </div>
        </div>

        {filteredChecks.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#597169]">
            Chưa có lượt khảo bài viết tay nào được lưu.
          </div>
        ) : (
          <div className="divide-y divide-[#EDF3F0]">
            {filteredChecks.map((chk) => (
              <div
                key={chk.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-[#0D221D]">
                      {chk.studentName}
                    </span>
                    {chk.className && (
                      <span className="text-xs text-[#597169]">· Lớp {chk.className}</span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-[#EFF7F3] text-[#0F4C3F] font-mono text-xs font-bold tabular-nums">
                      {formatScore(chk.score)}/{formatScore(chk.maxScore)}đ
                    </span>
                  </div>
                  {chk.promptText && (
                    <div className="text-xs text-[#597169] truncate">
                      Nội dung: {chk.promptText}
                    </div>
                  )}
                  <div className="text-xs text-[#3A524A]">{chk.teacherComment}</div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyCheckSummary(chk)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] hover:bg-[#F8FAF9] cursor-pointer"
                  >
                    {copiedId === chk.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#0F6D4F]" />
                        <span>Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Chép tin PH</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteHandwrittenCheck(chk.id)}
                    title="Xoá bản ghi"
                    className="p-1.5 rounded-lg text-[#698078] hover:text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
