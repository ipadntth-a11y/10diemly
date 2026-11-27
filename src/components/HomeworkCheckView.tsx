import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  MessageSquare,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createHomeworkSession,
  deleteHomeworkSession,
  extractFriendlyFirestoreError,
  subscribeClassStudents,
  subscribeHomeworkSessions,
  updateHomeworkSessionStatuses,
  upsertParentMessageByRef,
} from '../services/firestoreService';
import type {
  Classroom,
  HomeworkSession,
  HomeworkStatus,
  ParentMessage,
  StudentRecord,
} from '../types';
import { sanitizeConciseRemark } from '../utils/formatters';

interface HomeworkCheckViewProps {
  teacherId: string;
  classes: Classroom[];
  parentMessages?: ParentMessage[];
  onOpenParentMessagesTab?: () => void;
  onQuickCreateClass?: () => void;
}

type TapActionMode = 'toggle' | HomeworkStatus;

function getShortStudentLabel(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return fullName.trim();
  return `${parts[parts.length - 2]} ${parts[parts.length - 1]}`;
}

function parseSttTokens(
  rawInput: string,
  orderedStudents: StudentRecord[]
): {
  matchedIndices: number[];
  unknownTokens: string[];
} {
  const tokens = rawInput
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const indexSet = new Set<number>();
  const unknownTokens: string[] = [];

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d{1,3})-(\d{1,3})$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      let anyHit = false;
      for (let num = low; num <= high; num++) {
        if (num >= 1 && num <= orderedStudents.length) {
          indexSet.add(num - 1);
          anyHit = true;
        }
      }
      if (!anyHit) unknownTokens.push(token);
      continue;
    }

    if (/^\d{1,3}$/.test(token)) {
      const stt = Number(token);
      if (stt >= 1 && stt <= orderedStudents.length) {
        indexSet.add(stt - 1);
      } else {
        unknownTokens.push(token);
      }
      continue;
    }

    // Fallback: match by studentCode (case-insensitive)
    const norm = token.toUpperCase();
    const codeIdx = orderedStudents.findIndex(
      (s) => s.studentCode.trim().toUpperCase() === norm
    );
    if (codeIdx >= 0) {
      indexSet.add(codeIdx);
    } else {
      unknownTokens.push(token);
    }
  }

  return {
    matchedIndices: Array.from(indexSet).sort((a, b) => a - b),
    unknownTokens,
  };
}

function buildMissingHomeworkMessage(
  studentName: string,
  className: string,
  sessionTitle: string,
  dateLabel: string,
  status: HomeworkStatus
): string {
  const cleanTitle = sanitizeConciseRemark(sessionTitle, 80);
  const statusPhrase =
    status === 'incomplete'
      ? `nộp thiếu/chưa hoàn thiện bài "${cleanTitle}"`
      : `chưa nộp bài "${cleanTitle}"`;
  return `Kính gửi PH em ${studentName} (Lớp ${className}),\nBuổi ${dateLabel}, em ${statusPhrase}. Nhờ gia đình nhắc em hoàn thành và nộp bổ sung vào buổi tới.\nTrân trọng.`;
}

const STATUS_META: Record<
  HomeworkStatus,
  {
    label: string;
    shortLabel: string;
    cardClass: string;
    sttClass: string;
    dotClass: string;
  }
> = {
  submitted: {
    label: 'Đã nộp',
    shortLabel: 'Đủ',
    cardClass: 'bg-[#EFF7F3] border-[#96C7B3] text-[#0A362C] hover:border-[#0F4C3F]',
    sttClass: 'text-[#0F4C3F]',
    dotClass: 'bg-[#0F6D4F]',
  },
  missing: {
    label: 'Chưa nộp',
    shortLabel: 'Thiếu',
    cardClass: 'bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B] hover:border-[#DC2626]',
    sttClass: 'text-[#B91C1C]',
    dotClass: 'bg-[#DC2626]',
  },
  incomplete: {
    label: 'Thiếu / Muộn',
    shortLabel: 'Dở/Muộn',
    cardClass: 'bg-[#FDF8EB] border-[#E5C665] text-[#7A580B] hover:border-[#B0831A]',
    sttClass: 'text-[#8A630D]',
    dotClass: 'bg-[#C89B2B]',
  },
};

