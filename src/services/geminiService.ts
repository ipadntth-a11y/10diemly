import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  PracticeQuestion,
  RemedialPracticeData,
} from '../components/RemedialPracticePanel';
import type {
  EssayCriterionResult,
  ExamQuestion,
  ReferenceDifficulty,
  ReferenceQuestionItem,
} from '../types';
import type { ReferenceContextPayload } from './referenceBankService';
import { sanitizeConciseRemark } from '../utils/formatters';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const BACKUP_MODEL = 'gemini-3.1-flash-lite';
const HYDROGEN_COOLDOWN_MS = 60_000;

let hydrogenCooldownUntil = 0;
let activeKeyIndex = 0;

function getConfiguredApiKeys(): string[] {
  const primary = String(import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();
  const extras = String(import.meta.env.VITE_GEMINI_API_KEYS ?? '')
    .split(/[\s,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return Array.from(new Set([primary, ...extras].filter(Boolean)));
}

function getGeminiClient(): GoogleGenAI {
  const keys = getConfiguredApiKeys();
  if (keys.length === 0) {
    throw new Error(
      'Chưa cấu hình biến môi trường VITE_GEMINI_API_KEY. Vui lòng thêm VITE_GEMINI_API_KEY vào Environment Variables trên Vercel (hoặc tệp .env) rồi triển khai lại.'
    );
  }
  const idx = activeKeyIndex % keys.length;
  return new GoogleGenAI({ apiKey: keys[idx] });
}

function isQuotaError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('quota')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientAiError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('high demand') ||
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('500') ||
    message.includes('deadline_exceeded') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('abort') ||
    message.includes('timeout') ||
    message.includes('timed out')
  );
}

function toFriendlyAiError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (message.includes('VITE_GEMINI_API_KEY')) {
    return error instanceof Error ? error : new Error(message);
  }
  if (
    message.includes('PERMISSION_DENIED') ||
    message.includes('API_KEY_INVALID') ||
    lower.includes('api key not valid')
  ) {
    return new Error(
      'API key (VITE_GEMINI_API_KEY) không hợp lệ hoặc thiếu quyền truy cập. Vui lòng kiểm tra lại cấu hình biến môi trường.'
    );
  }
  if (message.includes('NOT_FOUND') || lower.includes('404')) {
    return new Error('Model Gemini yêu cầu không khả dụng (404).');
  }
  if (
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('deadline_exceeded')
  ) {
    return new Error(
      'Máy chủ AI phản hồi quá lâu do quá tải tạm thời. Vui lòng bấm thử lại sau vài giây.'
    );
  }
  if (
    message.includes('503') ||
    message.includes('UNAVAILABLE') ||
    lower.includes('high demand')
  ) {
    return new Error('Hệ thống AI đang quá tải tạm thời. Vui lòng bấm Thử lại sau vài giây.');
  }
  if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
    return new Error('Đã vượt quá hạn mức gọi Gemini API. Vui lòng thử lại sau ít phút.');
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return new Error(
      'Không thể kết nối trực tiếp tới Google Gemini API. Vui lòng kiểm tra mạng hoặc cấu hình VITE_GEMINI_API_KEY.'
    );
  }
  return new Error(`Không thể xử lý yêu cầu AI: ${message}`);
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: {
    contents: unknown;
    config?: Record<string, unknown>;
    timeoutMs?: number;
  }
) {
  const baseTimeout = params.timeoutMs ?? 15_000;
  const now = Date.now();
  const preferBackupFirst = now < hydrogenCooldownUntil;

  const attempts: { model: string; delayMs: number; timeoutMs: number }[] = preferBackupFirst
    ? [
        { model: BACKUP_MODEL, delayMs: 0, timeoutMs: baseTimeout + 2000 },
        { model: BACKUP_MODEL, delayMs: 400, timeoutMs: baseTimeout + 3000 },
        { model: PRIMARY_MODEL, delayMs: 250, timeoutMs: baseTimeout },
      ]
    : [
        { model: PRIMARY_MODEL, delayMs: 0, timeoutMs: Math.min(baseTimeout, 14_000) },
        { model: BACKUP_MODEL, delayMs: 150, timeoutMs: baseTimeout + 2000 },
        { model: BACKUP_MODEL, delayMs: 500, timeoutMs: baseTimeout + 3000 },
      ];

  const keys = getConfiguredApiKeys();
  let currentClient = ai;
  let lastError: unknown;

  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), attempt.timeoutMs);
    try {
      const mergedConfig: Record<string, unknown> = {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        ...(params.config ?? {}),
        abortSignal: controller.signal,
      };
      return await currentClient.models.generateContent({
        model: attempt.model,
        contents: params.contents as never,
        config: mergedConfig as never,
      });
    } catch (err) {
      lastError = err;
      if (isQuotaError(err) && keys.length > 1) {
        activeKeyIndex = (activeKeyIndex + 1) % keys.length;
        currentClient = new GoogleGenAI({ apiKey: keys[activeKeyIndex] });
        console.warn(`Quota hit on key, switching to backup key #${activeKeyIndex + 1}...`);
      }
      if (attempt.model === PRIMARY_MODEL && isTransientAiError(err)) {
        hydrogenCooldownUntil = Date.now() + HYDROGEN_COOLDOWN_MS;
      }
      if (!isTransientAiError(err)) {
        throw err;
      }
      console.warn(
        `Gemini transient error on ${attempt.model}, failing over...`,
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError;
}

function parseAiJson<T = Record<string, unknown>>(rawText: string | undefined): T {
  const trimmed = (rawText ?? '{}').trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!stripped) {
    return {} as T;
  }
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Phản hồi từ AI không đúng định dạng JSON hợp lệ.');
  }
}

function extractBase64Payload(raw: string): { mimeType: string; data: string } | null {
  if (!raw) return null;
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: 'image/jpeg', data: raw };
}

// 1. Analyze student performance across every question & response time
export interface AnalyzeStudentInput {
  studentName: string;
  examTitle: string;
  totalScore: number;
  maxScore: number;
  durationSeconds: number;
  violationCount: number;
  effortSummary?: {
    level: string;
    riskScore: number;
    reasons: string[];
  };
  questionSummaries: Array<{
    questionNumber: number;
    type: string;
    promptSnippet: string;
    timeSpentSeconds: number;
    classAvgSeconds: number;
    classCorrectPct: number;
    score: number;
    maxScore: number;
    isCorrect: boolean;
    suspectedFastGuess: boolean;
  }>;
}

export interface AnalyzeStudentOutput {
  analysis: string;
  suggestedComment: string;
}

