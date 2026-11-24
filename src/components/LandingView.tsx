import {
  ArrowRight,
  BookOpenCheck,
  GraduationCap,
  KeyRound,
  LogOut,
  Mail,
  UserCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import type { User } from 'firebase/auth';

interface LandingViewProps {
  user: User | null;
  userRole: 'teacher' | 'student' | null;
  authLoading: boolean;
  onTeacherSignIn: (emailHint?: string) => Promise<void>;
  onStudentSignIn: (examCode?: string) => Promise<void>;
  onEnterTeacherDashboard: () => void;
  onEnterStudentMode: (examCode?: string, studentCode?: string, classCode?: string) => void;
  onSignOut: () => Promise<void>;
  authError: string | null;
}

export function LandingView({
  user,
  userRole,
  authLoading,
  onTeacherSignIn,
  onStudentSignIn,
  onEnterTeacherDashboard,
  onEnterStudentMode,
  onSignOut,
  authError,
}: LandingViewProps) {
  const [teacherEmailInput, setTeacherEmailInput] = useState('');
  const [classCodeInput, setClassCodeInput] = useState('');
  const [examCodeInput, setExamCodeInput] = useState('');
  const [studentCodeInput, setStudentCodeInput] = useState('');
  const [guestCodeError, setGuestCodeError] = useState<string | null>(null);

  const handleTeacherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onTeacherSignIn(teacherEmailInput.trim() || undefined);
  };

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuestCodeError(null);
    if (user && userRole === 'student') {
      onEnterStudentMode(
        examCodeInput.trim() || undefined,
        studentCodeInput.trim() || undefined,
        classCodeInput.trim() || undefined
      );
      return;
    }
    await onStudentSignIn(examCodeInput.trim() || undefined);
  };

  const handleGuestExamEntry = () => {
    if (user && userRole === 'teacher') {
      onEnterStudentMode(
        examCodeInput.trim() || undefined,
        undefined,
        classCodeInput.trim() || undefined
      );
      return;
    }
    const cleanClassCode = classCodeInput.trim().toUpperCase();
    const cleanStuCode = studentCodeInput.trim().toUpperCase();
    if (!cleanClassCode && !cleanStuCode) {
      setGuestCodeError(
        'Vui lòng nhập Mã lớp (ví dụ: LY12A1) để vào lớp chọn tên, hoặc nhập Mã học sinh (ví dụ: HS1201).'
      );
      return;
    }
    setGuestCodeError(null);
    onEnterStudentMode(
      examCodeInput.trim() || undefined,
      cleanStuCode || undefined,
      cleanClassCode || undefined
    );
  };

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#0D221D] flex flex-col">
      {/* Header: Deep Imperial Jade + Champagne Gold trim */}
      <header className="border-b border-[#C89B2B]/30 bg-[#0A362C] text-white">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#E5C665] via-[#C89B2B] to-[#9E7514] text-[#082B23] font-serif font-bold text-sm flex items-center justify-center ring-1 ring-[#F4DE96]/50">
              10
            </span>
            <span className="font-serif font-bold text-lg text-white">
              Điểm 10
            </span>
          </div>

          <div className="text-xs font-medium text-[#E5C665] tracking-wide">
            Cổng đăng nhập Giáo viên &amp; Học sinh
          </div>
        </div>
      </header>

      {/* Main Centered Role Login Area */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10 sm:py-14">
        <div className="max-w-4xl w-full space-y-8">
          <div className="text-center space-y-2 max-w-xl mx-auto">
            <div className="text-xs font-semibold tracking-[0.12em] text-[#8A630D] uppercase">
              Hệ thống khảo thí &amp; chấm bài thông minh
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-[#0D221D]">
              Chọn vai trò để tiếp tục
            </h1>
            <p className="text-sm text-[#4A615A]">
              Giao diện dành riêng cho Giáo viên quản lý lớp học, phân tích dữ liệu và Học sinh vào lớp làm bài kiểm tra.
            </p>
          </div>

          {authError && (
            <div className="max-w-2xl mx-auto p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-sm text-[#B91C1C] text-center">
              {authError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* TEACHER LOGIN CARD */}
            <section className="bg-white border border-[#DAE5E0] rounded-2xl p-6 sm:p-7 flex flex-col justify-between space-y-6 shadow-[0_6px_24px_-12px_rgba(10,54,44,0.12)]">
              <div className="space-y-4">
                <div className="flex items-center gap-3 pb-4 border-b border-[#EBF1EE]">
                  <div className="w-11 h-11 rounded-xl bg-[#0A362C] text-[#E5C665] flex items-center justify-center shrink-0 ring-1 ring-[#C89B2B]/40">
                    <BookOpenCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl font-semibold text-[#0D221D]">
                      Giáo viên
                    </h2>
                    <p className="text-xs text-[#597169]">
                      Quản lý lớp học, đề thi &amp; chấm bài AI
                    </p>
                  </div>
                </div>

                {user && userRole === 'teacher' ? (
                  <div className="p-4 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F4C3F]">
                      <UserCheck className="w-3.5 h-3.5 text-[#8A630D]" />
                      <span>Đang đăng nhập tài khoản Giáo viên</span>
                    </div>
                    <div className="text-sm font-medium text-[#0D221D] truncate">
                      {user.email || user.displayName}
                    </div>
                  </div>
                ) : (
                  <form id="teacher-login-form" onSubmit={handleTeacherSubmit} className="space-y-3">
                    <div>
                      <label
                        htmlFor="teacher-email-input"
                        className="block text-xs font-medium text-[#3A524A] mb-1.5"
                      >
                        Email Google Giáo viên (tuỳ chọn gợi ý)
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-[#698078] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          id="teacher-email-input"
                          type="email"
                          value={teacherEmailInput}
                          onChange={(e) => setTeacherEmailInput(e.target.value)}
                          placeholder="giaovien@gmail.com"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm text-[#0D221D] focus:outline-none focus:ring-2 focus:ring-[#0F4C3F]/20 focus:border-[#0F4C3F]"
                        />
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-xs text-[#694E10] leading-relaxed">
                      Khi đăng nhập bằng email giáo viên, hệ thống tự động nạp sẵn dữ liệu lớp học (12A1, 12A2, 12A5), danh sách học sinh và đề kiểm tra mẫu.
                    </div>
                  </form>
                )}
              </div>

              <div className="space-y-2.5 pt-2">
                {user && userRole === 'teacher' ? (
                  <>
                    <button
                      type="button"
                      onClick={onEnterTeacherDashboard}
                      className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#0F4C3F] border border-[#C89B2B]/40 text-white text-sm font-medium hover:bg-[#0A362C] transition-colors cursor-pointer"
                    >
                      <span>Vào lớp học &amp; bảng điều khiển</span>
                      <ArrowRight className="w-4 h-4 text-[#E5C665]" />
                    </button>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        disabled={authLoading}
                        onClick={() => onTeacherSignIn(teacherEmailInput.trim() || undefined)}
                        className="text-xs font-medium text-[#0F4C3F] hover:underline cursor-pointer"
                      >
                        Đổi email giáo viên khác
                      </button>
                      <button
                        type="button"
                        onClick={onSignOut}
                        className="inline-flex items-center gap-1 text-xs text-[#597169] hover:text-[#0D221D] cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Đăng xuất</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="submit"
                    form="teacher-login-form"
                    disabled={authLoading}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#0F4C3F] border border-[#C89B2B]/40 text-white text-sm font-medium hover:bg-[#0A362C] transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    <span>
                      {authLoading ? 'Đang đăng nhập...' : 'Đăng nhập bằng mail Giáo viên'}
                    </span>
                    <ArrowRight className="w-4 h-4 text-[#E5C665]" />
                  </button>
                )}
              </div>
            </section>

            {/* STUDENT LOGIN CARD */}
            <section className="bg-white border border-[#EAD8A6] rounded-2xl p-6 sm:p-7 flex flex-col justify-between space-y-6 shadow-[0_6px_24px_-12px_rgba(166,124,27,0.14)]">
              <div className="space-y-4">
                <div className="flex items-center gap-3 pb-4 border-b border-[#F4ECD4]">
                  <div className="w-11 h-11 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] flex items-center justify-center shrink-0">
                    <GraduationCap className="w-5 h-5 text-[#0F4C3F]" />
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl font-semibold text-[#0D221D]">
                      Học sinh
                    </h2>
                    <p className="text-xs text-[#597169]">
                      Vào phòng thi toàn màn hình &amp; nộp bài
                    </p>
                  </div>
                </div>

                {user && userRole === 'student' && (
                  <div className="p-3.5 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F4C3F]">
                      <UserCheck className="w-3.5 h-3.5 text-[#8A630D]" />
                      <span>Đang đăng nhập tài khoản Học sinh</span>
                    </div>
                    <div className="text-sm font-medium text-[#0D221D] truncate">
                      {user.email || user.displayName}
                    </div>
                  </div>
                )}

                <form id="student-login-form" onSubmit={handleStudentSubmit} className="space-y-3">
                  <div>
                    <label
                      htmlFor="class-code-entry"
                      className="block text-xs font-semibold text-[#0D221D] mb-1.5"
                    >
                      Mã lớp học (để vào lớp &amp; chọn tên bạn)
                    </label>
                    <div className="relative">
                      <Users className="w-4 h-4 text-[#698078] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="class-code-entry"
                        type="text"
                        value={classCodeInput}
                        onChange={(e) => {
                          setClassCodeInput(e.target.value);
                          if (guestCodeError) setGuestCodeError(null);
                        }}
                        placeholder="Ví dụ: 12A1_XXXX hoặc LY12A1"
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm font-mono uppercase text-[#0D221D] focus:outline-none focus:ring-2 focus:ring-[#0F4C3F]/20 focus:border-[#0F4C3F]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="exam-code-entry"
                        className="block text-xs font-medium text-[#3A524A] mb-1.5"
                      >
                        Mã đề kiểm tra (tuỳ chọn)
                      </label>
                      <input
                        id="exam-code-entry"
                        type="text"
                        value={examCodeInput}
                        onChange={(e) => setExamCodeInput(e.target.value)}
                        placeholder="Ví dụ: VL12HK1"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm font-mono text-[#0D221D] focus:outline-none focus:ring-2 focus:ring-[#0F4C3F]/20 focus:border-[#0F4C3F]"
                      />
                    </div>

                    {(!user || userRole !== 'teacher') && (
                      <div>
                        <label
                          htmlFor="student-code-entry"
                          className="block text-xs font-medium text-[#3A524A] mb-1.5"
                        >
                          Hoặc Mã học sinh
                        </label>
                        <div className="relative">
                          <KeyRound className="w-4 h-4 text-[#698078] absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            id="student-code-entry"
                            type="text"
                            value={studentCodeInput}
                            onChange={(e) => {
                              setStudentCodeInput(e.target.value);
                              if (guestCodeError) setGuestCodeError(null);
                            }}
                            placeholder="VD: HS1201"
                            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-sm font-mono uppercase text-[#0D221D] focus:outline-none focus:ring-2 focus:ring-[#0F4C3F]/20 focus:border-[#0F4C3F]"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {guestCodeError && (
                    <p className="text-xs text-[#B91C1C]">{guestCodeError}</p>
                  )}

                  <p className="text-xs text-[#4A615A] leading-relaxed">
                    Nhập <strong>Mã lớp</strong> do thầy cô cung cấp để vào danh sách lớp, chọn đúng tên của mình và làm bài (không cần mật khẩu), hoặc đăng nhập bằng Google.
                  </p>
                </form>
              </div>

              <div className="space-y-2.5 pt-2">
                {user && userRole === 'student' ? (
                  <>
                    <button
                      type="submit"
                      form="student-login-form"
                      className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-[#C89B2B] to-[#B0831A] text-white text-sm font-semibold hover:from-[#B58A21] hover:to-[#9B7214] transition-all cursor-pointer"
                    >
                      <span>Vào lớp &amp; phòng thi Học sinh</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        disabled={authLoading}
                        onClick={() => onStudentSignIn(examCodeInput.trim() || undefined)}
                        className="text-xs font-medium text-[#0F4C3F] hover:underline cursor-pointer"
                      >
                        Đổi tài khoản học sinh
                      </button>
                      <button
                        type="button"
                        onClick={onSignOut}
                        className="inline-flex items-center gap-1 text-xs text-[#597169] hover:text-[#0D221D] cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Đăng xuất</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleGuestExamEntry}
                      className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-[#C89B2B] to-[#B0831A] text-white text-sm font-semibold hover:from-[#B58A21] hover:to-[#9B7214] transition-all cursor-pointer"
                    >
                      <span>
                        {user && userRole === 'teacher'
                          ? 'Xem thử phòng thi Học sinh'
                          : 'Vào lớp & chọn tên để làm bài'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <button
                      type="submit"
                      form="student-login-form"
                      disabled={authLoading}
                      className="w-full py-2.5 px-4 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-[#3A524A] text-xs font-medium hover:bg-[#EAF3EF] transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {authLoading ? 'Đang đăng nhập...' : 'Đăng nhập Học sinh bằng Google'}
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
