import type { Classroom, StudentRecord, Submission } from '../types';

export interface ClassScoreStat {
  key: string;
  className: string;
  classroomId?: string;
  joinCode?: string;
  rosterCount: number;
  submissionCount: number;
  uniqueStudentCount: number;
  avgScore10: number;
  avgRawScore: number;
  avgMaxScore: number;
  hasUniformMaxScore: boolean;
  avgPercent: number;
  highest10: number;
  lowest10: number;
  highestStudentName: string;
  lowestStudentName: string;
  passCount: number;
  passRate: number;
  avgDurationSeconds: number;
  pendingEssayCount: number;
  tiers: {
    excellent: number; // >= 8.0
    good: number;      // 6.5 - 7.99
    average: number;   // 5.0 - 6.49
    weak: number;      // < 5.0
  };
}

function normalizeLabel(val: string | undefined | null): string {
  return (val ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCode(val: string | undefined | null): string {
  return (val ?? '').trim().toUpperCase();
}

export function resolveClassForSubmission(
  sub: Submission,
  classes: Classroom[]
): Classroom | undefined {
  const joinCode = normalizeCode(sub.classJoinCode);
  if (joinCode) {
    const byJoin = classes.find((c) => normalizeCode(c.joinCode) === joinCode);
    if (byJoin) return byJoin;
  }
  const normName = normalizeLabel(sub.className);
  if (normName) {
    const byName = classes.find((c) => normalizeLabel(c.name) === normName);
    if (byName) return byName;
  }
  return undefined;
}

export function getSubmissionScore10(sub: Submission): number {
  if (!sub.maxScore || sub.maxScore <= 0) return 0;
  return (sub.totalScore / sub.maxScore) * 10;
}

export function computeClassScoreStats(
  submissions: Submission[],
  classes: Classroom[],
  options?: { includeEmptyClasses?: boolean }
): ClassScoreStat[] {
  const includeEmpty = options?.includeEmptyClasses ?? true;
  const groups = new Map<
    string,
    {
      key: string;
      className: string;
      classroom?: Classroom;
      subs: Submission[];
    }
  >();

  if (includeEmpty) {
    for (const cls of classes) {
      const key = `cls:${cls.id}`;
      groups.set(key, {
        key,
        className: cls.name.trim() || 'Lớp',
        classroom: cls,
        subs: [],
      });
    }
  }

  for (const sub of submissions) {
    const matched = resolveClassForSubmission(sub, classes);
    const trimmedName = (sub.className ?? '').trim();
    const key = matched
      ? `cls:${matched.id}`
      : trimmedName
        ? `name:${normalizeLabel(trimmedName)}`
        : 'unassigned';

    let entry = groups.get(key);
    if (!entry) {
      entry = {
        key,
        className: matched ? matched.name : trimmedName || 'Chưa ghi lớp',
        classroom: matched,
        subs: [],
      };
      groups.set(key, entry);
    }
    entry.subs.push(sub);
  }

  const results: ClassScoreStat[] = [];

  for (const entry of groups.values()) {
    const { subs, classroom } = entry;
    const submissionCount = subs.length;
    const rosterCount = classroom?.studentCount ?? 0;

    if (submissionCount === 0) {
      results.push({
        key: entry.key,
        className: entry.className,
        classroomId: classroom?.id,
        joinCode: classroom?.joinCode,
        rosterCount,
        submissionCount: 0,
        uniqueStudentCount: 0,
        avgScore10: 0,
        avgRawScore: 0,
        avgMaxScore: 10,
        hasUniformMaxScore: true,
        avgPercent: 0,
        highest10: 0,
        lowest10: 0,
        highestStudentName: '',
        lowestStudentName: '',
        passCount: 0,
        passRate: 0,
        avgDurationSeconds: 0,
        pendingEssayCount: 0,
        tiers: { excellent: 0, good: 0, average: 0, weak: 0 },
      });
      continue;
    }

    const uniqueStudents = new Set<string>();
    let sum10 = 0;
    let sumRaw = 0;
    let sumMax = 0;
    let sumDuration = 0;
    let passCount = 0;
    let pendingEssayCount = 0;
    let highest10 = -Infinity;
    let lowest10 = Infinity;
    let highestStudentName = '';
    let lowestStudentName = '';
    const maxScoreValues = new Set<number>();
    const tiers = { excellent: 0, good: 0, average: 0, weak: 0 };

    for (const s of subs) {
      const stuKey = normalizeCode(s.studentCode) || normalizeLabel(s.studentName) || s.id;
      uniqueStudents.add(stuKey);

      const s10 = getSubmissionScore10(s);
      sum10 += s10;
      sumRaw += s.totalScore;
      sumMax += s.maxScore;
      maxScoreValues.add(Number(s.maxScore || 0));
      sumDuration += s.durationSeconds || 0;

      if (s10 >= 5) passCount++;
      if (s.status === 'pending_essay') pendingEssayCount++;

      if (s10 > highest10) {
        highest10 = s10;
        highestStudentName = s.studentName;
      }
      if (s10 < lowest10) {
        lowest10 = s10;
        lowestStudentName = s.studentName;
      }

      if (s10 >= 8) tiers.excellent++;
      else if (s10 >= 6.5) tiers.good++;
      else if (s10 >= 5) tiers.average++;
      else tiers.weak++;
    }

    const avgScore10 = Number((sum10 / submissionCount).toFixed(2));
    const avgRawScore = Number((sumRaw / submissionCount).toFixed(2));
    const avgMaxScore = Number((sumMax / submissionCount).toFixed(2));

    results.push({
      key: entry.key,
      className: entry.className,
      classroomId: classroom?.id,
      joinCode: classroom?.joinCode,
      rosterCount,
      submissionCount,
      uniqueStudentCount: uniqueStudents.size,
      avgScore10,
      avgRawScore,
      avgMaxScore,
      hasUniformMaxScore: maxScoreValues.size === 1,
      avgPercent: Math.round(avgScore10 * 10),
      highest10: Number((highest10 === -Infinity ? 0 : highest10).toFixed(2)),
      lowest10: Number((lowest10 === Infinity ? 0 : lowest10).toFixed(2)),
      highestStudentName,
      lowestStudentName,
      passCount,
      passRate: Math.round((passCount / submissionCount) * 100),
      avgDurationSeconds: Math.round(sumDuration / submissionCount),
      pendingEssayCount,
      tiers,
    });
  }

  return results.sort((a, b) => {
    if (a.submissionCount > 0 && b.submissionCount === 0) return -1;
    if (a.submissionCount === 0 && b.submissionCount > 0) return 1;
    if (b.avgScore10 !== a.avgScore10) return b.avgScore10 - a.avgScore10;
    if (b.submissionCount !== a.submissionCount) return b.submissionCount - a.submissionCount;
    return a.className.localeCompare(b.className, 'vi');
  });
}

export function computeStudentPerformanceInClass(
  student: StudentRecord,
  classroom: Classroom,
  submissions: Submission[]
): {
  submissionCount: number;
  avgScore10: number | null;
  latestScore10: number | null;
  latestSubmissionId: string | null;
} {
  const stuCode = normalizeCode(student.studentCode);
  const stuName = normalizeLabel(student.fullName);

  const matchedSubs = submissions.filter((sub) => {
    const resolved = resolveClassForSubmission(sub, [classroom]);
    const sameClass =
      Boolean(resolved && resolved.id === classroom.id) ||
      normalizeLabel(sub.className) === normalizeLabel(classroom.name);
    if (!sameClass) return false;

    const subCode = normalizeCode(sub.studentCode);
    if (stuCode && subCode) {
      return stuCode === subCode;
    }
    return normalizeLabel(sub.studentName) === stuName;
  });

  if (matchedSubs.length === 0) {
    return {
      submissionCount: 0,
      avgScore10: null,
      latestScore10: null,
      latestSubmissionId: null,
    };
  }

  const scores10 = matchedSubs.map(getSubmissionScore10);
  const avg = scores10.reduce((sum, v) => sum + v, 0) / scores10.length;
  return {
    submissionCount: matchedSubs.length,
    avgScore10: Number(avg.toFixed(2)),
    latestScore10: Number(scores10[0].toFixed(2)),
    latestSubmissionId: matchedSubs[0].id,
  };
}

export function exportClassStatsCsv(stats: ClassScoreStat[], filePrefix: string): void {
  const header =
    'Lớp,Sĩ số,Số bài nộp,HS đã làm,Điểm TB (thang 10),Cao nhất (/10),Thấp nhất (/10),Tỉ lệ đạt >=5 (%),Giỏi (>=8),Khá (6.5-7.9),Trung bình (5-6.4),Yếu (<5),Thời gian TB (giây)\n';
  const rows = stats
    .map((st) =>
      [
        `"${st.className.replace(/"/g, '""')}"`,
        st.rosterCount || '',
        st.submissionCount,
        st.uniqueStudentCount,
        st.submissionCount > 0 ? st.avgScore10.toFixed(2) : '',
        st.submissionCount > 0 ? st.highest10.toFixed(2) : '',
        st.submissionCount > 0 ? st.lowest10.toFixed(2) : '',
        st.submissionCount > 0 ? st.passRate : '',
        st.tiers.excellent,
        st.tiers.good,
        st.tiers.average,
        st.tiers.weak,
        st.avgDurationSeconds,
      ].join(',')
    )
    .join('\n');

  const blob = new Blob(['\uFEFF' + header + rows], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filePrefix}_thong_ke_theo_lop.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