export async function analyzeStudentWithAi(
  input: AnalyzeStudentInput
): Promise<AnalyzeStudentOutput> {
  if (!input.studentName || !input.examTitle || !Array.isArray(input.questionSummaries)) {
    throw new Error('Thiếu dữ liệu bài làm để phân tích.');
  }

  try {
    const ai = getGeminiClient();
    const effortBlock = input.effortSummary
      ? `\nĐánh giá mức độ nghiêm túc (hệ thống tự động đo):
- Phân loại: ${input.effortSummary.level} (điểm rủi ro đối phó: ${input.effortSummary.riskScore}/100)
- Dấu hiệu ghi nhận: ${
          input.effortSummary.reasons.length > 0
            ? input.effortSummary.reasons.join('; ')
            : 'Không có dấu hiệu làm đối phó'
        }`
      : '';

    const prompt = `Bạn là giáo viên THPT giàu kinh nghiệm đang phân tích sâu dữ liệu bài làm của học sinh "${input.studentName}" ở đề "${input.examTitle}".

Tổng quan:
- Điểm hiện tại: ${input.totalScore}/${input.maxScore}
- Tổng thời gian làm bài: ${Math.floor(Number(input.durationSeconds || 0) / 60)} phút ${Number(input.durationSeconds || 0) % 60} giây
- Số lần vi phạm chuyển tab: ${input.violationCount || 0}${effortBlock}

Dữ liệu chi tiết TỪNG CÂU HỎI và THỜI GIAN TRẢ LỜI (so với trung bình cả lớp):
${JSON.stringify(input.questionSummaries, null, 2)}

Hãy phân tích sâu bằng tiếng Việt chuẩn sư phạm và trả về JSON gồm:
1. "analysis": Báo cáo chi tiết theo 4 ý rõ ràng (dùng gạch đầu dòng ngắn gọn):
   - Nhịp độ & hành vi làm bài theo thời gian (so sánh thời gian làm mỗi câu với TB lớp, chỉ rõ các câu trả lời quá nhanh <5s nghi chọn đại/đối phó và các câu sa lầy mất nhiều thời gian nhưng vẫn sai).
   - Năng lực theo từng dạng câu (Trắc nghiệm, Đúng/Sai, Trả lời ngắn/Tự luận).
    - Các câu/mạch kiến thức học sinh đang hổng (nêu cụ thể số câu).
   - Lộ trình ôn tập 2 bước tiếp theo cho học sinh này.
2. "suggestedComment": Lời phê ngắn gọn 1-2 câu (TỐI ĐA 180 ký tự), súc tích, đủ ý để điền ô Lời phê và gửi thẳng vào khung tin nhắn phụ huynh (nêu rõ: điểm nổi bật + lỗi chính hoặc thái độ/tốc độ + hướng khắc phục; văn phong tự nhiên, KHÔNG dùng markdown hay ký hiệu $ LaTeX).`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysis: { type: Type.STRING },
            suggestedComment: { type: Type.STRING },
          },
          required: ['analysis', 'suggestedComment'],
        },
      },
    });

    const parsed = parseAiJson<{ analysis?: string; suggestedComment?: string }>(
      response.text
    );
    return {
      analysis: String(parsed.analysis || ''),
      suggestedComment: sanitizeConciseRemark(parsed.suggestedComment || '', 195),
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

// 2. Grade short-answer / essay responses by structured Barem (supports both typed text AND handwritten photo images)
export interface GradeEssayItemInput {
  questionId: string;
  prompt: string;
  barem?: string;
  correctAnswer?: string;
  explanation?: string;
  studentAnswer?: string;
  imageBase64?: string;
  imageMimeType?: string;
  imageDataUrl?: string;
  maxScore: number;
}

export interface GradeEssayInput {
  studentName: string;
  examTitle?: string;
  customBarem?: string;
  items: GradeEssayItemInput[];
}

export interface GradeEssayItemResult {
  questionId: string;
  proposedScore: number;
  recognizedText: string;
  feedback: string;
  shortSummary?: string;
  breakdown: EssayCriterionResult[];
}

export interface GradeEssayOutput {
  results: GradeEssayItemResult[];
  overallNote: string;
  failedQuestionIds?: string[];
}

export async function gradeEssayWithAi(
  input: GradeEssayInput
): Promise<GradeEssayOutput> {
  if (!input.studentName || !Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Không có câu tự luận / ảnh bài làm để chấm.');
  }

  const ai = getGeminiClient();

  const gradeSingleItem = async (
    item: GradeEssayItemInput
  ): Promise<GradeEssayItemResult> => {
    const maxS = Math.max(0.1, Number(item.maxScore || 1));
    const imgInfo = item.imageBase64
      ? {
          mimeType: item.imageMimeType || 'image/jpeg',
          data: item.imageBase64,
        }
      : extractBase64Payload(item.imageDataUrl || '');

    const hasTextAnswer = String(item.studentAnswer || '').trim().length > 0;

    if (!imgInfo?.data && !hasTextAnswer) {
      const q1 = Number((maxS * 0.25).toFixed(2));
      const q2 = Number((maxS * 0.25).toFixed(2));
      const q3 = Number((maxS * 0.25).toFixed(2));
      const q4 = Number((maxS - q1 - q2 - q3).toFixed(2));
      return {
        questionId: String(item.questionId),
        proposedScore: 0,
        recognizedText: '(Học sinh bỏ trống bài làm)',
        feedback: 'Học sinh bỏ trống bài làm tự luận (không viết lời giải hoặc ảnh chụp).',
        shortSummary: 'Chưa làm bài tự luận.',
        breakdown: [
          {
            criterion: 'Công thức áp dụng / Phương pháp giải',
            score: 0,
            maxScore: q1,
            met: false,
          },
          { criterion: 'Thay số & Đổi đơn vị chuẩn', score: 0, maxScore: q2, met: false },
          { criterion: 'Đáp số chính xác', score: 0, maxScore: q3, met: false },
          { criterion: 'Đơn vị đầy đủ & Kết luận', score: 0, maxScore: q4, met: false },
        ],
      };
    }

    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (imgInfo && imgInfo.data) {
      parts.push({
        inlineData: {
          mimeType: imgInfo.mimeType,
          data: imgInfo.data,
        },
      });
    }

    const baremText = [
      item.barem,
      input.customBarem,
      item.correctAnswer,
      item.explanation,
    ]
      .filter((v) => typeof v === 'string' && v.trim().length > 0)
      .join('\n');

    const instruction = `Bạn là giáo viên THPT giàu kinh nghiệm chấm thi tự luận tại Việt Nam. Hãy chấm bài cho học sinh "${input.studentName}" trong đề "${input.examTitle || ''}" theo ĐÚNG BAREM CHI TIẾT.
${imgInfo ? 'Học sinh CÓ đính kèm ảnh chụp bài làm viết tay ở trên. Hãy đọc thật kỹ từng dòng chữ viết tay, ký hiệu công thức, bước đổi đơn vị, phép thay số, kết quả số và ĐƠN VỊ ở cuối bài làm.' : ''}

Thông tin câu hỏi & Barem:
- Mã câu: ${item.questionId}
- Đề bài: ${item.prompt}
- Đáp án chuẩn & Barem của giáo viên: ${baremText || '(Chưa nhập barem riêng — hãy chấm theo barem chuẩn 4 bước của SGK hiện hành)'}
- Bài làm dạng văn bản của học sinh: ${item.studentAnswer || '(Không nhập văn bản — chấm theo ảnh chụp ở trên)'}
- Thang điểm tối đa của câu: ${maxS}

QUY TẮC CHẤM BAREM TỰ LUẬN BẮT BUỘC:
1. Nếu giáo viên có ghi rõ mức điểm từng ý trong barem ở trên thì tuân theo đúng phân bổ điểm đó, nhưng PHẢI kiểm tra đủ 4 tiêu chí sau (nếu chưa có barem chi tiết thì chia ${maxS} điểm thành đúng 4 tiêu chí dưới đây, tổng maxScore của breakdown PHẢI bằng chính xác ${maxS}):
   - Tiêu chí 1: "Công thức áp dụng / Phương pháp giải" (~25%-30% tổng điểm): Kiểm tra viết đúng công thức/định luật/phương trình nền tảng chưa. Nếu SAI công thức gốc -> tiêu chí này 0đ và các bước thay số/đáp số phụ thuộc công thức sai đó cũng không được tính điểm.
   - Tiêu chí 2: "Thay số & Đổi đơn vị chuẩn" (~25%-30% tổng điểm): Kiểm tra việc đổi đúng đơn vị về hệ chuẩn (nếu cần) và thay đúng giá trị vào công thức.
   - Tiêu chí 3: "Đáp số chính xác" (~25% tổng điểm): Kiểm tra giá trị số cuối cùng (cho phép sai số làm tròn hợp lý nếu barem không khắt khe).
   - Tiêu chí 4: "Đơn vị đầy đủ & Kết luận" (~15%-20% tổng điểm): BẮT BUỘC kiểm tra đơn vị sau kết quả cuối cùng (VD: $J$, $kJ$, $m/s$, $A$, $V$, $\\Omega$, $mol$, $g$...). Nếu tính đúng con số nhưng THIẾU đơn vị hoặc GHI SAI đơn vị -> bắt buộc đánh dấu "met": false và cho 0đ ở tiêu chí này, đồng thời chỉ rõ thiếu/sai đơn vị trong nhận xét!
   (Ghi chú: Nếu là câu tự luận lý thuyết thuần giải thích không có phép tính số, vẫn bám đủ các ý: Nêu đúng quy luật/cơ sở lí thuyết, Lập luận/vận dụng vào đề bài, Kết luận chuẩn thuật ngữ & ký hiệu.)

2. "recognizedText": Chép lại chính xác bài làm đọc được từ ảnh viết tay (hoặc từ văn bản học sinh). Mọi công thức Toán/Vật lí/Hoá học viết bằng LaTeX chuẩn trong $...$ hoặc $$...$$ (escape \\ đúng chuẩn JSON).
3. "breakdown": Mảng các tiêu chí chấm theo barem trên, mỗi phần tử gồm { criterion, score, maxScore, met }. Tổng maxScore bằng ${maxS}, tổng score bằng "proposedScore".
4. "proposedScore": Tổng điểm đạt được từ breakdown (từ 0 đến ${maxS}).
5. "feedback": Nhận xét chi tiết từng mục: công thức đã đúng chưa, thay số/đổi đơn vị ra sao, đáp số thế nào, có thiếu/sai đơn vị không, và hướng dẫn cách sửa ngắn gọn (dùng $...$ cho công thức).
6. "shortSummary": ĐÚNG 1 câu nhận xét thật súc tích, đủ ý (tối đa 140 ký tự, văn phong tự nhiên gửi thẳng trong tin nhắn phụ huynh, KHÔNG dùng ký hiệu $ hay markdown) nêu rõ điểm đạt được và lỗi chính cần sửa.`;

    parts.push({ text: instruction });

    const response = await generateContentWithRetry(ai, {
      contents: { parts },
      timeoutMs: 24_000,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recognizedText: { type: Type.STRING },
            proposedScore: { type: Type.NUMBER },
            feedback: { type: Type.STRING },
            shortSummary: { type: Type.STRING },
            breakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  criterion: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  maxScore: { type: Type.NUMBER },
                  met: { type: Type.BOOLEAN },
                },
                required: ['criterion', 'score', 'maxScore', 'met'],
              },
            },
          },
          required: ['recognizedText', 'proposedScore', 'feedback', 'shortSummary', 'breakdown'],
        },
      },
    });

    const parsed = parseAiJson<{
      recognizedText?: string;
      proposedScore?: number;
      feedback?: string;
      shortSummary?: string;
      breakdown?: EssayCriterionResult[];
    }>(response.text);

    const rawBreakdown = Array.isArray(parsed.breakdown) ? parsed.breakdown : [];
    const sumBreakdown = rawBreakdown.reduce(
      (s: number, b: { score?: number }) => s + Number(b?.score || 0),
      0
    );
    const effectiveScore =
      rawBreakdown.length > 0 && sumBreakdown >= 0
        ? sumBreakdown
        : Number(parsed.proposedScore || 0);
    const clampedScore = Math.min(Math.max(effectiveScore, 0), maxS);

    return {
      questionId: String(item.questionId),
      proposedScore: Number(clampedScore.toFixed(2)),
      recognizedText: String(parsed.recognizedText || ''),
      feedback: String(parsed.feedback || ''),
      shortSummary: sanitizeConciseRemark(parsed.shortSummary || parsed.feedback || '', 155),
      breakdown: rawBreakdown,
    };
  };

  const settled = await Promise.allSettled(input.items.map(gradeSingleItem));
  const results: GradeEssayItemResult[] = [];
  const failedQuestionIds: string[] = [];
  let firstError: unknown = null;

  settled.forEach((outcome, idx) => {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      failedQuestionIds.push(String(input.items[idx].questionId));
      if (!firstError) firstError = outcome.reason;
    }
  });

  if (results.length === 0 && firstError) {
    throw toFriendlyAiError(firstError);
  }

  let overallNote = '';
  if (results.length === 1) {
    overallNote = sanitizeConciseRemark(
      results[0].shortSummary || results[0].feedback,
      190
    );
  } else {
    const scorePart = results
      .map((r) => `${r.questionId.toUpperCase()}: ${r.proposedScore}đ`)
      .join(', ');
    const keyIssue =
      results.find((r) => r.shortSummary && r.shortSummary !== 'Chưa làm bài tự luận.')
        ?.shortSummary ||
      results[0]?.shortSummary ||
      '';
    overallNote = sanitizeConciseRemark(
      `Tự luận (${scorePart})${keyIssue ? `. ${keyIssue}` : '.'}`,
      195
    );
  }

  return {
    results,
    overallNote,
    ...(failedQuestionIds.length > 0 ? { failedQuestionIds } : {}),
  };
}

