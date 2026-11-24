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
  seedDemoDataForTeacher,
  subscribeClassStudents,
  updateStudentRecord,
} from '../services/firestoreService';
import type { Classroom, StudentRecord } from '../types';

interface ClassesViewProps {
  teacherId: string;
  classes: Classroom[];
  openCreateModalSignal?: number;
  onConsumeCreateSignal?: () => void;
}

export function ClassesView({
  teacherId,
  classes,
  openCreateModalSignal = 0,
  onConsumeCreateSignal,
}: ClassesViewProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const pendingClassIdRef = useRef<string | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Create class modal
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [className, setClassName] = useState('');
  const [classSubject, setClassSubject] = useState('Vật lí 12');
  const [classGrade, setClassGrade] = useState('Khối 12');
  const [creatingClass, setCreatingClass] = useState(false);
  const [createClassError, setCreateClassError] = useState<string | null>(null);
  const [seedingSample, setSeedingSample] = useState(false);

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
      });
      pendingClassIdRef.current = id;
      setSelectedClassId(id);
      setClassName('');
      setShowCreateClass(false);
    } catch (err) {
      setCreateClassError(extractFriendlyFirestoreError(err));
    } finally {
      setCreatingClass(false);
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
          <div className="text-xs font-medium tracking-[0.08em] text-[#66706C] uppercase">
            Quản lý lớp học
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#16231F] mt-1">
            Lớp &amp; học sinh
          </h1>
          <p className="text-sm text-[#5C6561] mt-1">
            Tạo lớp, nhập danh sách học sinh và cập nhật số điện thoại phụ huynh.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateClassError(null);
            setShowCreateClass(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1E4D43] text-white text-sm font-medium hover:bg-[#163B33] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
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
        <div className="bg-white border border-[#E7E5DF] rounded-2xl p-10 text-center space-y-3">
          <Users className="w-8 h-8 text-[#7C8581] mx-auto" />
          <h2 className="font-serif text-xl font-semibold text-[#16231F]">
            Chưa có lớp học nào
          </h2>
          <p className="text-sm text-[#5C6561] max-w-md mx-auto">
            Tạo lớp học đầu tiên để bắt đầu quản lý danh sách học sinh và giao đề kiểm tra.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setCreateClassError(null);
                setShowCreateClass(true);
              }}
              className="px-4 py-2 rounded-xl bg-[#1E4D43] text-white text-sm font-medium hover:bg-[#163B33] cursor-pointer"
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
              className="px-4 py-2 rounded-xl border border-[#DCD9D0] bg-white text-[#16231F] text-sm font-medium hover:bg-[#FAF9F6] disabled:opacity-60 cursor-pointer"
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
                    ? 'bg-white border-[#1E4D43] ring-1 ring-[#1E4D43]/20'
                    : 'bg-white border-[#E7E5DF] hover:border-[#CFCBC0]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-serif text-xl font-semibold text-[#16231F]">
                      Lớp {cls.name}
                    </h3>
                    <p className="text-xs text-[#66706C] mt-0.5">
                      {cls.subject} · {cls.grade || 'THPT'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClass(cls.id);
                    }}
                    title="Xoá lớp"
                    className="p-1.5 rounded-lg text-[#8C9590] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-4 pt-3 border-t border-[#F0EEE8] flex items-center justify-between text-xs">
                  <span className="text-[#434D49] font-medium tabular-nums">
                    {isSelected ? students.length : cls.studentCount} học sinh
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyCode(cls.joinCode);
                    }}
                    className="inline-flex items-center gap-1.5 text-[#1E4D43] font-mono hover:underline cursor-pointer"
                  >
                    {copiedCode === cls.joinCode ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
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
        <section className="bg-white border border-[#E7E5DF] rounded-2xl p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-xl font-semibold text-[#16231F]">
                Danh sách học sinh — Lớp {activeClass.name}
              </h2>
              <div className="text-xs text-[#66706C] mt-1 flex flex-wrap items-center gap-2">
                <span>
                  {students.length} học sinh · Môn {activeClass.subject} · Năm học{' '}
                  {activeClass.academicYear}
                </span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => handleCopyCode(activeClass.joinCode)}
                  className="inline-flex items-center gap-1 font-mono font-semibold text-[#1E4D43] hover:underline cursor-pointer"
                >
                  {copiedCode === activeClass.joinCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                      <span>Đã chép mã {activeClass.joinCode}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Mã lớp: {activeClass.joinCode}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyCode(
                      `${window.location.origin}/?classCode=${encodeURIComponent(activeClass.joinCode)}`
                    )
                  }
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-[#DCD9D0] bg-[#FAF9F6] text-[11px] font-medium text-[#1E4D43] hover:bg-[#E5ECE7] cursor-pointer"
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
                <Search className="w-4 h-4 text-[#7C8581] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm tên, mã HS, SĐT..."
                  className="pl-9 pr-3.5 py-2 rounded-xl border border-[#DCD9D0] bg-[#FAF9F6] text-sm text-[#16231F] focus:outline-none focus:border-[#1E4D43] w-56"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setImportError(null);
                  setShowImportModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E4D43] text-white text-sm font-medium hover:bg-[#163B33] transition-colors whitespace-nowrap cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Thêm / Nhập danh sách</span>
              </button>
            </div>
          </div>

          {filteredStudents.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#66706C]">
              {students.length === 0
                ? 'Lớp chưa có học sinh nào. Nhấn "Thêm / Nhập danh sách" để nhập nhanh.'
                : 'Không tìm thấy học sinh khớp từ khoá.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#ECEAE4] text-xs font-medium text-[#66706C] uppercase tracking-wider">
                    <th className="py-3 pr-4">STT</th>
                    <th className="py-3 pr-4">Họ và tên</th>
                    <th className="py-3 pr-4">Mã HS</th>
                    <th className="py-3 pr-4">Phụ huynh</th>
                    <th className="py-3 pr-4">SĐT phụ huynh</th>
                    <th className="py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EEE8] text-sm">
                  {filteredStudents.map((stu, idx) => (
                    <tr key={stu.id} className="hover:bg-[#FAF9F6] transition-colors">
                      <td className="py-3 pr-4 text-[#66706C] tabular-nums">{idx + 1}</td>
                      <td className="py-3 pr-4 font-medium text-[#16231F]">
                        {stu.fullName}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-[#5C6561]">
                        {stu.studentCode || '—'}
                      </td>
                      <td className="py-3 pr-4 text-[#434D49]">
                        {stu.parentName || '—'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs tabular-nums">
                        {stu.parentPhone ? (
                          <span className="text-[#16231F]">{stu.parentPhone}</span>
                        ) : (
                          <span className="text-[#9AA19D]">chưa có SĐT</span>
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
                            className="p-1.5 rounded-lg text-[#5C6561] hover:text-[#1E4D43] hover:bg-[#E5ECE7] transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteStudent(stu)}
                            title="Xoá học sinh"
                            className="p-1.5 rounded-lg text-[#5C6561] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Modal: Create Class */}
      {showCreateClass && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E7E5DF] max-w-md w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl font-semibold text-[#16231F]">
                Tạo lớp học mới
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateClass(false)}
                className="p-1.5 rounded-lg text-[#66706C] hover:bg-[#F5F4F0] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateClass} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#434D49] mb-1.5">
                  Tên lớp *
                </label>
                <input
                  type="text"
                  required
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="Ví dụ: 12A3"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD9D0] text-sm focus:outline-none focus:border-[#1E4D43]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#434D49] mb-1.5">
                    Môn học
                  </label>
                  <input
                    type="text"
                    value={classSubject}
                    onChange={(e) => setClassSubject(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD9D0] text-sm focus:outline-none focus:border-[#1E4D43]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#434D49] mb-1.5">
                    Khối
                  </label>
                  <input
                    type="text"
                    value={classGrade}
                    onChange={(e) => setClassGrade(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD9D0] text-sm focus:outline-none focus:border-[#1E4D43]"
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
                  className="px-4 py-2 rounded-xl border border-[#DCD9D0] text-sm font-medium text-[#434D49] hover:bg-[#F5F4F0] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={creatingClass}
                  className="px-4 py-2 rounded-xl bg-[#1E4D43] text-white text-sm font-medium hover:bg-[#163B33] disabled:opacity-60 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E7E5DF] max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl font-semibold text-[#16231F]">
                Thêm học sinh vào lớp {activeClass.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1.5 rounded-lg text-[#66706C] hover:bg-[#F5F4F0] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSingleOrBulk} className="space-y-4">
              <div className="p-4 rounded-xl bg-[#FAF9F6] border border-[#E7E5DF] space-y-3">
                <div className="text-xs font-semibold text-[#16231F]">
                  Thêm nhanh 1 học sinh
                </div>
                <input
                  type="text"
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                  placeholder="Họ và tên (ví dụ: Nguyễn Văn An)"
                  className="w-full px-3 py-2 rounded-lg border border-[#DCD9D0] bg-white text-sm focus:outline-none focus:border-[#1E4D43]"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={singlePhone}
                    onChange={(e) => setSinglePhone(e.target.value)}
                    placeholder="SĐT phụ huynh"
                    className="w-full px-3 py-2 rounded-lg border border-[#DCD9D0] bg-white text-sm focus:outline-none focus:border-[#1E4D43]"
                  />
                  <input
                    type="text"
                    value={singleCode}
                    onChange={(e) => setSingleCode(e.target.value)}
                    placeholder="Mã HS (tuỳ chọn)"
                    className="w-full px-3 py-2 rounded-lg border border-[#DCD9D0] bg-white text-sm focus:outline-none focus:border-[#1E4D43]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#16231F] mb-1.5">
                  Hoặc dán danh sách nhiều học sinh (mỗi dòng 1 em: Họ tên, SĐT, Mã HS)
                </label>
                <textarea
                  rows={5}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'Trần Minh Khang, 0901234567, HS1210\nLê Ngọc Hân, 0912345678, HS1211'}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD9D0] text-sm font-mono focus:outline-none focus:border-[#1E4D43]"
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
                  className="px-4 py-2 rounded-xl border border-[#DCD9D0] text-sm font-medium text-[#434D49] hover:bg-[#F5F4F0] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={savingStudents}
                  className="px-4 py-2 rounded-xl bg-[#1E4D43] text-white text-sm font-medium hover:bg-[#163B33] disabled:opacity-60 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E7E5DF] max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl font-semibold text-[#16231F]">
                Cập nhật thông tin học sinh
              </h3>
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="p-1.5 rounded-lg text-[#66706C] hover:bg-[#F5F4F0] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-[#434D49] mb-1">
                  Họ và tên
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#DCD9D0] text-sm focus:outline-none focus:border-[#1E4D43]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#434D49] mb-1">
                  Mã học sinh
                </label>
                <input
                  type="text"
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#DCD9D0] text-sm focus:outline-none focus:border-[#1E4D43]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#434D49] mb-1">
                  Tên phụ huynh
                </label>
                <input
                  type="text"
                  value={editParentName}
                  onChange={(e) => setEditParentName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#DCD9D0] text-sm focus:outline-none focus:border-[#1E4D43]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#434D49] mb-1">
                  SĐT phụ huynh
                </label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="09xxxxxxxx"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#DCD9D0] text-sm focus:outline-none focus:border-[#1E4D43]"
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
                  className="px-4 py-2 rounded-xl border border-[#DCD9D0] text-sm font-medium text-[#434D49] hover:bg-[#F5F4F0] cursor-pointer"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-xl bg-[#1E4D43] text-white text-sm font-medium hover:bg-[#163B33] disabled:opacity-60 cursor-pointer"
                >
                  {savingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
