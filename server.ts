import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '8mb' }));

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const BACKUP_MODEL = 'gemini-3.1-flash-lite';
const HYDROGEN_COOLDOWN_MS = 60_000;
let hydrogenCooldownUntil = 0;

function sleep(ms: number) {
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
    message.includes('abort') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('socket')
  );
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: {
    contents: unknown;
    config?: Record<string, unknown>;
    timeoutMs?: number;
  }
) {
  const baseTimeout = params.timeoutMs ?? 11_000;
  const now = Date.now();
  const preferBackupFirst = now < hydrogenCooldownUntil;

  // Avoid retrying an overloaded primary twice back-to-back before trying backup.
  const attempts: { model: string; delayMs: number; timeoutMs: number }[] = preferBackupFirst
    ? [
        { model: BACKUP_MODEL, delayMs: 0, timeoutMs: baseTimeout + 2000 },
        { model: BACKUP_MODEL, delayMs: 400, timeoutMs: baseTimeout + 3000 },
        { model: PRIMARY_MODEL, delayMs: 250, timeoutMs: baseTimeout },
      ]
    : [
        { model: PRIMARY_MODEL, delayMs: 0, timeoutMs: Math.min(baseTimeout, 10_000) },
        { model: BACKUP_MODEL, delayMs: 150, timeoutMs: baseTimeout + 2000 },
        { model: BACKUP_MODEL, delayMs: 500, timeoutMs: baseTimeout + 3000 },
      ];

  let lastError: unknown;
  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attempt.timeoutMs);
    try {
      const mergedConfig: Record<string, unknown> = {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        ...(params.config ?? {}),
        abortSignal: controller.signal,
      };
      return await ai.models.generateContent({
        model: attempt.model,
        contents: params.contents as never,
        config: mergedConfig as never,
      });
    } catch (err) {
      lastError = err;
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
      clearTimeout(timer);
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

function handleAiError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  console.error('Gemini API Error:', message);
  if (message.includes('GEMINI_API_KEY')) {
    return res.status(503).json({
      error: 'Chưa cấu hình GEMINI_API_KEY trong phần Settings > Secrets.',
    });
  }
  if (message.includes('PERMISSION_DENIED') || message.includes('API_KEY_INVALID')) {
    return res.status(403).json({
      error: 'API key không hợp lệ hoặc thiếu quyền truy cập. Vui lòng kiểm tra Settings > Secrets.',
    });
  }
  if (
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('deadline_exceeded')
  ) {
    return res.status(504).json({
      error: 'Máy chủ AI phản hồi quá lâu do quá tải tạm thời. Vui lòng bấm tải lại sau vài giây.',
    });
  }
  if (message.includes('503') || message.includes('UNAVAILABLE') || message.includes('high demand')) {
    return res.status(503).json({
      error: 'Hệ thống AI đang quá tải tạm thời. Vui lòng bấm Thử lại sau vài giây.',
    });
  }
  if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
    return res.status(429).json({
      error: 'Đã vượt quá hạn mức gọi Gemini API. Vui lòng thử lại sau ít phút.',
    });
  }
  return res.status(500).json({
    error: `Không thể xử lý yêu cầu AI: ${message}`,
  });
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
app.post('/api/ai/analyze-student', async (req: Request, res: Response) => {
  try {
    const {
      studentName,
      examTitle,
      totalScore,
      maxScore,
      durationSeconds,
      violationCount,
      questionSummaries,
    } = req.body ?? {};

    if (!studentName || !examTitle || !Array.isArray(questionSummaries)) {
      return res.status(400).json({ error: 'Thiếu dữ liệu bài làm để phân tích.' });
    }

    const ai = getGeminiClient();
    const prompt = `Bạn là giáo viên THPT giàu kinh nghiệm đang phân tích sâu dữ liệu bài làm của học sinh "${studentName}" ở đề "${examTitle}".

Tổng quan:
- Điểm hiện tại: ${totalScore}/${maxScore}
- Tổng thời gian làm bài: ${Math.floor(Number(durationSeconds || 0) / 60)} phút ${Number(durationSeconds || 0) % 60} giây
- Số lần vi phạm chuyển tab: ${violationCount || 0}

Dữ liệu chi tiết TỪNG CÂU HỎI và THỜI GIAN TRẢ LỜI (so với trung bình cả lớp):
${JSON.stringify(questionSummaries, null, 2)}

Hãy phân tích sâu bằng tiếng Việt chuẩn sư phạm và trả về JSON gồm:
1. "analysis": Báo cáo chi tiết theo 4 ý rõ ràng (dùng gạch đầu dòng ngắn gọn):
   - Nhịp độ & hành vi làm bài theo thời gian (so sánh thời gian làm mỗi câu với TB lớp, chỉ rõ các câu trả lời quá nhanh <5s nghi chọn đại và các câu sa lầy mất nhiều thời gian nhưng vẫn sai).
   - Năng lực theo từng dạng câu (Trắc nghiệm, Đúng/Sai, Trả lời ngắn/Tự luận).
   - Các câu/mạch kiến thức học sinh đang hổng (nêu cụ thể số câu).
   - Lộ trình ôn tập 2 bước tiếp theo cho học sinh này.
2. "suggestedComment": Lời phê ngắn gọn 1-2 câu (tối đa 220 ký tự) để giáo viên điền vào ô Lời phê.`;

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

    const parsed = parseAiJson<{ analysis?: string; suggestedComment?: string }>(response.text);
    return res.json({
      analysis: parsed.analysis || '',
      suggestedComment: parsed.suggestedComment || '',
    });
  } catch (error) {
    return handleAiError(res, error);
  }
});