// 3. Standalone Photo Essay Grader
export interface GradePhotoInput {
  imageBase64: string;
  imageMimeType?: string;
  promptText?: string;
  rubricText?: string;
  maxScore?: number;
}

export interface GradePhotoOutput {
  recognizedText: string;
  score: number;
  breakdown: EssayCriterionResult[];
  strengths: string;
  mistakes: string;
  teacherComment: string;
}

export async function gradePhotoWithAi(
  input: GradePhotoInput
): Promise<GradePhotoOutput> {
  if (!input.imageBase64) {
    throw new Error('Vui lòng chọn ảnh chụp bài làm để AI chấm.');
  }

  try {
    const ai = getGeminiClient();
    const maxS = Math.min(Math.max(Number(input.maxScore || 10), 0.25), 100);

    const response = await generateContentWithRetry(ai, {
      timeoutMs: 25_000,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: input.imageMimeType || 'image/jpeg',
              data: input.imageBase64,
            },
          },
          {
            text: `Bạn là giáo viên THPT giàu kinh nghiệm tại Việt Nam. Hãy đọc ảnh chụp bài làm tự luận viết tay ở trên và chấm điểm theo ĐÚNG BAREM trên thang điểm ${maxS}.

Đề bài / Yêu cầu (nếu giáo viên có cung cấp): ${input.promptText || '(Tự nhận diện đề bài hoặc nội dung bài giải trong ảnh)'}
Đáp án / Barem điểm của giáo viên (nếu có): ${input.rubricText || '(Chấm theo barem chuẩn 4 bước: Công thức áp dụng, Thay số & Đổi đơn vị, Đáp số chính xác, Đơn vị đầy đủ & Kết luận)'}

QUY TẮC BAREM BẮT BUỘC:
- Nếu giáo viên đã ghi rõ phân bổ điểm từng bước trong barem trên thì bám sát barem đó, đồng thời kiểm tra đủ 4 khía cạnh: (1) Công thức áp dụng, (2) Thay số & đổi đơn vị chuẩn, (3) Đáp số chính xác, (4) Đơn vị đầy đủ ở kết quả cuối.
- Nếu chưa có phân bổ điểm cụ thể, hãy chia ${maxS} điểm thành đúng 4 tiêu chí trong "breakdown": Công thức áp dụng (~25-30%), Thay số & đổi đơn vị (~25-30%), Đáp số chính xác (~25%), Đơn vị đầy đủ & kết luận (~15-20%).
- Nếu học sinh tính đúng số nhưng THIẾU đơn vị hoặc SAI đơn vị ở đáp số cuối -> BẮT BUỘC trừ điểm tiêu chí đơn vị và ghi rõ trong "mistakes". Nếu sai công thức gốc -> không cho điểm thay số/đáp số phụ thuộc công thức sai.

Hãy trả về JSON:
1. "recognizedText": Chép lại sạch sẽ toàn bộ nội dung chữ viết tay và công thức đọc được từ ảnh. Mọi công thức Toán/Lí/Hoá viết bằng LaTeX chuẩn trong $...$ hoặc $$...$$ (thoát dấu \\ đúng chuẩn JSON).
2. "score": Tổng điểm đề xuất trên thang ${maxS} (khớp với tổng các mục trong breakdown).
3. "breakdown": Danh sách các tiêu chí chấm theo barem (criterion, score, maxScore, met).
4. "strengths": Điểm làm tốt trong bài.
5. "mistakes": Các lỗi sai cụ thể (sai công thức, quên đổi đơn vị, thay nhầm số, thiếu/sai đơn vị ở đáp số...; dùng LaTeX $...$ cho công thức).
6. "teacherComment": Lời phê sư phạm ngắn gọn gửi học sinh & phụ huynh.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recognizedText: { type: Type.STRING },
            score: { type: Type.NUMBER },
            breakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  criterion: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  maxScore: { type: Type.NUMBER },
                  met: { type: Type.BOOLEAN },
                },
                required: ['criterion', 'score', 'maxScore', 'met'],
              },
            },
            strengths: { type: Type.STRING },
            mistakes: { type: Type.STRING },
            teacherComment: { type: Type.STRING },
          },
          required: [
            'recognizedText',
            'score',
            'breakdown',
            'strengths',
            'mistakes',
            'teacherComment',
          ],
        },
      },
    });

    const parsed = parseAiJson<Partial<GradePhotoOutput>>(response.text);
    const rawBreakdown = Array.isArray(parsed.breakdown) ? parsed.breakdown : [];
    const sumBreakdown = rawBreakdown.reduce(
      (s: number, b: { score?: number }) => s + Number(b?.score || 0),
      0
    );
    const effectiveScore =
      rawBreakdown.length > 0 && sumBreakdown >= 0
        ? sumBreakdown
        : Number(parsed.score || 0);

    return {
      recognizedText: String(parsed.recognizedText || ''),
      score: Number(Math.min(Math.max(effectiveScore, 0), maxS).toFixed(2)),
      breakdown: rawBreakdown,
      strengths: String(parsed.strengths || ''),
      mistakes: String(parsed.mistakes || ''),
      teacherComment: sanitizeConciseRemark(parsed.teacherComment || '', 195),
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

// 4. Generate exam questions from topic/sample text
export interface GenerateExamInput {
  subject: string;
  topic: string;
  mcqCount?: number;
  tfCount?: number;
  shortCount?: number;
  essayCount?: number;
  referenceContext?: ReferenceContextPayload;
}

export interface GenerateExamOutput {
  title?: string;
  questions: Array<Partial<ExamQuestion>>;
}

export async function generateExamWithAi(
  input: GenerateExamInput
): Promise<GenerateExamOutput> {
  if (!input.subject?.trim() || !input.topic?.trim()) {
    throw new Error('Vui lòng nhập môn học và chủ đề đề thi.');
  }

  try {
    const ai = getGeminiClient();
    const totalMcq = Math.min(Math.max(Number(input.mcqCount ?? 4), 1), 12);
    const totalTf = Math.min(Math.max(Number(input.tfCount ?? 1), 0), 4);
    const totalShort = Math.min(Math.max(Number(input.shortCount ?? 1), 0), 4);
    const totalEssay = Math.min(Math.max(Number(input.essayCount ?? 1), 0), 4);

    const hasRef = Boolean(
      input.referenceContext &&
        (input.referenceContext.knowledgeSnippets.length > 0 ||
          input.referenceContext.referenceItems.length > 0)
    );

    const refBlock = hasRef
      ? `\n\nNGUỒN DỮ LIỆU CHUẨN DO GIÁO VIÊN CUNG CẤP (ƯU TIÊN THAM CHIẾU):
- Hãy bám sát công thức, ký hiệu, đơn vị, mức độ và cấu trúc câu hỏi trong kho chuẩn dưới đây (có thể biến tấu số liệu/ngữ cảnh tương đương hoặc tham khảo trực tiếp dạng toán chuẩn):
${input.referenceContext!.knowledgeSnippets.length > 0 ? `Kiến thức & công thức trọng tâm:\n${input.referenceContext!.knowledgeSnippets.join('\n\n')}\n` : ''}${input.referenceContext!.referenceItems.length > 0 ? `Câu hỏi mẫu chuẩn:\n${JSON.stringify(input.referenceContext!.referenceItems, null, 2)}` : ''}`
      : '';

    const prompt = `Bạn là chuyên gia ra đề kiểm tra theo Chương trình GDPT 2018 của Việt Nam.
Hãy soạn bộ câu hỏi môn "${input.subject}" về chủ đề: "${input.topic}".
Số lượng yêu cầu:
- ${totalMcq} câu Trắc nghiệm 4 lựa chọn (type: "mcq", maxScore: 0.25, có 4 options A/B/C/D, correctOption là chỉ số 0..3).
- ${totalTf} câu Đúng/Sai gồm 4 ý nhỏ a, b, c, d (type: "true_false", maxScore: 1.0, có statements gồm 4 phần tử text + isTrue).
- ${totalShort} câu Trả lời ngắn điền số tối đa 4 ký tự (type: "short_answer", maxScore: 0.5, có correctAnswer là giá trị số ngắn gọn tối đa 4 ký tự như "2,5" hoặc "668" hoặc "-12").
- ${totalEssay} câu Tự luận (type: "essay", maxScore: 1.0, có trường explanation là Hướng dẫn giải từng bước rõ ràng, chi tiết).
Mỗi câu PHẢI có trường "explanation" (Hướng dẫn giải ngắn gọn, chính xác, dễ hiểu).
Quy tắc công thức Toán/Vật lí/Hoá học: Tất cả biểu thức, phân số, căn thức, luỹ thừa, tích phân, vectơ, hệ phương trình PHẢI viết bằng LaTeX đặt trong $...$ (inline) hoặc $$...$$ (display) và escape dấu backslash đúng chuẩn JSON (\\frac, \\sqrt, \\int, \\overrightarrow...).${refBlock}`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      timeoutMs: 25_000,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  maxScore: { type: Type.NUMBER },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  correctOption: { type: Type.INTEGER },
                  statements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        isTrue: { type: Type.BOOLEAN },
                      },
                    },
                  },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: ['type', 'prompt', 'maxScore', 'explanation'],
              },
            },
          },
          required: ['title', 'questions'],
        },
      },
    });

    const parsed = parseAiJson<Partial<GenerateExamOutput>>(response.text);
    return {
      title: parsed.title,
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

// 5. AI-assisted Word (.docx) exam parser
export interface ParseWordExamInput {
  annotatedText: string;
}

export interface ParseWordExamOutput {
  title?: string;
  subject?: string;
  questions: Array<
    Partial<ExamQuestion> & {
      imageIndices?: number[];
      explanationImageIndices?: number[];
    }
  >;
}

export async function parseWordExamWithAi(
  input: ParseWordExamInput
): Promise<ParseWordExamOutput> {
  if (!input.annotatedText || typeof input.annotatedText !== 'string') {
    throw new Error('Thiếu nội dung trích xuất từ file Word.');
  }

  try {
    const ai = getGeminiClient();
    const prompt = `Bạn là trợ lý chuyển đổi đề thi từ file Word (.docx) sang cấu trúc JSON chuẩn.
Văn bản dưới đây đã được trích xuất từ file Word với 2 ký hiệu đặc biệt:
- [U]...[/U]: đoạn chữ ĐƯỢC GẠCH CHÂN trong Word.
- [IMG_0], [IMG_1], ...: vị trí hình ảnh đính kèm tương ứng trong Word.

Quy tắc đọc đáp án BẮT BUỘC:
1. Trắc nghiệm ("mcq", mặc định 0.25 điểm): có 4 phương án A, B, C, D. Phương án nào có nhãn (như [U]A.[/U]) hoặc nội dung được bọc [U]...[/U] thì đó là đáp án đúng (correctOption 0..3). Nếu không gạch chân thì tìm bảng đáp án cuối đề.
2. Đúng / Sai ("true_false", mặc định 1.0 điểm): gồm 4 ý a), b), c), d). Ý nào được bọc [U]...[/U] (gạch chân ở nhãn hoặc nội dung) là ĐÚNG (isTrue: true), ý không gạch chân là SAI (isTrue: false), trừ khi có ghi chú (Đ)/(S) hoặc bảng đáp án rõ ràng.
3. Trả lời ngắn ("short_answer", mặc định 0.5 điểm): câu điền số (học sinh sẽ nhập vào 4 ô số). Hãy đưa giá trị số chuẩn (tối đa 4 ký tự, vd "2,5" hoặc "668") vào "correctAnswer", giải thích vào "explanation".
4. Tự luận ("essay", mặc định 1.0 điểm hoặc theo điểm ghi trên đề): câu hỏi tự luận mở. Trích xuất toàn bộ Hướng dẫn giải / Lời giải vào "explanation" (nếu file chưa có lời giải, hãy tự viết hướng dẫn giải từng bước rõ ràng). Với CẢ câu trắc nghiệm, Đúng/Sai và Trả lời ngắn: nếu file Word chưa có lời giải, hãy tự phân tích dựa trên đáp án đúng vừa đọc được để viết "explanation" giải thích ngắn gọn, chính xác vì sao đáp án đó đúng.
5. Hình ảnh: Bỏ thẻ [IMG_i] khỏi văn bản prompt/explanation và đưa các số i (ví dụ 0, 1) vào mảng "imageIndices" (cho ảnh của đề bài) và "explanationImageIndices" (cho ảnh thuộc phần lời giải). Xoá sạch thẻ [U] và [/U] khỏi văn bản đầu ra.
6. Công thức Toán/Lí/Hoá: Giữ nguyên toàn bộ LaTeX $...$ và $$...$$; nếu có công thức rời rạc thì chuẩn hoá về LaTeX đặt trong $...$ (escape \\ đúng chuẩn JSON).

