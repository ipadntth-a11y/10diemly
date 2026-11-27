import type {
  Exam,
  ExamQuestion,
  ParentMessage,
  StudentAnswer,
  Submission,
} from '../types';
import { analyzeSubmissionEffort } from '../utils/effortAnalysis';
import {
  buildDefaultParentMessage,
  sanitizeConciseRemark,
} from '../utils/formatters';
import {
  normalizeShortNumeric,
  saveParentMessage,
  updateParentMessageStatus,
  updateSubmissionGrading,
} from './firestoreService';
import {
  analyzeStudentWithAi,
  gradeEssayWithAi,
  type GradeEssayItemInput,
} from './geminiService';

export interface BatchAiProgress {
  completed: number;
  total: number;
  currentStudentName: string;
  phase: 'regrading' | 'analyzing' | 'messaging';
}

export interface BatchAiResult {
  succeededCount: number;
  failedItems: Array<{ submissionId: string; studentName: string; error: string }>;
  aborted: boolean;
}

export interface ClassQuestionStat {
  avgSeconds: number;
  correctPct: number;
  sampleSize: number;
}

export function buildClassQuestionStatsMap(
  allExamSubmissions: Submission[]
): Map<string, ClassQuestionStat> {
  const map = new Map<string, ClassQuestionStat>();
  if (allExamSubmissions.length === 0) return map;

  const accum = new Map<
    string,
    { totalTime: number; count: number; rightCount: number }
  >();

  for (const sub of allExamSubmissions) {
    for (const ans of sub.answers) {
      const prev = accum.get(ans.questionId) || {
        totalTime: 0,
        count: 0,
        rightCount: 0,
      };
      prev.totalTime += ans.timeSpentSeconds || 0;
      prev.count += 1;
      if (ans.isCorrect || (ans.maxScore > 0 && ans.score >= ans.maxScore)) {
        prev.rightCount += 1;
      }
      accum.set(ans.questionId, prev);
    }
  }

  accum.forEach((v, qId) => {
    map.set(qId, {
      avgSeconds: v.count > 0 ? Math.round(v.totalTime / v.count) : 0,
      correctPct: v.count > 0 ? Math.round((v.rightCount / v.count) * 100) : 0,
      sampleSize: v.count,
    });
  });

  return map;
}

export function rescoreObjectiveAnswer(
  ans: StudentAnswer,
  q: ExamQuestion
): StudentAnswer {
  if (q.type === 'mcq') {
    const picked = ans.selectedOption ?? null;
    const isRight = picked !== null && picked === q.correctOption;
    return {
      ...ans,
      type: 'mcq',
      maxScore: q.maxScore,
      score: isRight ? q.maxScore : 0,
      isCorrect: isRight,
    };
  }

  if (q.type === 'true_false') {
    const picks = ans.statementAnswers || [null, null, null, null];
    const statements = q.statements || [];
    let rightCount = 0;
    statements.forEach((st, idx) => {
      if (picks[idx] === st.isTrue) rightCount++;
    });
    const ratio =
      rightCount === 4
        ? 1
        : rightCount === 3
          ? 0.5
          : rightCount === 2
            ? 0.25
            : rightCount === 1
              ? 0.1
              : 0;
    const score = Number((q.maxScore * ratio).toFixed(2));
    return {
      ...ans,
      type: 'true_false',
      maxScore: q.maxScore,
      score,
      isCorrect: statements.length > 0 && rightCount === statements.length,
    };
  }

  if (q.type === 'short_answer') {
    const normStudent = normalizeShortNumeric(ans.textAnswer || '');
    const normKey = normalizeShortNumeric(q.correctAnswer || '');
    const isExact =
      normKey.length > 0 && normStudent.length > 0 && normStudent === normKey;
    return {
      ...ans,
      type: 'short_answer',
      maxScore: q.maxScore,
      score: isExact ? q.maxScore : 0,
      isCorrect: isExact,
    };
  }

  return {
    ...ans,
    maxScore: q.maxScore,
  };
}

export function isAiGradeableAnswer(
  ans: StudentAnswer,
  q?: ExamQuestion
): boolean {
  if (ans.type === 'essay' || q?.type === 'essay') return true;
  if (Boolean(ans.imageDataUrl)) return true;
  if (ans.type === 'short_answer' || q?.type === 'short_answer') {
    const trimmed = (ans.textAnswer || '').trim();
    const normKey = normalizeShortNumeric(q?.correctAnswer || '');
    // Long descriptive text or open-ended short_answer without numeric key
    if (trimmed.length > 25) return true;
    if (trimmed.length > 0 && normKey.length === 0) return true;
  }
  return false;
}

