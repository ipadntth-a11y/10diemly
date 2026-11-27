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

export function sanitizeConciseRemark(
  rawText: string | undefined,
  maxLength = 210
): string {
  if (!rawText) return '';
  let text = String(rawText)
    // Remove markdown headings and bold/italic/code markers
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    // Convert leading list bullets on lines into "; " separators
    .replace(/\r?\n\s*[-•*+]\s+/g, '; ')
    .replace(/\r?\n+/g, ' ')
    // Normalize common LaTeX math into readable plain text for SMS/Zalo
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2')
    .replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\approx/g, '≈')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\Omega/g, 'Ω')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\pi/g, 'π')
    .replace(/\\circ/g, '°')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    // Clean redundant whitespace & punctuation
    .replace(/\s*;\s*;/g, ';')
    .replace(/^[\s;,:.-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';
  if (text.length <= maxLength) return text;

  // Try to cut cleanly at the last sentence boundary before maxLength
  const slice = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('; ')
  );
  if (lastSentenceEnd >= Math.floor(maxLength * 0.45)) {
    return slice.slice(0, lastSentenceEnd + 1).replace(/;$/, '.').trim();
  }

  // Otherwise cut at last word boundary
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 40 ? slice.slice(0, lastSpace) : slice.slice(0, maxLength - 1);
  return `${cut.replace(/[.,;:\s]+$/, '')}…`;
}

export function buildDefaultParentMessage(
  studentName: string,
  examTitle: string,
  score: number,
  maxScore: number,
  teacherComment?: string,
  options?: {
    effortWarning?: string;
    maxRemarkChars?: number;
  }
): string {
  const safeMax = maxScore > 0 ? maxScore : 10;
  const isScale10 = Math.abs(safeMax - 10) <= 0.01;
  const score10 = Number(((score / safeMax) * 10).toFixed(2));
  const scorePhrase = isScale10
    ? `${formatScore(score)}/10đ`
    : `${formatScore(score)}/${formatScore(safeMax)}đ (thang 10: ${formatScore(score10)}/10)`;

  const conciseRemark = sanitizeConciseRemark(
    teacherComment,
    options?.maxRemarkChars ?? 210
  );
  const effortNote = options?.effortWarning?.trim()
    ? sanitizeConciseRemark(options.effortWarning, 90)
    : '';

  const lines = [
    `Kính gửi PH em ${studentName},`,
    `Bài "${examTitle}" của em đạt ${scorePhrase}.`,
  ];
  if (conciseRemark) {
    lines.push(`Nhận xét: ${conciseRemark}`);
  }
  if (effortNote) {
    lines.push(`Lưu ý: ${effortNote}`);
  }
  lines.push('Trân trọng.');
  return lines.join('\n');
}
