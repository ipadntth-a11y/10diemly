import type { EffortLevel, Exam, Submission } from '../types';
import { formatDurationMMSS } from './formatters';

export interface EffortMetrics {
  totalQuestions: number;
  answeredCount: number;
  skippedCount: number;
  fastGuessCount: number;
  ultraFastCount: number;
  avgSecondsPerQuestion: number;
  durationRatioToLimit: number | null;
  mcqDominantLetter: string | null;
  mcqDominantRatio: number;
  skippedEssayCount: number;
  totalEssayCount: number;
  scoreRatio: number;
  violationCount: number;
}

export interface EffortAnalysis {
  level: EffortLevel;
  label: string;
  riskScore: number;
  reasons: string[];
  metrics: EffortMetrics;
}

export interface SubmissionEffortItem {
  submission: Submission;
  exam?: Exam;
  analysis: EffortAnalysis;
}

export interface CohortEffortSummary {
  totalSubmissions: number;
  perfunctoryCount: number;
  watchCount: number;
  seriousCount: number;
  perfunctoryRate: number;
  flaggedItems: SubmissionEffortItem[];
  watchItems: SubmissionEffortItem[];
  bySubmissionId: Map<string, EffortAnalysis>;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function isQuestionAnswered(ans: Submission['answers'][number]): boolean {
  if (ans.type === 'mcq') {
    return ans.selectedOption !== null && ans.selectedOption !== undefined;
  }
  if (ans.type === 'true_false') {
    return Array.isArray(ans.statementAnswers) && ans.statementAnswers.some((v) => v !== null && v !== undefined);
  }
  return Boolean((ans.textAnswer || '').trim() || ans.imageDataUrl || ans.recognizedText);
}

export function analyzeSubmissionEffort(
  submission: Submission,
  exam?: Exam
): EffortAnalysis {
  const answers = Array.isArray(submission.answers) ? submission.answers : [];
  const totalQuestions = Math.max(answers.length, exam?.questions.length || 0);
  const answeredCount = answers.filter(isQuestionAnswered).length;
  const skippedCount = Math.max(0, totalQuestions - answeredCount);

  const fastGuessCount = answers.filter(
    (a) => a.timeSpentSeconds > 0 && a.timeSpentSeconds < 5
  ).length;
  const ultraFastCount = answers.filter(
    (a) => a.timeSpentSeconds > 0 && a.timeSpentSeconds <= 2
  ).length;

  const avgSecondsPerQuestion =
    totalQuestions > 0 ? Math.round(submission.durationSeconds / totalQuestions) : 0;

  const limitSeconds = exam?.durationMinutes ? exam.durationMinutes * 60 : null;
  const durationRatioToLimit =
    limitSeconds && limitSeconds > 0
      ? Number((submission.durationSeconds / limitSeconds).toFixed(2))
      : null;

  // Check repeated MCQ choice bias (e.g. clicking all A or all C)
  const mcqPicked = answers
    .filter((a) => a.type === 'mcq' && a.selectedOption !== null && a.selectedOption !== undefined)
    .map((a) => Number(a.selectedOption));
  let mcqDominantLetter: string | null = null;
  let mcqDominantRatio = 0;
  if (mcqPicked.length >= 4) {
    const counts = [0, 0, 0, 0];
    mcqPicked.forEach((opt) => {
      if (opt >= 0 && opt < 4) counts[opt]++;
    });
    let maxIdx = 0;
    counts.forEach((c, idx) => {
      if (c > counts[maxIdx]) maxIdx = idx;
    });
    mcqDominantLetter = OPTION_LETTERS[maxIdx] || null;
    mcqDominantRatio = Number((counts[maxIdx] / mcqPicked.length).toFixed(2));
  }

  const essayAnswers = answers.filter((a) => a.type === 'essay');
  const totalEssayCount = essayAnswers.length;
  const skippedEssayCount = essayAnswers.filter((a) => !isQuestionAnswered(a)).length;

  const scoreRatio =
    submission.maxScore > 0 ? submission.totalScore / submission.maxScore : 0;
  const fastRatio = totalQuestions > 0 ? fastGuessCount / totalQuestions : 0;
  const skippedRatio = totalQuestions > 0 ? skippedCount / totalQuestions : 0;

  let riskScore = 0;
  const reasons: string[] = [];

  // 1. Fast guesses (< 5s per question)
  if (fastGuessCount >= 4 && fastRatio >= 0.45) {
    riskScore += 35;
    reasons.push(
      `Chọn siêu nhanh (<5s) ở ${fastGuessCount}/${totalQuestions} câu (${Math.round(
        fastRatio * 100
      )}%)`
    );
  } else if (fastGuessCount >= 2 && fastRatio >= 0.25) {
    riskScore += 18;
    reasons.push(`${fastGuessCount}/${totalQuestions} câu trả lời dưới 5 giây`);
  }

  if (ultraFastCount >= 3) {
    riskScore += 12;
    reasons.push(`${ultraFastCount} câu bấm chuyển chỉ trong ≤2 giây`);
  }

  // 2. Total duration disproportionately short
  if (totalQuestions >= 5 && avgSecondsPerQuestion < 8) {
    riskScore += scoreRatio >= 0.75 ? 10 : 24;
    reasons.push(
      `Tổng thời gian làm chỉ ${formatDurationMMSS(
        submission.durationSeconds
      )} (TB ${avgSecondsPerQuestion}s/câu)`
    );
  } else if (
    durationRatioToLimit !== null &&
    totalQuestions >= 8 &&
    durationRatioToLimit < 0.15
  ) {
    riskScore += scoreRatio >= 0.75 ? 8 : 16;
    reasons.push(
      `Nộp bài quá sớm (${formatDurationMMSS(submission.durationSeconds)} / ${
        exam?.durationMinutes || 0
      } phút)`
    );
  }

  // 3. Repeated MCQ letter pattern
  if (mcqPicked.length >= 5 && mcqDominantRatio >= 0.75 && mcqDominantLetter) {
    riskScore += 25;
    reasons.push(
      `Chọn lặp đáp án ${mcqDominantLetter} tới ${Math.round(
        mcqDominantRatio * 100
      )}% câu trắc nghiệm`
    );
  } else if (
    mcqPicked.length >= 4 &&
    mcqDominantRatio === 1 &&
    scoreRatio < 0.65 &&
    mcqDominantLetter
  ) {
    riskScore += 25;
    reasons.push(`Chọn toàn đáp án ${mcqDominantLetter} ở cả ${mcqPicked.length} câu trắc nghiệm`);
  }

  // 4. Skipping many questions or skipping all essays
  if (skippedCount >= 3 && skippedRatio >= 0.35) {
    riskScore += 26;
    reasons.push(
      `Bỏ trống ${skippedCount}/${totalQuestions} câu (${Math.round(
        skippedRatio * 100
      )}%)`
    );
  } else if (skippedCount >= 2 && skippedRatio >= 0.2) {
    riskScore += 12;
    reasons.push(`Chưa làm ${skippedCount}/${totalQuestions} câu`);
  }

  if (
    totalEssayCount > 0 &&
    skippedEssayCount === totalEssayCount &&
    (fastGuessCount >= 2 || avgSecondsPerQuestion < 15 || skippedRatio >= 0.2)
  ) {
    riskScore += 18;
    reasons.push(`Bỏ trống toàn bộ ${totalEssayCount}/${totalEssayCount} câu tự luận`);
  }

  // 5. Screen-exit / anti-cheat violations
  if (submission.violationCount > 3) {
    riskScore += 30;
    reasons.push(
      `Thoát màn hình thi ${submission.violationCount} lần (bị ép buộc nộp)`
    );
  } else if (submission.violationCount >= 2) {
    riskScore += 15;
    reasons.push(`Thoát cửa sổ làm bài ${submission.violationCount} lần`);
  }

  // 6. Very low score combined with rushing or skipping
  if (
    scoreRatio < 0.35 &&
    (fastRatio >= 0.3 || skippedRatio >= 0.3 || (totalQuestions >= 5 && avgSecondsPerQuestion < 10))
  ) {
    riskScore += 15;
    reasons.push(
      `Điểm đạt thấp (${Math.round(scoreRatio * 100)}%) kèm dấu hiệu làm vội / bỏ câu`
    );
  }

  // Safeguard for genuinely strong, rule-abiding students who work fast without skipping
  if (scoreRatio >= 0.8 && submission.violationCount <= 1 && skippedCount === 0) {
    riskScore = Math.min(riskScore, 35);
  }

  const clampedRisk = Math.min(100, Math.max(0, riskScore));

  let level: EffortLevel = 'serious';
  let label = 'Nghiêm túc';
  if (clampedRisk >= 45 || (submission.violationCount > 3 && scoreRatio < 0.5)) {
    level = 'perfunctory';
    label = 'Làm bài đối phó';
  } else if (clampedRisk >= 22) {
    level = 'watch';
    label = 'Cần lưu ý';
  }

  return {
    level,
    label,
    riskScore: clampedRisk,
    reasons,
    metrics: {
      totalQuestions,
      answeredCount,
      skippedCount,
      fastGuessCount,
      ultraFastCount,
      avgSecondsPerQuestion,
      durationRatioToLimit,
      mcqDominantLetter,
      mcqDominantRatio,
      skippedEssayCount,
      totalEssayCount,
      scoreRatio,
      violationCount: submission.violationCount,
    },
  };
}

export function summarizeCohortEffort(
  submissions: Submission[],
  exams: Exam[]
): CohortEffortSummary {
  const examMap = new Map(exams.map((e) => [e.id, e]));
  const bySubmissionId = new Map<string, EffortAnalysis>();
  const flaggedItems: SubmissionEffortItem[] = [];
  const watchItems: SubmissionEffortItem[] = [];
  let seriousCount = 0;

  for (const sub of submissions) {
    const exam = examMap.get(sub.examId);
    const analysis = analyzeSubmissionEffort(sub, exam);
    bySubmissionId.set(sub.id, analysis);
    if (analysis.level === 'perfunctory') {
      flaggedItems.push({ submission: sub, exam, analysis });
    } else if (analysis.level === 'watch') {
      watchItems.push({ submission: sub, exam, analysis });
    } else {
      seriousCount++;
    }
  }

  flaggedItems.sort((a, b) => b.analysis.riskScore - a.analysis.riskScore);
  watchItems.sort((a, b) => b.analysis.riskScore - a.analysis.riskScore);

  const totalSubmissions = submissions.length;
  const perfunctoryCount = flaggedItems.length;
  const watchCount = watchItems.length;
  const perfunctoryRate =
    totalSubmissions > 0 ? Math.round((perfunctoryCount / totalSubmissions) * 100) : 0;

  return {
    totalSubmissions,
    perfunctoryCount,
    watchCount,
    seriousCount,
    perfunctoryRate,
    flaggedItems,
    watchItems,
    bySubmissionId,
  };
}
