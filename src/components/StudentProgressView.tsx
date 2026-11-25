import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  analyzeStudentProgressWithAi,
  type AnalyzeStudentProgressOutput,
} from '../services/geminiService';
import type { EffortLevel, StudentJournalEntry } from '../types';
import { formatDurationMMSS, formatScore } from '../utils/formatters';
import { MathText } from './MathText';

interface StudentProgressViewProps {
  studentName: string;
  className: string;
  studentCode?: string;
  entries: StudentJournalEntry[];
  loading: boolean;
  onRefresh: () => void;
  onGoToExamRoom: () => void;
  onRetakeExam: (examId: string, examCode?: string) => void;
}

function getEffortBadgeMeta(level: EffortLevel): {
  label: string;
  badgeClass: string;
} {
  if (level === 'perfunctory') {
    return {
      label: 'Làm đối phó',
      badgeClass: 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]',
    };
  }
  if (level === 'watch') {
    return {
      label: 'Cần lưu ý tốc độ',
      badgeClass: 'bg-[#FDF8EB] border-[#EAD8A6] text-[#8A630D]',
    };
  }
  return {
    label: 'Nghiêm túc',
    badgeClass: 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0F6D4F]',
  };
}

function formatShortDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'Vừa xong';
  const d = new Date(ts);
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDayMonth(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  });
}

