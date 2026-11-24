export function formatDurationMMSS(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatScore(score: number): string {
  const rounded = Math.round(score * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
}

export function getScoreTier(score: number, maxScore: number): {
  label: string;
  tone: 'high' | 'mid' | 'low';
} {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  if (pct >= 80) return { label: 'Giỏi', tone: 'high' };
  if (pct >= 65) return { label: 'Khá', tone: 'high' };
  if (pct >= 50) return { label: 'Trung bình', tone: 'mid' };
  return { label: 'Cần cố gắng', tone: 'low' };
}

export function buildDefaultParentMessage(
  studentName: string,
  examTitle: string,
  score: number,
  maxScore: number,
  teacherComment?: string
): string {
  const commentPart = teacherComment?.trim()
    ? `\nNhận xét của giáo viên: ${teacherComment.trim()}`
    : '';
  return `Kính gửi phụ huynh em ${studentName},\nKết quả bài "${examTitle}" của em đạt ${formatScore(score)}/${formatScore(maxScore)} điểm.${commentPart}\nTrân trọng.`;
}
