import { BarChart3, Download, Filter, Trophy } from 'lucide-react';
import type { Classroom, Exam, Submission } from '../types';
import {
  computeClassScoreStats,
  exportClassStatsCsv,
  type ClassScoreStat,
} from '../utils/classStats';
import { formatDurationMMSS, formatScore } from '../utils/formatters';

interface ClassStatsSectionProps {
  title?: string;
  subtitle?: string;
  classes: Classroom[];
  submissions: Submission[];
  exams?: Exam[];
  selectedExamId?: string;
  onChangeExamId?: (examId: string) => void;
  activeClassFilter?: string;
  onSelectClassFilter?: (className: string) => void;
  exportPrefix?: string;
}

export function ClassStatsSection({
  title = 'Thống kê điểm theo từng lớp',
  subtitle = 'So sánh điểm trung bình (quy đổi thang 10), tỉ lệ đạt và phân bố mức độ giữa các lớp.',
  classes,
  submissions,
  exams,
  selectedExamId = 'all',
  onChangeExamId,
  activeClassFilter,
  onSelectClassFilter,
  exportPrefix = 'diem10',
}: ClassStatsSectionProps) {
  const scopedSubmissions =
    selectedExamId && selectedExamId !== 'all'
      ? submissions.filter((s) => s.examId === selectedExamId)
      : submissions;

  const stats: ClassScoreStat[] = computeClassScoreStats(scopedSubmissions, classes, {
    includeEmptyClasses: true,
  });

  const activeStats = stats.filter((s) => s.submissionCount > 0);
  const topClass = activeStats[0] || null;
  const maxAvg10 = Math.max(10, ...activeStats.map((s) => s.avgScore10));

  return (
    <section className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-5 shadow-[0_1px_2px_rgba(10,54,44,0.03)]">
      {/* Header row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#EBF1EE]">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#C89B2B] shrink-0" />
            <h2 className="font-serif text-lg sm:text-xl font-semibold text-[#0D221D]">
              {title}
            </h2>
          </div>
          <p className="text-xs text-[#597169] mt-0.5">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {exams && exams.length > 0 && onChangeExamId && (
            <select
              value={selectedExamId}
              onChange={(e) => onChangeExamId(e.target.value)}
              aria-label="Chọn đề kiểm tra để thống kê theo lớp"
              className="px-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-xs font-medium text-[#0D221D] focus:outline-none focus:border-[#0F4C3F] max-w-[240px]"
            >
              <option value="all">Tất cả các đề ({submissions.length} bài)</option>
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title}
                </option>
              ))}
            </select>
          )}

          {stats.length > 0 && (
            <button
              type="button"
              onClick={() => exportClassStatsCsv(stats, exportPrefix)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#CEDCD6] bg-white text-xs font-medium text-[#0D221D] hover:bg-[#EFF7F3] transition-colors whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#0F4C3F]" />
              <span>Xuất CSV theo lớp</span>
            </button>
          )}
        </div>
      </div>

      {stats.length === 0 ? (
        <div className="py-10 text-center text-sm text-[#597169]">
          Chưa có lớp học hoặc bài nộp nào để thống kê điểm.
        </div>
      ) : (
        <>
          {/* Visual Comparison Bars for classes with submissions */}
          {activeStats.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-8 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-[#3A524A]">
                  <span>So sánh Điểm trung bình theo lớp (thang 10)</span>
                  {topClass && activeStats.length > 1 && (
                    <span className="inline-flex items-center gap-1.5 text-[#8A630D]">
                      <Trophy className="w-3.5 h-3.5 text-[#C89B2B]" />
                      <span>
                        Dẫn đầu: Lớp {topClass.className} ({topClass.avgScore10.toFixed(2)}/10)
                      </span>
                    </span>
                  )}
                </div>

                <div className="space-y-2.5">
                  {activeStats.map((row) => {
                    const widthPct = Math.max(
                      4,
                      Math.round((row.avgScore10 / maxAvg10) * 100)
                    );
                    const barColor =
                      row.avgScore10 >= 6.5
                        ? 'bg-[#0F4C3F]'
                        : row.avgScore10 >= 5
                          ? 'bg-[#C89B2B]'
                          : 'bg-[#DC2626]';
                    const isFiltered =
                      activeClassFilter &&
                      activeClassFilter !== 'all' &&
                      activeClassFilter.toLowerCase() === row.className.toLowerCase();

                    return (
                      <div
                        key={row.key}
                        className={`p-3 rounded-xl border transition-colors ${
                          isFiltered
                            ? 'bg-[#EFF7F3] border-[#0F4C3F]'
                            : 'bg-[#F8FAF9] border-[#EBF1EE]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#0D221D]">
                              Lớp {row.className}
                            </span>
                            <span className="text-[#597169] tabular-nums">
                              ({row.submissionCount} bài
                              {row.rosterCount > 0
                                ? ` · ${row.uniqueStudentCount}/${row.rosterCount} HS`
                                : ''}
                              )
                            </span>
                          </div>
                          <div className="flex items-center gap-3 tabular-nums">
                            <span className="text-[#4A615A]">
                              Đạt: <strong className="text-[#0D221D]">{row.passRate}%</strong>
                            </span>
                            <span className="font-mono font-bold text-[#0A362C]">
                              {row.avgScore10.toFixed(2)}/10
                            </span>
                          </div>
                        </div>

                        <div className="h-2.5 w-full rounded-full bg-[#E4ECE8] overflow-hidden">
                          <div
                            style={{ width: `${widthPct}%` }}
                            className={`h-full rounded-full ${barColor} transition-all duration-300`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tier legend & summary card */}
              <div className="lg:col-span-4 p-4 rounded-2xl bg-gradient-to-br from-white to-[#FDF8EB] border border-[#EAD8A6] space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#8A630D]">
                  Phân loại học lực toàn khối
                </div>
                {(() => {
                  const totals = activeStats.reduce(
                    (acc, r) => ({
                      excellent: acc.excellent + r.tiers.excellent,
                      good: acc.good + r.tiers.good,
                      average: acc.average + r.tiers.average,
                      weak: acc.weak + r.tiers.weak,
                      all: acc.all + r.submissionCount,
                    }),
                    { excellent: 0, good: 0, average: 0, weak: 0, all: 0 }
                  );
                  const tierItems = [
                    {
                      label: 'Giỏi (≥ 8,0)',
                      count: totals.excellent,
                      bar: 'bg-[#0F6D4F]',
                      text: 'text-[#0F6D4F]',
                    },
                    {
                      label: 'Khá (6,5 – 7,9)',
                      count: totals.good,
                      bar: 'bg-[#2C7A62]',
                      text: 'text-[#0F4C3F]',
                    },
                    {
                      label: 'Trung bình (5,0 – 6,4)',
                      count: totals.average,
                      bar: 'bg-[#C89B2B]',
                      text: 'text-[#8A630D]',
                    },
                    {
                      label: 'Chưa đạt (< 5,0)',
                      count: totals.weak,
                      bar: 'bg-[#DC2626]',
                      text: 'text-[#B91C1C]',
                    },
                  ];
                  return (
                    <div className="space-y-2.5">
                      {tierItems.map((t) => {
                        const pct =
                          totals.all > 0 ? Math.round((t.count / totals.all) * 100) : 0;
                        return (
                          <div key={t.label} className="space-y-1 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-[#3A524A] font-medium">{t.label}</span>
                              <span className={`font-semibold tabular-nums ${t.text}`}>
                                {t.count} bài ({pct}%)
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-[#EFE7D1] overflow-hidden">
                              <div
                                style={{ width: `${pct}%` }}
                                className={`h-full rounded-full ${t.bar}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Detailed table per class */}
          <div className="overflow-x-auto pt-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DAE5E0] text-[11px] font-semibold text-[#597169] uppercase tracking-wider">
                  <th className="py-3 pr-4">Lớp</th>
                  <th className="py-3 pr-4">Số bài nộp</th>
                  <th className="py-3 pr-4">Điểm TB (/10)</th>
                  <th className="py-3 pr-4">Cao nhất / Thấp nhất</th>
                  <th className="py-3 pr-4">Tỉ lệ đạt (≥5)</th>
                  <th className="py-3 pr-4">Giỏi · Khá · TB · Yếu</th>
                  <th className="py-3 pr-4">TG trung bình</th>
                  {onSelectClassFilter && <th className="py-3 text-right">Xem theo lớp</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDF3F0] text-sm">
                {stats.map((row) => {
                  const hasSubs = row.submissionCount > 0;
                  const isFiltered =
                    activeClassFilter &&
                    activeClassFilter !== 'all' &&
                    activeClassFilter.toLowerCase() === row.className.toLowerCase();

                  return (
                    <tr
                      key={row.key}
                      className={`transition-colors ${
                        isFiltered ? 'bg-[#EFF7F3]' : 'hover:bg-[#F8FAF9]'
                      }`}
                    >
                      <td className="py-3.5 pr-4 font-semibold text-[#0D221D]">
                        <div>Lớp {row.className}</div>
                        {row.rosterCount > 0 && (
                          <div className="text-[11px] font-normal text-[#597169] tabular-nums">
                            {row.uniqueStudentCount}/{row.rosterCount} HS đã làm
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 pr-4 tabular-nums text-[#3A524A]">
                        {hasSubs ? (
                          <span className="font-medium text-[#0D221D]">
                            {row.submissionCount} bài
                          </span>
                        ) : (
                          <span className="text-xs text-[#8DA29B]">Chưa có bài</span>
                        )}
                      </td>

                      <td className="py-3.5 pr-4 tabular-nums">
                        {hasSubs ? (
                          <div>
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-bold border ${
                                row.avgScore10 >= 6.5
                                  ? 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0F4C3F]'
                                  : row.avgScore10 >= 5
                                    ? 'bg-[#FDF8EB] border-[#EAD8A6] text-[#8A630D]'
                                    : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                              }`}
                            >
                              {row.avgScore10.toFixed(2)}/10
                            </span>
                            {row.hasUniformMaxScore && row.avgMaxScore !== 10 && (
                              <div className="text-[11px] text-[#597169] mt-0.5">
                                Gốc: {formatScore(row.avgRawScore)}/{formatScore(row.avgMaxScore)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[#8DA29B]">—</span>
                        )}
                      </td>

                      <td className="py-3.5 pr-4 text-xs tabular-nums">
                        {hasSubs ? (
                          <div className="space-y-0.5">
                            <div className="text-[#0F6D4F] font-semibold">
                              Cao: {row.highest10.toFixed(2)}
                              {row.highestStudentName ? ` (${row.highestStudentName})` : ''}
                            </div>
                            <div className="text-[#B91C1C]">
                              Thấp: {row.lowest10.toFixed(2)}
                              {row.lowestStudentName ? ` (${row.lowestStudentName})` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[#8DA29B]">—</span>
                        )}
                      </td>

                      <td className="py-3.5 pr-4 text-xs tabular-nums">
                        {hasSubs ? (
                          <span className="font-semibold text-[#0D221D]">
                            {row.passRate}%{' '}
                            <span className="font-normal text-[#597169]">
                              ({row.passCount}/{row.submissionCount})
                            </span>
                          </span>
                        ) : (
                          <span className="text-[#8DA29B]">—</span>
                        )}
                      </td>

                      <td className="py-3.5 pr-4 text-xs font-mono tabular-nums text-[#3A524A]">
                        {hasSubs ? (
                          <span>
                            <strong className="text-[#0F6D4F]">{row.tiers.excellent}</strong> ·{' '}
                            <strong className="text-[#0F4C3F]">{row.tiers.good}</strong> ·{' '}
                            <strong className="text-[#8A630D]">{row.tiers.average}</strong> ·{' '}
                            <strong className="text-[#B91C1C]">{row.tiers.weak}</strong>
                          </span>
                        ) : (
                          <span className="text-[#8DA29B]">—</span>
                        )}
                      </td>

                      <td className="py-3.5 pr-4 font-mono text-xs text-[#4A615A] tabular-nums">
                        {hasSubs ? formatDurationMMSS(row.avgDurationSeconds) : '—'}
                      </td>

                      {onSelectClassFilter && (
                        <td className="py-3.5 text-right">
                          {hasSubs ? (
                            <button
                              type="button"
                              onClick={() =>
                                onSelectClassFilter(isFiltered ? 'all' : row.className)
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                                isFiltered
                                  ? 'bg-[#0F4C3F] text-white'
                                  : 'border border-[#CEDCD6] bg-white text-[#0F4C3F] hover:bg-[#EFF7F3]'
                              }`}
                            >
                              <Filter className="w-3 h-3" />
                              <span>{isFiltered ? 'Đang lọc' : 'Lọc lớp'}</span>
                            </button>
                          ) : (
                            <span className="text-xs text-[#8DA29B]">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