Nội dung trích xuất từ file Word:
${input.annotatedText.slice(0, 45000)}`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      timeoutMs: 28_000,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subject: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  maxScore: { type: Type.NUMBER },
                  imageIndices: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                  },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  correctOption: { type: Type.INTEGER },
                  statements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        isTrue: { type: Type.BOOLEAN },
                      },
                    },
                  },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  explanationImageIndices: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                  },
                },
                required: ['type', 'prompt', 'maxScore', 'explanation'],
              },
            },
          },
          required: ['questions'],
        },
      },
    });

    const parsed = parseAiJson<Partial<ParseWordExamOutput>>(response.text);
    return {
      title: parsed.title,
      subject: parsed.subject,
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

// 6. Auto-generate step-by-step explanations strictly anchored to known answer keys
export interface ExplanationQuestionInput {
  id: string;
  index: number;
  type: string;
  prompt: string;
  options?: string[];
  correctOption?: number;
  statements?: { text: string; isTrue: boolean }[];
  correctAnswer?: string;
  explanation?: string;
}

export interface GenerateExplanationsInput {
  subject?: string;
  title?: string;
  overwriteAll?: boolean;
  questions: ExplanationQuestionInput[];
}

export interface GenerateExplanationsOutput {
  explanations: { id: string; explanation: string }[];
}

export async function generateExplanationsWithAi(
  input: GenerateExplanationsInput
): Promise<GenerateExplanationsOutput> {
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error('Không có câu hỏi nào để tạo lời giải.');
  }

  const targets = input.questions.filter(
    (q) => input.overwriteAll || !String(q.explanation || '').trim()
  );

  if (targets.length === 0) {
    return { explanations: [] };
  }

  try {
    const ai = getGeminiClient();
    const collected: { id: string; explanation: string }[] = [];
    const BATCH_SIZE = 15;

    for (let start = 0; start < targets.length; start += BATCH_SIZE) {
      const batch = targets.slice(start, start + BATCH_SIZE).map((q) => {
        const optionLetters = ['A', 'B', 'C', 'D'];
        let answerSummary = '';
        if (q.type === 'mcq') {
          const optIdx = typeof q.correctOption === 'number' ? q.correctOption : 0;
          answerSummary = `Đáp án đúng đã chốt: ${optionLetters[optIdx] || 'A'}. ${
            q.options?.[optIdx] || ''
          }`;
        } else if (q.type === 'true_false') {
          answerSummary = `Đáp án Đúng/Sai đã chốt: ${(q.statements || [])
            .map((st, i) => `${'abcd'[i]}) ${st.isTrue ? 'Đúng' : 'Sai'} — "${st.text}"`)
            .join(' | ')}`;
        } else {
          answerSummary = `Đáp án / barem đã chốt: ${
            q.correctAnswer || '(Tự luận — lập hướng dẫn giải từng bước)'
          }`;
        }

        return {
          id: String(q.id),
          index: Number(q.index || 0),
          type: q.type,
          prompt: q.prompt,
          ...(q.options ? { options: q.options } : {}),
          answerSummary,
        };
      });

      const prompt = `Bạn là giáo viên THPT giàu kinh nghiệm môn "${input.subject || 'Tổng hợp'}" (đề "${input.title || 'Đề kiểm tra'}").