// 2. Grade short-answer / essay responses by structured Barem (supports both typed text AND handwritten photo images!)
app.post('/api/ai/grade-essay', async (req: Request, res: Response) => {
  try {
    const { studentName, examTitle, customBarem, items } = req.body ?? {};
    if (!studentName || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Không có câu tự luận / ảnh bài làm để chấm.' });
    }

    const ai = getGeminiClient();

    const results: {
      questionId: string;
      proposedScore: number;
      recognizedText: string;
      feedback: string;
      breakdown: { criterion: string; score: number; maxScore: number; met: boolean }[];
    }[] = [];

    for (const item of items) {
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
        results.push({
          questionId: String(item.questionId),
          proposedScore: 0,
          recognizedText: '(Học sinh bỏ trống bài làm)',
          feedback: 'Học sinh chưa viết bài làm hoặc chưa đính kèm ảnh chụp bài giải.',
          breakdown: [
            { criterion: 'Công thức áp dụng / Phương pháp giải', score: 0, maxScore: q1, met: false },
            { criterion: 'Thay số & Đổi đơn vị chuẩn', score: 0, maxScore: q2, met: false },
            { criterion: 'Đáp số chính xác', score: 0, maxScore: q3, met: false },
            { criterion: 'Đơn vị đầy đủ & Kết luận', score: 0, maxScore: q4, met: false },
          ],
        });
        continue;
      }

      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [];

      if (imgInfo && imgInfo.data) {
        parts.push({
          inlineData: {
            mimeType: imgInfo.mimeType,
            data: imgInfo.data,
          },
        });
      }

      const baremText = [item.barem, customBarem, item.correctAnswer, item.explanation]
        .filter((v) => typeof v === 'string' && v.trim().length > 0)
        .join('\n');

      const instruction = `Bạn là giáo viên THPT giàu kinh nghiệm chấm thi tự luận tại Việt Nam. Hãy chấm bài cho học sinh "${studentName}" trong đề "${examTitle || ''}" theo ĐÚNG BAREM CHI TIẾT.
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
5. "feedback": Nhận xét rõ từng mục: công thức đã đúng chưa, thay số/đổi đơn vị ra sao, đáp số thế nào, có thiếu/sai đơn vị không, và hướng dẫn cách sửa ngắn gọn (dùng $...$ cho công thức).`;

      parts.push({ text: instruction });

      const response = await generateContentWithRetry(ai, {
        contents: { parts },
        timeoutMs: 22_000,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              recognizedText: { type: Type.STRING },
              proposedScore: { type: Type.NUMBER },
              feedback: { type: Type.STRING },
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
            required: ['recognizedText', 'proposedScore', 'feedback', 'breakdown'],
          },
        },
      });

      const parsed = parseAiJson<{
        recognizedText?: string;
        proposedScore?: number;
        feedback?: string;
        breakdown?: { criterion: string; score: number; maxScore: number; met: boolean }[];
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

      results.push({
        questionId: String(item.questionId),
        proposedScore: Number(clampedScore.toFixed(2)),
        recognizedText: parsed.recognizedText || '',
        feedback: parsed.feedback || '',
        breakdown: rawBreakdown,
      });
    }

    const overallNote =
      results.length === 1
        ? results[0].feedback
        : `Đã chấm xong ${results.length} câu tự luận theo barem. ${results
            .map((r) => `${r.questionId.toUpperCase()}: ${r.proposedScore}đ`)
            .join(', ')}.`;

    return res.json({ results, overallNote });
  } catch (error) {
    return handleAiError(res, error);
  }
});