export function HomeworkCheckView({
  teacherId,
  classes,
  parentMessages = [],
  onOpenParentMessagesTab,
  onQuickCreateClass,
}: HomeworkCheckViewProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [sessions, setSessions] = useState<HomeworkSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  // New session creation state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newDefaultSubmitted, setNewDefaultSubmitted] = useState(true);
  const [creating, setCreating] = useState(false);

  // Fast STT input & tap mode
  const [tapMode, setTapMode] = useState<TapActionMode>('missing');
  const [sttInput, setSttInput] = useState('');
  const [sttFeedback, setSttFeedback] = useState<{
    tone: 'ok' | 'warn';
    text: string;
  } | null>(null);
  const [highlightedStudentIds, setHighlightedStudentIds] = useState<Set<string>>(
    new Set()
  );

  // Parent message batch creation state
  const [sendingMsgs, setSendingMsgs] = useState(false);
  const [msgNotice, setMsgNotice] = useState<string | null>(null);
  const [copiedBulkPreview, setCopiedBulkPreview] = useState(false);
  const [generatedPreviewText, setGeneratedPreviewText] = useState('');

  // Multi-session matrix view filter
  const [onlyShowMissingStudents, setOnlyShowMissingStudents] = useState(false);
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sttInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!selectedClassId && classes.length > 0) {
      setSelectedClassId(classes[0].id);
    } else if (
      selectedClassId &&
      classes.length > 0 &&
      !classes.some((c) => c.id === selectedClassId)
    ) {
      setSelectedClassId(classes[0].id);
    }
  }, [classes, selectedClassId]);

  useEffect(() => {
    if (!teacherId) return;
    return subscribeHomeworkSessions(teacherId, setSessions, (err) =>
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

  const activeClass = classes.find((c) => c.id === selectedClassId) || null;
  const classSessions = useMemo(
    () => sessions.filter((s) => s.classId === selectedClassId),
    [sessions, selectedClassId]
  );

  useEffect(() => {
    if (classSessions.length === 0) {
      setSelectedSessionId('');
      return;
    }
    if (!classSessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(classSessions[0].id);
    }
  }, [classSessions, selectedSessionId]);

  const activeSession =
    classSessions.find((s) => s.id === selectedSessionId) || null;

  // Helper to read effective status for a student in any session
  const getStudentStatus = (
    session: HomeworkSession | null,
    studentId: string
  ): HomeworkStatus => {
    if (!session) return 'missing';
    const raw = session.statuses?.[studentId];
    if (raw === 'submitted' || raw === 'missing' || raw === 'incomplete') {
      return raw;
    }
    return 'missing';
  };

  const sessionCounts = useMemo(() => {
    if (!activeSession) {
      return { submitted: 0, missing: 0, incomplete: 0, total: students.length };
    }
    let submitted = 0;
    let missing = 0;
    let incomplete = 0;
    for (const stu of students) {
      const st = getStudentStatus(activeSession, stu.id);
      if (st === 'submitted') submitted++;
      else if (st === 'incomplete') incomplete++;
      else missing++;
    }
    return { submitted, missing, incomplete, total: students.length };
  }, [activeSession, students]);

  const missingStudentsInActive = useMemo(() => {
    if (!activeSession) return [];
    return students
      .map((stu, idx) => ({
        student: stu,
        stt: idx + 1,
        status: getStudentStatus(activeSession, stu.id),
      }))
      .filter((item) => item.status !== 'submitted');
  }, [activeSession, students]);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClass || creating) return;
    const title =
      newTitle.trim() ||
      `Bài tập ngày ${newDate.split('-').reverse().join('/')}`;
    setCreating(true);
    setErrorMsg(null);
    try {
      const initialStatuses: Record<string, HomeworkStatus> = {};
      students.forEach((stu) => {
        initialStatuses[stu.id] = newDefaultSubmitted ? 'submitted' : 'missing';
      });
      const created = await createHomeworkSession({
        teacherId,
        classId: activeClass.id,
        className: activeClass.name,
        title,
        dateLabel: newDate || new Date().toISOString().slice(0, 10),
        statuses: initialStatuses,
      });
      setSelectedSessionId(created.id);
      setNewTitle('');
      setShowCreateForm(false);
      // If defaulted to all submitted, default tap/typing mode to 'missing' for 3-second exception marking
      setTapMode(newDefaultSubmitted ? 'missing' : 'submitted');
      window.setTimeout(() => sttInputRef.current?.focus(), 100);
    } catch (err) {
      setErrorMsg(extractFriendlyFirestoreError(err));
    } finally {
      setCreating(false);
    }
  };

  const applyStatuses = async (nextStatuses: Record<string, HomeworkStatus>) => {
    if (!activeSession) return;
    setErrorMsg(null);
    try {
      await updateHomeworkSessionStatuses(activeSession.id, nextStatuses);
    } catch (err) {
      setErrorMsg(extractFriendlyFirestoreError(err));
    }
  };

  const handleMarkAll = async (status: HomeworkStatus) => {
    if (!activeSession || students.length === 0) return;
    const nextStatuses: Record<string, HomeworkStatus> = {
      ...(activeSession.statuses || {}),
    };
    students.forEach((stu) => {
      nextStatuses[stu.id] = status;
    });
    await applyStatuses(nextStatuses);
    setSttFeedback({
      tone: 'ok',
      text:
        status === 'submitted'
          ? `Đã đánh dấu toàn bộ ${students.length} học sinh là Đã nộp. Giờ thầy/cô chỉ cần gõ STT hoặc chạm các em thiếu bài.`
          : `Đã đặt lại toàn bộ ${students.length} học sinh là Chưa nộp.`,
    });
    if (status === 'submitted') {
      setTapMode('missing');
    } else {
      setTapMode('submitted');
    }
  };

  const handleTapStudent = async (stu: StudentRecord) => {
    if (!activeSession) return;
    const current = getStudentStatus(activeSession, stu.id);
    let next: HomeworkStatus;
    if (tapMode === 'toggle') {
      next =
        current === 'submitted'
          ? 'missing'
          : current === 'missing'
            ? 'incomplete'
            : 'submitted';
    } else {
      // Clicking an already-marked tile toggles back to submitted if marking missing/incomplete
      next = current === tapMode ? (tapMode === 'submitted' ? 'missing' : 'submitted') : tapMode;
    }
    const nextStatuses: Record<string, HomeworkStatus> = {
      ...(activeSession.statuses || {}),
      [stu.id]: next,
    };
    await applyStatuses(nextStatuses);
  };

  const handleApplySttBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !sttInput.trim()) return;
    const targetStatus: HomeworkStatus =
      tapMode === 'toggle' ? 'missing' : tapMode;
    const { matchedIndices, unknownTokens } = parseSttTokens(sttInput, students);
    if (matchedIndices.length === 0) {
      setSttFeedback({
        tone: 'warn',
        text: `Không tìm thấy STT hợp lệ (lớp có STT từ 1 đến ${students.length}).`,
      });
      return;
    }

    const nextStatuses: Record<string, HomeworkStatus> = {
      ...(activeSession.statuses || {}),
    };
    const markedLabels: string[] = [];
    const hitIds = new Set<string>();
    matchedIndices.forEach((idx) => {
      const stu = students[idx];
      nextStatuses[stu.id] = targetStatus;
      hitIds.add(stu.id);
      markedLabels.push(`${String(idx + 1).padStart(2, '0')} (${getShortStudentLabel(stu.fullName)})`);
    });

    await applyStatuses(nextStatuses);
    setSttInput('');
    setHighlightedStudentIds(hitIds);
    window.setTimeout(() => setHighlightedStudentIds(new Set()), 2200);

    const warnSuffix =
      unknownTokens.length > 0
        ? ` · Bỏ qua mã không hợp lệ: ${unknownTokens.join(', ')}`
        : '';
    setSttFeedback({
      tone: unknownTokens.length > 0 ? 'warn' : 'ok',
      text: `Đã tích "${STATUS_META[targetStatus].label}" cho ${matchedIndices.length} em: ${markedLabels.slice(0, 8).join(', ')}${markedLabels.length > 8 ? '...' : ''}${warnSuffix}`,
    });
  };

  const handleSendMessagesToMissingGroup = async () => {
    if (!activeSession || !activeClass || missingStudentsInActive.length === 0 || sendingMsgs) {
      return;
    }
    setSendingMsgs(true);
    setErrorMsg(null);
    setMsgNotice(null);
    try {
      const previewLines: string[] = [];
      for (const item of missingStudentsInActive) {
        const content = buildMissingHomeworkMessage(
          item.student.fullName,
          activeClass.name,
          activeSession.title,
          activeSession.dateLabel,
          item.status
        );
        previewLines.push(content);
        const refId = `hw_${activeSession.id}_${item.student.id}`;
        await upsertParentMessageByRef({
          teacherId,
          refId,
          studentName: item.student.fullName,
          className: activeClass.name,
          examTitle: `Bài tập: ${activeSession.title}`,
          parentPhone: item.student.parentPhone || '',
          content,
          existingMessages: parentMessages,
        });
      }
      setGeneratedPreviewText(previewLines.join('\n\n---\n\n'));
      setMsgNotice(
        `Đã tạo ${missingStudentsInActive.length} tin nhắn cho nhóm chưa nộp/thiếu bài vào mục Tin nhắn phụ huynh.`
      );
    } catch (err) {
      setErrorMsg(extractFriendlyFirestoreError(err));
    } finally {
      setSendingMsgs(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setErrorMsg(null);
    try {
      await deleteHomeworkSession(sessionId);
      setConfirmDeleteSessionId(null);
    } catch (err) {
      setErrorMsg(extractFriendlyFirestoreError(err));
    }
  };

  // Multi-session statistics per student
  const matrixRows = useMemo(() => {
    return students
      .map((stu, idx) => {
        let submittedCount = 0;
        let missingCount = 0;
        let incompleteCount = 0;
        const perSession = classSessions.map((sess) => {
          const st = getStudentStatus(sess, stu.id);
          if (st === 'submitted') submittedCount++;
          else if (st === 'incomplete') incompleteCount++;
          else missingCount++;
          return { sessionId: sess.id, status: st };
        });
        const total = classSessions.length || 1;
        const completionPct = Math.round((submittedCount / total) * 100);
        return {
          stt: idx + 1,
          student: stu,
          submittedCount,
          missingCount,
          incompleteCount,
          deficitCount: missingCount + incompleteCount,
          completionPct,
          perSession,
        };
      })
      .filter((r) => !onlyShowMissingStudents || r.deficitCount > 0);
  }, [students, classSessions, onlyShowMissingStudents]);

  if (classes.length === 0) {
    return (
      <div className="bg-white border border-[#DAE5E0] rounded-2xl p-12 text-center space-y-4">
        <Users className="w-9 h-9 text-[#0F4C3F] mx-auto" />
        <h1 className="font-serif text-2xl font-semibold text-[#0D221D]">
          Chưa có lớp học nào
        </h1>
        <p className="text-sm text-[#4A615A] max-w-md mx-auto">
          Hãy tạo lớp và thêm danh sách học sinh trước để bắt đầu kiểm tra bài tập nhanh theo STT.
        </p>
        {onQuickCreateClass && (
          <button
            type="button"
            onClick={onQuickCreateClass}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#E5C665]" />
            <span>Tạo lớp học ngay</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-[0.08em] text-[#8A630D] uppercase">
            Điểm danh nộp bài siêu tốc · Không cần quét mã
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#0D221D] mt-1">
            Kiểm tra bài tập theo STT
          </h1>
          <p className="text-sm text-[#4A615A] mt-1">
            Bấm &ldquo;Cả lớp đã nộp&rdquo; rồi gõ dãy STT (VD: 3 7 12) hoặc chạm ô số để lọc nhanh học sinh thiếu bài và gửi tin phụ huynh.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={selectedClassId}
            onChange={(e) => {
              setSelectedClassId(e.target.value);
              setSttFeedback(null);
              setMsgNotice(null);
              setGeneratedPreviewText('');
            }}
            className="px-3.5 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm font-semibold text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
          >
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                Lớp {cls.name} ({cls.studentCount} HS)
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 text-[#E5C665]" />
            <span>Tạo buổi kiểm tra mới</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
          {errorMsg}
        </div>
      )}

      {/* Create Session Panel */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSession}
          className="bg-white border border-[#C5DDD3] rounded-2xl p-5 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
              Tạo buổi kiểm tra bài tập — Lớp {activeClass?.name}
            </h2>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="p-1 rounded-lg text-[#597169] hover:text-[#0D221D] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#3A524A] mb-1">
                Tên bài tập / buổi kiểm tra
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="VD: BTVN Định luật I NĐLH, Phiếu ôn chương 2..."
                className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3A524A] mb-1">
                Ngày kiểm tra
              </label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-[#3A524A] cursor-pointer">
              <input
                type="checkbox"
                checked={newDefaultSubmitted}
                onChange={(e) => setNewDefaultSubmitted(e.target.checked)}
                className="rounded border-[#CEDCD6] accent-[#0F4C3F]"
              />
              <span>
                Mặc định <strong>Cả lớp đã nộp</strong> (chỉ cần gõ STT / chạm vài em thiếu bài)
              </span>
            </label>

            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
            >
              {creating ? 'Đang tạo...' : 'Bắt đầu điểm danh STT'}
            </button>
          </div>
        </form>
      )}

      {students.length === 0 ? (
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-10 text-center space-y-2">
          <Users className="w-7 h-7 text-[#698078] mx-auto" />
          <div className="text-sm font-semibold text-[#0D221D]">
            Lớp {activeClass?.name} chưa có danh sách học sinh
          </div>
          <p className="text-xs text-[#597169]">
            Hãy thêm học sinh trong tab &ldquo;Lớp &amp; học sinh&rdquo; để tự động cấp số thứ tự (STT 01 → N).
          </p>
        </div>
      ) : classSessions.length === 0 ? (
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-10 text-center space-y-3">
          <ClipboardCheck className="w-8 h-8 text-[#0F4C3F] mx-auto" />
          <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
            Chưa có buổi kiểm tra bài tập nào cho Lớp {activeClass?.name}
          </h2>
          <p className="text-sm text-[#4A615A] max-w-md mx-auto">
            Bấm nút bên dưới để tạo buổi đầu tiên với lưới STT 01 → {String(students.length).padStart(2, '0')} và chế độ nhập dãy STT siêu tốc.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#E5C665]" />
            <span>Tạo buổi kiểm tra bài tập đầu tiên</span>
          </button>
        </div>
      ) : (
        <>
          {/* Session selector bar */}
          <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#EDF3F0]">
              <div className="flex flex-wrap items-center gap-2.5">
                <Calendar className="w-4 h-4 text-[#8A630D] shrink-0" />
                <select
                  value={activeSession?.id || ''}
                  onChange={(e) => {
                    setSelectedSessionId(e.target.value);
                    setSttFeedback(null);
                    setMsgNotice(null);
                    setGeneratedPreviewText('');
                  }}
                  className="px-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm font-semibold text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                >
                  {classSessions.map((sess) => (
                    <option key={sess.id} value={sess.id}>
                      {sess.title} ({sess.dateLabel})
                    </option>
                  ))}
                </select>

                {activeSession && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteSessionId(activeSession.id)}
                    title="Xoá buổi kiểm tra này"
                    className="p-1.5 rounded-lg text-[#698078] hover:text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Live Summary + Send Parent Messages */}
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-[#EFF7F3] border border-[#C5DDD3] text-[#0F4C3F] font-semibold tabular-nums">
                  Đã nộp: {sessionCounts.submitted}/{sessionCounts.total}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] font-semibold tabular-nums">
                  Chưa nộp: {sessionCounts.missing}
                </span>
                {sessionCounts.incomplete > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] font-semibold tabular-nums">
                    Thiếu/Muộn: {sessionCounts.incomplete}
                  </span>
                )}

                {missingStudentsInActive.length > 0 && (
                  <button
                    type="button"
                    disabled={sendingMsgs}
                    onClick={handleSendMessagesToMissingGroup}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#B0831A] text-white font-semibold hover:bg-[#936C12] disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>
                      {sendingMsgs
                        ? 'Đang tạo tin...'
                        : `Gửi tin PH nhóm chưa nộp (${missingStudentsInActive.length})`}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {confirmDeleteSessionId === activeSession?.id && activeSession && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex flex-wrap items-center justify-between gap-2 text-xs text-[#991B1B]">
                <span>
                  Xoá buổi kiểm tra <strong>{activeSession.title}</strong>? Dữ liệu điểm danh buổi này sẽ bị xoá vĩnh viễn.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteSession(activeSession.id)}
                    className="px-3 py-1 rounded-lg bg-[#B91C1C] text-white font-semibold cursor-pointer"
                  >
                    Xác nhận xoá
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteSessionId(null)}
                    className="px-3 py-1 rounded-lg border border-[#FECACA] bg-white cursor-pointer"
                  >
                    Huỷ
                  </button>
                </div>
              </div>
            )}

            {/* Quick Toolbar: All Submitted button + Tap mode + Batch STT text box */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-end bg-[#F8FAF9] border border-[#EBF1EE] rounded-xl p-4">
              <div className="xl:col-span-5 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                  1. Thao tác nhanh toàn lớp &amp; chế độ tích
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleMarkAll('submitted')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] cursor-pointer whitespace-nowrap"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-[#E5C665]" />
                    <span>Cả lớp đã nộp</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMarkAll('missing')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#4A615A] hover:bg-[#EFF7F3] cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Đặt lại chưa nộp</span>
                  </button>
                </div>
              </div>

              <div className="xl:col-span-7 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#597169]">
                    2. Gõ STT để tự tích (VD: 3 7 12 19-22)
                  </span>
                  <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#E6EEEA] text-[11px]">
                    {(
                      [
                        { id: 'missing', label: 'Đánh dấu Chưa nộp' },
                        { id: 'submitted', label: 'Đánh dấu Đã nộp' },
                        { id: 'incomplete', label: 'Thiếu / Muộn' },
                        { id: 'toggle', label: 'Chạm xoay vòng' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setTapMode(m.id)}
                        className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          tapMode === m.id
                            ? 'bg-white text-[#0F4C3F] font-semibold shadow-2xs'
                            : 'text-[#4A615A] hover:text-[#0D221D]'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleApplySttBatch} className="flex gap-2">
                  <input
                    ref={sttInputRef}
                    type="text"
                    value={sttInput}
                    onChange={(e) => setSttInput(e.target.value)}
                    placeholder={`Nhập STT (1–${students.length}) hoặc Mã HS, cách nhau dấu cách/phẩy...`}
                    className="flex-1 px-3.5 py-2 rounded-xl border border-[#CEDCD6] bg-white text-sm font-mono text-[#0D221D] focus:outline-none focus:border-[#0F4C3F]"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] whitespace-nowrap cursor-pointer"
                  >
                    Tích tự động
                  </button>
                </form>
              </div>
            </div>

            {sttFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs ${
                  sttFeedback.tone === 'warn'
                    ? 'bg-[#FDF8EB] border-[#EAD8A6] text-[#7A580B]'
                    : 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0A362C]'
                }`}
              >
                {sttFeedback.text}
              </div>
            )}

            {msgNotice && (
              <div className="p-4 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] space-y-2.5 text-xs text-[#0A362C]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-[#0F6D4F]" />
                    <span>{msgNotice}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {generatedPreviewText && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(generatedPreviewText);
                          setCopiedBulkPreview(true);
                          setTimeout(() => setCopiedBulkPreview(false), 1800);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#C5DDD3] bg-white font-semibold text-[#0F4C3F] hover:bg-[#F8FAF9] cursor-pointer"
                      >
                        {copiedBulkPreview ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Đã sao chép tất cả</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Sao chép tất cả tin</span>
                          </>
                        )}
                      </button>
                    )}
                    {onOpenParentMessagesTab && (
                      <button
                        type="button"
                        onClick={onOpenParentMessagesTab}
                        className="px-2.5 py-1 rounded-lg bg-[#0F4C3F] text-white font-semibold hover:bg-[#0A362C] cursor-pointer"
                      >
                        Mở mục Tin nhắn PH
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 1-Tap STT Grid */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#597169]">
                <span>
                  Lưới STT 1 chạm ({students.length} học sinh · chạm trực tiếp vào ô số để đổi trạng thái)
                </span>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#0F6D4F]" /> Đã nộp
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" /> Chưa nộp
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#C89B2B]" /> Thiếu/Muộn
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-2">
                {students.map((stu, idx) => {
                  const stt = idx + 1;
                  const status = getStudentStatus(activeSession, stu.id);
                  const meta = STATUS_META[status];
                  const isHighlighted = highlightedStudentIds.has(stu.id);
                  return (
                    <button
                      key={stu.id}
                      type="button"
                      onClick={() => handleTapStudent(stu)}
                      title={`STT ${stt} · ${stu.fullName} — ${meta.label}`}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                        meta.cardClass
                      } ${isHighlighted ? 'ring-2 ring-[#0F4C3F] scale-[1.03]' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`font-mono text-base font-bold tabular-nums ${meta.sttClass}`}
                        >
                          {String(stt).padStart(2, '0')}
                        </span>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />
                      </div>
                      <div className="text-[11px] font-medium truncate mt-1">
                        {getShortStudentLabel(stu.fullName)}
                      </div>
                      <div className="text-[10px] opacity-80 truncate">
                        {meta.shortLabel}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Multi-Session Matrix & Statistics */}
          <section className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                  Thống kê thiếu bài theo buổi — Lớp {activeClass?.name} ({classSessions.length} buổi)
                </h2>
                <p className="text-xs text-[#597169] mt-0.5">
                  Tổng hợp chuyên cần nộp bài tập theo từng buổi và cảnh báo học sinh thiếu bài nhiều lần.
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#3A524A] cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyShowMissingStudents}
                  onChange={(e) => setOnlyShowMissingStudents(e.target.checked)}
                  className="rounded border-[#CEDCD6] accent-[#0F4C3F]"
                />
                <span>Chỉ hiện học sinh có buổi thiếu</span>
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#DAE5E0] text-[#597169] uppercase tracking-wider">
                    <th className="py-2.5 pr-3 w-12">STT</th>
                    <th className="py-2.5 pr-4 min-w-40">Họ và tên</th>
                    <th className="py-2.5 pr-3 text-center">Tỉ lệ nộp</th>
                    <th className="py-2.5 pr-3 text-center">Số buổi thiếu</th>
                    {classSessions.slice(0, 10).map((sess) => {
                      const subCount = students.filter(
                        (s) => getStudentStatus(sess, s.id) === 'submitted'
                      ).length;
                      const pct =
                        students.length > 0
                          ? Math.round((subCount / students.length) * 100)
                          : 0;
                      return (
                        <th
                          key={sess.id}
                          className="py-2.5 px-2 text-center min-w-24 font-medium normal-case"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(sess.id)}
                            className={`text-left hover:text-[#0F4C3F] cursor-pointer ${
                              sess.id === activeSession?.id
                                ? 'font-bold text-[#0F4C3F]'
                                : 'text-[#3A524A]'
                            }`}
                          >
                            <div className="truncate max-w-24">{sess.title}</div>
                            <div className="text-[10px] text-[#597169] font-normal tabular-nums">
                              {sess.dateLabel.slice(5)} · {pct}%
                            </div>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF3F0]">
                  {matrixRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4 + Math.min(classSessions.length, 10)}
                        className="py-8 text-center text-[#597169]"
                      >
                        Tất cả học sinh đều đã nộp đủ bài trong các buổi đã tạo.
                      </td>
                    </tr>
                  ) : (
                    matrixRows.map((row) => (
                      <tr key={row.student.id} className="hover:bg-[#F8FAF9]">
                        <td className="py-2.5 pr-3 font-mono font-bold text-[#0F4C3F] tabular-nums">
                          {String(row.stt).padStart(2, '0')}
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-[#0D221D]">
                          <div className="flex items-center gap-1.5">
                            <span>{row.student.fullName}</span>
                            {row.deficitCount >= 2 && (
                              <span
                                title={`Thiếu ${row.deficitCount} buổi`}
                                className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#B91C1C]"
                              >
                                <AlertTriangle className="w-3 h-3" />
                                Thiếu nhiều
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-center font-semibold tabular-nums text-[#0D221D]">
                          {row.completionPct}%
                        </td>
                        <td className="py-2.5 pr-3 text-center font-semibold tabular-nums">
                          <span
                            className={
                              row.deficitCount > 0 ? 'text-[#B91C1C]' : 'text-[#0F6D4F]'
                            }
                          >
                            {row.deficitCount}/{classSessions.length}
                          </span>
                        </td>
                        {row.perSession.slice(0, 10).map((cell) => {
                          const meta = STATUS_META[cell.status];
                          return (
                            <td key={cell.sessionId} className="py-2.5 px-2 text-center">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                                  cell.status === 'submitted'
                                    ? 'bg-[#EFF7F3] text-[#0F6D4F]'
                                    : cell.status === 'incomplete'
                                      ? 'bg-[#FDF8EB] text-[#8A630D]'
                                      : 'bg-[#FEF2F2] text-[#B91C1C]'
                                }`}
                              >
                                {meta.shortLabel}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
