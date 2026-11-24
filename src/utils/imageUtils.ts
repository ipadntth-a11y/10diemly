export interface CompressedExamImage {
  aiBase64: string;
  aiMimeType: string;
  storageDataUrl: string;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Tệp ảnh không hợp lệ.'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không thể xử lý dữ liệu ảnh.'));
    img.src = dataUrl;
  });
}

function renderResizedJpeg(
  img: HTMLImageElement,
  maxDimension: number,
  quality: number
): string {
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Downscales an existing image data URL so its base64 length fits within `maxChars`
 * (used when a student attaches multiple essay photos so total Firestore doc stays safely < 1 MiB).
 */
export async function recompressDataUrlToBudget(
  dataUrl: string,
  maxChars: number
): Promise<string> {
  if (!dataUrl || dataUrl.length <= maxChars) return dataUrl;
  try {
    const img = await loadImageFromDataUrl(dataUrl);
    const steps: [number, number][] = [
      [640, 0.56],
      [520, 0.48],
      [420, 0.42],
      [340, 0.38],
      [260, 0.34],
    ];
    let candidate = dataUrl;
    for (const [dim, q] of steps) {
      candidate = renderResizedJpeg(img, dim, q);
      if (candidate.length <= maxChars) return candidate;
    }
    return candidate;
  } catch {
    return dataUrl;
  }
}

export async function compressExamPhoto(file: File): Promise<CompressedExamImage> {
  const img = await loadImageElement(file);
  // Crisp high-res JPEG for Gemini Vision OCR + formula/unit reading
  const aiDataUrl = renderResizedJpeg(img, 1400, 0.85);
  const aiBase64 = aiDataUrl.split(',')[1] || '';

  // Compact JPEG thumbnail for Firestore storage (~55-90KB)
  let storageDataUrl = renderResizedJpeg(img, 760, 0.66);
  if (storageDataUrl.length > 105000) {
    storageDataUrl = renderResizedJpeg(img, 620, 0.55);
  }
  if (storageDataUrl.length > 105000) {
    storageDataUrl = renderResizedJpeg(img, 500, 0.46);
  }

  return {
    aiBase64,
    aiMimeType: 'image/jpeg',
    storageDataUrl,
  };
}