function buildQuestionSummariesForAi(
  answers: StudentAnswer[],
  exam: Exam | undefined,
  classStatsByQId: Map<string, ClassQuestionStat>
) {
  return answers.map((a, idx) => {
    const q = exam?.questions.find((qq) => qq.id === a.questionId);
    const clsStat = classStatsByQId.get(a.questionId);
    return {
      questionNumber: q?.index ?? idx + 1,
      type: a.type,
      promptSnippet: q?.prompt?.slice(0, 120) || '',
      timeSpentSeconds: a.timeSpentSeconds,
      classAvgSeconds: clsStat?.avgSeconds ?? 0,
      classCorrectPct: clsStat?.correctPct ?? 0,
      score: a.score,
      maxScore: a.maxScore,
      isCorrect: a.isCorrect,
      suspectedFastGuess: a.timeSpentSeconds > 0 && a.timeSpentSeconds < 5,
    };
  });
}

function formatEffortWarning(sub: Submission, exam?: Exam): string | undefined {
  const eff = analyzeSubmissionEffort(sub, exam);
  if (eff.level === 'perfunctory') {
    return eff.reasons[0] || 'Có dấu hiệu làm bài vội/đối phó, cần nhắc nhở thêm.';
  }
  if (sub.violationCount > 0) {
    return `Chuyển tab ${sub.violationCount} lần khi làm bài.`;
  }
  return undefined;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  shouldAbort: () => boolean,
  worker: (item: T, index: number) => Promise<void>
): Promise<boolean> {
  let cursor = 0;
  let aborted = false;

  const runner = async () => {
    while (true) {
      if (shouldAbort()) {
        aborted = true;
        return;
      }
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
      if (shouldAbort()) {
        aborted = true;
        return;
      }
      // Small stagger between items to reduce burst 429 rate-limits
      await new Promise((r) => setTimeout(r, 180));
    }
  };

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    () => runner()
  );
  await Promise.all(workers);
  return aborted;
}

export async function analyzeSingleSubmissionWithAi(options: {
  submission: Submission;
  exam: Exam | undefined;
  allExamSubmissions: Submission[];
  classStatsByQId?: Map<string, ClassQuestionStat>;
  overwriteComment?: boolean;
  persistToFirestore?: boolean;
}): Promise<{
  aiAnalysis: string;
  teacherComment: string;
}> {
  const {
    submission,
    exam,
    allExamSubmissions,
    overwriteComment = true,
    persistToFirestore = true,
  } = options;

  const statsMap =
    options.classStatsByQId || buildClassQuestionStatsMap(allExamSubmissions);
  const effort = analyzeSubmissionEffort(submission, exam);
  const summaries = buildQuestionSummariesForAi(
    submission.answers,
    exam,
    statsMap
  );

  const aiResult = await analyzeStudentWithAi({
    studentName: submission.studentName,
    examTitle: submission.examTitle,
    totalScore: submission.totalScore,
    maxScore: submission.maxScore,
    durationSeconds: submission.durationSeconds,
    violationCount: submission.violationCount,
    effortSummary: {
      level: effort.label,
      riskScore: effort.riskScore,
      reasons: effort.reasons,
    },
    questionSummaries: summaries,
  });

  const nextComment =
    overwriteComment || !submission.teacherComment.trim()
      ? sanitizeConciseRemark(aiResult.suggestedComment, 195)
      : sanitizeConciseRemark(submission.teacherComment, 195);

  if (persistToFirestore) {
    await updateSubmissionGrading(submission.id, {
      totalScore: submission.totalScore,
      teacherComment: nextComment,
      aiAnalysis: aiResult.analysis,
      status: submission.status,
      answers: submission.answers,
      parentPhone: submission.parentPhone,
    });
  }

  return {
    aiAnalysis: aiResult.analysis,
    teacherComment: nextComment,
  };
}