// 3. Standalone Photo Essay Grader (teacher uploads a photo of any handwritten paper + prompt/rubric)
app.post('/api/ai/grade-photo', async (req: Request, res: Response) => {
  try {
    const { imageBase64, imageMimeType, promptText, rubricText, maxScore } = req.body ?? {};
    if (!imageBase64) {
      return res.status(400).json({ error: 'Vui lòng chọn ảnh chụp bài làm để AI chấm.' });
    }

    const ai = getGeminiClient();
    const maxS = Math.min(Math.max(Number(maxScore || 10), 0.25), 100);

    const response = await generateContentWithRetry(ai, {
      timeoutMs: 22_000,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: imageMimeType || 'image/jpeg',
              data: imageBase64,
            },
          },
          {
            text: `Bạn là giáo viên THPT giàu kinh nghiệm tại Việt Nam. Hãy đọc ảnh chụp bài làm tự luận viết tay ở trên và chấm điểm theo ĐÚNG BAREM trên thang điểm ${maxS}.

Đề bài / Yêu cầu (nếu giáo viên có cung cấp): ${promptText || '(Tự nhận diện đề bài hoặc nội dung bài giải trong ảnh)'}
Đáp án / Barem điểm của giáo viên (nếu có): ${rubricText || '(Chấm theo barem chuẩn 4 bước: Công thức áp dụng, Thay số & Đổi đơn vị, Đáp số chính xác, Đơn vị đầy đủ & Kết luận)'}

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

    const parsed = parseAiJson<{
      recognizedText?: string;
      score?: number;
      breakdown?: { criterion: string; score: number; maxScore: number; met: boolean }[];
      strengths?: string;
      mistakes?: string;
      teacherComment?: string;
    }>(response.text);
    const rawBreakdown = Array.isArray(parsed.breakdown) ? parsed.breakdown : [];
    const sumBreakdown = rawBreakdown.reduce(
      (s: number, b: { score?: number }) => s + Number(b?.score || 0),
      0
    );
    const effectiveScore =
      rawBreakdown.length > 0 && sumBreakdown >= 0
        ? sumBreakdown
        : Number(parsed.score || 0);
    return res.json({
      ...parsed,
      breakdown: rawBreakdown,
      score: Number(Math.min(Math.max(effectiveScore, 0), maxS).toFixed(2)),
    });
  } catch (error) {
    return handleAiError(res, error);
  }
});

// 4. Generate exam questions from topic/sample text
app.post('/api/ai/generate-exam', async (req: Request, res: Response) => {
  try {
    const { subject, topic, mcqCount, tfCount, shortCount, essayCount } = req.body ?? {};
    if (!subject || !topic) {
      return res.status(400).json({ error: 'Vui lòng nhập môn học và chủ đề đề thi.' });
    }

    const totalMcq = Math.min(Math.max(Number(mcqCount ?? 4), 1), 12);
    const totalTf = Math.min(Math.max(Number(tfCount ?? 1), 0), 4);
    const totalShort = Math.min(Math.max(Number(shortCount ?? 1), 0), 4);
    const totalEssay = Math.min(Math.max(Number(essayCount ?? 1), 0), 4);

    const ai = getGeminiClient();
    const prompt = `Bạn là chuyên gia ra đề kiểm tra theo Chương trình GDPT 2018 của Việt Nam.
Hãy soạn bộ câu hỏi môn "${subject}" về chủ đề: "${topic}".
Số lượng yêu cầu:
- ${totalMcq} câu Trắc nghiệm 4 lựa chọn (type: "mcq", maxScore: 0.25, có 4 options A/B/C/D, correctOption là chỉ số 0..3).
- ${totalTf} câu Đúng/Sai gồm 4 ý nhỏ a, b, c, d (type: "true_false", maxScore: 1.0, có statements gồm 4 phần tử text + isTrue).
- ${totalShort} câu Trả lời ngắn điền số tối đa 4 ký tự (type: "short_answer", maxScore: 0.5, có correctAnswer là giá trị số ngắn gọn tối đa 4 ký tự như "2,5" hoặc "668" hoặc "-12").
- ${totalEssay} câu Tự luận (type: "essay", maxScore: 1.0, có trường explanation là Hướng dẫn giải từng bước rõ ràng, chi tiết).
Mỗi câu PHẢI có trường "explanation" (Hướng dẫn giải ngắn gọn, chính xác, dễ hiểu).
Quy tắc công thức Toán/Vật lí/Hoá học: Tất cả biểu thức, phân số, căn thức, luỹ thừa, tích phân, vectơ, hệ phương trình PHẢI viết bằng LaTeX đặt trong $...$ (inline) hoặc $$...$$ (display) và escape dấu backslash đúng chuẩn JSON (\\frac, \\sqrt, \\int, \\overrightarrow...).`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      timeoutMs: 22_000,
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

    const parsed = parseAiJson(response.text);
    return res.json(parsed);
  } catch (error) {
    return handleAiError(res, error);
  }
});

// 5. AI-assisted Word (.docx) exam parser preserving [U]...[/U] underlines and [IMG_i] image tags
app.post('/api/ai/parse-word-exam', async (req: Request, res: Response) => {
  try {
    const { annotatedText } = req.body ?? {};
    if (!annotatedText || typeof annotatedText !== 'string') {
      return res.status(400).json({ error: 'Thiếu nội dung trích xuất từ file Word.' });
    }

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
${annotatedText.slice(0, 45000)}`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      timeoutMs: 24_000,
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

    const parsed = parseAiJson(response.text);
    return res.json(parsed);
  } catch (error) {
    return handleAiError(res, error);
  }
});

// 6. Auto-generate step-by-step explanations strictly anchored to known answer keys
app.post('/api/ai/generate-explanations', async (req: Request, res: Response) => {
  try {
    const { subject, title, questions, overwriteAll } = req.body ?? {};
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Không có câu hỏi nào để tạo lời giải.' });
    }

    const targets = questions.filter(
      (q: { explanation?: string }) =>
        overwriteAll || !String(q.explanation || '').trim()
    );

    if (targets.length === 0) {
      return res.json({ explanations: [] });
    }

    const ai = getGeminiClient();
    const collected: { id: string; explanation: string }[] = [];
    const BATCH_SIZE = 15;

    for (let start = 0; start < targets.length; start += BATCH_SIZE) {
      const batch = targets.slice(start, start + BATCH_SIZE).map((q: {
        id: string;
        index: number;
        type: string;
        prompt: string;
        options?: string[];
        correctOption?: number;
        statements?: { text: string; isTrue: boolean }[];
        correctAnswer?: string;
      }) => {
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

      const prompt = `Bạn là giáo viên THPT giàu kinh nghiệm môn "${subject || 'Tổng hợp'}" (đề "${title || 'Đề kiểm tra'}").
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
        timeoutMs: 22_000,
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

    return res.json({ explanations: collected });
  } catch (error) {
    return handleAiError(res, error);
  }
});

// 7. Generate targeted remedial practice questions for a student based on their wrong answers
app.post('/api/ai/generate-remedial-practice', async (req: Request, res: Response) => {
  try {
    const { subject, examTitle, wrongQuestions } = req.body ?? {};
    if (!Array.isArray(wrongQuestions) || wrongQuestions.length === 0) {
      return res.status(400).json({ error: 'Không có câu sai để tạo bài ôn tập.' });
    }

    const ai = getGeminiClient();
    const cappedWrong = wrongQuestions.slice(0, 6);
    const targetCount = Math.min(Math.max(cappedWrong.length, 3), 6);

    const prompt = `Bạn là gia sư AI tâm huyết hỗ trợ học sinh THPT ôn tập ngay sau khi vừa làm xong bài kiểm tra "${examTitle || ''}" (môn "${subject || 'Tổng hợp'}").
Dưới đây là các câu mà học sinh vừa LÀM SAI (kèm lựa chọn sai của học sinh và đáp án đúng):
${JSON.stringify(cappedWrong, null, 2)}

Hãy phân tích lỗ hổng kiến thức gây ra các câu sai trên và soạn bộ ${targetCount} câu hỏi ÔN TẬP TƯƠNG TỰ MỚI (thay số liệu / bối cảnh / cách hỏi tương đương để học sinh luyện lại đúng dạng kiến thức vừa hổng, KHÔNG chép nguyên văn câu cũ).

Quy tắc:
1. Gắn mỗi câu luyện tập với số thứ tự câu gốc bị sai ("sourceQuestionIndex") và tên kỹ năng/kiến thức cần củng cố ("focusTopic").
2. Dùng các dạng tự chấm được ngay để học sinh làm bài trực tiếp:
   - "mcq": 4 phương án A/B/C/D ("options" gồm đúng 4 chuỗi KHÔNG cần tiền tố A./B./C./D., "correctOption" từ 0..3).
   - "true_false": 4 mệnh đề a, b, c, d ("statements" gồm 4 phần tử { text, isTrue }).
   - "short_answer": điền số ngắn gọn tối đa 4 ký tự vào "correctAnswer" (ví dụ "2,5" hoặc "120" hoặc "-4").
   Ưu tiên phân bổ theo đúng dạng của câu học sinh làm sai (nếu câu sai là tự luận thì tạo câu trắc nghiệm hoặc trả lời ngắn kiểm tra lại từng bước kiến thức cốt lõi của câu đó).
3. Mỗi câu BẮT BUỘC có "explanation" hướng dẫn giải chi tiết từng bước.
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
                required: ['sourceQuestionIndex', 'focusTopic', 'type', 'prompt', 'explanation'],
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
    const normalized = Array.isArray(parsed.practiceQuestions)
      ? parsed.practiceQuestions.map((q: Record<string, unknown>, idx: number) => {
          const rawType = String(q.type || 'mcq');
          const type =
            rawType === 'true_false' || rawType === 'short_answer' ? rawType : 'mcq';
          return {
            id: `prac_${idx + 1}_${Date.now().toString(36)}`,
            index: idx + 1,
            sourceQuestionIndex: Number(q.sourceQuestionIndex || cappedWrong[0]?.index || 1),
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
                      ? q.statements.slice(0, 4).map((st: { text?: string; isTrue?: boolean }) => ({
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

    return res.json({
      focusSummary: String(
        parsed.focusSummary || 'Bộ câu hỏi được cá nhân hoá theo những câu bạn vừa làm sai.'
      ),
      practiceQuestions: normalized,
    });
  } catch (error) {
    return handleAiError(res, error);
  }
});

// 8. Student post-exam personal analysis & pedagogical feedback
app.post('/api/ai/student-review', async (req: Request, res: Response) => {
  try {
    const {
      studentName,
      subject,
      examTitle,
      totalScore,
      maxScore,
      durationSeconds,
      questionResults,
    } = req.body ?? {};

    if (!examTitle || !Array.isArray(questionResults)) {
      return res.status(400).json({ error: 'Thiếu dữ liệu bài làm để nhận xét.' });
    }

    const ai = getGeminiClient();
    const compactResults = questionResults.slice(0, 50);

    const prompt = `Bạn là thầy/cô giáo THPT tận tâm đang viết NHẬN XÉT & PHÂN TÍCH BÀI LÀM trực tiếp gửi cho học sinh "${studentName || 'em'}" ngay sau khi em vừa nộp bài "${examTitle}" (môn "${subject || 'Tổng hợp'}").

Kết quả tổng quan:
- Điểm đạt được: ${totalScore}/${maxScore}
- Tổng thời gian làm: ${Math.floor(Number(durationSeconds || 0) / 60)} phút ${Number(durationSeconds || 0) % 60} giây

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
          required: ['overallComment', 'strengths', 'weaknesses', 'pacingNote', 'studyPlan'],
        },
      },
    });

    const parsed = parseAiJson<{
      overallComment?: string;
      strengths?: string;
      weaknesses?: string;
      pacingNote?: string;
      studyPlan?: string;
    }>(response.text);

    return res.json({
      overallComment: String(parsed.overallComment || ''),
      strengths: String(parsed.strengths || ''),
      weaknesses: String(parsed.weaknesses || ''),
      pacingNote: String(parsed.pacingNote || ''),
      studyPlan: String(parsed.studyPlan || ''),
    });
  } catch (error) {
    return handleAiError(res, error);
  }
});

// Ensure /api/* routes always return JSON even on 404 or body-parser/express errors
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Không tìm thấy API endpoint yêu cầu.' });
});

app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof (err as { status?: number })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
  const message =
    status === 413
      ? 'Dữ liệu gửi lên vượt quá giới hạn 8MB. Vui lòng giảm kích thước ảnh hoặc tệp.'
      : err instanceof Error
        ? err.message
        : 'Lỗi máy chủ khi xử lý yêu cầu API.';
  res.status(status).json({ error: message });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