Hãy viết lời giải / phân tích chi tiết cho từng câu hỏi dưới đây DỰA CHÍNH XÁC VÀO ĐÁP ÁN ĐÃ CHỐT (tuyệt đối không tự ý đổi đáp án đã cho).

Yêu cầu cho từng câu:
- Với Trắc nghiệm: giải thích ngắn gọn, rõ ràng công thức / lập luận dẫn tới đúng phương án đã chốt.
- Với Đúng / Sai: phân tích lần lượt cả 4 ý a), b), c), d) vì sao Đúng hoặc Sai đúng như đáp án đã chốt.
- Với Trả lời ngắn: trình bày các bước tính toán ra đúng đáp số đã chốt (kèm đơn vị nếu có).
- Với Tự luận: trình bày hướng dẫn giải từng bước rõ ràng, có thể gợi ý thang điểm từng bước.
- Mọi công thức Toán/Vật lí/Hoá học PHẢI viết bằng LaTeX chuẩn đặt trong $...$ hoặc $$...$$ (escape \\ đúng chuẩn JSON, vd: \\frac{a}{b}, \\sqrt{x}).

Danh sách câu hỏi cần viết giải thích:
${JSON.stringify(batch, null, 2)}`;

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
        timeoutMs: 25_000,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              explanations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                  },
                  required: ['id', 'explanation'],
                },
              },
            },
            required: ['explanations'],
          },
        },
      });

      const parsed = parseAiJson<{ explanations?: { id?: string; explanation?: string }[] }>(
        response.text
      );
      if (Array.isArray(parsed.explanations)) {
        for (const item of parsed.explanations) {
          if (item?.id && item?.explanation) {
            collected.push({
              id: String(item.id),
              explanation: String(item.explanation).trim(),
            });
          }
        }
      }
    }

    return { explanations: collected };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

// 7. Generate targeted remedial practice questions for a student based on their wrong answers
export interface RemedialWrongQuestionInput {
  index: number;
  type: string;
  prompt: string;
  studentAnswer: string;
  correctAnswer: string;
  explanation: string;
}

export interface GenerateRemedialPracticeInput {
  subject?: string;
  examTitle?: string;
  wrongQuestions: RemedialWrongQuestionInput[];
  referenceContext?: ReferenceContextPayload;
}

export async function generateRemedialPracticeWithAi(
  input: GenerateRemedialPracticeInput
): Promise<RemedialPracticeData> {
  if (!Array.isArray(input.wrongQuestions) || input.wrongQuestions.length === 0) {
    throw new Error('Không có câu sai để tạo bài ôn tập.');
  }

  try {
    const ai = getGeminiClient();
    const cappedWrong = input.wrongQuestions.slice(0, 6);
    const targetCount = Math.min(Math.max(cappedWrong.length, 3), 6);

    const refCtx = input.referenceContext;
    const hasRefData = Boolean(
      refCtx &&
        (refCtx.knowledgeSnippets.length > 0 || refCtx.referenceItems.length > 0)
    );

    const referenceInstruction = hasRefData
      ? `\n\nNGUỒN DỮ LIỆU CHUẨN DO GIÁO VIÊN CUNG CẤP (BẮT BUỘC ƯU TIÊN THAM CHIẾU):
- Giáo viên đã nạp Kho dữ liệu chuẩn bên dưới gồm kiến thức trọng tâm và câu hỏi mẫu chuẩn.
- Hãy ưu tiên chọn dạng toán, công thức, ký hiệu, đơn vị và phương pháp giải từ Kho chuẩn khớp với từng câu sai của học sinh (bạn có thể giữ nguyên mô hình bài toán chuẩn rồi thay số/tình huống tương đương, hoặc bám sát câu mẫu chuẩn nhưng KHÔNG trùng nguyên văn câu học sinh vừa sai trong bài thi).
- Lời giải ("explanation") phải giải chi tiết đúng chuẩn công thức trong tài liệu của giáo viên.
${refCtx!.knowledgeSnippets.length > 0 ? `\n[Tóm tắt kiến thức & công thức chuẩn]\n${refCtx!.knowledgeSnippets.join('\n\n')}\n` : ''}${refCtx!.referenceItems.length > 0 ? `\n[Ngân hàng câu hỏi mẫu chuẩn liên quan]\n${JSON.stringify(refCtx!.referenceItems, null, 2)}` : ''}`
      : '';

    const prompt = `Bạn là gia sư AI tâm huyết hỗ trợ học sinh THPT ôn tập ngay sau khi vừa làm xong bài kiểm tra "${input.examTitle || ''}" (môn "${input.subject || 'Tổng hợp'}").
Dưới đây là các câu mà học sinh vừa LÀM SAI (kèm lựa chọn sai của học sinh và đáp án đúng):
${JSON.stringify(cappedWrong, null, 2)}${referenceInstruction}

