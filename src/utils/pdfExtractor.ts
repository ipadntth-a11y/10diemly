import { PDFDocument } from 'pdf-lib';

export interface PdfInspectionResult {
  pageCount: number;
  fileSizeBytes: number;
  fileSizeMb: number;
}

export interface PdfPageChunk {
  startPage: number; // 1-indexed inclusive
  endPage: number; // 1-indexed inclusive
  base64: string;
  byteLength: number;
}

const MAX_CHUNK_RAW_BYTES = 8 * 1024 * 1024; // ~10.6 MB base64, safely below Gemini inlineData limits

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...sub));
  }
  return btoa(parts.join(''));
}

export async function inspectPdfFile(file: File): Promise<PdfInspectionResult> {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    throw new Error('Vui lòng chọn tệp đúng định dạng PDF (.pdf).');
  }
  const buffer = await file.arrayBuffer();
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch {
    throw new Error(
      'Không thể mở file PDF này (tệp có thể bị hỏng hoặc đặt mật khẩu bảo vệ).'
    );
  }

  const pageCount = pdfDoc.getPageCount();
  if (pageCount <= 0) {
    throw new Error('File PDF không có trang nào.');
  }

  return {
    pageCount,
    fileSizeBytes: file.size,
    fileSizeMb: Number((file.size / (1024 * 1024)).toFixed(2)),
  };
}

async function buildChunkPdfBytes(
  sourceDoc: PDFDocument,
  startPage1: number,
  endPage1: number
): Promise<Uint8Array> {
  const outDoc = await PDFDocument.create();
  const pageIndices: number[] = [];
  for (let p = startPage1 - 1; p <= endPage1 - 1; p++) {
    pageIndices.push(p);
  }
  const copiedPages = await outDoc.copyPages(sourceDoc, pageIndices);
  copiedPages.forEach((page) => outDoc.addPage(page));
  return outDoc.save();
}

export async function slicePdfPagesToBase64Chunks(
  file: File,
  startPage: number,
  endPage: number,
  pagesPerChunk = 8
): Promise<PdfPageChunk[]> {
  const buffer = await file.arrayBuffer();
  let sourceDoc: PDFDocument;
  try {
    sourceDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch {
    throw new Error(
      'Không thể giải mã các trang trong file PDF này (tệp có thể bị khoá sao chép/mật khẩu).'
    );
  }

  const totalPages = sourceDoc.getPageCount();
  const safeStart = Math.max(1, Math.min(Math.floor(startPage), totalPages));
  const safeEnd = Math.max(safeStart, Math.min(Math.floor(endPage), totalPages));
  const step = Math.max(1, Math.min(pagesPerChunk, 12));

  const chunks: PdfPageChunk[] = [];

  const queue: Array<{ s: number; e: number }> = [];
  for (let cur = safeStart; cur <= safeEnd; cur += step) {
    queue.push({ s: cur, e: Math.min(cur + step - 1, safeEnd) });
  }

  while (queue.length > 0) {
    const { s, e } = queue.shift()!;
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await buildChunkPdfBytes(sourceDoc, s, e);
    } catch {
      throw new Error(
        `Không thể tách trang ${s}–${e} từ file PDF (có thể sách PDF đã bị đặt khoá DRM).`
      );
    }

    if (pdfBytes.byteLength > MAX_CHUNK_RAW_BYTES && e > s) {
      const mid = Math.floor((s + e) / 2);
      queue.unshift({ s: mid + 1, e });
      queue.unshift({ s, e: mid });
      continue;
    }

    if (pdfBytes.byteLength > 13 * 1024 * 1024) {
      throw new Error(
        `Trang ${s} có dung lượng ảnh scan quá lớn (${(pdfBytes.byteLength / (1024 * 1024)).toFixed(1)} MB), vượt mức gửi AI trực tiếp.`
      );
    }

    chunks.push({
      startPage: s,
      endPage: e,
      base64: uint8ArrayToBase64(pdfBytes),
      byteLength: pdfBytes.byteLength,
    });
  }

  return chunks;
}
