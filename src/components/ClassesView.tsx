import {
  Check,
  Copy,
  Edit3,
  Link2,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  addStudentsToClass,
  createClassroom,
  deleteClassroom,
  deleteStudentRecord,
  extractFriendlyFirestoreError,
  normalizeJoinCode,
  seedDemoDataForTeacher,
  subscribeClassStudents,
  updateClassroom,
  updateStudentRecord,
} from '../services/firestoreService';
import type { Classroom, Exam, StudentRecord, Submission } from '../types';
import {
  computeClassScoreStats,
  computeStudentPerformanceInClass,
} from '../utils/classStats';
import { analyzeSubmissionEffort } from '../utils/effortAnalysis';

interface ClassesViewProps {
  teacherId: string;
  classes: Classroom[];
  submissions?: Submission[];
  exams?: Exam[];
  onOpenSubmission?: (submissionId: string) => void;
  openCreateModalSignal?: number;
  onConsumeCreateSignal?: () => void;
}

export function ClassesView({
  teacherId,
  classes,
  submissions = [],
  exams = [],
  onOpenSubmission,
  openCreateModalSignal = 0,
  onConsumeCreateSignal,
}: ClassesViewProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [classStatsExamId, setClassStatsExamId] = useState<string>('all');
  const pendingClassIdRef = useRef<string | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Create class modal
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [className, setClassName] = useState('');
  const [classJoinCode, setClassJoinCode] = useState('');
  const [classSubject, setClassSubject] = useState('Vật lí 12');
  const [classGrade, setClassGrade] = useState('Khối 12');
  const [creatingClass, setCreatingClass] = useState(false);
  const [createClassError, setCreateClassError] = useState<string | null>(null);
  const [seedingSample, setSeedingSample] = useState(false);

  // Edit class / joinCode modal
  const [editingClass, setEditingClass] = useState<Classroom | null>(null);
  const [editClassName, setEditClassName] = useState('');
  const [editClassJoinCode, setEditClassJoinCode] = useState('');
  const [editClassSubject, setEditClassSubject] = useState('');
  const [editClassGrade, setEditClassGrade] = useState('');
  const [editClassYear, setEditClassYear] = useState('');
  const [savingClassEdit, setSavingClassEdit] = useState(false);
  const [editClassError, setEditClassError] = useState<string | null>(null);

  // Bulk import / add student modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [singleName, setSingleName] = useState('');
  const [singlePhone, setSinglePhone] = useState('');
  const [singleCode, setSingleCode] = useState('');
  const [savingStudents, setSavingStudents] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Inline edit student
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editParentName, setEditParentName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (openCreateModalSignal > 0) {
      setCreateClassError(null);
      setShowCreateClass(true);
      onConsumeCreateSignal?.();
    }
  }, [openCreateModalSignal, onConsumeCreateSignal]);

  useEffect(() => {
    if (pendingClassIdRef.current && classes.some((c) => c.id === pendingClassIdRef.current)) {
      setSelectedClassId(pendingClassIdRef.current);
      pendingClassIdRef.current = null;
      return;
    }

    if (!selectedClassId && classes.length > 0) {
      setSelectedClassId(classes[0].id);
    } else if (
      selectedClassId &&
      selectedClassId !== pendingClassIdRef.current &&
      !classes.some((c) => c.id === selectedClassId)
    ) {
      setSelectedClassId(classes[0]?.id || '');
    }
  }, [classes, selectedClassId]);

  useEffect(() => {
    if (!selectedClassId) {
      setStudents([]);
      return;
    }
    return subscribeClassStudents(selectedClassId, teacherId, setStudents);
  }, [selectedClassId, teacherId]);

  const activeClass = classes.find((c) => c.id === selectedClassId) || null;

  const filteredStudents = students.filter((s) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      s.fullName.toLowerCase().includes(q) ||
      s.studentCode.toLowerCase().includes(q) ||
      s.parentPhone.toLowerCase().includes(q)
    );
  });

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1800);
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className.trim()) {
      setCreateClassError('Vui lòng nhập tên lớp học.');
      return;
    }
    setCreatingClass(true);
    setCreateClassError(null);
    setPageError(null);
    try {
      const id = await createClassroom(teacherId, {
        name: className.trim(),
        subject: classSubject.trim() || 'Vật lí',
        grade: classGrade.trim() || 'Khối 12',
        academicYear: '2025–2026',
        ...(classJoinCode.trim() ? { joinCode: classJoinCode.trim() } : {}),
      });
      pendingClassIdRef.current = id;
      setSelectedClassId(id);
      setClassName('');
      setClassJoinCode('');
      setShowCreateClass(false);
    } catch (err) {
      setCreateClassError(extractFriendlyFirestoreError(err));
    } finally {
      setCreatingClass(false);
    }
  };

  const openEditClassModal = (cls: Classroom) => {
    setEditClassError(null);
    setEditingClass(cls);
    setEditClassName(cls.name);
    setEditClassJoinCode(cls.joinCode);
    setEditClassSubject(cls.subject);
    setEditClassGrade(cls.grade || '');
    setEditClassYear(cls.academicYear || '2025–2026');
  };

  const handleSaveClassEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass) return;
    if (!editClassName.trim()) {
      setEditClassError('Vui lòng nhập tên lớp học.');
      return;
    }
    const cleanCode = normalizeJoinCode(editClassJoinCode);
    if (cleanCode.length < 3 || cleanCode.length > 20) {
      setEditClassError(
        'Mã lớp phải dài từ 3 đến 20 ký tự, chỉ gồm chữ không dấu, số, dấu gạch dưới (_) hoặc gạch ngang (-).'
      );
      return;
    }

    setSavingClassEdit(true);
    setEditClassError(null);
    try {
      await updateClassroom(editingClass.id, teacherId, {
        name: editClassName.trim(),
        joinCode: cleanCode,
        subject: editClassSubject.trim() || editingClass.subject,
        grade: editClassGrade.trim(),
        academicYear: editClassYear.trim() || editingClass.academicYear,
      });
      setEditingClass(null);
    } catch (err) {
      setEditClassError(extractFriendlyFirestoreError(err));
    } finally {
      setSavingClassEdit(false);
    }
  };

  const handleAddSingleOrBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClass) return;
    setImportError(null);

    const entries: {
      fullName: string;
      studentCode?: string;
      parentPhone?: string;
      parentName?: string;
    }[] = [];

    if (singleName.trim()) {
      entries.push({
        fullName: singleName.trim(),
        studentCode: singleCode.trim(),
        parentPhone: singlePhone.trim(),
        parentName: `Phụ huynh em ${singleName.trim().split(' ').slice(-1)[0]}`,
      });
    }

    if (bulkText.trim()) {
      const lines = bulkText.split(/\r?\n/);
      for (const line of lines) {
        const clean = line.trim();
        if (!clean) continue;
        const parts = clean.split(/[,\t;]+/).map((p) => p.trim());
        if (parts[0]) {
          entries.push({
            fullName: parts[0],
            parentPhone: parts[1] || '',
            studentCode: parts[2] || '',
            parentName: `Phụ huynh em ${parts[0].split(' ').slice(-1)[0]}`,
          });
        }
      }
    }

    if (entries.length === 0) {
      setImportError('Vui lòng nhập ít nhất 1 học sinh trước khi lưu.');
      return;
    }

    setSavingStudents(true);
    try {
      await addStudentsToClass(
        activeClass.id,
        teacherId,
        students.length,
        entries,
        activeClass.name
      );
      setSingleName('');
      setSinglePhone('');
      setSingleCode('');
      setBulkText('');
      setShowImportModal(false);
    } catch (err) {
      setImportError(extractFriendlyFirestoreError(err));
    } finally {
      setSavingStudents(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClass || !editingStudent || !editName.trim()) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      await updateStudentRecord(
        activeClass.id,
        editingStudent.id,
        {
          fullName: editName.trim(),
          studentCode: editCode.trim(),
          parentPhone: editPhone.trim(),
          parentName: editParentName.trim(),
        },
        {
          teacherId,
          className: activeClass.name,
          previousCode: editingStudent.studentCode,
        }
      );
      setEditingStudent(null);
    } catch (err) {
      setEditError(extractFriendlyFirestoreError(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteClass = async (clsId: string) => {
    setPageError(null);
    try {
      if (selectedClassId === clsId) {
        pendingClassIdRef.current = null;
        setSelectedClassId('');
      }
      await deleteClassroom(clsId, teacherId);
    } catch (err) {
      setPageError(extractFriendlyFirestoreError(err));
    }
  };

  const handleDeleteStudent = async (stu: StudentRecord) => {
    if (!activeClass) return;
    setPageError(null);
    try {
      await deleteStudentRecord(activeClass.id, stu.id, students.length, {
        teacherId,
        studentCode: stu.studentCode,
      });
    } catch (err) {
      setPageError(extractFriendlyFirestoreError(err));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-[0.12em] text-[#8A630D] uppercase">
            Quản lý lớp học
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#0D221D] mt-1">
            Lớp &amp; học sinh
          </h1>
          <p className="text-sm text-[#4A615A] mt-1">
            Tạo lớp, nhập danh sách học sinh và cập nhật số điện thoại phụ huynh.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateClassError(null);
            setShowCreateClass(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F4C3F] border border-[#C89B2B]/40 text-white text-sm font-medium hover:bg-[#0A362C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#E5C665]" />
          <span>Tạo lớp mới</span>
        </button>
      </div>

      {pageError && (
        <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C] flex items-center justify-between gap-3">
          <span>{pageError}</span>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="text-[#B91C1C] hover:underline shrink-0 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Class tabs */}
      {classes.length === 0 ? (
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-10 text-center space-y-3">
          <Users className="w-8 h-8 text-[#698078] mx-auto" />
          <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
            Chưa có lớp học nào
          </h2>
          <p className="text-sm text-[#4A615A] max-w-md mx-auto">
            Tạo lớp học đầu tiên để bắt đầu quản lý danh sách học sinh và giao đề kiểm tra.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setCreateClassError(null);
                setShowCreateClass(true);
              }}
              className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-medium hover:bg-[#0A362C] cursor-pointer"
            >
              Tạo lớp đầu tiên
            </button>
            <button
              type="button"
              disabled={seedingSample}
              onClick={async () => {
                setSeedingSample(true);
                setPageError(null);
                try {
                  await seedDemoDataForTeacher(teacherId);
                } catch (err) {
                  setPageError(extractFriendlyFirestoreError(err));
                } finally {
                  setSeedingSample(false);
                }
              }}
              className="px-4 py-2 rounded-xl border border-[#CEDCD6] bg-white text-[#0D221D] text-sm font-medium hover:bg-[#F8FAF9] disabled:opacity-60 cursor-pointer"
            >
              {seedingSample ? 'Đang tạo dữ liệu lớp...' : 'Khởi tạo dữ liệu lớp mẫu'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {classes.map((cls) => {
            const isSelected = cls.id === selectedClassId;
            return (
              <div
                key={cls.id}
                onClick={() => setSelectedClassId(cls.id)}
                className={`rounded-2xl p-5 border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-gradient-to-br from-white to-[#EFF7F3] border-[#0F4C3F] ring-1 ring-[#C89B2B]/50'
                    : 'bg-white border-[#DAE5E0] hover:border-[#A8C1B6]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-serif text-xl font-semibold text-[#0D221D]">
                      Lớp {cls.name}
                    </h3>
                    <p className="text-xs text-[#597169] mt-0.5">
                      {cls.subject} · {cls.grade || 'THPT'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditClassModal(cls);
                      }}
                      title="Sửa tên lớp & mã lớp"
                      className="p-1.5 rounded-lg text-[#4A615A] hover:text-[#0F4C3F] hover:bg-[#EFF7F3] transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClass(cls.id);
                      }}
                      title="Xoá lớp"
                      className="p-1.5 rounded-lg text-[#698078] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#EBF1EE] flex items-center justify-between text-xs">
                  <span className="text-[#3A524A] font-medium tabular-nums">
                    {isSelected ? students.length : cls.studentCount} học sinh
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyCode(cls.joinCode);
                    }}
                    className="inline-flex items-center gap-1.5 text-[#0F4C3F] font-mono font-medium hover:text-[#8A630D] cursor-pointer"
                  >
                    {copiedCode === cls.joinCode ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#0F6D4F]" />
                        <span>Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-[#8A630D]" />
                        <span>Mã: {cls.joinCode}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Class Roster */}
      {activeClass && (
        <section className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
                Danh sách học sinh — Lớp {activeClass.name}
              </h2>
              <div className="text-xs text-[#597169] mt-1 flex flex-wrap items-center gap-2">
                <span>
                  {students.length} học sinh · Môn {activeClass.subject} · Năm học{' '}
                  {activeClass.academicYear}
                </span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => handleCopyCode(activeClass.joinCode)}
                  className="inline-flex items-center gap-1 font-mono font-semibold text-[#0F4C3F] hover:underline cursor-pointer"
                >
                  {copiedCode === activeClass.joinCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#0F6D4F]" />
                      <span>Đã chép mã {activeClass.joinCode}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#8A630D]" />
                      <span>Mã lớp: {activeClass.joinCode}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => openEditClassModal(activeClass)}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border border-[#CEDCD6] bg-white text-[11px] font-semibold text-[#0F4C3F] hover:bg-[#EFF7F3] cursor-pointer"
                  title="Chỉnh sửa tên lớp, môn học hoặc mã lớp"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>Sửa mã lớp</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyCode(
                      `${window.location.origin}/?classCode=${encodeURIComponent(activeClass.joinCode)}`
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border border-[#EAD8A6] bg-[#FDF8EB] text-[11px] font-semibold text-[#7A580B] hover:bg-[#F9EED2] cursor-pointer"
                  title="Chép đường dẫn để học sinh bấm vào, chọn tên mình và làm bài"
                >
                  <Link2 className="w-3 h-3" />
                  <span>
                    {copiedCode?.includes(`classCode=${encodeURIComponent(activeClass.joinCode)}`)
                      ? 'Đã chép link vào lớp'
                      : 'Chép link vào lớp cho HS'}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-[#698078] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm tên, mã HS, SĐT..."
                  className="pl-9 pr-3.5 py-2 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm text-[#0D221D] focus:outline-none focus:border-[#0F4C3F] w-56"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setImportError(null);
                  setShowImportModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-medium hover:bg-[#0A362C] transition-colors whitespace-nowrap cursor-pointer"
              >
                <Upload className="w-4 h-4 text-[#E5C665]" />
                <span>Thêm / Nhập danh sách</span>
              </button>
            </div>
          </div>

          {/* Class Score Summary Strip */}
          {(() => {
            const examFilteredSubs =
              classStatsExamId === 'all'
                ? submissions
                : submissions.filter((s) => s.examId === classStatsExamId);
            const clsStat = computeClassScoreStats(examFilteredSubs, [activeClass], {
              includeEmptyClasses: true,
            })[0];
            return (
              <div className="p-4 rounded-2xl bg-[#F8FAF9] border border-[#E6EEEA] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#0F4C3F]">
                    Thống kê điểm lớp {activeClass.name}
                  </div>
                  {exams.length > 0 && (
                    <select
                      value={classStatsExamId}
                      onChange={(e) => setClassStatsExamId(e.target.value)}
                      className="px-3 py-1 rounded-lg border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] focus:outline-none focus:border-[#0F4C3F] max-w-[230px]"
                    >
                      <option value="all">Tất cả các đề</option>
                      {exams.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-white border border-[#DAE5E0]">
                    <div className="text-[#597169]">Số bài đã nộp</div>
                    <div className="font-serif text-xl font-semibold text-[#0D221D] mt-0.5 tabular-nums">
                      {clsStat?.submissionCount || 0} bài
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-[#EAD8A6]">
                    <div className="text-[#8A630D]">Điểm TB (thang 10)</div>
                    <div className="font-serif text-xl font-semibold text-[#0A362C] mt-0.5 tabular-nums">
                      {clsStat && clsStat.submissionCount > 0
                        ? `${clsStat.avgScore10.toFixed(2)}/10`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-[#DAE5E0]">
                    <div className="text-[#597169]">Tỉ lệ đạt (≥ 5,0)</div>
                    <div className="font-serif text-xl font-semibold text-[#0F6D4F] mt-0.5 tabular-nums">
                      {clsStat && clsStat.submissionCount > 0
                        ? `${clsStat.passRate}%`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-[#DAE5E0]">
                    <div className="text-[#597169]">Cao nhất / Thấp nhất</div>
                    <div className="font-serif text-lg font-semibold text-[#0D221D] mt-0.5 tabular-nums">
                      {clsStat && clsStat.submissionCount > 0
                        ? `${clsStat.highest10.toFixed(2)} / ${clsStat.lowest10.toFixed(2)}`
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {filteredStudents.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#597169]">
              {students.length === 0
                ? 'Lớp chưa có học sinh nào. Nhấn "Thêm / Nhập danh sách" để nhập nhanh.'
                : 'Không tìm thấy học sinh khớp từ khoá.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EBF1EE] text-xs font-semibold text-[#597169] uppercase tracking-wider">
                    <th className="py-3 pr-4">STT</th>
                    <th className="py-3 pr-4">Họ và tên</th>
                    <th className="py-3 pr-4">Mã HS</th>
                    <th className="py-3 pr-4">Kết quả làm bài</th>
                    <th className="py-3 pr-4">Phụ huynh</th>
                    <th className="py-3 pr-4">SĐT phụ huynh</th>
                    <th className="py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF3F0] text-sm">
                  {filteredStudents.map((stu, idx) => {
                    const examFilteredSubs =
                      classStatsExamId === 'all'
                        ? submissions
                        : submissions.filter((s) => s.examId === classStatsExamId);
                    const perf = computeStudentPerformanceInClass(
                      stu,
                      activeClass,
                      examFilteredSubs
                    );
                    return (
                    <tr key={stu.id} className="hover:bg-[#F8FAF9] transition-colors">
                      <td className="py-3 pr-4 text-[#597169] tabular-nums">{idx + 1}</td>
                      <td className="py-3 pr-4 font-medium text-[#0D221D]">
                        {stu.fullName}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-[#4A615A]">
                        {stu.studentCode || '—'}
                      </td>
                      <td className="py-3 pr-4 text-xs tabular-nums">
                        {perf.submissionCount > 0 && perf.avgScore10 !== null ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded-md font-semibold border ${
                                perf.avgScore10 >= 6.5
                                  ? 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0F4C3F]'
                                  : perf.avgScore10 >= 5
                                    ? 'bg-[#FDF8EB] border-[#EAD8A6] text-[#8A630D]'
                                    : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                              }`}
                            >
                              TB {perf.avgScore10.toFixed(2)}/10
                            </span>
                            {(() => {
                              const latestSub = perf.latestSubmissionId
                                ? examFilteredSubs.find((s) => s.id === perf.latestSubmissionId)
                                : undefined;
                              if (!latestSub) return null;
                              const effort = analyzeSubmissionEffort(
                                latestSub,
                                exams.find((e) => e.id === latestSub.examId)
                              );
                              if (effort.level === 'serious') return null;
                              return (
                                <span
                                  title={effort.reasons.join(' • ')}
                                  className={`px-2 py-0.5 rounded-md border font-semibold ${
                                    effort.level === 'perfunctory'
                                      ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                                      : 'bg-[#FDF8EB] border-[#EAD8A6] text-[#8A630D]'
                                  }`}
                                >
                                  {effort.level === 'perfunctory' ? 'Đối phó' : 'Lưu ý'}
                                </span>
                              );
                            })()}
                            <span className="text-[#597169]">({perf.submissionCount} bài)</span>
                            {onOpenSubmission && perf.latestSubmissionId && (
                              <button
                                type="button"
                                onClick={() => onOpenSubmission(perf.latestSubmissionId!)}
                                className="text-[#0F4C3F] font-semibold hover:underline cursor-pointer"
                              >
                                Xem
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#8DA29B]">Chưa nộp bài</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-[#3A524A]">
                        {stu.parentName || '—'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs tabular-nums">
                        {stu.parentPhone ? (
                          <span className="text-[#0D221D]">{stu.parentPhone}</span>
                        ) : (
                          <span className="text-[#8DA29B]">chưa có SĐT</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditError(null);
                              setEditingStudent(stu);
                              setEditName(stu.fullName);
                              setEditCode(stu.studentCode);
                              setEditPhone(stu.parentPhone);
                              setEditParentName(stu.parentName);
                            }}
                            title="Sửa thông tin"
                            className="p-1.5 rounded-lg text-[#4A615A] hover:text-[#0F4C3F] hover:bg-[#EFF7F3] transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteStudent(stu)}
                            title="Xoá học sinh"
                            className="p-1.5 rounded-lg text-[#4A615A] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Modal: Create Class */}
      {showCreateClass && (
        <div className="fixed inset-0 z-50 bg-[#082B23]/45 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#DAE5E0] max-w-md w-full p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl font-semibold text-[#0D221D]">
                Tạo lớp học mới
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateClass(false)}
                className="p-1.5 rounded-lg text-[#597169] hover:bg-[#EFF7F3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateClass} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                    Tên lớp *
                  </label>
                  <input
                    type="text"
                    required
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="Ví dụ: 12A3"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                    Mã lớp (tuỳ chọn)
                  </label>
                  <input
                    type="text"
                    maxLength={20}
                    value={classJoinCode}
                    onChange={(e) => setClassJoinCode(e.target.value.toUpperCase())}
                    placeholder="Để trống sẽ tự tạo"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] text-sm font-mono uppercase focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                    Môn học
                  </label>
                  <input
                    type="text"
                    value={classSubject}
                    onChange={(e) => setClassSubject(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3A524A] mb-1.5">
                    Khối
                  </label>
                  <input
                    type="text"
                    value={classGrade}
                    onChange={(e) => setClassGrade(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
              </div>

              {createClassError && (
                <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                  {createClassError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateClass(false)}
                  className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-sm font-medium text-[#3A524A] hover:bg-[#F8FAF9] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={creatingClass}
                  className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-medium hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
                >
                  {creatingClass ? 'Đang tạo...' : 'Tạo lớp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Import / Add Students */}
      {showImportModal && activeClass && (
        <div className="fixed inset-0 z-50 bg-[#082B23]/45 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#DAE5E0] max-w-lg w-full p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl font-semibold text-[#0D221D]">
                Thêm học sinh vào lớp {activeClass.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1.5 rounded-lg text-[#597169] hover:bg-[#EFF7F3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSingleOrBulk} className="space-y-4">
              <div className="p-4 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-3">
                <div className="text-xs font-semibold text-[#0D221D]">
                  Thêm nhanh 1 học sinh
                </div>
                <input
                  type="text"
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                  placeholder="Họ và tên (ví dụ: Nguyễn Văn An)"
                  className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm focus:outline-none focus:border-[#0F4C3F]"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={singlePhone}
                    onChange={(e) => setSinglePhone(e.target.value)}
                    placeholder="SĐT phụ huynh"
                    className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm focus:outline-none focus:border-[#0F4C3F]"
                  />
                  <input
                    type="text"
                    value={singleCode}
                    onChange={(e) => setSingleCode(e.target.value)}
                    placeholder="Mã HS (tuỳ chọn)"
                    className="w-full px-3 py-2 rounded-lg border border-[#CEDCD6] bg-white text-sm focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0D221D] mb-1.5">
                  Hoặc dán danh sách nhiều học sinh (mỗi dòng 1 em: Họ tên, SĐT, Mã HS)
                </label>
                <textarea
                  rows={5}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'Trần Minh Khang, 0901234567, HS1210\nLê Ngọc Hân, 0912345678, HS1211'}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] text-sm font-mono focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>

              {importError && (
                <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                  {importError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-sm font-medium text-[#3A524A] hover:bg-[#F8FAF9] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={savingStudents}
                  className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-medium hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
                >
                  {savingStudents ? 'Đang lưu...' : 'Lưu vào lớp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Student */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-[#082B23]/45 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#DAE5E0] max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl font-semibold text-[#0D221D]">
                Cập nhật thông tin học sinh
              </h3>
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="p-1.5 rounded-lg text-[#597169] hover:bg-[#EFF7F3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Họ và tên
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Mã học sinh
                </label>
                <input
                  type="text"
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Tên phụ huynh
                </label>
                <input
                  type="text"
                  value={editParentName}
                  onChange={(e) => setEditParentName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  SĐT phụ huynh
                </label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="09xxxxxxxx"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>

              {editError && (
                <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-sm font-medium text-[#3A524A] hover:bg-[#F8FAF9] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-medium hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
                >
                  {savingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Class & Join Code */}
      {editingClass && (
        <div className="fixed inset-0 z-50 bg-[#082B23]/45 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#DAE5E0] max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold tracking-[0.08em] text-[#8A630D] uppercase">
                  Thông tin lớp học
                </div>
                <h3 className="font-serif text-xl font-semibold text-[#0D221D]">
                  Chỉnh sửa lớp &amp; mã lớp
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingClass(null)}
                className="p-1.5 rounded-lg text-[#597169] hover:bg-[#EFF7F3] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveClassEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Tên lớp *
                </label>
                <input
                  type="text"
                  required
                  value={editClassName}
                  onChange={(e) => setEditClassName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Mã lớp (3–20 ký tự không dấu) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={20}
                  value={editClassJoinCode}
                  onChange={(e) => setEditClassJoinCode(e.target.value.toUpperCase())}
                  placeholder="VD: LY12A1"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] font-mono text-sm font-semibold uppercase text-[#8A630D] focus:outline-none focus:border-[#0F4C3F]"
                />
                <p className="text-[11px] text-[#597169] mt-1">
                  Mã sau chuẩn hoá:{' '}
                  <strong className="font-mono text-[#0F4C3F]">
                    {normalizeJoinCode(editClassJoinCode) || '—'}
                  </strong>
                  . Học sinh sẽ vào lớp bằng mã mới này.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3A524A] mb-1">
                    Môn học
                  </label>
                  <input
                    type="text"
                    value={editClassSubject}
                    onChange={(e) => setEditClassSubject(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3A524A] mb-1">
                    Khối
                  </label>
                  <input
                    type="text"
                    value={editClassGrade}
                    onChange={(e) => setEditClassGrade(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3A524A] mb-1">
                  Năm học
                </label>
                <input
                  type="text"
                  value={editClassYear}
                  onChange={(e) => setEditClassYear(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#CEDCD6] text-sm focus:outline-none focus:border-[#0F4C3F]"
                />
              </div>

              {editClassError && (
                <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
                  {editClassError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingClass(null)}
                  className="px-4 py-2 rounded-xl border border-[#CEDCD6] text-sm font-medium text-[#3A524A] hover:bg-[#F8FAF9] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={savingClassEdit}
                  className="px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] disabled:opacity-60 cursor-pointer"
                >
                  {savingClassEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