Hãy phân tích lỗ hổng kiến thức gây ra các câu sai trên và soạn bộ ${targetCount} câu hỏi ÔN TẬP TƯƠNG TỰ MỚI (thay số liệu / bối cảnh / cách hỏi tương đương để học sinh luyện lại đúng dạng kiến thức vừa hổng, KHÔNG chép nguyên văn câu cũ).

Quy tắc:
1. Gắn mỗi câu luyện tập với số thứ tự câu gốc bị sai ("sourceQuestionIndex") và tên kỹ năng/kiến thức cần củng cố ("focusTopic").
2. Dùng các dạng tự chấm được ngay để học sinh làm bài trực tiếp:
   - "mcq": 4 phương án A/B/C/D ("options" gồm đúng 4 chuỗi KHÔNG cần tiền tố A./B./C./D., "correctOption" từ 0..3).
   - "true_false": 4 mệnh đề a, b, c, d ("statements" gồm 4 phần tử { text, isTrue }).
   - "short_answer": điền số ngắn gọn tối đa 4 ký tự vào "correctAnswer" (ví dụ "2,5" hoặc "120" hoặc "-4").
   Ưu tiên phân bổ theo đúng dạng của câu học sinh làm sai (nếu câu sai là tự luận thì tạo câu trắc nghiệm hoặc trả lời ngắn kiểm tra lại từng bước kiến thức cốt lõi của câu đó).
3. Mỗi câu BẮT BUỘC có "explanation" hướng dẫn giải chi tiết từng bước và kiểm tra lại thật kỹ tính toán để đáp án đúng là chính xác tuyệt đối.
4. Tất cả công thức Toán/Lí/Hoá viết bằng LaTeX chuẩn trong $...$ hoặc $$...$$ (escape \\ đúng chuẩn JSON).`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            focusSummary: { type: Type.STRING },
            practiceQuestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sourceQuestionIndex: { type: Type.INTEGER },
                  focusTopic: { type: Type.STRING },
                  type: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  correctOption: { type: Type.INTEGER },
                  statements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        isTrue: { type: Type.BOOLEAN },
                      },
                    },
                  },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: [
                  'sourceQuestionIndex',
                  'focusTopic',
                  'type',
                  'prompt',
                  'explanation',
                ],
              },
            },
          },
          required: ['focusSummary', 'practiceQuestions'],
        },
      },
    });

    const parsed = parseAiJson<{
      focusSummary?: string;
      practiceQuestions?: Record<string, unknown>[];
    }>(response.text);

    const normalized: PracticeQuestion[] = Array.isArray(parsed.practiceQuestions)
      ? parsed.practiceQuestions.map((q: Record<string, unknown>, idx: number) => {
          const rawType = String(q.type || 'mcq');
          const type: PracticeQuestion['type'] =
            rawType === 'true_false' || rawType === 'short_answer' ? rawType : 'mcq';
          return {
            id: `prac_${idx + 1}_${Date.now().toString(36)}`,
            index: idx + 1,
            sourceQuestionIndex: Number(
              q.sourceQuestionIndex || cappedWrong[0]?.index || 1
            ),
            focusTopic: String(q.focusTopic || 'Củng cố kiến thức'),
            type,
            prompt: String(q.prompt || ''),
            ...(type === 'mcq'
              ? {
                  options:
                    Array.isArray(q.options) && q.options.length >= 4
                      ? q.options.slice(0, 4).map(String)
                      : ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
                  correctOption:
                    typeof q.correctOption === 'number'
                      ? Math.min(Math.max(q.correctOption, 0), 3)
                      : 0,
                }
              : {}),
            ...(type === 'true_false'
              ? {
                  statements:
                    Array.isArray(q.statements) && q.statements.length >= 4
                      ? q.statements
                          .slice(0, 4)
                          .map((st: { text?: string; isTrue?: boolean }) => ({
                            text: String(st?.text || ''),
                            isTrue: Boolean(st?.isTrue),
                          }))
                      : [
                          { text: 'Ý a', isTrue: true },
                          { text: 'Ý b', isTrue: false },
                          { text: 'Ý c', isTrue: true },
                          { text: 'Ý d', isTrue: false },
                        ],
                }
              : {}),
            ...(type === 'short_answer'
              ? { correctAnswer: String(q.correctAnswer || '').slice(0, 6) }
              : {}),
            explanation: String(q.explanation || ''),
          };
        })
      : [];

    return {
      focusSummary: String(
        parsed.focusSummary ||
          'Bộ câu hỏi được cá nhân hoá theo những câu bạn vừa làm sai.'
      ),
      practiceQuestions: normalized,
      ...(input.referenceContext && input.referenceContext.matchedTitles.length > 0
        ? {
            referenceSources: {
              titles: input.referenceContext.matchedTitles,
              sampleCount: input.referenceContext.referenceItems.length,
            },
          }
        : {}),
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

// 8. Student post-exam personal analysis & pedagogical feedback
export interface StudentReviewQuestionResultInput {
  index: number;
  type: string;
  promptSnippet: string;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  timeSpentSeconds: number;
  aiBaremFeedback?: string;
}

export interface GenerateStudentReviewInput {
  studentName?: string;
  subject?: string;
  examTitle: string;
  totalScore: number;
  maxScore: number;
  durationSeconds: number;
  questionResults: StudentReviewQuestionResultInput[];
}

export interface GenerateStudentReviewOutput {
  overallComment: string;
  strengths: string;
  weaknesses: string;
  pacingNote: string;
  studyPlan: string;
}

export async function generateStudentReviewWithAi(
  input: GenerateStudentReviewInput
): Promise<GenerateStudentReviewOutput> {
  if (!input.examTitle || !Array.isArray(input.questionResults)) {
    throw new Error('Thiếu dữ liệu bài làm để nhận xét.');
  }

  try {
    const ai = getGeminiClient();
    const compactResults = input.questionResults.slice(0, 50);

    const prompt = `Bạn là thầy/cô giáo THPT tận tâm đang viết NHẬN XÉT & PHÂN TÍCH BÀI LÀM trực tiếp gửi cho học sinh "${input.studentName || 'em'}" ngay sau khi em vừa nộp bài "${input.examTitle}" (môn "${input.subject || 'Tổng hợp'}").

Kết quả tổng quan:
- Điểm đạt được: ${input.totalScore}/${input.maxScore}
- Tổng thời gian làm: ${Math.floor(Number(input.durationSeconds || 0) / 60)} phút ${Number(input.durationSeconds || 0) % 60} giây

Chi tiết từng câu (đúng/sai, điểm, thời gian làm, và nhận xét barem nếu là câu tự luận):
${JSON.stringify(compactResults, null, 2)}