export async function batchRegradeSubmissionsWithAi(options: {
  teacherId: string;
  exam: Exam;
  targetSubmissions: Submission[];
  allExamSubmissions: Submission[];
  customBarem?: string;
  alsoAnalyzeAfterRegrade?: boolean;
  overwriteComment?: boolean;
  syncParentMessages?: boolean;
  existingMessages?: ParentMessage[];
  shouldAbort?: () => boolean;
  onProgress?: (progress: BatchAiProgress) => void;
}): Promise<BatchAiResult> {
  const {
    teacherId,
    exam,
    targetSubmissions,
    allExamSubmissions,
    customBarem,
    alsoAnalyzeAfterRegrade = true,
    overwriteComment = true,
    syncParentMessages = false,
    existingMessages = [],
    shouldAbort = () => false,
    onProgress,
  } = options;

  const qMap = new Map<string, ExamQuestion>(
    exam.questions.map((q) => [q.id, q])
  );
  const classStatsByQId = buildClassQuestionStatsMap(allExamSubmissions);
  const msgBySubId = new Map<string, ParentMessage>(
    existingMessages.map((m) => [m.submissionId, m])
  );

  let completed = 0;
  let succeededCount = 0;
  const failedItems: BatchAiResult['failedItems'] = [];

  const aborted = await runWithConcurrency(
    targetSubmissions,
    2,
    shouldAbort,
    async (sub) => {
      onProgress?.({
        completed,
        total: targetSubmissions.length,
        currentStudentName: sub.studentName,
        phase: 'regrading',
      });

      try {
        // 1. Re-score deterministic objective questions against latest exam keys
        const rescoredAnswers = sub.answers.map((ans) => {
          const q = qMap.get(ans.questionId);
          if (!q) return ans;
          if (isAiGradeableAnswer(ans, q)) {
            return { ...ans, maxScore: q.maxScore };
          }
          return rescoreObjectiveAnswer(ans, q);
        });

        // 2. Collect essay / photo / open-text short_answer targets for AI grading
        const aiTargets = rescoredAnswers.filter((ans) =>
          isAiGradeableAnswer(ans, qMap.get(ans.questionId))
        );

        let essayOverallNote = '';
        let finalAnswers = rescoredAnswers;

        if (aiTargets.length > 0) {
          const items: GradeEssayItemInput[] = aiTargets.map((ans) => {
            const q = qMap.get(ans.questionId);
            return {
              questionId: ans.questionId,
              prompt: q?.prompt || '',
              correctAnswer: q?.correctAnswer || '',
              explanation: q?.explanation || '',
              studentAnswer: ans.textAnswer || '',
              imageDataUrl: ans.imageDataUrl,
              maxScore: ans.maxScore,
            };
          });

          const essayResult = await gradeEssayWithAi({
            studentName: sub.studentName,
            examTitle: exam.title,
            customBarem: customBarem?.trim() || undefined,
            items,
          });

          essayOverallNote = essayResult.overallNote;
          const resultMap = new Map(
            (essayResult.results || []).map((r) => [r.questionId, r])
          );

          finalAnswers = rescoredAnswers.map((ans) => {
            const hit = resultMap.get(ans.questionId);
            if (!hit) return ans;
            const clamped = Math.min(
              Math.max(Number(hit.proposedScore || 0), 0),
              ans.maxScore
            );
            return {
              ...ans,
              score: Number(clamped.toFixed(2)),
              isCorrect: ans.maxScore > 0 && clamped >= ans.maxScore,
              recognizedText: hit.recognizedText || ans.recognizedText,
              aiFeedback: hit.feedback,
              aiBreakdown: hit.breakdown,
            };
          });
        }

        const totalScore = Number(
          Math.min(
            100,
            Math.max(
              0,
              finalAnswers.reduce((acc, a) => acc + Number(a.score || 0), 0)
            )
          ).toFixed(2)
        );

        let nextAnalysis = sub.aiAnalysis || '';
        let nextComment = sub.teacherComment || '';

        if (alsoAnalyzeAfterRegrade) {
          const updatedSub: Submission = {
            ...sub,
            totalScore,
            answers: finalAnswers,
            status: 'graded',
          };
          const effort = analyzeSubmissionEffort(updatedSub, exam);
          const aiData = await analyzeStudentWithAi({
            studentName: sub.studentName,
            examTitle: exam.title,
            totalScore,
            maxScore: sub.maxScore,
            durationSeconds: sub.durationSeconds,
            violationCount: sub.violationCount,
            effortSummary: {
              level: effort.label,
              riskScore: effort.riskScore,
              reasons: effort.reasons,
            },
            questionSummaries: buildQuestionSummariesForAi(
              finalAnswers,
              exam,
              classStatsByQId
            ),
          });
          nextAnalysis = aiData.analysis;
          if (overwriteComment || !nextComment.trim()) {
            nextComment = sanitizeConciseRemark(aiData.suggestedComment, 195);
          }
        } else if (essayOverallNote && (overwriteComment || !nextComment.trim())) {
          nextComment = sanitizeConciseRemark(essayOverallNote, 195);
        }

        await updateSubmissionGrading(sub.id, {
          totalScore,
          teacherComment: nextComment,
          aiAnalysis: nextAnalysis,
          status: 'graded',
          answers: finalAnswers,
          parentPhone: sub.parentPhone,
        });

        if (syncParentMessages) {
          const msgContent = buildDefaultParentMessage(
            sub.studentName,
            exam.title,
            totalScore,
            sub.maxScore,
            nextComment,
            {
              effortWarning: formatEffortWarning(
                { ...sub, totalScore, answers: finalAnswers },
                exam
              ),
            }
          );
          const existingMsg = msgBySubId.get(sub.id);
          if (existingMsg) {
            await updateParentMessageStatus(existingMsg.id, {
              content: msgContent,
            });
          } else {
            await saveParentMessage({
              teacherId,
              submissionId: sub.id,
              studentName: sub.studentName,
              className: sub.className,
              examTitle: exam.title,
              parentPhone: sub.parentPhone,
              content: msgContent,
              status: 'draft',
            });
          }
        }

        succeededCount++;
      } catch (err) {
        failedItems.push({
          submissionId: sub.id,
          studentName: sub.studentName,
          error: err instanceof Error ? err.message : 'Lỗi khi chấm lại bằng AI.',
        });
      } finally {
        completed++;
        onProgress?.({
          completed,
          total: targetSubmissions.length,
          currentStudentName: sub.studentName,
          phase: 'regrading',
        });
      }
    }
  );

  return { succeededCount, failedItems, aborted };
}