export function StudentProgressView({
  studentName,
  className,
  studentCode,
  entries,
  loading,
  onRefresh,
  onGoToExamRoom,
  onRetakeExam,
}: StudentProgressViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(
    entries[0]?.submissionId ?? null
  );
  const [effortFilter, setEffortFilter] = useState<'all' | 'serious' | 'flagged'>('all');
  const [aiProgress, setAiProgress] = useState<AnalyzeStudentProgressOutput | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [lastAiDigest, setLastAiDigest] = useState<string>('');

  // Reset expanded item when entries change
  useEffect(() => {
    if (entries.length > 0 && !entries.some((e) => e.submissionId === expandedId)) {
      setExpandedId(entries[0].submissionId);
    }
  }, [entries, expandedId]);

  const chronologicalEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) => Date.parse(a.submittedAtIso) - Date.parse(b.submittedAtIso)
      ),
    [entries]
  );

  const metrics = useMemo(() => {
    const count = chronologicalEntries.length;
    if (count === 0) {
      return {
        count: 0,
        avg10: 0,
        bestEntry: null as StudentJournalEntry | null,
        delta10: 0,
        seriousCount: 0,
        perfunctoryCount: 0,
        watchCount: 0,
        seriousRate: 100,
        statusLabel: 'Chưa có dữ liệu',
        statusTone: 'neutral' as const,
        typeBreakdown: [] as Array<{ label: string; pct: number; earned: number; max: number }>,
      };
    }

    const avg10 =
      chronologicalEntries.reduce((s, e) => s + e.score10, 0) / count;
    let bestEntry = chronologicalEntries[0];
    chronologicalEntries.forEach((e) => {
      if (e.score10 >= bestEntry.score10) bestEntry = e;
    });

    const latest = chronologicalEntries[count - 1];
    const priorAvg =
      count > 1
        ? chronologicalEntries.slice(0, count - 1).reduce((s, e) => s + e.score10, 0) /
          (count - 1)
        : latest.score10;
    const delta10 = count > 1 ? Number((latest.score10 - priorAvg).toFixed(2)) : 0;

    const seriousCount = chronologicalEntries.filter((e) => e.effortLevel === 'serious').length;
    const perfunctoryCount = chronologicalEntries.filter(
      (e) => e.effortLevel === 'perfunctory'
    ).length;
    const watchCount = chronologicalEntries.filter((e) => e.effortLevel === 'watch').length;
    const seriousRate = Math.round((seriousCount / count) * 100);

    let statusLabel = 'Đang ổn định';
    let statusTone: 'high' | 'mid' | 'warn' | 'neutral' = 'mid';
    if (
      perfunctoryCount >= Math.ceil(count * 0.5) ||
      (latest.effortLevel === 'perfunctory' && avg10 < 5.5)
    ) {
      statusLabel = 'Cần chấn chỉnh thái độ làm bài';
      statusTone = 'warn';
    } else if (avg10 >= 8.2 && seriousRate >= 75) {
      statusLabel = 'Học lực Xuất sắc · Nghiêm túc';
      statusTone = 'high';
    } else if (count >= 2 && delta10 >= 0.45 && avg10 >= 5) {
      statusLabel = 'Đang tiến bộ tích cực';
      statusTone = 'high';
    } else if (avg10 >= 6.5) {
      statusLabel = 'Phong độ Khá · Ổn định';
      statusTone = 'mid';
    } else {
      statusLabel = 'Cần củng cố nền tảng';
      statusTone = 'warn';
    }

    const typeAccum = new Map<string, { label: string; earned: number; max: number }>();
    const order = ['mcq', 'true_false', 'short_answer', 'essay'];
    const defaultLabels: Record<string, string> = {
      mcq: 'Trắc nghiệm',
      true_false: 'Đúng / Sai',
      short_answer: 'Trả lời ngắn',
      essay: 'Tự luận',
    };

    chronologicalEntries.forEach((e) => {
      (e.typeStats || []).forEach((st) => {
        const prev = typeAccum.get(st.type) || {
          label: st.label || defaultLabels[st.type] || st.type,
          earned: 0,
          max: 0,
        };
        prev.earned += Number(st.earned || 0);
        prev.max += Number(st.max || 0);
        typeAccum.set(st.type, prev);
      });
    });

    const typeBreakdown = order
      .map((k) => typeAccum.get(k))
      .filter((x): x is { label: string; earned: number; max: number } => Boolean(x && x.max > 0))
      .map((x) => ({
        label: x.label,
        earned: Number(x.earned.toFixed(2)),
        max: Number(x.max.toFixed(2)),
        pct: x.max > 0 ? Math.round((x.earned / x.max) * 100) : 0,
      }));

    return {
      count,
      avg10: Number(avg10.toFixed(2)),
      bestEntry,
      delta10,
      seriousCount,
      perfunctoryCount,
      watchCount,
      seriousRate,
      statusLabel,
      statusTone,
      typeBreakdown,
    };
  }, [chronologicalEntries]);

  const runAiProgressAnalysis = async () => {
    if (chronologicalEntries.length === 0) return;
    setAiLoading(true);
    setAiError(null);
    const digest = chronologicalEntries
      .map((e) => `${e.submissionId}:${e.totalScore}`)
      .join('|');
    try {
      const data = await analyzeStudentProgressWithAi({
        studentName: studentName || 'Học sinh',
        className: className || undefined,
        attempts: chronologicalEntries.slice(-15).map((e) => ({
          examTitle: e.examTitle,
          subject: e.subject,
          score10: e.score10,
          totalScore: e.totalScore,
          maxScore: e.maxScore,
          durationSeconds: e.durationSeconds,
          violationCount: e.violationCount,
          effortLevel:
            e.effortLevel === 'perfunctory'
              ? 'Làm đối phó'
              : e.effortLevel === 'watch'
                ? 'Cần lưu ý'
                : 'Nghiêm túc',
          dateLabel: formatShortDate(e.submittedAtIso),
        })),
        typeStats: metrics.typeBreakdown.map((t) => ({
          label: t.label,
          pct: t.pct,
        })),
      });
      setAiProgress(data);
      setLastAiDigest(digest);
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'Không thể tải phân tích tổng quan từ AI.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  // Auto-generate holistic AI progress commentary once when student opens tab with data
  useEffect(() => {
    if (chronologicalEntries.length === 0) {
      setAiProgress(null);
      setAiError(null);
      setLastAiDigest('');
      return;
    }
    const digest = chronologicalEntries
      .map((e) => `${e.submissionId}:${e.totalScore}`)
      .join('|');
    if (digest !== lastAiDigest && !aiLoading) {
      void runAiProgressAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chronologicalEntries.length, studentName, className]);

  const filteredJournal = useMemo(() => {
    if (effortFilter === 'serious') {
      return entries.filter((e) => e.effortLevel === 'serious');
    }
    if (effortFilter === 'flagged') {
      return entries.filter((e) => e.effortLevel !== 'serious');
    }
    return entries;
  }, [entries, effortFilter]);

  const statusToneStyle =
    metrics.statusTone === 'high'
      ? 'bg-[#EFF7F3] border-[#C5DDD3] text-[#0F6D4F]'
      : metrics.statusTone === 'warn'
        ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
        : metrics.statusTone === 'mid'
          ? 'bg-[#FDF8EB] border-[#EAD8A6] text-[#8A630D]'
          : 'bg-[#F8FAF9] border-[#DAE5E0] text-[#4A615A]';

  // SVG chart geometry
  const chartPoints = useMemo(() => {
    const recent = chronologicalEntries.slice(-12);
    const width = 560;
    const height = 180;
    const padL = 34;
    const padR = 20;
    const padT = 18;
    const padB = 26;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;

    const coords = recent.map((e, i) => {
      const x =
        recent.length === 1
          ? padL + innerW / 2
          : padL + (i / (recent.length - 1)) * innerW;
      const clamped = Math.min(Math.max(e.score10, 0), 10);
      const y = padT + (1 - clamped / 10) * innerH;
      return { x, y, entry: e };
    });

    const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
    const areaPath =
      coords.length > 0
        ? `M ${coords[0].x},${padT + innerH} ` +
          coords.map((c) => `L ${c.x},${c.y}`).join(' ') +
          ` L ${coords[coords.length - 1].x},${padT + innerH} Z`
        : '';

    return { width, height, padL, padR, padT, padB, innerH, coords, polyline, areaPath };
  }, [chronologicalEntries]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="bg-gradient-to-br from-white via-white to-[#FDF8EB] border border-[#EAD8A6] rounded-2xl p-6 sm:p-7 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-xs">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-[#8A630D] uppercase">
              Hồ sơ tiến độ &amp; Tổng quan học tập
            </span>
            <span className={`px-2.5 py-0.5 rounded-md border text-xs font-semibold ${statusToneStyle}`}>
              {metrics.statusLabel}
            </span>
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#0D221D]">
            {studentName || 'Học sinh'}
          </h1>
          <p className="text-sm text-[#4A615A] flex flex-wrap items-center gap-2">
            {className && <span>Lớp {className}</span>}
            {studentCode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-xs text-[#0F4C3F]">Mã HS: {studentCode}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>Ghi nhận {metrics.count} lần làm bài</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#CEDCD6] bg-white text-xs font-semibold text-[#0D221D] hover:bg-[#EFF7F3] disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#0F4C3F] ${loading ? 'animate-spin' : ''}`} />
            <span>Cập nhật</span>
          </button>
          <button
            type="button"
            onClick={onGoToExamRoom}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F4C3F] text-white text-xs font-semibold hover:bg-[#0A362C] cursor-pointer shadow-xs"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#E5C665]" />
            <span>Vào phòng thi / Làm đề mới</span>
          </button>
        </div>
      </section>

      {loading && entries.length === 0 ? (
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-12 text-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#0F4C3F] mx-auto" />
          <p className="text-sm text-[#4A615A]">Đang tải nhật ký làm bài và tiến độ học tập...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-[#DAE5E0] rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] text-[#0F4C3F] flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
              Chưa có lịch sử làm bài được ghi nhận
            </h2>
            <p className="text-xs sm:text-sm text-[#4A615A] leading-relaxed">
              {studentName
                ? `Hãy hoàn thành ít nhất 1 đề kiểm tra dưới tên "${studentName}" để hệ thống tự động ghi chép bảng tiến độ, biểu đồ điểm và phân tích năng lực cho bạn.`
                : 'Hãy chọn lớp & tên của bạn ở mục Phòng thi, hoàn thành bài kiểm tra để lưu nhật ký học tập và xem đánh giá tiến độ tại đây.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToExamRoom}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F4C3F] text-white text-sm font-semibold hover:bg-[#0A362C] cursor-pointer"
          >
            <span>Bắt đầu làm bài ngay</span>
            <ArrowUpRight className="w-4 h-4 text-[#E5C665]" />
          </button>
        </div>
      ) : (
        <>
          {/* 4 Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#597169]">
                Số lần làm bài
              </div>
              <div className="font-serif text-3xl font-semibold text-[#0D221D] tabular-nums">
                {metrics.count}
              </div>
              <div className="text-xs text-[#4A615A] tabular-nums">
                {metrics.seriousCount} bài nghiêm túc
              </div>
            </div>

            <div className="bg-gradient-to-br from-white to-[#FDF8EB] border border-[#EAD8A6] rounded-2xl p-5 space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#8A630D]">
                Điểm trung bình (thang 10)
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-3xl font-semibold text-[#0A362C] tabular-nums">
                  {metrics.avg10.toFixed(2)}
                </span>
                {metrics.count > 1 && metrics.delta10 !== 0 && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${
                      metrics.delta10 > 0 ? 'text-[#0F6D4F]' : 'text-[#B91C1C]'
                    }`}
                  >
                    {metrics.delta10 > 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5" />
                    )}
                    {metrics.delta10 > 0 ? `+${metrics.delta10}` : metrics.delta10}
                  </span>
                )}
              </div>
              <div className="text-xs text-[#7A580B]">
                {metrics.count > 1
                  ? 'So sánh bài gần nhất với TB trước đó'
                  : 'Tính trên lần thi đầu tiên'}
              </div>
            </div>

            <div className="bg-white border border-[#DAE5E0] rounded-2xl p-5 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#597169]">
                <span>Điểm cao nhất</span>
                <Award className="w-4 h-4 text-[#C89B2B]" />
              </div>
              <div className="font-serif text-3xl font-semibold text-[#0F4C3F] tabular-nums">
                {metrics.bestEntry ? metrics.bestEntry.score10.toFixed(2) : '0.00'}/10
              </div>
              <div className="text-xs text-[#4A615A] truncate">
                {metrics.bestEntry?.examTitle || ''}
              </div>
            </div>

            <div
              className={`rounded-2xl p-5 space-y-1.5 border ${
                metrics.perfunctoryCount > 0
                  ? 'bg-[#FEF2F2]/60 border-[#FECACA]'
                  : 'bg-[#EFF7F3]/70 border-[#C5DDD3]'
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-wider text-[#597169]">
                Thái độ làm bài
              </div>
              <div className="font-serif text-3xl font-semibold text-[#0D221D] tabular-nums">
                {metrics.seriousRate}%
              </div>
              <div className="text-xs text-[#4A615A] tabular-nums">
                {metrics.perfunctoryCount > 0
                  ? `${metrics.perfunctoryCount} bài làm đối phó · ${metrics.watchCount} cần lưu ý`
                  : metrics.watchCount > 0
                    ? `${metrics.watchCount} bài cần chậm lại kiểm tra`
                    : 'Giữ vững tác phong làm bài nghiêm túc'}
              </div>
            </div>
          </div>

          {/* Trend Chart + Type Skill Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Score Trend SVG Chart */}
            <section className="lg:col-span-7 bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                    Biểu đồ tiến độ điểm số (thang 10)
                  </h2>
                  <p className="text-xs text-[#597169]">
                    Theo dõi biến động qua tối đa 12 lần làm bài gần nhất
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[#4A615A]">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#0F4C3F]" /> Nghiêm túc
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#C89B2B]" /> Cần lưu ý
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#B91C1C]" /> Đối phó
                  </span>
                </div>
              </div>

              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${chartPoints.width} ${chartPoints.height}`}
                  className="w-full min-w-[420px] h-48 overflow-visible"
                  role="img"
                  aria-label="Biểu đồ tiến độ điểm qua các lần làm bài"
                >
                  <defs>
                    <linearGradient id="studentProgressGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0F4C3F" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#0F4C3F" stopOpacity="0.01" />
                    </linearGradient>
                  </defs>

                  {[0, 2.5, 5, 7.5, 10].map((tick) => {
                    const y =
                      chartPoints.padT + (1 - tick / 10) * chartPoints.innerH;
                    return (
                      <g key={tick}>
                        <line
                          x1={chartPoints.padL}
                          y1={y}
                          x2={chartPoints.width - chartPoints.padR}
                          y2={y}
                          stroke="#E6EEEA"
                          strokeDasharray={tick === 5 ? '4 3' : undefined}
                        />
                        <text
                          x={chartPoints.padL - 8}
                          y={y + 4}
                          textAnchor="end"
                          className="fill-[#698078] text-[10px]"
                        >
                          {tick}
                        </text>
                      </g>
                    );
                  })}

                  {chartPoints.coords.length > 1 && (
                    <>
                      <path d={chartPoints.areaPath} fill="url(#studentProgressGrad)" />
                      <polyline
                        fill="none"
                        stroke="#0F4C3F"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={chartPoints.polyline}
                      />
                    </>
                  )}

                  {chartPoints.coords.map((pt, idx) => {
                    const dotFill =
                      pt.entry.effortLevel === 'perfunctory'
                        ? '#B91C1C'
                        : pt.entry.effortLevel === 'watch'
                          ? '#C89B2B'
                          : '#0F4C3F';
                    return (
                      <g key={pt.entry.submissionId}>
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={6}
                          fill="#FFFFFF"
                          stroke={dotFill}
                          strokeWidth="2.5"
                        />
                        <text
                          x={pt.x}
                          y={pt.y - 10}
                          textAnchor="middle"
                          className="fill-[#0D221D] text-[10px] font-semibold"
                        >
                          {pt.entry.score10.toFixed(1)}
                        </text>
                        <text
                          x={pt.x}
                          y={chartPoints.height - 6}
                          textAnchor="middle"
                          className="fill-[#597169] text-[10px]"
                        >
                          Lần {idx + 1} ({formatDayMonth(pt.entry.submittedAtIso)})
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </section>

            {/* Skill Breakdown by Question Type */}
            <section className="lg:col-span-5 bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-4">
              <div>
                <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                  Năng lực theo dạng câu hỏi
                </h2>
                <p className="text-xs text-[#597169]">
                  Tổng hợp độ chắc kiến thức qua các dạng bài bạn đã làm
                </p>
              </div>

              {metrics.typeBreakdown.length === 0 ? (
                <p className="text-xs text-[#597169] py-6">
                  Chưa có đủ dữ liệu chi tiết theo dạng câu hỏi.
                </p>
              ) : (
                <div className="space-y-3.5 pt-1">
                  {metrics.typeBreakdown.map((item) => {
                    const barColor =
                      item.pct >= 75
                        ? 'bg-[#0F4C3F]'
                        : item.pct >= 50
                          ? 'bg-[#C89B2B]'
                          : 'bg-[#DC2626]';
                    return (
                      <div key={item.label} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#0D221D]">{item.label}</span>
                          <span className="font-mono text-[#4A615A] tabular-nums">
                            {formatScore(item.earned)}/{formatScore(item.max)} đ ({item.pct}%)
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-[#EDF3F0] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                            style={{ width: `${Math.max(item.pct, 3)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* AI Holistic Progress Analysis */}
          <section className="bg-white border border-[#EAD8A6] rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#C89B2B]" />
                <h2 className="font-serif text-xl font-semibold text-[#0D221D]">
                  AI Phân tích tổng quan tình trạng học tập
                </h2>
              </div>
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => void runAiProgressAnalysis()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#CEDCD6] bg-[#F8FAF9] text-xs font-semibold text-[#0F4C3F] hover:bg-[#EFF7F3] disabled:opacity-60 cursor-pointer"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>AI đang tổng hợp...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-[#C89B2B]" />
                    <span>Phân tích lại tiến độ</span>
                  </>
                )}
              </button>
            </div>

            {aiLoading && !aiProgress ? (
              <div className="p-4 rounded-xl bg-[#EFF7F3] border border-[#DCECE4] flex items-center gap-3 text-xs text-[#0F4C3F]">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>AI đang tổng hợp toàn bộ các lần làm bài để đánh giá tiến độ của bạn...</span>
              </div>
            ) : aiError ? (
              <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex flex-wrap items-center justify-between gap-2 text-xs text-[#991B1B]">
                <span>{aiError}</span>
                <button
                  type="button"
                  onClick={() => void runAiProgressAnalysis()}
                  className="px-3 py-1 rounded-lg bg-white border border-[#FCA5A5] font-semibold text-[#991B1B] hover:bg-[#FEF2F2] cursor-pointer"
                >
                  Thử lại
                </button>
              </div>
            ) : aiProgress ? (
              <div className="space-y-3 text-xs sm:text-sm">
                <div className="p-4 rounded-xl bg-[#FDF8EB] border border-[#EAD8A6] space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#8A630D]">
                    Nhận định hiện trạng: {aiProgress.learningStatus}
                  </div>
                  <MathText
                    text={aiProgress.overallAssessment}
                    className="text-[#0D221D] leading-relaxed"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-[#F0FBF6] border border-[#C5DDD3] text-[#0D221D] space-y-1">
                    <div className="font-bold uppercase tracking-wider text-[#0F6D4F]">
                      Điểm mạnh cần phát huy
                    </div>
                    <MathText text={aiProgress.strengths} className="leading-relaxed" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#FEF2F2]/70 border border-[#FECACA] text-[#0D221D] space-y-1">
                    <div className="font-bold uppercase tracking-wider text-[#B91C1C]">
                      Thói quen &amp; Lỗi lặp lại
                    </div>
                    <MathText text={aiProgress.patternsToFix} className="leading-relaxed" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#EFF7F3] border border-[#DCECE4] text-[#0D221D] space-y-1">
                    <div className="font-bold uppercase tracking-wider text-[#0F4C3F]">
                      Mục tiêu lần thi tới
                    </div>
                    <MathText text={aiProgress.nextGoalPlan} className="leading-relaxed" />
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {/* Attempt Journal List */}
          <section className="bg-white border border-[#DAE5E0] rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#EBF1EE]">
              <div>
                <h2 className="font-serif text-lg font-semibold text-[#0D221D]">
                  Nhật ký các lần làm bài ({filteredJournal.length})
                </h2>
                <p className="text-xs text-[#597169]">
                  Bấm vào từng bài để xem điểm chi tiết từng phần, nhận xét AI và lời phê giáo viên.
                </p>
              </div>

              <div className="inline-flex p-1 rounded-xl bg-[#E6EEEA] gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setEffortFilter('all')}
                  className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${
                    effortFilter === 'all'
                      ? 'bg-white text-[#0F4C3F] font-semibold shadow-xs'
                      : 'text-[#4A615A]'
                  }`}
                >
                  Tất cả ({entries.length})
                </button>
                <button
                  type="button"
                  onClick={() => setEffortFilter('serious')}
                  className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${
                    effortFilter === 'serious'
                      ? 'bg-white text-[#0F6D4F] font-semibold shadow-xs'
                      : 'text-[#4A615A]'
                  }`}
                >
                  Nghiêm túc ({metrics.seriousCount})
                </button>
                <button
                  type="button"
                  onClick={() => setEffortFilter('flagged')}
                  className={`px-3 py-1 rounded-lg font-medium cursor-pointer ${
                    effortFilter === 'flagged'
                      ? 'bg-white text-[#B91C1C] font-semibold shadow-xs'
                      : 'text-[#4A615A]'
                  }`}
                >
                  Cần chấn chỉnh ({metrics.perfunctoryCount + metrics.watchCount})
                </button>
              </div>
            </div>

            {filteredJournal.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#597169]">
                Không có lần làm bài nào thuộc bộ lọc này.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredJournal.map((entry) => {
                  const isOpen = expandedId === entry.submissionId;
                  const effortMeta = getEffortBadgeMeta(entry.effortLevel);
                  return (
                    <div
                      key={entry.submissionId}
                      className="rounded-xl border border-[#DAE5E0] bg-[#FAFBFB] overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId((prev) =>
                            prev === entry.submissionId ? null : entry.submissionId
                          )
                        }
                        className="w-full px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-[#F3F7F5] transition-colors cursor-pointer"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-sm text-[#0D221D]">
                              {entry.examTitle}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${effortMeta.badgeClass}`}
                            >
                              {effortMeta.label}
                            </span>
                            {entry.status === 'pending_essay' && (
                              <span className="px-2 py-0.5 rounded-md bg-[#FDF8EB] border border-[#EAD8A6] text-[#8A630D] text-[11px] font-medium">
                                Chờ chấm tự luận
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#597169] flex flex-wrap items-center gap-2 tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatShortDate(entry.submittedAtIso)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDurationMMSS(entry.durationSeconds)}
                            </span>
                            {entry.violationCount > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[#B91C1C] font-medium">
                                  {entry.violationCount} lần thoát màn hình
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right tabular-nums">
                            <div className="font-serif text-xl font-semibold text-[#0F4C3F]">
                              {entry.score10.toFixed(2)}/10
                            </div>
                            <div className="text-[11px] text-[#597169]">
                              ({formatScore(entry.totalScore)}/{formatScore(entry.maxScore)} đ)
                            </div>
                          </div>
                          {isOpen ? (
                            <ChevronUp className="w-4 h-4 text-[#597169]" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-[#597169]" />
                          )}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="px-4 pb-4 pt-2 border-t border-[#E6EEEA] bg-white space-y-3 text-xs">
                          {entry.typeStats && entry.typeStats.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {entry.typeStats.map((st) => (
                                <div
                                  key={st.type}
                                  className="p-2.5 rounded-lg bg-[#F8FAF9] border border-[#EBF1EE]"
                                >
                                  <div className="text-[11px] text-[#597169]">
                                    {st.label} ({st.count})
                                  </div>
                                  <div className="font-semibold text-[#0D221D] mt-0.5 tabular-nums">
                                    {formatScore(st.earned)}/{formatScore(st.max)} đ
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {entry.effortReasons && entry.effortReasons.length > 0 && (
                            <div
                              className={`p-3 rounded-xl border flex items-start gap-2 ${
                                entry.effortLevel === 'perfunctory'
                                  ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                                  : 'bg-[#FDF8EB] border-[#EAD8A6] text-[#7A580B]'
                              }`}
                            >
                              {entry.effortLevel === 'perfunctory' ? (
                                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                              )}
                              <div className="space-y-0.5">
                                <div className="font-semibold">
                                  Lưu ý về cách làm bài:
                                </div>
                                <ul className="list-disc pl-4 space-y-0.5">
                                  {entry.effortReasons.map((reason, rIdx) => (
                                    <li key={rIdx}>{reason}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}

                          {entry.teacherComment && (
                            <div className="p-3 rounded-xl bg-[#EFF7F3] border border-[#C5DDD3] text-[#0D221D]">
                              <div className="font-semibold text-[#0F4C3F] mb-0.5 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Lời phê của giáo viên:</span>
                              </div>
                              <p className="leading-relaxed">{entry.teacherComment}</p>
                            </div>
                          )}

                          {entry.aiReview && (
                            <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DAE5E0] space-y-1.5 text-[#3A524A]">
                              <div className="font-semibold text-[#0F4C3F] flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-[#C89B2B]" />
                                <span>Nhận xét AI cho lần thi này:</span>
                              </div>
                              <MathText
                                text={entry.aiReview.overallComment}
                                className="leading-relaxed text-[#0D221D]"
                              />
                              <MathText
                                text={`Khuyến nghị: ${entry.aiReview.studyPlan}`}
                                className="leading-relaxed text-[#4A615A]"
                              />
                            </div>
                          )}

                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={() => onRetakeExam(entry.examId, entry.examCode)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#0F4C3F] text-[#0F4C3F] font-semibold hover:bg-[#EFF7F3] cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Làm lại đề này</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
