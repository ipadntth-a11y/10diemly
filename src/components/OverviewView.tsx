import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  ShieldAlert,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import {
  deleteSubmission,
  extractFriendlyFirestoreError,
} from '../services/firestoreService';
import type { Classroom, Exam, Submission } from '../types';
import { resolveClassForSubmission } from '../utils/classStats';
import { summarizeCohortEffort } from '../utils/effortAnalysis';
import { formatDurationMMSS, formatScore } from '../utils/formatters';
import { ClassStatsSection } from './ClassStatsSection';

interface OverviewViewProps {
  teacherId: string;
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
  teacherId,
  classes,
  exams,
  submissions,
  onOpenExam,
  onOpenSubmission,
  onQuickCreateClass,
  onQuickCreateExam,
  onOpenStudentMode,
}: OverviewViewProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statsExamId, setStatsExamId] = useState<string>('all');
  const [statsClassFilter, setStatsClassFilter] = useState<string>('all');

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

  const filteredRecentSource = submissions.filter((sub) => {
    if (statsExamId !== 'all' && sub.examId !== statsExamId) return false;
    if (statsClassFilter !== 'all') {
      const resolved = resolveClassForSubmission(sub, classes);
      const subClassLabel = (resolved?.name || sub.className || 'Chưa ghi lớp').trim();
      if (subClassLabel.toLowerCase() !== statsClassFilter.trim().toLowerCase()) {
        return false;
      }
    }
    return true;
  });
  const recentSubmissions = filteredRecentSource.slice(0, 8);
  const cohortEffort = summarizeCohortEffort(filteredRecentSource, exams);
  const flaggedAndWatchEffort = [
    ...cohortEffort.flaggedItems,
    ...cohortEffort.watchItems,
  ];
  const [effortTab, setEffortTab] = useState<'perfunctory' | 'all_flagged'>('perfunctory');
  const firstExam = exams[0];

  const handleConfirmDelete = async (subId: string) => {
    setDeletingId(subId);
    setDeleteError(null);
    try {
      await deleteSubmission(subId, teacherId);
      setConfirmDeleteId(null);
    } catch (err) {
      setDeleteError(extractFriendlyFirestoreError(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="text-xs font-semibold tracking-[0.12em] text-[#8A630D] uppercase">
          Tổng quan hệ thống
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-[#0D221D] mt-1">
          Chào thầy cô
        </h1>
        <p className="text-sm text-[#4A615A] mt-1.5">
          Theo dõi lớp học, đề đang mở và những bài vừa nộp. Có thể xoá nhanh bài làm thử để giữ số liệu chuẩn.
        </p>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between text-xs font-semibold tracking-[0.06em] text-[#597169] uppercase">
            <span>Lớp học</span>
            <span className="w-8 h-8 rounded-lg bg-[#EFF7F3] text-[#0F4C3F] flex items-center justify-center">
              <GraduationCap className="w-4 h-4" strokeWidth={1.8} />
            </span>
          </div>
          <div className="font-serif text-3xl font-semibold text-[#0D221D] tabular-nums">
            {classes.length}
          </div>
        </div>

        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between text-xs font-semibold tracking-[0.06em] text-[#597169] uppercase">
            <span>Đề kiểm tra</span>
            <span className="w-8 h-8 rounded-lg bg-[#EFF7F3] text-[#0F4C3F] flex items-center justify-center">
              <BookOpen className="w-4 h-4" strokeWidth={1.8} />
            </span>
          </div>
          <div className="font-serif text-3xl font-semibold text-[#0D221D] tabular-nums">
            {exams.length}
          </div>
        </div>

        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between text-xs font-semibold tracking-[0.06em] text-[#597169] uppercase">
            <span>Bài đã nộp</span>
            <span className="w-8 h-8 rounded-lg bg-[#FDF8EB] text-[#8A630D] flex items-center justify-center">
              <ClipboardCheck className="w-4 h-4" strokeWidth={1.8} />
            </span>
          </div>
          <div className="font-serif text-3xl font-semibold text-[#0D221D] tabular-nums">
            {submissions.length}
          </div>
        </div>

        <div className="bg-white border border-[#EAD8A6] rounded-2xl p-5 flex flex-col justify-between gap-4 bg-gradient-to-br from-white to-[#FDF9EF]">
          <div className="flex items-center justify-between text-xs font-semibold tracking-[0.06em] text-[#7A580B] uppercase">
            <span>Điểm trung bình</span>
            <span className="w-8 h-8 rounded-lg bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" strokeWidth={1.8} />
            </span>
          </div>
          <div className="font-serif text-3xl font-semibold text-[#0F4C3F] tabular-nums">
            {avgPercent}%
          </div>
        </div>
      </div>

      {/* Class-by-class Score Statistics */}
      <ClassStatsSection
        classes={classes}
        submissions={submissions}
        exams={exams}
        selectedExamId={statsExamId}
        onChangeExamId={(id) => {
          setStatsExamId(id);
          setStatsClassFilter('all');
        }}
        activeClassFilter={statsClassFilter}
        onSelectClassFilter={setStatsClassFilter}
        exportPrefix={
          statsExamId !== 'all'
            ? exams.find((e) => e.id === statsExamId)?.examCode || 'de_thi'
            : 'tong_hop'
        }
      />

      {/* Perfunctory / Superficial Effort Analysis */}
      <section className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#EBF1EE]">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.1em] text-[#B91C1C] uppercase">
              Giám sát chất lượng làm bài
            </div>
            <h2 className="font-serif text-xl font-semibold text-[#0D221D] mt-0.5">
              Phân tích &amp; Phát hiện học sinh làm bài đối phó
            </h2>
            <p className="text-xs text-[#597169] mt-0.5">
              Tự động phát hiện các bài nộp chọn đại (&lt;5s/câu), lặp một đáp án (toàn A/B/C/D), bỏ trống tự luận hoặc thoát màn hình nhiều lần.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
            <span className="px-2.5 py-1 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] font-semibold tabular-nums">
              {cohortEffort.perfunctoryCount} đối phó
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] font-semibold tabular-nums">
              {cohortEffort.watchCount} cần lưu ý
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-[#EFF7F3] border border-[#C5DDD3] text-[#0F6D4F] font-semibold tabular-nums">
              {cohortEffort.seriousCount} nghiêm túc
            </span>
          </div>
        </div>

        {filteredRecentSource.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#597169]">
            Chưa có bài nộp nào trong phạm vi lọc hiện tại để phân tích.
          </div>
        ) : flaggedAndWatchEffort.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] flex items-center gap-2.5 text-xs text-[#0F4C3F]">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#0F6D4F]" />
            <span>
              Tất cả {filteredRecentSource.length} bài nộp đang xét đều thể hiện thái độ làm bài nghiêm túc, chưa phát hiện dấu hiệu làm đối phó.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="inline-flex p-1 rounded-xl bg-[#E6EEEA] gap-1 text-xs">
              <button
                type="button"
                onClick={() => setEffortTab('perfunctory')}
                className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${
                  effortTab === 'perfunctory'
                    ? 'bg-white text-[#B91C1C] font-semibold shadow-xs'
                    : 'text-[#4A615A]'
                }`}
              >
                Làm đối phó rõ rệt ({cohortEffort.perfunctoryCount})
              </button>
              <button
                type="button"
                onClick={() => setEffortTab('all_flagged')}
                className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${
                  effortTab === 'all_flagged'
                    ? 'bg-white text-[#0D221D] font-semibold shadow-xs'
                    : 'text-[#4A615A]'
                }`}
              >
                Tất cả cần chú ý ({flaggedAndWatchEffort.length})
              </button>
            </div>

            {(() => {
              const displayItems =
                effortTab === 'perfunctory'
                  ? cohortEffort.flaggedItems
                  : flaggedAndWatchEffort;
              if (displayItems.length === 0) {
                return (
                  <div className="p-4 rounded-xl bg-[#F8FAF9] border border-[#EBF1EE] text-xs text-[#4A615A]">
                    Không có học sinh nào ở mức đối phó rõ rệt; chuyển sang tab «Tất cả cần chú ý» để xem {cohortEffort.watchCount} bài cần lưu ý tốc độ.
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {displayItems.slice(0, 8).map(({ submission: sub, analysis }) => {
                    const isPerfunctory = analysis.level === 'perfunctory';
                    return (
                      <div
                        key={sub.id}
                        className={`p-4 rounded-xl border space-y-2 ${
                          isPerfunctory
                            ? 'bg-[#FEF2F2]/60 border-[#FECACA]'
                            : 'bg-[#FDF8EB]/70 border-[#EAD8A6]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {isPerfunctory ? (
                                <ShieldAlert className="w-4 h-4 text-[#B91C1C] shrink-0" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-[#8A630D] shrink-0" />
                              )}
                              <span className="font-semibold text-sm text-[#0D221D] truncate">
                                {sub.studentName}
                              </span>
                              {sub.className && (
                                <span className="text-xs text-[#4A615A]">
                                  · Lớp {sub.className}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#597169] truncate mt-0.5">
                              {sub.examTitle} · {formatScore(sub.totalScore)}/{formatScore(sub.maxScore)}đ ·{' '}
                              {formatDurationMMSS(sub.durationSeconds)}
                            </div>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold shrink-0 tabular-nums border ${
                              isPerfunctory
                                ? 'bg-white border-[#FCA5A5] text-[#B91C1C]'
                                : 'bg-white border-[#EAD8A6] text-[#8A630D]'
                            }`}
                          >
                            Rủi ro {analysis.riskScore}%
                          </span>
                        </div>

                        <ul className="list-disc pl-4 text-xs text-[#3A524A] space-y-0.5">
                          {analysis.reasons.slice(0, 3).map((r, rIdx) => (
                            <li key={rIdx}>{r}</li>
                          ))}
                        </ul>

                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => onOpenSubmission(sub.id)}
                            className="text-xs font-semibold text-[#0F4C3F] hover:underline cursor-pointer"
                          >
                            Xem chi tiết bài làm →
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(sub.id)}
                            className="text-[11px] font-medium text-[#B91C1C] hover:underline cursor-pointer"
                          >
                            Xoá bài đối phó
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </section>

      {/* Main 2-column content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Recent submissions */}
        <section className="lg:col-span-8 bg-white border border-[#DAE5E0] rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#EBF1EE]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                Bài nộp gần đây
              </h2>
              {statsClassFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setStatsClassFilter('all')}
                  className="px-2.5 py-0.5 rounded-lg bg-[#EFF7F3] border border-[#C5DDD3] text-xs font-semibold text-[#0F4C3F] hover:bg-[#E2EFE8] cursor-pointer"
                >
                  Lớp {statsClassFilter} ×
                </button>
              )}
            </div>
            {firstExam && (
              <button
                type="button"
                onClick={() => onOpenExam(firstExam.id)}
                className="text-sm font-semibold text-[#0F4C3F] hover:text-[#8A630D] transition-colors whitespace-nowrap cursor-pointer"
              >
                Xem đề &amp; thống kê
              </button>
            )}
          </div>

          {deleteError && (
            <div className="mt-3 p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]">
              {deleteError}
            </div>
          )}

          {recentSubmissions.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm text-[#4A615A]">Chưa có bài nộp nào.</p>
              <button
                type="button"
                onClick={onOpenStudentMode}
                className="text-sm font-semibold text-[#0F4C3F] hover:underline cursor-pointer"
              >
                Thử làm bài trong giao diện học sinh
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#EDF3F0]">
              {recentSubmissions.map((sub) => {
                const ratio = sub.maxScore > 0 ? sub.totalScore / sub.maxScore : 0;
                const isGood = ratio >= 0.7;
                const scoreText = `${formatScore(sub.totalScore)}/${formatScore(sub.maxScore)}`;
                const isConfirming = confirmDeleteId === sub.id;
                const isDeleting = deletingId === sub.id;

                return (
                  <div
                    key={sub.id}
                    className="py-3 px-2 -mx-2 rounded-xl flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 hover:bg-[#F8FAF9] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenSubmission(sub.id)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="text-sm font-semibold text-[#0D221D] truncate">
                        {sub.studentName}
                      </div>
                      <div className="text-xs text-[#597169] mt-0.5 flex flex-wrap items-center gap-1.5 tabular-nums">
                        {sub.className && (
                          <>
                            <span>Lớp {sub.className}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
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
                                  : 'text-[#8A630D] font-medium'
                              }
                            >
                              {sub.violationCount > 3
                                ? `${sub.violationCount} vi phạm (ép buộc nộp)`
                                : `${sub.violationCount} vi phạm`}
                            </span>
                          </>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold tabular-nums border ${
                          isGood
                            ? 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0F4C3F]'
                            : 'bg-[#FDF8EB] border-[#EAD8A6] text-[#8A630D]'
                        }`}
                      >
                        {scoreText}
                      </span>

                      {isConfirming ? (
                        <div className="inline-flex items-center gap-1.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-2 py-1">
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => void handleConfirmDelete(sub.id)}
                            className="text-[11px] font-semibold text-[#B91C1C] hover:underline cursor-pointer whitespace-nowrap"
                          >
                            {isDeleting ? 'Đang xoá...' : 'Xác nhận xoá'}
                          </button>
                          <span className="text-[#FCA5A5]">|</span>
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[11px] font-medium text-[#4A615A] hover:text-[#0D221D] cursor-pointer"
                          >
                            Huỷ
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(sub.id)}
                            title="Xoá bài làm này để thu số liệu chuẩn"
                            className="p-1.5 rounded-lg text-[#698078] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenSubmission(sub.id)}
                            title="Mở chi tiết bài làm"
                            className="p-1 rounded-lg text-[#698078] hover:text-[#0F4C3F] cursor-pointer"
                          >
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Quick actions */}
        <aside className="lg:col-span-4 bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
              Bắt đầu nhanh
            </h2>
            <span className="w-2 h-2 rounded-full bg-[#C89B2B]" aria-hidden="true" />
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={onQuickCreateClass}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#DAE5E0] bg-[#F8FAF9] hover:border-[#0F4C3F] hover:bg-[#EFF7F3] text-left text-sm font-medium text-[#0D221D] transition-colors cursor-pointer"
            >
              <GraduationCap className="w-4 h-4 text-[#0F4C3F] shrink-0" />
              <span>Tạo lớp và nhập danh sách</span>
            </button>

            <button
              type="button"
              onClick={onQuickCreateExam}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#DAE5E0] bg-[#F8FAF9] hover:border-[#0F4C3F] hover:bg-[#EFF7F3] text-left text-sm font-medium text-[#0D221D] transition-colors cursor-pointer"
            >
              <BookOpen className="w-4 h-4 text-[#8A630D] shrink-0" />
              <span>Soạn đề hoặc đẩy file Word</span>
            </button>

            <button
              type="button"
              onClick={onOpenStudentMode}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#EAD8A6] bg-[#FDF8EB] hover:border-[#C89B2B] text-left text-sm font-medium text-[#0D221D] transition-colors cursor-pointer"
            >
              <ClipboardCheck className="w-4 h-4 text-[#8A630D] shrink-0" />
              <span>Xem giao diện học sinh</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