export async function batchAnalyzeSubmissionsWithAi(options: {
  teacherId: string;
  exam: Exam | undefined;
  targetSubmissions: Submission[];
  allExamSubmissions: Submission[];
  overwriteComment?: boolean;
  syncParentMessages?: boolean;
  existingMessages?: ParentMessage[];
  shouldAbort?: () => boolean;
  onProgress?: (progress: BatchAiProgress) => void;
}): Promise<BatchAiResult> {
  const {
    teacherId,
    exam,
    targetSubmissions,
    allExamSubmissions,
    overwriteComment = true,
    syncParentMessages = false,
    existingMessages = [],
    shouldAbort = () => false,
    onProgress,
  } = options;

  const classStatsByQId = buildClassQuestionStatsMap(allExamSubmissions);
  const msgBySubId = new Map<string, ParentMessage>(
    existingMessages.map((m) => [m.submissionId, m])
  );

  let completed = 0;
  let succeededCount = 0;
  const failedItems: BatchAiResult['failedItems'] = [];

  const aborted = await runWithConcurrency(
    targetSubmissions,
    2,
    shouldAbort,
    async (sub) => {
      onProgress?.({
        completed,
        total: targetSubmissions.length,
        currentStudentName: sub.studentName,
        phase: 'analyzing',
      });

      try {
        const res = await analyzeSingleSubmissionWithAi({
          submission: sub,
          exam,
          allExamSubmissions,
          classStatsByQId,
          overwriteComment,
          persistToFirestore: true,
        });

        if (syncParentMessages) {
          const msgContent = buildDefaultParentMessage(
            sub.studentName,
            exam?.title || sub.examTitle,
            sub.totalScore,
            sub.maxScore,
            res.teacherComment,
            { effortWarning: formatEffortWarning(sub, exam) }
          );
          const existingMsg = msgBySubId.get(sub.id);
          if (existingMsg) {
            await updateParentMessageStatus(existingMsg.id, {
              content: msgContent,
            });
          } else {
            await saveParentMessage({
              teacherId,
              submissionId: sub.id,
              studentName: sub.studentName,
              className: sub.className,
              examTitle: exam?.title || sub.examTitle,
              parentPhone: sub.parentPhone,
              content: msgContent,
              status: 'draft',
            });
          }
        }

        succeededCount++;
      } catch (err) {
        failedItems.push({
          submissionId: sub.id,
          studentName: sub.studentName,
          error: err instanceof Error ? err.message : 'Lỗi khi phân tích bằng AI.',
        });
      } finally {
        completed++;
        onProgress?.({
          completed,
          total: targetSubmissions.length,
          currentStudentName: sub.studentName,
          phase: 'analyzing',
        });
      }
    }
  );

  return { succeededCount, failedItems, aborted };
}