Hãy trả về JSON với giọng văn thân thiện, khích lệ nhưng thẳng thắn chỉ rõ lỗi sai (xưng "thầy/cô" hoặc "bạn", gọi "em"), các công thức Toán/Lí/Hoá đặt trong $...$ (escape \\ chuẩn JSON):
1. "overallComment": Nhận xét tổng quan 2-3 câu về mức độ nắm kiến thức và điểm số hiện tại.
2. "strengths": Điểm làm tốt (dạng câu hoặc chuyên đề nào em làm chắc, bước giải tự luận nào đạt chuẩn).
3. "weaknesses": Những lỗi cần khắc phục cụ thể (nêu đích danh số câu sai, lỗi công thức / đổi đơn vị / thiếu đơn vị hoặc câu làm quá vội dưới 5 giây). Nếu làm đúng hết thì ghi nhận sự cẩn thận và nhắc điểm cần giữ phong độ.
4. "pacingNote": Nhận xét nhịp độ & phân bổ thời gian làm bài (câu nào vội, câu nào sa lầy quá lâu).
5. "studyPlan": Lời khuyên 2 việc cụ thể em nên làm ngay sau khi đọc nhận xét này (xem lại câu nào và luyện dạng bài gì ở mục Luyện câu ôn tập AI).`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallComment: { type: Type.STRING },
            strengths: { type: Type.STRING },
            weaknesses: { type: Type.STRING },
            pacingNote: { type: Type.STRING },
            studyPlan: { type: Type.STRING },
          },
          required: [
            'overallComment',
            'strengths',
            'weaknesses',
            'pacingNote',
            'studyPlan',
          ],
        },
      },
    });

    const parsed = parseAiJson<Partial<GenerateStudentReviewOutput>>(response.text);
    return {
      overallComment: String(parsed.overallComment || ''),
      strengths: String(parsed.strengths || ''),
      weaknesses: String(parsed.weaknesses || ''),
      pacingNote: String(parsed.pacingNote || ''),
      studyPlan: String(parsed.studyPlan || ''),
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

// 9. Holistic cross-attempt progress analysis for Student Learning Journal
export interface AnalyzeStudentProgressInput {
  studentName: string;
  className?: string;
  attempts: Array<{
    examTitle: string;
    subject: string;
    score10: number;
    totalScore: number;
    maxScore: number;
    durationSeconds: number;
    violationCount: number;
    effortLevel: string;
    dateLabel: string;
  }>;
  typeStats: Array<{
    label: string;
    pct: number;
  }>;
}

export interface AnalyzeStudentProgressOutput {
  learningStatus: string;
  overallAssessment: string;
  strengths: string;
  patternsToFix: string;
  nextGoalPlan: string;
}

export async function analyzeStudentProgressWithAi(
  input: AnalyzeStudentProgressInput
): Promise<AnalyzeStudentProgressOutput> {
  if (!Array.isArray(input.attempts) || input.attempts.length === 0) {
    throw new Error('Chưa có lịch sử làm bài để phân tích tiến độ.');
  }

  try {
    const ai = getGeminiClient();
    const recentAttempts = input.attempts.slice(0, 15);

    const prompt = `Bạn là giáo viên cố vấn học tập THPT đang phân tích TOÀN BỘ QUÁ TRÌNH HỌC TẬP qua nhiều lần làm bài của học sinh "${input.studentName || 'em'}" (${input.className ? `Lớp ${input.className}` : 'học sinh tự do'}).

Nhật ký các lần làm bài (xếp theo thời gian):
${JSON.stringify(recentAttempts, null, 2)}

Năng lực tổng hợp theo từng dạng câu hỏi:
${JSON.stringify(input.typeStats, null, 2)}

Hãy đánh giá toàn diện bằng tiếng Việt thân thiện, rõ ràng, truyền động lực nhưng thẳng thắn (xưng "thầy/cô", gọi "em"; công thức viết bằng $...$ nếu có) và trả về JSON gồm:
1. "learningStatus": Nhãn ngắn gọn nhận định tình trạng hiện tại (VD: "Đang tiến bộ rõ rệt", "Phong độ ổn định ở mức khá", "Cần chấn chỉnh tốc độ & thái độ làm bài", "Cần củng cố nền tảng").
2. "overallAssessment": Đánh giá tổng quan 2-3 câu về xu hướng điểm số (tăng/giảm/ổn định) và mức độ nghiêm túc qua các lần thi.
3. "strengths": Dạng bài hoặc thói quen tích cực em đang giữ vững.
4. "patternsToFix": Điểm yếu lặp lại qua nhiều bài (dạng câu hay mất điểm, hiện tượng chọn quá nhanh <5s hoặc bỏ trống tự luận nếu có).
5. "nextGoalPlan": Mục tiêu điểm số và 2 bước hành động cụ thể cho lần thi tiếp theo.`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            learningStatus: { type: Type.STRING },
            overallAssessment: { type: Type.STRING },
            strengths: { type: Type.STRING },
            patternsToFix: { type: Type.STRING },
            nextGoalPlan: { type: Type.STRING },
          },
          required: [
            'learningStatus',
            'overallAssessment',
            'strengths',
            'patternsToFix',
            'nextGoalPlan',
          ],
        },
      },
    });

    const parsed = parseAiJson<Partial<AnalyzeStudentProgressOutput>>(response.text);
    return {
      learningStatus: String(parsed.learningStatus || ''),
      overallAssessment: String(parsed.overallAssessment || ''),
      strengths: String(parsed.strengths || ''),
      patternsToFix: String(parsed.patternsToFix || ''),
      nextGoalPlan: String(parsed.nextGoalPlan || ''),
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

function normalizeAiReferenceItems(
  rawItems: unknown,
  fallbackTopic: string,
  idPrefix: string
): ReferenceQuestionItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.slice(0, 60).map((item, idx) => {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const rawType = String(raw.type || 'mcq');
    const type: ReferenceQuestionItem['type'] =
      rawType === 'true_false' ||
      rawType === 'short_answer' ||
      rawType === 'essay'
        ? rawType
        : 'mcq';
    const rawDiff = String(raw.difficulty || 'thong_hieu');
    const difficulty: ReferenceDifficulty =
      rawDiff === 'nhan_biet' || rawDiff === 'van_dung'
        ? rawDiff
        : 'thong_hieu';
    return {
      id: `${idPrefix}_${idx + 1}_${Date.now().toString(36)}`,
      type,
      topicTag: String(raw.topicTag || fallbackTopic || 'Chuyên đề chuẩn').slice(0, 120),
      difficulty,
      prompt: String(raw.prompt || '').slice(0, 2500),
      ...(type === 'mcq'
        ? {
            options:
              Array.isArray(raw.options) && raw.options.length >= 4
                ? raw.options.slice(0, 4).map((o) => String(o || '').slice(0, 600))
                : ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
            correctOption:
              typeof raw.correctOption === 'number'
                ? Math.min(Math.max(Math.round(raw.correctOption), 0), 3)
                : 0,
          }
        : {}),
      ...(type === 'true_false'
        ? {
            statements:
              Array.isArray(raw.statements) && raw.statements.length >= 4
                ? raw.statements.slice(0, 4).map((st: unknown, sIdx: number) => {
                    const sObj = (st && typeof st === 'object' ? st : {}) as {
                      text?: unknown;
                      isTrue?: unknown;
                    };
                    return {
                      text: String(sObj.text || `Mệnh đề ${'abcd'[sIdx]}`).slice(0, 600),
                      isTrue: Boolean(sObj.isTrue),
                    };
                  })
                : [
                    { text: 'Mệnh đề a', isTrue: true },
                    { text: 'Mệnh đề b', isTrue: false },
                    { text: 'Mệnh đề c', isTrue: true },
                    { text: 'Mệnh đề d', isTrue: false },
                  ],
          }
        : {}),
      ...(type === 'short_answer'
        ? { correctAnswer: String(raw.correctAnswer || '').slice(0, 40) }
        : {}),
      explanation: String(raw.explanation || '').slice(0, 2500),
    };
  });
}

// 10. Parse & normalize Word (.docx) reference material (question bank or topic handout)
export interface ParseReferenceWordInput {
  annotatedText: string;
  subjectHint?: string;
  titleHint?: string;
}

export interface ParseReferenceWordOutput {
  title: string;
  subject: string;
  topic: string;
  grade: string;
  knowledgeSummary: string;
  items: ReferenceQuestionItem[];
}

export async function parseReferenceWordWithAi(
  input: ParseReferenceWordInput
): Promise<ParseReferenceWordOutput> {
  if (!input.annotatedText?.trim()) {
    throw new Error('Thiếu nội dung văn bản từ file Word để chuẩn hoá.');
  }

  try {
    const ai = getGeminiClient();
    const prompt = `Bạn là chuyên gia biên tập ngân hàng câu hỏi & học liệu chuẩn GDPT 2018 cho môn "${input.subjectHint || 'Tổng hợp'}".
Giáo viên vừa tải lên tài liệu Word (có thể là ngân hàng câu hỏi có đáp án gạch chân [U]...[/U] / bảng đáp án, hoặc chuyên đề lý thuyết + công thức + ví dụ minh hoạ).

