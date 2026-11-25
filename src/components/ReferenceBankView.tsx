import {
  AlertCircle,
  BookMarked,
  BookOpen,
  Check,
  CheckCircle2,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import {
  createReferenceMaterialsChunked,
  deleteReferenceMaterial,
  examQuestionToReferenceItem,
  updateReferenceMaterial,
} from '../services/referenceBankService';
import {
  extractFriendlyFirestoreError,
} from '../services/firestoreService';
import {
  generateExplanationsWithAi,
  parseReferencePdfChunkWithAi,
  parseReferenceWordWithAi,
} from '../services/geminiService';
import type {
  Exam,
  QuestionType,
  ReferenceDifficulty,
  ReferenceMaterial,
  ReferenceQuestionItem,
} from '../types';
import { parseDocxForReferenceBank } from '../utils/docxParser';
import {
  inspectPdfFile,
  slicePdfPagesToBase64Chunks,
} from '../utils/pdfExtractor';
import { MathText } from './MathText';

interface ReferenceBankViewProps {
  teacherId: string;
  materials: ReferenceMaterial[];
  exams: Exam[];
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const TF_LETTERS = ['a', 'b', 'c', 'd'];

const DIFFICULTY_LABEL: Record<ReferenceDifficulty, string> = {
  nhan_biet: 'Nhận biết',
  thong_hieu: 'Thông hiểu',
  van_dung: 'Vận dụng',
};

const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'Trắc nghiệm',
  true_false: 'Đúng / Sai',
  short_answer: 'Trả lời ngắn',
  essay: 'Tự luận',
};

function makeEmptyQuestion(idx: number): ReferenceQuestionItem {
  return {
    id: `ref_manual_${Date.now().toString(36)}_${idx}`,
    type: 'mcq',
    topicTag: 'Kiến thức trọng tâm',
    difficulty: 'thong_hieu',
    prompt: '',
    options: ['', '', '', ''],
    correctOption: 0,
    explanation: '',
  };
}

export function ReferenceBankView({
  teacherId,
  materials,
  exams,
}: ReferenceBankViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');

  // Selected material detail / editor state
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(
    materials[0]?.id ?? null
  );
  const [editingMeta, setEditingMeta] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftTopic, setDraftTopic] = useState('');
  const [draftGrade, setDraftGrade] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftItems, setDraftItems] = useState<ReferenceQuestionItem[]>([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [previewSummaryMath, setPreviewSummaryMath] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [generatingMissingExplanations, setGeneratingMissingExplanations] = useState(false);

  // Confirm delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Import / Create Modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'word' | 'pdf' | 'exam' | 'manual'>('word');
  const [impTitle, setImpTitle] = useState('');
  const [impSubject, setImpSubject] = useState('Vật lí');
  const [impTopic, setImpTopic] = useState('');
  const [impGrade, setImpGrade] = useState('Lớp 12');
  const [impSourceFile, setImpSourceFile] = useState('');
  const [impSummary, setImpSummary] = useState('');
  const [impItems, setImpItems] = useState<ReferenceQuestionItem[]>([]);
  const [impActiveForAi, setImpActiveForAi] = useState(true);
  const [impAnnotatedText, setImpAnnotatedText] = useState('');
  const [impParsingWord, setImpParsingWord] = useState(false);
  const [impAiExtracting, setImpAiExtracting] = useState(false);
  const [impParseMeta, setImpParseMeta] = useState<string | null>(null);
  const [impWarnings, setImpWarnings] = useState<string[]>([]);
  const [impError, setImpError] = useState<string | null>(null);
  const [impSaving, setImpSaving] = useState(false);
  const [selectedSourceExamId, setSelectedSourceExamId] = useState('');

  // PDF textbook import states
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfSizeMb, setPdfSizeMb] = useState(0);
  const [pdfStartPage, setPdfStartPage] = useState(1);
  const [pdfEndPage, setPdfEndPage] = useState(1);
  const [pdfInspecting, setPdfInspecting] = useState(false);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfProgressText, setPdfProgressText] = useState<string | null>(null);
  const [pdfGenTheoryPractice, setPdfGenTheoryPractice] = useState(true);
  const pdfCancelRef = useRef(false);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    materials.forEach((m) => {
      if (m.subject.trim()) set.add(m.subject.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [materials]);

  const filteredMaterials = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return materials.filter((m) => {
      if (subjectFilter !== 'all' && m.subject.trim() !== subjectFilter) {
        return false;
      }
      if (statusFilter === 'active' && !m.isActiveForAi) return false;
      if (statusFilter === 'paused' && m.isActiveForAi) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.topic.toLowerCase().includes(q) ||
        m.sourceFileName.toLowerCase().includes(q)
      );
    });
  }, [materials, searchTerm, subjectFilter, statusFilter]);

  const activeMaterialsCount = useMemo(
    () => materials.filter((m) => m.isActiveForAi).length,
    [materials]
  );

  const activeItemsCount = useMemo(
    () =>
      materials
        .filter((m) => m.isActiveForAi)
        .reduce((sum, m) => sum + (m.itemCount || m.items?.length || 0), 0),
    [materials]
  );

  const selectedMaterial = useMemo(
    () => materials.find((m) => m.id === selectedMaterialId) || null,
    [materials, selectedMaterialId]
  );

  const openMaterialForEdit = (mat: ReferenceMaterial) => {
    setSelectedMaterialId(mat.id);
    setDraftTitle(mat.title);
    setDraftSubject(mat.subject);
    setDraftTopic(mat.topic);
    setDraftGrade(mat.grade);
    setDraftSummary(mat.knowledgeSummary || '');
    setDraftItems((mat.items || []).map((it) => ({ ...it })));
    setEditingMeta(true);
    setEditingItemId(null);
    setEditError(null);
    setEditNotice(null);
  };

  const resetImportModal = () => {
    setImportMode('word');
    setImpTitle('');
    setImpSubject('Vật lí');
    setImpTopic('');
    setImpGrade('Lớp 12');
    setImpSourceFile('');
    setImpSummary('');
    setImpItems([]);
    setImpActiveForAi(true);
    setImpAnnotatedText('');
    setImpParseMeta(null);
    setImpWarnings([]);
    setImpError(null);
    setSelectedSourceExamId('');
    setPdfFile(null);
    setPdfPageCount(0);
    setPdfSizeMb(0);
    setPdfStartPage(1);
    setPdfEndPage(1);
    setPdfInspecting(false);
    setPdfExtracting(false);
    setPdfProgressText(null);
    setPdfGenTheoryPractice(true);
    pdfCancelRef.current = false;
  };

  const handleOpenImportModal = () => {
    resetImportModal();
    setShowImportModal(true);
  };

  const handleUploadWordFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImpError(null);
    setImpWarnings([]);
    setImpParseMeta(null);
    setImpParsingWord(true);
    try {
      const parsed = await parseDocxForReferenceBank(file);
      const convertedItems = parsed.questions.map((q, idx) =>
        examQuestionToReferenceItem(q, idx, parsed.title)
      );

      setImpSourceFile(file.name);
      setImpTitle(parsed.title || file.name.replace(/\.docx$/i, ''));
      setImpSubject(parsed.subject || 'Vật lí');
      if (!impTopic.trim()) {
        setImpTopic(parsed.title || '');
      }
      setImpSummary(parsed.introKnowledgeText || '');
      setImpItems(convertedItems);
      setImpAnnotatedText(parsed.annotatedTextForAi || parsed.plainFullText || '');
      setImpWarnings(parsed.warnings || []);

      if (convertedItems.length > 0) {
        setImpParseMeta(
          `Đã tách tự động ${convertedItems.length} câu hỏi chuẩn từ Word (${parsed.underlineAnswerCount} câu đọc gạch chân, ${parsed.bottomAnswerCount} câu từ bảng đáp án).`
        );
      } else {
        setImpParseMeta(
          'File Word này chủ yếu là văn bản lý thuyết/công thức (chưa chia mục "Câu 1:"). Bạn có thể lưu trực tiếp phần tóm tắt hoặc bấm nút "Dùng AI tách câu hỏi & rút trích công thức" bên dưới.'
        );
      }
    } catch (err) {
      setImpError(
        err instanceof Error
          ? err.message
          : 'Không thể đọc tệp Word (.docx). Vui lòng kiểm tra định dạng tệp.'
      );
    } finally {
      setImpParsingWord(false);
      e.target.value = '';
    }
  };

  const handleAiNormalizeWord = async () => {
    if (!impAnnotatedText.trim()) {
      setImpError('Vui lòng tải tệp Word (.docx) trước khi dùng AI chuẩn hoá.');
      return;
    }
    setImpError(null);
    setImpAiExtracting(true);
    try {
      const res = await parseReferenceWordWithAi({
        annotatedText: impAnnotatedText,
        subjectHint: impSubject,
        titleHint: impTitle,
      });
      if (res.title) setImpTitle(res.title);
      if (res.subject) setImpSubject(res.subject);
      if (res.topic) setImpTopic(res.topic);
      if (res.grade) setImpGrade(res.grade);
      if (res.knowledgeSummary) setImpSummary(res.knowledgeSummary);
      if (res.items.length > 0) {
        setImpItems(res.items);
      }
      setImpParseMeta(
        `AI đã chuẩn hoá xong: rút trích tóm tắt công thức trọng tâm và ${res.items.length} câu hỏi mẫu kèm đáp án & lời giải.`
      );
    } catch (err) {
      setImpError(
        err instanceof Error ? err.message : 'Lỗi khi nhờ AI chuẩn hoá file Word.'
      );
    } finally {
      setImpAiExtracting(false);
    }
  };

  const handleSelectPdfFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImpError(null);
    setImpWarnings([]);
    setImpParseMeta(null);
    setPdfInspecting(true);
    try {
      const info = await inspectPdfFile(file);
      setPdfFile(file);
      setPdfPageCount(info.pageCount);
      setPdfSizeMb(info.fileSizeMb);
      setPdfStartPage(1);
      setPdfEndPage(Math.min(info.pageCount, 12));
      setImpSourceFile(file.name);
      if (!impTitle.trim()) {
        setImpTitle(file.name.replace(/\.pdf$/i, ''));
      }
      if (info.pageCount > 12) {
        setImpWarnings([
          `Sách PDF có ${info.pageCount} trang. Mặc định chọn trước trang 1–12 để trích xuất nhanh; Thầy/Cô có thể đổi khoảng trang theo từng chương/bài muốn nạp.`,
        ]);
      }
    } catch (err) {
      setImpError(
        err instanceof Error
          ? err.message
          : 'Không thể đọc thông tin tệp PDF. Vui lòng kiểm tra lại.'
      );
      setPdfFile(null);
      setPdfPageCount(0);
    } finally {
      setPdfInspecting(false);
      e.target.value = '';
    }
  };

  const handleExtractPdfWithAi = async () => {
    if (!pdfFile || pdfPageCount === 0) {
      setImpError('Vui lòng chọn tệp sách PDF trước.');
      return;
    }
    const safeStart = Math.max(1, Math.min(pdfStartPage, pdfPageCount));
    const safeEnd = Math.max(safeStart, Math.min(pdfEndPage, pdfPageCount));
    const selectedSpan = safeEnd - safeStart + 1;
    if (selectedSpan > 60) {
      setImpError(
        `Bạn đang chọn ${selectedSpan} trang một lúc. Vui lòng chọn tối đa 60 trang mỗi lượt (hoặc tách theo từng chương) để AI trích xuất chính xác và không bị quá tải.`
      );
      return;
    }

    setImpError(null);
    setImpWarnings([]);
    setPdfExtracting(true);
    pdfCancelRef.current = false;
    setPdfProgressText(`Đang tách trang ${safeStart}–${safeEnd} từ sách PDF...`);

    try {
      const chunks = await slicePdfPagesToBase64Chunks(
        pdfFile,
        safeStart,
        safeEnd,
        6
      );
      const summaryParts: string[] = [];
      const collectedItems: ReferenceQuestionItem[] = [];
      const seenPrompts = new Set<string>();
      let detectedTitle = impTitle.trim();
      let detectedSubject = impSubject.trim();
      let detectedTopic = impTopic.trim();
      let detectedGrade = impGrade.trim();

      for (let i = 0; i < chunks.length; i++) {
        if (pdfCancelRef.current) {
          setImpWarnings([
            `Đã dừng trích xuất sau ${i}/${chunks.length} phần. Dữ liệu đã đọc tới hiện tại vẫn được giữ lại bên dưới.`,
          ]);
          break;
        }
        const chunk = chunks[i];
        setPdfProgressText(
          `AI đang đọc sách PDF: trang ${chunk.startPage}–${chunk.endPage} (lượt ${i + 1}/${chunks.length})...`
        );

        const res = await parseReferencePdfChunkWithAi({
          pdfBase64: chunk.base64,
          startPage: chunk.startPage,
          endPage: chunk.endPage,
          subjectHint: detectedSubject || impSubject,
          titleHint: detectedTitle || pdfFile.name.replace(/\.pdf$/i, ''),
          generatePracticeIfTheoryOnly: pdfGenTheoryPractice,
        });

        if (i === 0) {
          if (!detectedTitle && res.title) detectedTitle = res.title;
          if (res.subject) detectedSubject = res.subject;
          if (!detectedTopic && res.topic) detectedTopic = res.topic;
          if (res.grade) detectedGrade = res.grade;
        }
        if (res.knowledgeSummary.trim()) {
          summaryParts.push(
            chunks.length > 1
              ? `[Trang ${chunk.startPage}–${chunk.endPage}]\n${res.knowledgeSummary.trim()}`
              : res.knowledgeSummary.trim()
          );
        }
        for (const it of res.items) {
          const normKey = it.prompt.trim().toLowerCase().slice(0, 90);
          if (normKey && !seenPrompts.has(normKey)) {
            seenPrompts.add(normKey);
            collectedItems.push(it);
          }
        }
      }

      if (detectedTitle) setImpTitle(detectedTitle);
      if (detectedSubject) setImpSubject(detectedSubject);
      if (detectedTopic) setImpTopic(detectedTopic);
      if (detectedGrade) setImpGrade(detectedGrade);

      const mergedSummary = summaryParts.join('\n\n').slice(0, 8000);
      if (mergedSummary) {
        setImpSummary(mergedSummary);
      }
      if (collectedItems.length > 0) {
        setImpItems(collectedItems);
      }

      setImpSourceFile(`${pdfFile.name} (tr. ${safeStart}–${safeEnd})`);
      setImpParseMeta(
        `AI đã đọc xong trang ${safeStart}–${safeEnd} sách PDF: trích xuất phần kiến thức trọng tâm và ${collectedItems.length} câu hỏi chuẩn kèm lời giải.`
      );
    } catch (err) {
      setImpError(
        err instanceof Error
          ? err.message
          : 'Không thể trích xuất dữ liệu từ sách PDF.'
      );
    } finally {
      setPdfExtracting(false);
      setPdfProgressText(null);
    }
  };

  const handleImportFromExam = (examId: string) => {
    setSelectedSourceExamId(examId);
    const found = exams.find((ex) => ex.id === examId);
    if (!found) return;
    setImpError(null);
    setImpTitle(`Kho chuẩn từ đề: ${found.title}`);
    setImpSubject(found.subject || 'Vật lí');
    setImpTopic(found.title);
    setImpSourceFile(`Đề có sẵn (${found.examCode})`);
    setImpItems(
      (found.questions || []).map((q, idx) =>
        examQuestionToReferenceItem(q, idx, found.title)
      )
    );
    setImpParseMeta(
      `Đã lấy ${found.questions.length} câu hỏi từ đề "${found.title}". Hãy kiểm tra/chỉnh sửa trước khi lưu.`
    );
  };

  const handleSaveNewMaterial = async () => {
    if (!impTitle.trim()) {
      setImpError('Vui lòng nhập tiêu đề cho bộ dữ liệu chuẩn.');
      return;
    }
    if (!impSubject.trim()) {
      setImpError('Vui lòng nhập môn học.');
      return;
    }
    const validItems = impItems.filter((it) => it.prompt.trim().length > 0);
    if (!impSummary.trim() && validItems.length === 0) {
      setImpError(
        'Vui lòng nạp nội dung từ file Word, chọn đề có sẵn, hoặc nhập ít nhất 1 câu hỏi / phần kiến thức chuẩn.'
      );
      return;
    }

    setImpError(null);
    setImpSaving(true);
    try {
      const createdList = await createReferenceMaterialsChunked({
        teacherId,
        title: impTitle.trim(),
        subject: impSubject.trim(),
        topic: impTopic.trim(),
        grade: impGrade.trim() || 'THPT',
        sourceFileName: impSourceFile.trim(),
        knowledgeSummary: impSummary.trim(),
        items: validItems,
        isActiveForAi: impActiveForAi,
      });
      setShowImportModal(false);
      if (createdList[0]) {
        setSelectedMaterialId(createdList[0].id);
        setEditingMeta(false);
      }
    } catch (err) {
      setImpError(extractFriendlyFirestoreError(err));
    } finally {
      setImpSaving(false);
    }
  };

  const handleToggleActive = async (mat: ReferenceMaterial) => {
    setTogglingId(mat.id);
    try {
      await updateReferenceMaterial(mat.id, {
        isActiveForAi: !mat.isActiveForAi,
      });
    } catch (err) {
      setEditError(extractFriendlyFirestoreError(err));
    } finally {
      setTogglingId(null);
    }
  };

  const handleSaveMaterialChanges = async () => {
    if (!selectedMaterial) return;
    if (!draftTitle.trim() || !draftSubject.trim()) {
      setEditError('Tiêu đề và môn học không được để trống.');
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    setEditNotice(null);
    try {
      await updateReferenceMaterial(selectedMaterial.id, {
        title: draftTitle.trim(),
        subject: draftSubject.trim(),
        topic: draftTopic.trim(),
        grade: draftGrade.trim(),
        knowledgeSummary: draftSummary.trim(),
        items: draftItems,
      });
      setEditingMeta(false);
      setEditingItemId(null);
      setEditNotice('Đã lưu thay đổi vào Firestore.');
    } catch (err) {
      setEditError(extractFriendlyFirestoreError(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleFillMissingExplanations = async () => {
    if (!selectedMaterial) return;
    const sourceItems = editingMeta ? draftItems : selectedMaterial.items;
    const missing = sourceItems.filter((it) => !it.explanation.trim());
    if (missing.length === 0) {
      setEditNotice('Tất cả câu mẫu trong bộ này đã có lời giải chuẩn.');
      return;
    }

    setGeneratingMissingExplanations(true);
    setEditError(null);
    try {
      const res = await generateExplanationsWithAi({
        subject: editingMeta ? draftSubject : selectedMaterial.subject,
        title: editingMeta ? draftTitle : selectedMaterial.title,
        overwriteAll: false,
        questions: missing.map((it, idx) => ({
          id: it.id,
          index: idx + 1,
          type: it.type,
          prompt: it.prompt,
          options: it.options,
          correctOption: it.correctOption,
          statements: it.statements,
          correctAnswer: it.correctAnswer,
          explanation: it.explanation,
        })),
      });
      const expMap = new Map(res.explanations.map((e) => [e.id, e.explanation]));
      const merged = sourceItems.map((it) =>
        expMap.has(it.id) ? { ...it, explanation: expMap.get(it.id)! } : it
      );
      if (editingMeta) {
        setDraftItems(merged);
      } else {
        await updateReferenceMaterial(selectedMaterial.id, { items: merged });
      }
      setEditNotice(`Đã bổ sung lời giải chuẩn cho ${res.explanations.length} câu.`);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Không thể tạo lời giải AI.'
      );
    } finally {
      setGeneratingMissingExplanations(false);
    }
  };

  const handleConfirmDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteReferenceMaterial(id);
      setConfirmDeleteId(null);
      if (selectedMaterialId === id) {
        const remaining = materials.filter((m) => m.id !== id);
        setSelectedMaterialId(remaining[0]?.id ?? null);
        setEditingMeta(false);
      }
    } catch (err) {
      setEditError(extractFriendlyFirestoreError(err));
    } finally {
      setDeletingId(null);
    }
  };

  const activeViewItems = editingMeta
    ? draftItems
    : selectedMaterial?.items || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A630D]">
            Dữ liệu tham chiếu trên Cloud Firestore
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#0D221D]">
            Kho dữ liệu chuẩn cho AI
          </h1>
          <p className="text-sm text-[#4A615A] max-w-2xl leading-relaxed">
            Nạp ngân hàng câu hỏi, công thức và lời giải mẫu từ file Word (.docx) hoặc sách/tài liệu
            PDF (.pdf). AI sẽ tự động lấy dữ liệu chuẩn tại đây làm căn cứ khi tạo đề tự luyện cho
            học sinh và soạn đề mới.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenImportModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          <Plus className="w-4 h-4 text-[#E5C665]" />
          <span>Nạp dữ liệu chuẩn</span>
        </button>
      </div>

      {/* 3 KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-[#597169]">Bộ tài liệu đã nạp</div>
            <div className="font-serif text-2xl font-semibold text-[#0D221D] mt-1 tabular-nums">
              {materials.length}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#EFF7F3] border border-[#DCECE4] text-[#0F4C3F] flex items-center justify-center">
            <BookMarked className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-[#597169]">Câu chuẩn đang bật cho AI</div>
            <div className="font-serif text-2xl font-semibold text-[#0F4C3F] mt-1 tabular-nums">
              {activeItemsCount} câu
            </div>
            <div className="text-[11px] text-[#597169] mt-0.5 tabular-nums">
              Từ {activeMaterialsCount}/{materials.length} bộ đang kích hoạt
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-[#597169]">Phạm vi môn học</div>
            <div className="font-serif text-2xl font-semibold text-[#0D221D] mt-1 tabular-nums">
              {subjects.length || 0} môn
            </div>
            <div className="text-[11px] text-[#597169] mt-0.5 truncate max-w-[180px]">
              {subjects.length > 0 ? subjects.join(', ') : 'Chưa có dữ liệu'}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#EFF7F3] border border-[#DCECE4] text-[#0F4C3F] flex items-center justify-center">
            <FolderOpen className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-[#DAE5E0] rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#597169] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên bộ câu hỏi, chuyên đề, file Word..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#CEDCD6] bg-[#FAFBFB] text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
          >
            <option value="all">Tất cả môn học</option>
            {subjects.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>

          <div className="inline-flex p-1 rounded-xl bg-[#E6EEEA] gap-1 text-xs">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'active', label: 'Đang bật AI' },
                { id: 'paused', label: 'Tạm tắt' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white text-[#0F4C3F] font-semibold shadow-xs'
                    : 'text-[#4A615A] hover:text-[#0D221D]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Empty State or Master-Detail Grid */}
      {materials.length === 0 ? (
        <div className="bg-white border border-dashed border-[#C5DDD3] rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#EFF7F3] border border-[#C5DDD3] text-[#0F4C3F] flex items-center justify-center mx-auto">
            <Upload className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 max-w-lg mx-auto">
            <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
              Chưa có bộ dữ liệu chuẩn nào trong kho
            </h2>
            <p className="text-sm text-[#4A615A] leading-relaxed">
              Hãy tải lên file Word (.docx), sách giáo khoa/tài liệu PDF (.pdf) hoặc lấy từ đề
              chuẩn sẵn có. AI sẽ bám sát tài liệu này khi tạo bài ôn tập cho học sinh.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleOpenImportModal}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] cursor-pointer"
            >
              <Upload className="w-4 h-4 text-[#E5C665]" />
              <span>Nạp file Word / Sách PDF chuẩn</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Master List */}
          <div className="lg:col-span-5 space-y-3">
            {filteredMaterials.length === 0 ? (
              <div className="bg-white border border-[#DAE5E0] rounded-2xl p-6 text-center text-sm text-[#597169]">
                Không tìm thấy bộ tài liệu nào khớp bộ lọc.
              </div>
            ) : (
              filteredMaterials.map((mat) => {
                const isSelected = selectedMaterial?.id === mat.id;
                const itemLen = mat.itemCount || mat.items?.length || 0;
                return (
                  <div
                    key={mat.id}
                    className={`rounded-2xl border p-4 transition-colors space-y-3 ${
                      isSelected
                        ? 'bg-[#EFF7F3]/75 border-[#0F4C3F] ring-1 ring-[#C89B2B]/35'
                        : 'bg-white border-[#DAE5E0] hover:border-[#B5CCC2]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMaterialId(mat.id);
                        setEditingMeta(false);
                        setEditingItemId(null);
                        setEditError(null);
                        setEditNotice(null);
                      }}
                      className="w-full text-left space-y-1.5 cursor-pointer"
                    >
                      <div className="font-semibold text-base text-[#0D221D] leading-snug">
                        {mat.title}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#4A615A] tabular-nums">
                        <span>{mat.subject}</span>
                        <span aria-hidden="true">·</span>
                        <span>{mat.grade || 'THPT'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-[#0F4C3F]">
                          {itemLen} câu chuẩn
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            mat.isActiveForAi
                              ? 'text-[#0F6D4F] font-semibold'
                              : 'text-[#6E857D]'
                          }
                        >
                          {mat.isActiveForAi ? 'Đang bật cho AI' : 'Đang tạm tắt'}
                        </span>
                      </div>
                      {(mat.topic || mat.sourceFileName) && (
                        <div className="text-xs text-[#597169] truncate">
                          {mat.topic ? `Chuyên đề: ${mat.topic}` : ''}
                          {mat.topic && mat.sourceFileName ? ' · ' : ''}
                          {mat.sourceFileName ? `Nguồn: ${mat.sourceFileName}` : ''}
                        </div>
                      )}
                    </button>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E6EEEA] text-xs">
                      <button
                        type="button"
                        disabled={togglingId === mat.id}
                        onClick={() => void handleToggleActive(mat)}
                        className="inline-flex items-center gap-1.5 font-medium text-[#0F4C3F] hover:text-[#0A362C] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                      >
                        {mat.isActiveForAi ? (
                          <ToggleRight className="w-4 h-4 text-[#0F6D4F]" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-[#7D928B]" />
                        )}
                        <span>{mat.isActiveForAi ? 'Tắt dùng AI' : 'Bật dùng AI'}</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openMaterialForEdit(mat)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#CEDCD6] bg-white text-[#0D221D] font-medium hover:bg-[#F8FAF9] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Sửa</span>
                        </button>

                        {confirmDeleteId === mat.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={deletingId === mat.id}
                              onClick={() => void handleConfirmDelete(mat.id)}
                              className="px-2 py-1 rounded-lg bg-[#B91C1C] text-white font-semibold hover:bg-[#991B1B] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {deletingId === mat.id ? 'Đang xoá...' : 'Xác nhận xoá'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded-lg border border-[#CEDCD6] bg-white text-[#4A615A] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Huỷ
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(mat.id)}
                            className="p-1.5 rounded-lg text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                            title="Xoá bộ dữ liệu này"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Detail / Editor Panel */}
          <div className="lg:col-span-7 bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-5">
            {!selectedMaterial ? (
              <div className="py-12 text-center text-sm text-[#597169]">
                Chọn một bộ tài liệu bên trái để xem công thức trọng tâm và danh sách câu chuẩn.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#EBF1EE]">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[#8A630D]">
                      {selectedMaterial.subject} · {selectedMaterial.grade || 'THPT'}
                    </div>
                    <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
                      {editingMeta ? draftTitle || selectedMaterial.title : selectedMaterial.title}
                    </h2>
                    {selectedMaterial.sourceFileName && (
                      <div className="text-xs text-[#597169]">
                        Tệp nguồn: {selectedMaterial.sourceFileName}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={generatingMissingExplanations}
                      onClick={() => void handleFillMissingExplanations()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] text-xs font-semibold text-[#8A630D] hover:bg-[#FAF0D2] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {generatingMissingExplanations ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>AI điền lời giải còn thiếu</span>
                    </button>

                    {!editingMeta ? (
                      <button
                        type="button"
                        onClick={() => openMaterialForEdit(selectedMaterial)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#E5C665]" />
                        <span>Chỉnh sửa kho này</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMeta(false);
                            setEditingItemId(null);
                          }}
                          className="px-3 py-1.5 rounded-xl border border-[#CEDCD6] text-xs font-medium text-[#4A615A] hover:bg-[#F8FAF9] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Huỷ
                        </button>
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => void handleSaveMaterialChanges()}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {savingEdit ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5 text-[#E5C665]" />
                          )}
                          <span>Lưu vào Firestore</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {editError && (
                  <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{editError}</span>
                  </div>
                )}

                {editNotice && (
                  <div className="p-3 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] text-xs text-[#0F6D4F] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{editNotice}</span>
                  </div>
                )}

                {/* Metadata & Knowledge Summary Editor / Preview */}
                {editingMeta ? (
                  <div className="space-y-3 p-4 rounded-xl bg-[#F8FAF9] border border-[#E6EEEA]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <label className="space-y-1">
                        <span className="font-semibold text-[#3A524A]">Tiêu đề bộ tài liệu</span>
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-[#3A524A]">Môn học</span>
                        <input
                          type="text"
                          value={draftSubject}
                          onChange={(e) => setDraftSubject(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-[#3A524A]">Chuyên đề trọng tâm</span>
                        <input
                          type="text"
                          value={draftTopic}
                          onChange={(e) => setDraftTopic(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-[#3A524A]">Khối lớp</span>
                        <input
                          type="text"
                          value={draftGrade}
                          onChange={(e) => setDraftGrade(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                        />
                      </label>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#3A524A]">
                          Tóm tắt lý thuyết, công thức &amp; quy tắc chuẩn (LaTeX $...$)
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewSummaryMath((v) => !v)}
                          className="inline-flex items-center gap-1 text-[#0F4C3F] font-medium hover:underline cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{previewSummaryMath ? 'Sửa văn bản' : 'Xem trước công thức'}</span>
                        </button>
                      </div>
                      {previewSummaryMath ? (
                        <div className="p-3 rounded-lg border border-[#CEDCD6] bg-white text-sm">
                          <MathText
                            text={draftSummary || '(Chưa có phần tóm tắt lý thuyết)'}
                            className="whitespace-pre-line leading-relaxed"
                          />
                        </div>
                      ) : (
                        <textarea
                          rows={5}
                          value={draftSummary}
                          onChange={(e) => setDraftSummary(e.target.value)}
                          placeholder="Ghi các công thức quan trọng, đơn vị chuẩn, điều kiện áp dụng, hoặc lỗi sai học sinh hay mắc..."
                          className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm text-[#0D221D] leading-relaxed"
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  selectedMaterial.knowledgeSummary && (
                    <div className="p-4 rounded-xl bg-[#FDF8EB]/70 border border-[#EAD8A6] space-y-1.5">
                      <div className="text-xs font-semibold uppercase tracking-wider text-[#8A630D]">
                        Kiến thức &amp; công thức chuẩn AI sẽ tham chiếu
                      </div>
                      <MathText
                        text={selectedMaterial.knowledgeSummary}
                        className="text-sm text-[#0D221D] whitespace-pre-line leading-relaxed"
                      />
                    </div>
                  )
                )}

                {/* Items List */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif text-base font-semibold text-[#0D221D]">
                      Câu hỏi mẫu chuẩn ({activeViewItems.length})
                    </h3>
                    {editingMeta && activeViewItems.length < 80 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = makeEmptyQuestion(draftItems.length + 1);
                          setDraftItems((prev) => [...prev, next]);
                          setEditingItemId(next.id);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-[#0F4C3F] text-xs font-semibold text-[#0F4C3F] hover:bg-[#EFF7F3] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Thêm câu mẫu</span>
                      </button>
                    )}
                  </div>

                  {activeViewItems.length === 0 ? (
                    <div className="p-6 rounded-xl bg-[#F8FAF9] border border-[#E6EEEA] text-center text-xs text-[#597169]">
                      Bộ tài liệu này chỉ chứa phần tóm tắt lý thuyết/công thức (0 câu hỏi mẫu).
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
                      {activeViewItems.map((item, idx) => {
                        const isItemEditing = editingMeta && editingItemId === item.id;
                        return (
                          <div
                            key={item.id}
                            className="p-4 rounded-xl border border-[#DAE5E0] bg-[#FAFBFB] space-y-2.5 text-sm"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4A615A]">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-[#0F4C3F]">
                                  Câu {idx + 1}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{TYPE_LABEL[item.type]}</span>
                                <span aria-hidden="true">·</span>
                                <span>{DIFFICULTY_LABEL[item.difficulty]}</span>
                                {item.topicTag && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-[#8A630D] font-medium">
                                      {item.topicTag}
                                    </span>
                                  </>
                                )}
                              </div>

                              {editingMeta && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingItemId(isItemEditing ? null : item.id)
                                    }
                                    className="text-xs font-semibold text-[#0F4C3F] hover:underline cursor-pointer"
                                  >
                                    {isItemEditing ? 'Thu gọn' : 'Sửa câu này'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraftItems((prev) =>
                                        prev.filter((x) => x.id !== item.id)
                                      )
                                    }
                                    className="text-xs text-[#B91C1C] hover:underline cursor-pointer"
                                  >
                                    Xoá
                                  </button>
                                </div>
                              )}
                            </div>

                            {isItemEditing ? (
                              <div className="space-y-3 pt-2 border-t border-[#E6EEEA] text-xs">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  <label className="space-y-1">
                                    <span className="font-semibold text-[#3A524A]">Dạng câu</span>
                                    <select
                                      value={item.type}
                                      onChange={(e) => {
                                        const nextType = e.target.value as QuestionType;
                                        setDraftItems((prev) =>
                                          prev.map((x) =>
                                            x.id === item.id
                                              ? {
                                                  ...x,
                                                  type: nextType,
                                                  options:
                                                    nextType === 'mcq'
                                                      ? x.options || ['', '', '', '']
                                                      : undefined,
                                                  correctOption:
                                                    nextType === 'mcq'
                                                      ? x.correctOption ?? 0
                                                      : undefined,
                                                  statements:
                                                    nextType === 'true_false'
                                                      ? x.statements || [
                                                          { text: '', isTrue: true },
                                                          { text: '', isTrue: false },
                                                          { text: '', isTrue: true },
                                                          { text: '', isTrue: false },
                                                        ]
                                                      : undefined,
                                                  correctAnswer:
                                                    nextType === 'short_answer' ||
                                                    nextType === 'essay'
                                                      ? x.correctAnswer || ''
                                                      : undefined,
                                                }
                                              : x
                                          )
                                        );
                                      }}
                                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white"
                                    >
                                      <option value="mcq">Trắc nghiệm</option>
                                      <option value="true_false">Đúng / Sai</option>
                                      <option value="short_answer">Trả lời ngắn</option>
                                      <option value="essay">Tự luận</option>
                                    </select>
                                  </label>

                                  <label className="space-y-1">
                                    <span className="font-semibold text-[#3A524A]">Mức độ</span>
                                    <select
                                      value={item.difficulty}
                                      onChange={(e) => {
                                        const val = e.target.value as ReferenceDifficulty;
                                        setDraftItems((prev) =>
                                          prev.map((x) =>
                                            x.id === item.id ? { ...x, difficulty: val } : x
                                          )
                                        );
                                      }}
                                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white"
                                    >
                                      <option value="nhan_biet">Nhận biết</option>
                                      <option value="thong_hieu">Thông hiểu</option>
                                      <option value="van_dung">Vận dụng</option>
                                    </select>
                                  </label>

                                  <label className="space-y-1">
                                    <span className="font-semibold text-[#3A524A]">
                                      Tag chuyên đề
                                    </span>
                                    <input
                                      type="text"
                                      value={item.topicTag}
                                      onChange={(e) =>
                                        setDraftItems((prev) =>
                                          prev.map((x) =>
                                            x.id === item.id
                                              ? { ...x, topicTag: e.target.value }
                                              : x
                                          )
                                        )
                                      }
                                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white"
                                    />
                                  </label>
                                </div>

                                <label className="block space-y-1">
                                  <span className="font-semibold text-[#3A524A]">Nội dung câu hỏi</span>
                                  <textarea
                                    rows={3}
                                    value={item.prompt}
                                    onChange={(e) =>
                                      setDraftItems((prev) =>
                                        prev.map((x) =>
                                          x.id === item.id ? { ...x, prompt: e.target.value } : x
                                        )
                                      )
                                    }
                                    className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm"
                                  />
                                </label>

                                {item.type === 'mcq' && (
                                  <div className="space-y-1.5">
                                    <span className="font-semibold text-[#3A524A]">
                                      Phương án &amp; Đáp án đúng
                                    </span>
                                    {[0, 1, 2, 3].map((optIdx) => (
                                      <div key={optIdx} className="flex items-center gap-2">
                                        <input
                                          type="radio"
                                          name={`correct_${item.id}`}
                                          checked={(item.correctOption ?? 0) === optIdx}
                                          onChange={() =>
                                            setDraftItems((prev) =>
                                              prev.map((x) =>
                                                x.id === item.id
                                                  ? { ...x, correctOption: optIdx }
                                                  : x
                                              )
                                            )
                                          }
                                        />
                                        <span className="font-mono font-bold w-5">
                                          {OPTION_LETTERS[optIdx]}.
                                        </span>
                                        <input
                                          type="text"
                                          value={item.options?.[optIdx] || ''}
                                          onChange={(e) =>
                                            setDraftItems((prev) =>
                                              prev.map((x) => {
                                                if (x.id !== item.id) return x;
                                                const opts = [...(x.options || ['', '', '', ''])];
                                                opts[optIdx] = e.target.value;
                                                return { ...x, options: opts };
                                              })
                                            )
                                          }
                                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {item.type === 'true_false' && (
                                  <div className="space-y-1.5">
                                    <span className="font-semibold text-[#3A524A]">4 Mệnh đề</span>
                                    {[0, 1, 2, 3].map((sIdx) => {
                                      const st = item.statements?.[sIdx] || {
                                        text: '',
                                        isTrue: false,
                                      };
                                      return (
                                        <div key={sIdx} className="flex items-center gap-2">
                                          <span className="font-mono font-bold w-5">
                                            {TF_LETTERS[sIdx]})
                                          </span>
                                          <input
                                            type="text"
                                            value={st.text}
                                            onChange={(e) =>
                                              setDraftItems((prev) =>
                                                prev.map((x) => {
                                                  if (x.id !== item.id) return x;
                                                  const sts = [
                                                    ...(x.statements || [
                                                      { text: '', isTrue: true },
                                                      { text: '', isTrue: false },
                                                      { text: '', isTrue: true },
                                                      { text: '', isTrue: false },
                                                    ]),
                                                  ];
                                                  sts[sIdx] = {
                                                    ...sts[sIdx],
                                                    text: e.target.value,
                                                  };
                                                  return { ...x, statements: sts };
                                                })
                                              )
                                            }
                                            className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white"
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setDraftItems((prev) =>
                                                prev.map((x) => {
                                                  if (x.id !== item.id) return x;
                                                  const sts = [...(x.statements || [])];
                                                  sts[sIdx] = {
                                                    ...sts[sIdx],
                                                    isTrue: !sts[sIdx].isTrue,
                                                  };
                                                  return { ...x, statements: sts };
                                                })
                                              )
                                            }
                                            className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                                              st.isTrue
                                                ? 'bg-[#EFF7F3] text-[#0F6D4F] border border-[#C5DDD3]'
                                                : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]'
                                            }`}
                                          >
                                            {st.isTrue ? 'Đúng' : 'Sai'}
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {(item.type === 'short_answer' || item.type === 'essay') && (
                                  <label className="block space-y-1">
                                    <span className="font-semibold text-[#3A524A]">
                                      {item.type === 'short_answer'
                                        ? 'Đáp số chuẩn (tối đa 4 ký tự)'
                                        : 'Đáp án / ý chính barem'}
                                    </span>
                                    <input
                                      type="text"
                                      value={item.correctAnswer || ''}
                                      onChange={(e) =>
                                        setDraftItems((prev) =>
                                          prev.map((x) =>
                                            x.id === item.id
                                              ? { ...x, correctAnswer: e.target.value }
                                              : x
                                          )
                                        )
                                      }
                                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white"
                                    />
                                  </label>
                                )}

                                <label className="block space-y-1">
                                  <span className="font-semibold text-[#3A524A]">
                                    Hướng dẫn giải chuẩn (AI sẽ học theo cách giải này)
                                  </span>
                                  <textarea
                                    rows={3}
                                    value={item.explanation}
                                    onChange={(e) =>
                                      setDraftItems((prev) =>
                                        prev.map((x) =>
                                          x.id === item.id
                                            ? { ...x, explanation: e.target.value }
                                            : x
                                        )
                                      )
                                    }
                                    className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm"
                                  />
                                </label>
                              </div>
                            ) : (
                              <>
                                <MathText
                                  text={item.prompt}
                                  className="text-sm text-[#0D221D] whitespace-pre-line leading-relaxed"
                                />

                                {item.type === 'mcq' && item.options && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                                    {item.options.map((opt, optIdx) => {
                                      const isKey = item.correctOption === optIdx;
                                      return (
                                        <div
                                          key={optIdx}
                                          className={`px-2.5 py-1.5 rounded-lg border flex items-start gap-1.5 ${
                                            isKey
                                              ? 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0A362C] font-semibold'
                                              : 'bg-white border-[#E6EEEA] text-[#4A615A]'
                                          }`}
                                        >
                                          <span className="font-mono shrink-0">
                                            {OPTION_LETTERS[optIdx]}.
                                          </span>
                                          <MathText text={opt} inline />
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {item.type === 'true_false' && item.statements && (
                                  <div className="space-y-1 text-xs">
                                    {item.statements.map((st, sIdx) => (
                                      <div
                                        key={sIdx}
                                        className="flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E6EEEA]"
                                      >
                                        <div className="flex items-start gap-1.5 text-[#0D221D]">
                                          <span className="font-mono font-bold shrink-0">
                                            {TF_LETTERS[sIdx]})
                                          </span>
                                          <MathText text={st.text} inline />
                                        </div>
                                        <span
                                          className={`font-semibold shrink-0 ${
                                            st.isTrue ? 'text-[#0F6D4F]' : 'text-[#B91C1C]'
                                          }`}
                                        >
                                          {st.isTrue ? 'Đúng' : 'Sai'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {item.type === 'short_answer' && item.correctAnswer && (
                                  <div className="text-xs text-[#0F4C3F] font-semibold">
                                    Đáp số:{' '}
                                    <span className="font-mono px-2 py-0.5 rounded bg-[#EFF7F3] border border-[#C5DDD3]">
                                      {item.correctAnswer}
                                    </span>
                                  </div>
                                )}

                                {item.explanation && (
                                  <div className="p-2.5 rounded-lg bg-white border border-[#E6EEEA] text-xs text-[#3A524A]">
                                    <span className="font-semibold text-[#0F6D4F]">
                                      Lời giải chuẩn:{' '}
                                    </span>
                                    <MathText text={item.explanation} inline />
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Import / Create Reference Material Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#DAE5E0] rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 z-10 bg-white px-6 py-4 border-b border-[#EBF1EE] flex items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
                  Nạp dữ liệu chuẩn mới cho AI
                </h2>
                <p className="text-xs text-[#597169]">
                  Dữ liệu được lưu vào Firestore và sử dụng tự động khi AI tạo bài ôn tập cho học sinh.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-2 rounded-lg text-[#597169] hover:bg-[#F3F7F5] cursor-pointer"
                aria-label="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Source Tabs */}
              <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-[#E6EEEA]">
                {(
                  [
                    { id: 'word', label: 'File Word (.docx)', icon: Upload },
                    { id: 'pdf', label: 'Sách / Tài liệu PDF', icon: BookOpen },
                    { id: 'exam', label: 'Từ đề có sẵn', icon: FileText },
                    { id: 'manual', label: 'Soạn thủ công', icon: Edit3 },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = importMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setImportMode(tab.id);
                        setImpError(null);
                      }}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
                        active
                          ? 'bg-white text-[#0F4C3F] shadow-xs'
                          : 'text-[#4A615A] hover:text-[#0D221D]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Word Import Area */}
              {importMode === 'word' && (
                <div className="space-y-3">
                  <label className="block border-2 border-dashed border-[#B5CCC2] hover:border-[#0F4C3F] rounded-2xl p-6 text-center bg-[#F8FAF9] cursor-pointer transition-colors">
                    <input
                      type="file"
                      accept=".docx"
                      className="hidden"
                      onChange={handleUploadWordFile}
                    />
                    {impParsingWord ? (
                      <div className="flex flex-col items-center gap-2 text-[#0F4C3F]">
                        <Loader2 className="w-7 h-7 animate-spin" />
                        <span className="text-sm font-semibold">
                          Đang đọc công thức, bảng đáp án và câu hỏi trong file Word...
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Upload className="w-7 h-7 text-[#0F4C3F] mx-auto" />
                        <div className="text-sm font-semibold text-[#0D221D]">
                          {impSourceFile && importMode === 'word'
                            ? `Đã chọn: ${impSourceFile} (bấm để chọn file khác)`
                            : 'Chọn file Word (.docx) ngân hàng câu hỏi hoặc chuyên đề ôn tập'}
                        </div>
                        <p className="text-xs text-[#597169]">
                          Hỗ trợ tự đọc công thức Equation/OMML thành LaTeX, đáp án gạch chân, bảng đáp án cuối file và lời giải mẫu.
                        </p>
                      </div>
                    )}
                  </label>

                  {impAnnotatedText && (
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6]">
                      <div className="text-xs text-[#7A580B]">
                        Muốn AI tự động tóm tắt công thức, gắn tag chuyên đề và điền lời giải chuẩn cho file Word này?
                      </div>
                      <button
                        type="button"
                        disabled={impAiExtracting}
                        onClick={() => void handleAiNormalizeWord()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {impAiExtracting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>AI đang chuẩn hoá...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-[#E5C665]" />
                            <span>Dùng AI chuẩn hoá &amp; rút công thức</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* PDF Textbook Import Area */}
              {importMode === 'pdf' && (
                <div className="space-y-3">
                  <label className="block border-2 border-dashed border-[#B5CCC2] hover:border-[#0F4C3F] rounded-2xl p-6 text-center bg-[#F8FAF9] cursor-pointer transition-colors">
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={handleSelectPdfFile}
                    />
                    {pdfInspecting ? (
                      <div className="flex flex-col items-center gap-2 text-[#0F4C3F]">
                        <Loader2 className="w-7 h-7 animate-spin" />
                        <span className="text-sm font-semibold">
                          Đang kiểm tra số trang và dung lượng file PDF...
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <BookOpen className="w-7 h-7 text-[#0F4C3F] mx-auto" />
                        <div className="text-sm font-semibold text-[#0D221D]">
                          {pdfFile
                            ? `Đã chọn: ${pdfFile.name} (${pdfPageCount} trang · ${pdfSizeMb} MB)`
                            : 'Chọn file sách PDF (.pdf) — SGK, sách bài tập hoặc đề cương'}
                        </div>
                        <p className="text-xs text-[#597169]">
                          AI đọc trực tiếp cả PDF chữ in lẫn PDF scan hình ảnh, công thức Toán/Lí/Hoá và tự tách kiến thức trọng tâm cùng câu hỏi mẫu.
                        </p>
                      </div>
                    )}
                  </label>

                  {pdfFile && pdfPageCount > 0 && (
                    <div className="p-4 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-[#7A580B]">
                          Chọn khoảng trang muốn trích xuất (tổng {pdfPageCount} trang)
                        </div>
                        {pdfPageCount <= 60 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPdfStartPage(1);
                              setPdfEndPage(pdfPageCount);
                            }}
                            className="text-xs font-semibold text-[#0F4C3F] hover:underline cursor-pointer"
                          >
                            Chọn cả {pdfPageCount} trang
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs items-end">
                        <label className="space-y-1">
                          <span className="font-semibold text-[#3A524A]">Từ trang</span>
                          <input
                            type="number"
                            min={1}
                            max={pdfPageCount}
                            value={pdfStartPage}
                            onChange={(e) => {
                              const v = Math.max(
                                1,
                                Math.min(Number(e.target.value) || 1, pdfPageCount)
                              );
                              setPdfStartPage(v);
                              if (v > pdfEndPage) setPdfEndPage(v);
                            }}
                            className="w-full px-3 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-sm text-[#0D221D] tabular-nums"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="font-semibold text-[#3A524A]">Đến trang</span>
                          <input
                            type="number"
                            min={pdfStartPage}
                            max={pdfPageCount}
                            value={pdfEndPage}
                            onChange={(e) => {
                              const v = Math.max(
                                pdfStartPage,
                                Math.min(Number(e.target.value) || pdfStartPage, pdfPageCount)
                              );
                              setPdfEndPage(v);
                            }}
                            className="w-full px-3 py-1.5 rounded-lg border border-[#CEDCD6] bg-white text-sm text-[#0D221D] tabular-nums"
                          />
                        </label>

                        <div className="col-span-2 flex flex-wrap items-center justify-end gap-2">
                          {pdfExtracting ? (
                            <button
                              type="button"
                              onClick={() => {
                                pdfCancelRef.current = true;
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#B91C1C] bg-white text-[#B91C1C] text-xs font-semibold hover:bg-[#FEF2F2] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Dừng lại</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleExtractPdfWithAi()}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-[#E5C665]" />
                              <span>
                                Đọc &amp; trích xuất trang {pdfStartPage}–{pdfEndPage}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-xs text-[#597169] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pdfGenTheoryPractice}
                          onChange={(e) => setPdfGenTheoryPractice(e.target.checked)}
                        />
                        <span>
                          Nếu trang sách chỉ có lý thuyết/công thức, cho AI tự soạn thêm 3–5 câu mẫu bám sát trang đó
                        </span>
                      </label>

                      {pdfProgressText && (
                        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-[#EAD8A6] text-xs font-medium text-[#0F4C3F]">
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          <span>{pdfProgressText}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Import from Existing Exam */}
              {importMode === 'exam' && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[#3A524A]">
                    Chọn một đề thi đã có trong hệ thống để đưa vào Kho chuẩn
                  </label>
                  <select
                    value={selectedSourceExamId}
                    onChange={(e) => handleImportFromExam(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                  >
                    <option value="">-- Chọn đề thi mẫu --</option>
                    {exams.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.title} ({ex.subject} · {ex.questions.length} câu · Mã {ex.examCode})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {impParseMeta && (
                <div className="p-3 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] text-xs text-[#0F6D4F] flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{impParseMeta}</span>
                </div>
              )}

              {impWarnings.length > 0 && (
                <div className="p-3 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-xs text-[#8A630D] space-y-1">
                  {impWarnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}

              {/* Common Metadata Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="font-semibold text-[#3A524A]">
                    Tên bộ dữ liệu chuẩn *
                  </span>
                  <input
                    type="text"
                    value={impTitle}
                    onChange={(e) => setImpTitle(e.target.value)}
                    placeholder="VD: Chuyên đề Khí lí tưởng - Chuẩn GDPT 2018"
                    className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-[#3A524A]">Môn học *</span>
                  <input
                    type="text"
                    value={impSubject}
                    onChange={(e) => setImpSubject(e.target.value)}
                    placeholder="VD: Vật lí, Toán, Hoá học..."
                    className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-[#3A524A]">Chuyên đề / Chương</span>
                  <input
                    type="text"
                    value={impTopic}
                    onChange={(e) => setImpTopic(e.target.value)}
                    placeholder="VD: Nhiệt học, Định luật Boyle, Phương trình trạng thái"
                    className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-[#3A524A]">Khối lớp</span>
                  <input
                    type="text"
                    value={impGrade}
                    onChange={(e) => setImpGrade(e.target.value)}
                    placeholder="VD: Lớp 12"
                    className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                  />
                </label>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="font-semibold text-[#3A524A]">
                  Tóm tắt lý thuyết, công thức trọng tâm &amp; lưu ý giải chuẩn (tuỳ chọn)
                </span>
                <textarea
                  rows={4}
                  value={impSummary}
                  onChange={(e) => setImpSummary(e.target.value)}
                  placeholder="Các công thức chuẩn (viết LaTeX trong $...$), đơn vị chuẩn và các bẫy hay gặp..."
                  className="w-full px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm text-[#0D221D]"
                />
              </label>

              {/* Quick Preview of Parsed/Manual Questions */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#3A524A]">
                    Danh sách câu hỏi chuẩn ({impItems.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setImpItems((prev) => [
                        ...prev,
                        makeEmptyQuestion(prev.length + 1),
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#0F4C3F] text-xs font-semibold text-[#0F4C3F] hover:bg-[#EFF7F3] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm câu mẫu</span>
                  </button>
                </div>

                {impItems.length > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                    {impItems.map((it, idx) => (
                      <div
                        key={it.id}
                        className="p-3 rounded-xl border border-[#DAE5E0] bg-[#FAFBFB] text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#0F4C3F]">
                            Câu {idx + 1} · {TYPE_LABEL[it.type]}
                            {it.topicTag ? ` · ${it.topicTag}` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setImpItems((prev) => prev.filter((x) => x.id !== it.id))
                            }
                            className="text-[#B91C1C] hover:underline cursor-pointer"
                          >
                            Bỏ câu này
                          </button>
                        </div>
                        {importMode === 'manual' && !it.prompt ? (
                          <input
                            type="text"
                            value={it.prompt}
                            onChange={(e) =>
                              setImpItems((prev) =>
                                prev.map((x) =>
                                  x.id === it.id ? { ...x, prompt: e.target.value } : x
                                )
                              )
                            }
                            placeholder="Nhập đề bài câu mẫu..."
                            className="w-full px-2.5 py-1.5 rounded-lg border border-[#CEDCD6] bg-white"
                          />
                        ) : (
                          <MathText
                            text={it.prompt}
                            className="text-xs text-[#0D221D] line-clamp-2"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-[#0D221D] cursor-pointer">
                <input
                  type="checkbox"
                  checked={impActiveForAi}
                  onChange={(e) => setImpActiveForAi(e.target.checked)}
                />
                <span>
                  Kích hoạt dùng ngay cho AI (học sinh làm bài xong AI sẽ tham chiếu kho này)
                </span>
              </label>

              {impError && (
                <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{impError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#EBF1EE]">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-xs font-medium text-[#4A615A] hover:bg-[#F8FAF9] cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={impSaving}
                  onClick={() => void handleSaveNewMaterial()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
                >
                  {impSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang lưu lên Firestore...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-[#E5C665]" />
                      <span>Lưu vào Kho chuẩn Firestore</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
