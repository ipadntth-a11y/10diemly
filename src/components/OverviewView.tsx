import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  TrendingUp,
} from 'lucide-react';
import type { Classroom, Exam, Submission } from '../types';
import { formatDurationMMSS, formatScore } from '../utils/formatters';

interface OverviewViewProps {
  classes: Classroom[];
  exams: Exam[];
  submissions: Submission[];
  onOpenExam: (examId: string) => void;
  onOpenSubmission: (submissionId: string) => void;
  onQuickCreateClass: () => void;
  onQuickCreateExam: () => void;
  onOpenStudentMode: () => void;
}

export function OverviewView({
  classes,
  exams,
  submissions,
  onOpenExam,
  onOpenSubmission,
  onQuickCreateClass,
  onQuickCreateExam,
  onOpenStudentMode,
}: OverviewViewProps) {
  const avgPercent =
    submissions.length > 0
      ? Math.round(
          (submissions.reduce(
            (sum, s) => sum + (s.maxScore > 0 ? s.totalScore / s.maxScore : 0),
            0
          ) /
            submissions.length) *
            100
        )
      : 0;

  const recentSubmissions = submissions.slice(0, 8);
  const firstExam = exams[0];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="text-xs font-medium tracking-[0.08em] text-[#66706C] uppercase">
          Tổng quan
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-[#16231F] mt-1">
          Chào thầy cô
        </h1>
        <p className="text-sm text-[#5C6561] mt-1.5">
          Theo dõi lớp, đề đang mở và những bài vừa nộp.
        </p>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E7E5DF] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between text-xs font-medium tracking-[0.06em] text-[#66706C] uppercase">
            <span>Lớp học</span>
            <GraduationCap className="w-4 h-4 text-[#7C8581]" strokeWidth={1.8} />
          </div>
          <div className="font-serif text-3xl font-semibold text-[#16231F] tabular-nums">
            {classes.length}
          </div>
        </div>

        <div className="bg-white border border-[#E7E5DF] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between text-xs font-medium tracking-[0.06em] text-[#66706C] uppercase">
            <span>Đề kiểm tra</span>
            <BookOpen className="w-4 h-4 text-[#7C8581]" strokeWidth={1.8} />
          </div>
          <div className="font-serif text-3xl font-semibold text-[#16231F] tabular-nums">
            {exams.length}
          </div>
        </div>

        <div className="bg-white border border-[#E7E5DF] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between text-xs font-medium tracking-[0.06em] text-[#66706C] uppercase">
            <span>Bài đã nộp</span>
            <ClipboardCheck className="w-4 h-4 text-[#7C8581]" strokeWidth={1.8} />
          </div>
          <div className="font-serif text-3xl font-semibold text-[#16231F] tabular-nums">
            {submissions.length}
          </div>
        </div>

        <div className="bg-white border border-[#E7E5DF] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between text-xs font-medium tracking-[0.06em] text-[#66706C] uppercase">
            <span>Điểm trung bình</span>
            <TrendingUp className="w-4 h-4 text-[#7C8581]" strokeWidth={1.8} />
          </div>
          <div className="font-serif text-3xl font-semibold text-[#16231F] tabular-nums">
            {avgPercent}%
          </div>
        </div>
      </div>

      {/* Main 2-column content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Recent submissions */}
        <section className="lg:col-span-8 bg-white border border-[#E7E5DF] rounded-2xl p-6">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#ECEAE4]">
            <h2 className="font-serif text-lg font-semibold text-[#16231F]">
              Bài nộp gần đây
            </h2>
            {firstExam && (
              <button
                type="button"
                onClick={() => onOpenExam(firstExam.id)}
                className="text-sm font-medium text-[#1E4D43] hover:text-[#163B33] transition-colors whitespace-nowrap cursor-pointer"
              >
                Xem đề
              </button>
            )}
          </div>

          {recentSubmissions.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm text-[#5C6561]">Chưa có bài nộp nào.</p>
              <button
                type="button"
                onClick={onOpenStudentMode}
                className="text-sm font-medium text-[#1E4D43] hover:underline cursor-pointer"
              >
                Thử làm bài trong giao diện học sinh
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#F0EEE8]">
              {recentSubmissions.map((sub) => {
                const ratio = sub.maxScore > 0 ? sub.totalScore / sub.maxScore : 0;
                const isGood = ratio >= 0.7;
                const scoreText = `${formatScore(sub.totalScore)}/${formatScore(sub.maxScore)}`;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => onOpenSubmission(sub.id)}
                    className="w-full py-3.5 px-2 -mx-2 rounded-xl flex items-center justify-between gap-4 hover:bg-[#FAF9F6] transition-colors text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#16231F] truncate">
                        {sub.studentName}
                      </div>
                      <div className="text-xs text-[#66706C] mt-0.5 flex flex-wrap items-center gap-1.5 tabular-nums">
                        <span>{formatDurationMMSS(sub.durationSeconds)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {sub.status === 'pending_essay' ? 'chờ chấm tự luận' : 'đã chấm'}
                        </span>
                        {sub.violationCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                sub.violationCount > 3
                                  ? 'text-[#B91C1C] font-semibold'
                                  : 'text-[#B45309]'
                              }
                            >
                              {sub.violationCount > 3
                                ? `${sub.violationCount} vi phạm (ép buộc nộp)`
                                : `${sub.violationCount} vi phạm`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold tabular-nums ${
                          isGood
                            ? 'bg-[#E6F2FA] text-[#1D5F8A]'
                            : 'bg-[#FDF1DC] text-[#A85D0A]'
                        }`}
                      >
                        {scoreText}
                      </span>
                      <ArrowRight className="w-4 h-4 text-[#7C8581]" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Quick actions */}
        <aside className="lg:col-span-4 bg-white border border-[#E7E5DF] rounded-2xl p-6 space-y-4">
          <h2 className="font-serif text-lg font-semibold text-[#16231F]">
            Bắt đầu nhanh
          </h2>

          <div className="space-y-3">
            <button
              type="button"
              onClick={onQuickCreateClass}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#E7E5DF] bg-white hover:bg-[#FAF9F6] text-left text-sm font-medium text-[#16231F] transition-colors cursor-pointer"
            >
              <GraduationCap className="w-4 h-4 text-[#1E4D43] shrink-0" />
              <span>Tạo lớp và nhập danh sách</span>
            </button>

            <button
              type="button"
              onClick={onQuickCreateExam}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#E7E5DF] bg-white hover:bg-[#FAF9F6] text-left text-sm font-medium text-[#16231F] transition-colors cursor-pointer"
            >
              <BookOpen className="w-4 h-4 text-[#1E4D43] shrink-0" />
              <span>Soạn đề từ đề mẫu</span>
            </button>

            <button
              type="button"
              onClick={onOpenStudentMode}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#E7E5DF] bg-white hover:bg-[#FAF9F6] text-left text-sm font-medium text-[#16231F] transition-colors cursor-pointer"
            >
              <ClipboardCheck className="w-4 h-4 text-[#1E4D43] shrink-0" />
              <span>Xem giao diện học sinh</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