Nhiệm vụ của bạn:
1. Tóm tắt phần kiến thức cốt lõi, định luật, công thức quan trọng, lưu ý bẫy thường gặp từ tài liệu vào "knowledgeSummary" (ngắn gọn, rõ ràng, có thể dùng LaTeX $...$).
2. Trích xuất toàn bộ câu hỏi mẫu hoặc ví dụ bài tập trong tài liệu thành mảng "items" (tối đa 45 câu quan trọng nhất nếu file rất dài). Nếu tài liệu chủ yếu là lý thuyết mà ít câu hỏi, hãy tạo thêm 3-5 câu mẫu chuẩn bám sát chính lý thuyết/công thức trong tài liệu đó.
3. Mỗi phần tử trong "items":
   - "type": "mcq" | "true_false" | "short_answer" | "essay"
   - "topicTag": Tên chuyên đề/dạng bài ngắn gọn của câu đó (VD: "Định luật Boyle", "Cực trị hàm số")
   - "difficulty": "nhan_biet" | "thong_hieu" | "van_dung"
   - "prompt": Nội dung câu hỏi (bỏ ký hiệu [U], [/U], [IMG_...])
   - Với "mcq": "options" gồm đúng 4 chuỗi (không kèm A./B./C./D.), "correctOption" (0..3, ưu tiên đọc từ phần được đánh dấu [U]...[/U] hoặc bảng đáp án cuối bài).
   - Với "true_false": "statements" gồm 4 phần tử { text, isTrue }.
   - Với "short_answer": "correctAnswer" là đáp số ngắn gọn.
   - "explanation": Lời giải chuẩn từng bước (nếu file gốc chưa ghi thì tự giải chi tiết theo đáp án đúng).
4. Công thức Toán/Lí/Hoá PHẢI viết bằng LaTeX chuẩn đặt trong $...$ hoặc $$...$$ (escape \\ đúng chuẩn JSON).

Tiêu đề gợi ý: "${input.titleHint || ''}"
Nội dung trích xuất từ file Word:
${input.annotatedText.slice(0, 42000)}`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      timeoutMs: 28_000,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subject: { type: Type.STRING },
            topic: { type: Type.STRING },
            grade: { type: Type.STRING },
            knowledgeSummary: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  topicTag: { type: Type.STRING },
                  difficulty: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  correctOption: { type: Type.INTEGER },
                  statements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        isTrue: { type: Type.BOOLEAN },
                      },
                    },
                  },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: ['type', 'topicTag', 'difficulty', 'prompt', 'explanation'],
              },
            },
          },
          required: ['title', 'subject', 'topic', 'knowledgeSummary', 'items'],
        },
      },
    });

    const parsed = parseAiJson<{
      title?: string;
      subject?: string;
      topic?: string;
      grade?: string;
      knowledgeSummary?: string;
      items?: Array<Record<string, unknown>>;
    }>(response.text);

    const normalizedItems = normalizeAiReferenceItems(
      parsed.items,
      parsed.topic || 'Chuyên đề chuẩn',
      'ref_ai'
    );

    return {
      title: String(parsed.title || input.titleHint || 'Tài liệu chuẩn AI').slice(0, 200),
      subject: String(parsed.subject || input.subjectHint || 'Vật lí').slice(0, 80),
      topic: String(parsed.topic || '').slice(0, 160),
      grade: String(parsed.grade || 'THPT').slice(0, 40),
      knowledgeSummary: String(parsed.knowledgeSummary || '').slice(0, 8000),
      items: normalizedItems,
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}

// 11. Parse & extract structured curriculum knowledge + questions directly from a PDF book/chapter chunk
export interface ParseReferencePdfInput {
  pdfBase64: string;
  startPage: number;
  endPage: number;
  subjectHint?: string;
  titleHint?: string;
  generatePracticeIfTheoryOnly?: boolean;
}

export async function parseReferencePdfChunkWithAi(
  input: ParseReferencePdfInput
): Promise<ParseReferenceWordOutput> {
  if (!input.pdfBase64) {
    throw new Error('Thiếu dữ liệu PDF để trích xuất.');
  }

  try {
    const ai = getGeminiClient();
    const pageLabel =
      input.startPage === input.endPage
        ? `trang ${input.startPage}`
        : `từ trang ${input.startPage} đến trang ${input.endPage}`;

    const instruction = `Bạn là chuyên gia biên tập học liệu & ngân hàng câu hỏi chuẩn Chương trình GDPT 2018 cho môn "${input.subjectHint || 'Tổng hợp'}".
Đính kèm ở trên là trích đoạn sách giáo khoa / sách tham khảo / tài liệu PDF (${pageLabel}). Hãy đọc thật kỹ CẢ chữ in, bảng số liệu, hình vẽ minh hoạ, hộp công thức và các bài tập trong PDF (kể cả nếu PDF là bản scan).

Nhiệm vụ của bạn:
1. "title", "subject", "topic", "grade": Nhận diện tên chương/bài học chính trong đoạn PDF, môn học, chuyên đề và khối lớp (gợi ý tên tệp: "${input.titleHint || ''}").
2. "knowledgeSummary": Tóm tắt súc tích nhưng đầy đủ kiến thức cốt lõi, định nghĩa, định luật, công thức quan trọng (kèm đơn vị chuẩn và điều kiện áp dụng), lỗi sai thường gặp có trong đoạn sách này.
3. "items": Trích xuất TOÀN BỘ ví dụ mẫu, câu hỏi trắc nghiệm, Đúng/Sai, trả lời ngắn hoặc bài tập cuối bài xuất hiện trong đoạn PDF này (tối đa 35 câu mỗi lượt).
   ${
     input.generatePracticeIfTheoryOnly !== false
       ? '- Nếu đoạn PDF này chủ yếu là lý thuyết/bài học mà có ít câu hỏi bài tập, hãy tự biên soạn thêm 3-5 câu hỏi mẫu chuẩn (ưu tiên Trắc nghiệm / Đúng-Sai / Trả lời ngắn) bám sát chính xác công thức và ví dụ trong đoạn sách vừa đọc.'
       : ''
   }
   - Mỗi phần tử trong "items":
     * "type": "mcq" | "true_false" | "short_answer" | "essay"
     * "topicTag": Tên mục/dạng bài ngắn gọn (VD: "Định luật Charles", "Khảo sát hàm số")
     * "difficulty": "nhan_biet" | "thong_hieu" | "van_dung"
     * "prompt": Nội dung câu hỏi rõ ràng, đầy đủ dữ kiện (nếu đề trong sách có bảng số liệu ngắn thì chép đủ số liệu vào đề).
     * Với "mcq": "options" gồm đúng 4 phương án (không kèm A./B./C./D.), "correctOption" (0..3).
     * Với "true_false": "statements" gồm 4 mệnh đề { text, isTrue }.
     * Với "short_answer": "correctAnswer" là đáp số ngắn gọn (VD "2,5" hoặc "120").
     * "explanation": Lời giải chuẩn từng bước theo phương pháp của sách giáo khoa (tự giải chi tiết nếu sách chỉ ghi đáp án hoặc chưa ghi lời giải).
4. Mọi công thức Toán/Vật lí/Hoá học PHẢI viết bằng LaTeX chuẩn đặt trong $...$ hoặc $$...$$ (escape \\ đúng chuẩn JSON).`;

    const response = await generateContentWithRetry(ai, {
      timeoutMs: 42_000,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: input.pdfBase64,
            },
          },
          { text: instruction },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subject: { type: Type.STRING },
            topic: { type: Type.STRING },
            grade: { type: Type.STRING },
            knowledgeSummary: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  topicTag: { type: Type.STRING },
                  difficulty: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  correctOption: { type: Type.INTEGER },
                  statements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        isTrue: { type: Type.BOOLEAN },
                      },
                    },
                  },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: ['type', 'topicTag', 'difficulty', 'prompt', 'explanation'],
              },
            },
          },
          required: ['title', 'subject', 'topic', 'knowledgeSummary', 'items'],
        },
      },
    });

    const parsed = parseAiJson<{
      title?: string;
      subject?: string;
      topic?: string;
      grade?: string;
      knowledgeSummary?: string;
      items?: Array<Record<string, unknown>>;
    }>(response.text);

    const normalizedItems = normalizeAiReferenceItems(
      parsed.items,
      parsed.topic || input.titleHint || 'Sách PDF chuẩn',
      `ref_pdf_p${input.startPage}`
    );

    return {
      title: String(parsed.title || input.titleHint || 'Tài liệu PDF chuẩn').slice(0, 200),
      subject: String(parsed.subject || input.subjectHint || 'Vật lí').slice(0, 80),
      topic: String(parsed.topic || '').slice(0, 160),
      grade: String(parsed.grade || 'THPT').slice(0, 40),
      knowledgeSummary: String(parsed.knowledgeSummary || '').slice(0, 8000),
      items: normalizedItems,
    };
  } catch (error) {
    throw toFriendlyAiError(error);
  }
}
