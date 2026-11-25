import JSZip from 'jszip';
import type { ExamQuestion, QuestionType, TrueFalseStatement } from '../types';

export interface ParsedDocxQuestion extends ExamQuestion {
  answerSource?: 'underline' | 'explicit' | 'table' | 'missing';
  needsReview?: boolean;
}

export interface DocxParseResult {
  title: string;
  subject: string;
  durationMinutes: number;
  questions: ParsedDocxQuestion[];
  imageCount: number;
  bottomAnswerCount: number;
  underlineAnswerCount: number;
  annotatedTextForAi: string;
  imagePool: string[];
  warnings: string[];
}

interface TextSegment {
  text: string;
  underlined: boolean;
}

interface LogicalLine {
  text: string;
  segments: TextSegment[];
  images: string[];
}

interface ParsedTableCell {
  text: string;
  lines: LogicalLine[];
  images: string[];
}

interface ParsedTableInfo {
  startLineIdx: number;
  endLineIdx: number;
  rows: ParsedTableCell[][];
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V_NS = 'urn:schemas-microsoft-com:vml';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function getAttr(el: Element, localName: string, ns?: string): string | null {
  if (ns) {
    const byNs = el.getAttributeNS(ns, localName);
    if (byNs !== null) return byNs;
  }
  return (
    el.getAttribute(`w:${localName}`) ??
    el.getAttribute(`r:${localName}`) ??
    el.getAttribute(localName)
  );
}

function getElementsByLocalName(root: Document | Element, localName: string): Element[] {
  const result: Element[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 1) {
      const el = node as Element;
      if (el.localName === localName) {
        result.push(el);
      }
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i]);
    }
  };
  walk(root);
  return result;
}

function isRunUnderlined(rPr: Element | null): boolean {
  if (!rPr) return false;
  for (let i = 0; i < rPr.childNodes.length; i++) {
    const child = rPr.childNodes[i];
    if (child.nodeType === 1 && (child as Element).localName === 'u') {
      const val = getAttr(child as Element, 'val', W_NS);
      return val !== 'none';
    }
  }
  return false;
}

const OMML_CHAR_TO_LATEX: Record<string, string> = {
  '×': '\\times ',
  '⋅': '\\cdot ',
  '·': '\\cdot ',
  '÷': '\\div ',
  '±': '\\pm ',
  '∓': '\\mp ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '≠': '\\ne ',
  '≈': '\\approx ',
  '≡': '\\equiv ',
  '∝': '\\propto ',
  '∞': '\\infty ',
  '→': '\\to ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '←': '\\leftarrow ',
  '↔': '\\leftrightarrow ',
  '∈': '\\in ',
  '∉': '\\notin ',
  '⊂': '\\subset ',
  '⊆': '\\subseteq ',
  '⊃': '\\supset ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '∅': '\\emptyset ',
  '∀': '\\forall ',
  '∃': '\\exists ',
  '∂': '\\partial ',
  '∇': '\\nabla ',
  '⊥': '\\perp ',
  '∥': '\\parallel ',
  '∠': '\\angle ',
  '△': '\\triangle ',
  '°': '^\\circ ',
  'α': '\\alpha ',
  'β': '\\beta ',
  'γ': '\\gamma ',
  'δ': '\\delta ',
  'ε': '\\epsilon ',
  'ɛ': '\\varepsilon ',
  'ζ': '\\zeta ',
  'η': '\\eta ',
  'θ': '\\theta ',
  'ϑ': '\\vartheta ',
  'ι': '\\iota ',
  'κ': '\\kappa ',
  'λ': '\\lambda ',
  'μ': '\\mu ',
  'µ': '\\mu ',
  'ν': '\\nu ',
  'ξ': '\\xi ',
  'π': '\\pi ',
  'ρ': '\\rho ',
  'σ': '\\sigma ',
  'τ': '\\tau ',
  'υ': '\\upsilon ',
  'φ': '\\varphi ',
  'ϕ': '\\phi ',
  'χ': '\\chi ',
  'ψ': '\\psi ',
  'ω': '\\omega ',
  'Γ': '\\Gamma ',
  'Δ': '\\Delta ',
  'Θ': '\\Theta ',
  'Λ': '\\Lambda ',
  'Ξ': '\\Xi ',
  'Π': '\\Pi ',
  'Σ': '\\Sigma ',
  'Υ': '\\Upsilon ',
  'Φ': '\\Phi ',
  'Ψ': '\\Psi ',
  'Ω': '\\Omega ',
  '′': "'",
  '−': '-',
  '–': '-',
};

function mapOmmlCharsToLatex(raw: string): string {
  let out = '';
  for (const ch of raw) {
    out += OMML_CHAR_TO_LATEX[ch] ?? ch;
  }
  return out;
}

function getDirectChildByLocalName(el: Element, localName: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 1 && (c as Element).localName === localName) {
      return c as Element;
    }
  }
  return null;
}

function getDirectChildrenByLocalName(el: Element, localName: string): Element[] {
  const res: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 1 && (c as Element).localName === localName) {
      res.push(c as Element);
    }
  }
  return res;
}

function getOmmlPrVal(prEl: Element | null, childTag: string): string | null {
  if (!prEl) return null;
  const child = getDirectChildByLocalName(prEl, childTag);
  if (!child) return null;
  return (
    child.getAttributeNS(M_NS, 'val') ??
    child.getAttribute('m:val') ??
    child.getAttribute('val')
  );
}

function wrapMathBase(tex: string): string {
  const trimmed = tex.trim();
  if (!trimmed) return '{}';
  if (/^[A-Za-z0-9]$/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  return `{${trimmed}}`;
}

function isOmmlUnderlined(el: Element): boolean {
  const uEls = getElementsByLocalName(el, 'u');
  if (uEls.length === 0) return false;
  return uEls.some((u) => getAttr(u, 'val', W_NS) !== 'none');
}

function getRunVertAlign(rPr: Element | null): 'superscript' | 'subscript' | null {
  if (!rPr) return null;
  const va = getDirectChildByLocalName(rPr, 'vertAlign');
  if (!va) return null;
  const val = getAttr(va, 'val', W_NS);
  if (val === 'superscript' || val === 'subscript') return val;
  return null;
}

function extractMathLatex(node: Node, insideCases = false): string {
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.localName;

  if (tag === 't' && (el.namespaceURI === M_NS || el.prefix === 'm')) {
    return mapOmmlCharsToLatex(el.textContent || '');
  }

  // Skip property nodes directly
  if (tag.endsWith('Pr')) return '';

  if (tag === 'f') {
    const fPr = getDirectChildByLocalName(el, 'fPr');
    const fType = getOmmlPrVal(fPr, 'type');
    const numEl = getDirectChildByLocalName(el, 'num');
    const denEl = getDirectChildByLocalName(el, 'den');
    const num = numEl ? extractMathLatex(numEl).trim() : '';
    const den = denEl ? extractMathLatex(denEl).trim() : '';
    if (fType === 'noBar') {
      return `\\binom{${num}}{${den}}`;
    }
    return `\\frac{${num}}{${den}}`;
  }

  if (tag === 'sSup') {
    const base = extractMathLatex(getDirectChildByLocalName(el, 'e') || el.ownerDocument.createElement('x'));
    const supEl = getDirectChildByLocalName(el, 'sup');
    const sup = supEl ? extractMathLatex(supEl).trim() : '';
    return `${wrapMathBase(base)}^{${sup}}`;
  }

  if (tag === 'sSub') {
    const baseEl = getDirectChildByLocalName(el, 'e');
    const subEl = getDirectChildByLocalName(el, 'sub');
    const base = baseEl ? extractMathLatex(baseEl) : '';
    const sub = subEl ? extractMathLatex(subEl).trim() : '';
    return `${wrapMathBase(base)}_{${sub}}`;
  }

  if (tag === 'sSubSup') {
    const baseEl = getDirectChildByLocalName(el, 'e');
    const subEl = getDirectChildByLocalName(el, 'sub');
    const supEl = getDirectChildByLocalName(el, 'sup');
    const base = baseEl ? extractMathLatex(baseEl) : '';
    const sub = subEl ? extractMathLatex(subEl).trim() : '';
    const sup = supEl ? extractMathLatex(supEl).trim() : '';
    return `${wrapMathBase(base)}_{${sub}}^{${sup}}`;
  }

  if (tag === 'sPre') {
    const baseEl = getDirectChildByLocalName(el, 'e');
    const subEl = getDirectChildByLocalName(el, 'sub');
    const supEl = getDirectChildByLocalName(el, 'sup');
    const base = baseEl ? extractMathLatex(baseEl) : '';
    const sub = subEl ? extractMathLatex(subEl).trim() : '';
    const sup = supEl ? extractMathLatex(supEl).trim() : '';
    return `{}_{${sub}}^{${sup}}${wrapMathBase(base)}`;
  }

  if (tag === 'rad') {
    const degEl = getDirectChildByLocalName(el, 'deg');
    const baseEl = getDirectChildByLocalName(el, 'e');
    const deg = degEl ? extractMathLatex(degEl).trim() : '';
    const base = baseEl ? extractMathLatex(baseEl).trim() : '';
    return deg ? `\\sqrt[${deg}]{${base}}` : `\\sqrt{${base}}`;
  }

  if (tag === 'nary') {
    const naryPr = getDirectChildByLocalName(el, 'naryPr');
    const chr = getOmmlPrVal(naryPr, 'chr') || '∫';
    const opMap: Record<string, string> = {
      '∫': '\\int',
      '∬': '\\iint',
      '∭': '\\iiint',
      '∮': '\\oint',
      '∑': '\\sum',
      '∏': '\\prod',
      '⋃': '\\bigcup',
      '⋂': '\\bigcap',
    };
    const op = opMap[chr] || '\\int';
    const subEl = getDirectChildByLocalName(el, 'sub');
    const supEl = getDirectChildByLocalName(el, 'sup');
    const eEl = getDirectChildByLocalName(el, 'e');
    const sub = subEl ? extractMathLatex(subEl).trim() : '';
    const sup = supEl ? extractMathLatex(supEl).trim() : '';
    const body = eEl ? extractMathLatex(eEl).trim() : '';
    return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${body}`.trim();
  }

  if (tag === 'func') {
    const fNameEl = getDirectChildByLocalName(el, 'fName');
    const eEl = getDirectChildByLocalName(el, 'e');
    const rawName = (fNameEl ? extractMathLatex(fNameEl) : '').trim();
    const stdFuncs = new Set([
      'sin',
      'cos',
      'tan',
      'cot',
      'sec',
      'csc',
      'arcsin',
      'arccos',
      'arctan',
      'sinh',
      'cosh',
      'tanh',
      'log',
      'ln',
      'lg',
      'lim',
      'max',
      'min',
      'sup',
      'inf',
      'exp',
      'det',
      'gcd',
    ]);
    let funcTex = rawName;
    if (stdFuncs.has(rawName)) {
      funcTex = `\\${rawName}`;
    } else if (/^[a-zA-Z]+$/.test(rawName)) {
      funcTex = `\\operatorname{${rawName}}`;
    }
    const arg = eEl ? extractMathLatex(eEl).trim() : '';
    return `${funcTex} ${arg}`.trim();
  }

  if (tag === 'limLow' || tag === 'limUpp') {
    const eEl = getDirectChildByLocalName(el, 'e');
    const limEl = getDirectChildByLocalName(el, 'lim');
    const base = eEl ? extractMathLatex(eEl).trim() : '';
    const lim = limEl ? extractMathLatex(limEl).trim() : '';
    if (tag === 'limLow') {
      if (base === 'lim' || base === '\\lim') {
        return `\\lim_{${lim}}`;
      }
      return `\\underset{${lim}}{${base}}`;
    }
    return `\\overset{${lim}}{${base}}`;
  }

  if (tag === 'acc') {
    const accPr = getDirectChildByLocalName(el, 'accPr');
    const chr = getOmmlPrVal(accPr, 'chr') || '';
    const eEl = getDirectChildByLocalName(el, 'e');
    const base = eEl ? extractMathLatex(eEl).trim() : '';
    if (chr === '\u20d7' || chr === '→' || chr === '⃗') {
      return base.length <= 1 ? `\\vec{${base}}` : `\\overrightarrow{${base}}`;
    }
    if (chr === '\u0304' || chr === '¯' || chr === '-') {
      return `\\overline{${base}}`;
    }
    if (chr === '^' || chr === '\u0302' || chr === 'ˆ') {
      return `\\widehat{${base}}`;
    }
    if (chr === '\u0307' || chr === '˙') {
      return `\\dot{${base}}`;
    }
    return `\\overrightarrow{${base}}`;
  }

  if (tag === 'bar') {
    const barPr = getDirectChildByLocalName(el, 'barPr');
    const pos = getOmmlPrVal(barPr, 'pos');
    const eEl = getDirectChildByLocalName(el, 'e');
    const base = eEl ? extractMathLatex(eEl).trim() : '';
    return pos === 'bot' ? `\\underline{${base}}` : `\\overline{${base}}`;
  }

  if (tag === 'groupChr') {
    const groupPr = getDirectChildByLocalName(el, 'groupChrPr');
    const pos = getOmmlPrVal(groupPr, 'pos');
    const eEl = getDirectChildByLocalName(el, 'e');
    const base = eEl ? extractMathLatex(eEl).trim() : '';
    return pos === 'top' ? `\\overbrace{${base}}` : `\\underbrace{${base}}`;
  }

  if (tag === 'm') {
    const rows = getDirectChildrenByLocalName(el, 'mr');
    const rowTex = rows.map((mr) => {
      const cells = getDirectChildrenByLocalName(mr, 'e');
      return cells.map((c) => extractMathLatex(c).trim()).join(' & ');
    });
    const body = rowTex.join(' \\\\ ');
    return insideCases ? body : `\\begin{matrix} ${body} \\end{matrix}`;
  }

  if (tag === 'eqArr') {
    const items = getDirectChildrenByLocalName(el, 'e');
    const lineTex = items.map((item) => extractMathLatex(item).trim()).filter(Boolean);
    if (insideCases) {
      return lineTex.join(' \\\\ ');
    }
    if (lineTex.length > 1) {
      return `\\begin{aligned} ${lineTex.join(' \\\\ ')} \\end{aligned}`;
    }
    return lineTex[0] || '';
  }

  if (tag === 'd') {
    const dPr = getDirectChildByLocalName(el, 'dPr');
    const begChr = getOmmlPrVal(dPr, 'begChr');
    const endChr = getOmmlPrVal(dPr, 'endChr');
    const sepChr = getOmmlPrVal(dPr, 'sepChr') || '|';
    const left = begChr === null ? '(' : begChr;
    const right = endChr === null ? ')' : endChr;
    const eChildren = getDirectChildrenByLocalName(el, 'e');

    // System of equations / piecewise function: "{" with empty right delimiter
    const hasMultilineInner =
      left === '{' &&
      right === '' &&
      eChildren.some(
        (eEl) =>
          getDirectChildByLocalName(eEl, 'eqArr') !== null ||
          getDirectChildByLocalName(eEl, 'm') !== null
      );

    if (hasMultilineInner) {
      const inner = eChildren
        .map((eEl) => {
          let row = '';
          for (let i = 0; i < eEl.childNodes.length; i++) {
            row += extractMathLatex(eEl.childNodes[i], true);
          }
          return row.trim();
        })
        .filter(Boolean)
        .join(' \\\\ ');
      return `\\begin{cases} ${inner} \\end{cases}`;
    }

    const escDelim = (d: string) => {
      if (!d) return '.';
      if (d === '{' || d === '}') return `\\${d}`;
      return d;
    };
    const inner = eChildren.map((eEl) => extractMathLatex(eEl).trim()).join(` ${sepChr} `);
    if (left === '(' && right === ')' && !/\\(?:frac|binom|begin|int|sum|prod)/.test(inner)) {
      return `(${inner})`;
    }
    return `\\left${escDelim(left)} ${inner} \\right${escDelim(right)}`;
  }

  let out = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    out += extractMathLatex(el.childNodes[i], insideCases);
  }
  return out;
}

async function compressZipImageToDataUrl(
  bytes: Uint8Array,
  ext: string,
  maxDim = 820,
  quality = 0.82
): Promise<string | null> {
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };
  const mime = mimeMap[ext.toLowerCase()];
  if (!mime) return null;

  const blob = new Blob([bytes.slice().buffer], { type: mime });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không thể giải mã hình ảnh trong file Word.'));
      el.src = objectUrl;
    });

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (width <= 0 || height <= 0) return null;

    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        height = Math.max(1, Math.round((height * maxDim) / width));
        width = maxDim;
      } else {
        width = Math.max(1, Math.round((width * maxDim) / height));
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const webp = canvas.toDataURL('image/webp', quality);
    if (webp.startsWith('data:image/webp')) {
      return webp;
    }
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function shrinkDataUrl(dataUrl: string, maxDim = 560, quality = 0.65): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxDim || h > maxDim) {
      if (w >= h) {
        h = Math.max(1, Math.round((h * maxDim) / w));
        w = maxDim;
      } else {
        w = Math.max(1, Math.round((w * maxDim) / h));
        h = maxDim;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const webp = canvas.toDataURL('image/webp', quality);
    return webp.startsWith('data:image/webp')
      ? webp
      : canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl;
  }
}

function appendSegment(segments: TextSegment[], text: string, underlined: boolean) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.underlined === underlined) {
    last.text += text;
  } else {
    segments.push({ text, underlined });
  }
}

function sliceSegments(segments: TextSegment[], start: number, end: number): TextSegment[] {
  const result: TextSegment[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const segStart = cursor;
    const segEnd = cursor + seg.text.length;
    cursor = segEnd;
    if (segEnd <= start || segStart >= end) continue;
    const sliceStart = Math.max(0, start - segStart);
    const sliceEnd = Math.min(seg.text.length, end - segStart);
    appendSegment(result, seg.text.slice(sliceStart, sliceEnd), seg.underlined);
  }
  return result;
}

function trimLine(line: LogicalLine): LogicalLine {
  const full = line.text;
  const leadingMatch = full.match(/^\s*/);
  const trailingMatch = full.match(/\s*$/);
  const start = leadingMatch ? leadingMatch[0].length : 0;
  const end = trailingMatch ? full.length - trailingMatch[0].length : full.length;
  if (start >= end) {
    return { text: '', segments: [], images: line.images };
  }
  return {
    text: full.slice(start, end),
    segments: sliceSegments(line.segments, start, end),
    images: line.images,
  };
}

function isRangeUnderlined(segments: TextSegment[], start: number, end: number): boolean {
  const sliced = sliceSegments(segments, start, end);
  let totalNonSpace = 0;
  let underlinedNonSpace = 0;
  for (const s of sliced) {
    const stripped = s.text.replace(/\s+/g, '');
    totalNonSpace += stripped.length;
    if (s.underlined) underlinedNonSpace += stripped.length;
  }
  return totalNonSpace > 0 && underlinedNonSpace > 0;
}

function underlineRatioInRange(segments: TextSegment[], start: number, end: number): number {
  const sliced = sliceSegments(segments, start, end);
  let totalNonSpace = 0;
  let underlinedNonSpace = 0;
  for (const s of sliced) {
    const stripped = s.text.replace(/\s+/g, '');
    totalNonSpace += stripped.length;
    if (s.underlined) underlinedNonSpace += stripped.length;
  }
  if (totalNonSpace === 0) return 0;
  return underlinedNonSpace / totalNonSpace;
}

function splitMultiColumnLine(line: LogicalLine): LogicalLine[] {
  // Detect lines containing multiple MCQ options like "A. ...   B. ...   C. ...   D. ..."
  // or multiple True/False statements like "a) ...   b) ..."
  const mcqSplitRegex = /(?:^|\s{2,}|\t)([ABCD]\s*[.)]\s+)/g;
  const tfSplitRegex = /(?:^|\s{2,}|\t)([abcd]\s*[).]\s+)/g;

  const findMatches = (re: RegExp) => {
    const indices: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text)) !== null) {
      const markerOffset = m.index + (m[0].length - m[1].length);
      indices.push(markerOffset);
    }
    return indices;
  };

  let indices = findMatches(mcqSplitRegex);
  if (indices.length < 2) {
    indices = findMatches(tfSplitRegex);
  }
  if (indices.length < 2) {
    return [trimLine(line)];
  }

  const out: LogicalLine[] = [];
  if (indices[0] > 0) {
    const prefix = trimLine({
      text: line.text.slice(0, indices[0]),
      segments: sliceSegments(line.segments, 0, indices[0]),
      images: line.images,
    });
    if (prefix.text || prefix.images.length > 0) out.push(prefix);
  }

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : line.text.length;
    const chunk = trimLine({
      text: line.text.slice(start, end),
      segments: sliceSegments(line.segments, start, end),
      images: i === 0 && indices[0] === 0 ? line.images : [],
    });
    if (chunk.text || chunk.images.length > 0) {
      out.push(chunk);
    }
  }
  return out;
}

function extractParagraphLines(
  pEl: Element,
  mediaMap: Map<string, string>
): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let curSegments: TextSegment[] = [];
  let curText = '';
  let curImages: string[] = [];

  const flushLine = () => {
    const trimmed = trimLine({
      text: curText,
      segments: curSegments,
      images: curImages,
    });
    if (trimmed.text || trimmed.images.length > 0) {
      lines.push(...splitMultiColumnLine(trimmed));
    }
    curSegments = [];
    curText = '';
    curImages = [];
  };

  const pushText = (t: string, underlined: boolean) => {
    if (!t) return;
    if (curText.endsWith('$') && !curText.endsWith('$$') && t.startsWith('$')) {
      curText += ' ';
      appendSegment(curSegments, ' ', underlined);
    }
    curText += t;
    appendSegment(curSegments, t, underlined);
  };

  const collectImageIdsFromElement = (el: Element) => {
    const blips = getElementsByLocalName(el, 'blip');
    for (const blip of blips) {
      const rId =
        blip.getAttributeNS(R_NS, 'embed') ||
        blip.getAttribute('r:embed') ||
        blip.getAttributeNS(R_NS, 'link') ||
        blip.getAttribute('r:link');
      if (rId && mediaMap.has(rId)) {
        const url = mediaMap.get(rId)!;
        if (!curImages.includes(url)) curImages.push(url);
      }
    }
    const vmlImgs = getElementsByLocalName(el, 'imagedata');
    for (const vImg of vmlImgs) {
      const rId =
        vImg.getAttributeNS(R_NS, 'id') ||
        vImg.getAttribute('r:id') ||
        vImg.getAttribute('o:relid');
      if (rId && mediaMap.has(rId)) {
        const url = mediaMap.get(rId)!;
        if (!curImages.includes(url)) curImages.push(url);
      }
    }
    // Check alternative A_NS blip just in case
    void A_NS;
    void V_NS;
  };

  const walkParagraphNode = (node: Node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName;

    if (tag === 'pPr') return;

    if (tag === 'oMathPara') {
      const mathEls = getDirectChildrenByLocalName(el, 'oMath');
      const latexParts = (mathEls.length > 0 ? mathEls : [el])
        .map((m) => extractMathLatex(m).trim())
        .filter(Boolean);
      if (latexParts.length > 0) {
        const joined =
          latexParts.length > 1
            ? `\\begin{aligned} ${latexParts.join(' \\\\ ')} \\end{aligned}`
            : latexParts[0];
        pushText(`$$${joined}$$`, isOmmlUnderlined(el));
      }
      return;
    }

    if (tag === 'oMath') {
      const mathStr = extractMathLatex(el).trim();
      if (mathStr) {
        pushText(`$${mathStr}$`, isOmmlUnderlined(el));
      }
      return;
    }

    if (tag === 'r') {
      let rPr: Element | null = null;
      for (let i = 0; i < el.childNodes.length; i++) {
        const c = el.childNodes[i];
        if (c.nodeType === 1 && (c as Element).localName === 'rPr') {
          rPr = c as Element;
          break;
        }
      }
      const underlined = isRunUnderlined(rPr);
      const vertAlign = getRunVertAlign(rPr);

      for (let i = 0; i < el.childNodes.length; i++) {
        const c = el.childNodes[i];
        if (c.nodeType !== 1) continue;
        const cEl = c as Element;
        const cTag = cEl.localName;
        if (cTag === 't' || cTag === 'delText') {
          const rawRunText = cEl.textContent || '';
          if (vertAlign && rawRunText.trim()) {
            const safeVal = rawRunText.trim();
            const tex =
              vertAlign === 'superscript' ? `$^{${safeVal}}$` : `$_{${safeVal}}$`;
            pushText(tex, underlined);
          } else {
            pushText(rawRunText, underlined);
          }
        } else if (cTag === 'tab') {
          pushText('    ', underlined);
        } else if (cTag === 'br' || cTag === 'cr') {
          flushLine();
        } else if (cTag === 'drawing' || cTag === 'pict' || cTag === 'object') {
          collectImageIdsFromElement(cEl);
        } else if (cTag === 'sym') {
          const ch = getAttr(cEl, 'char', W_NS);
          if (ch) pushText(ch, underlined);
        }
      }
      return;
    }

    // Hyperlinks, sdtContent, smartTag, ins, etc.
    for (let i = 0; i < el.childNodes.length; i++) {
      walkParagraphNode(el.childNodes[i]);
    }
  };

  for (let i = 0; i < pEl.childNodes.length; i++) {
    walkParagraphNode(pEl.childNodes[i]);
  }
  flushLine();
  return lines;
}

function normalizeSectionFromLine(
  text: string,
  current: QuestionType | null
): QuestionType | null {
  const upper = text.toUpperCase();
  if (/TỰ LUẬN|PHẦN\s*(?:IV|4)\b/.test(upper)) {
    return 'essay';
  }
  if (/TRẢ LỜI NGẮN|ĐIỀN SỐ|ĐIỀN ĐÁP ÁN|PHẦN\s*(?:III|3)\b/.test(upper)) {
    return 'short_answer';
  }
  if (/ĐÚNG\s*[-–/]?\s*SAI|PHẦN\s*(?:II|2)\b(?![I\d])/.test(upper)) {
    return 'true_false';
  }
  if (
    /PHẦN\s*(?:I|1)\b(?![I\d])/.test(upper) ||
    /TRẮC NGHIỆM\s*(?:NHIỀU LỰA CHỌN|KHÁCH QUAN|\(4 PHƯƠNG ÁN\))/.test(upper)
  ) {
    return 'mcq';
  }
  return current;
}

function isSectionHeaderLine(text: string): boolean {
  return /^(?:PHẦN\s+(?:I|II|III|IV|1|2|3|4|A|B|C|D)\b|(?:[IVX]+|[ABCD])\.\s*(?:PHẦN\s+)?(?:TRẮC NGHIỆM|ĐÚNG\s*[-–/]?\s*SAI|TRẢ LỜI NGẮN|TỰ LUẬN)\b|(?:PHẦN\s+|CÂU\s+HỎI\s+)?(?:TRẮC NGHIỆM|ĐÚNG\s*[-–/]?\s*SAI|TRẢ LỜI NGẮN|TỰ LUẬN)\b)/i.test(
    text.trim()
  );
}

function parseScoreFromHeader(meta?: string): number | null {
  if (!meta) return null;
  const m = meta.match(/(\d+(?:[.,]\d+)?)\s*(?:điểm|đ|d)\b/i);
  if (!m) return null;
  const val = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(val) && val > 0 ? val : null;
}

function parseTrailingTrueFalseTag(rawText: string): {
  cleaned: string;
  explicit: boolean | null;
} {
  const m = rawText.match(
    /^(.*?)\s*(?:[-–:]\s*|\(\s*|\[\s*)(Đúng|Sai|Đ|S)(?:\s*\)|\s*\])?\s*$/i
  );
  if (m && m[1].trim().length > 0 && /(?:\(|\[|[-–:])/.test(rawText.slice(m[1].length))) {
    const token = m[2].toUpperCase();
    return {
      cleaned: m[1].trim(),
      explicit: token.startsWith('Đ'),
    };
  }
  return { cleaned: rawText.trim(), explicit: null };
}

function normalizeShortNumericKey(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^(?:đáp\s*(?:án|số)|kq|kết\s*quả)\s*[:.]?\s*/i, '')
    .trim();
  const numMatch = cleaned.match(/^-?\d+(?:[.,]\d+)?/);
  if (numMatch) {
    return numMatch[0].slice(0, 4);
  }
  return cleaned.slice(0, 4);
}

interface BottomAnswerEntry {
  answerRaw?: string;
  mcqLetter?: 'A' | 'B' | 'C' | 'D';
  tfValues?: (boolean | null)[];
  shortNumeric?: string;
  explanationLines: string[];
  explanationImages: string[];
}

interface AnswerKeyStore {
  scoped: Map<string, BottomAnswerEntry>;
  byInferredType: Map<string, BottomAnswerEntry>;
  flat: Map<number, BottomAnswerEntry>;
}

function createEmptyEntry(): BottomAnswerEntry {
  return { explanationLines: [], explanationImages: [] };
}

function mergeEntry(target: BottomAnswerEntry, patch: Partial<BottomAnswerEntry>) {
  if (patch.mcqLetter && !target.mcqLetter) target.mcqLetter = patch.mcqLetter;
  if (patch.shortNumeric && !target.shortNumeric) target.shortNumeric = patch.shortNumeric;
  if (patch.answerRaw && !target.answerRaw) target.answerRaw = patch.answerRaw;
  if (patch.tfValues) {
    if (!target.tfValues) {
      target.tfValues = [...patch.tfValues];
    } else {
      for (let i = 0; i < 4; i++) {
        if (target.tfValues[i] === null && patch.tfValues[i] !== null) {
          target.tfValues[i] = patch.tfValues[i];
        }
      }
    }
  }
  if (patch.explanationLines) {
    for (const ln of patch.explanationLines) {
      if (ln && !target.explanationLines.includes(ln)) {
        target.explanationLines.push(ln);
      }
    }
  }
  if (patch.explanationImages) {
    for (const img of patch.explanationImages) {
      if (img && !target.explanationImages.includes(img)) {
        target.explanationImages.push(img);
      }
    }
  }
}

function parseTrueFalseAnswerString(raw: string): (boolean | null)[] | null {
  const result: (boolean | null)[] = [null, null, null, null];
  const pairRe = /([abcd])\s*[).:=-]?\s*(Đúng|Sai|Đ|S)(?![a-zA-ZÀ-ỹ])/gi;
  let pm: RegExpExecArray | null;
  let count = 0;
  while ((pm = pairRe.exec(raw)) !== null) {
    const slot = 'abcd'.indexOf(pm[1].toLowerCase());
    if (slot >= 0 && slot < 4) {
      result[slot] = pm[2].toUpperCase().startsWith('Đ');
      count++;
    }
  }
  if (count >= 2) return result;

  // Compact 4 chars like "ĐSĐS" or "Đ - S - Đ - Đ" or "Đúng - Sai - Đúng - Sai"
  const compactMatch = raw.trim().match(/^([ĐS])\s*([ĐS])\s*([ĐS])\s*([ĐS])$/i);
  if (compactMatch) {
    return [1, 2, 3, 4].map((idx) => compactMatch[idx].toUpperCase().startsWith('Đ'));
  }

  const seq = raw.match(/(?:^|[\s,;.\-/|])(Đúng|Sai|Đ|S)(?=$|[\s,;.\-/|])/gi);
  if (seq && seq.length >= 2) {
    seq.slice(0, 4).forEach((tok, idx) => {
      const cleaned = tok.replace(/[^ĐSĐúngSai]/gi, '').toUpperCase();
      result[idx] = cleaned.startsWith('Đ');
    });
    return result;
  }

  return null;
}

function parseAnswerToken(
  raw: string,
  sectionHint: QuestionType | null
): {
  inferredType: QuestionType | null;
  patch: Partial<BottomAnswerEntry>;
} {
  const text = raw
    .trim()
    .replace(/^(?:đáp\s*(?:án|số)|chọn(?:\s+đáp\s+án)?|kq|kết\s*quả)\s*[:.]?\s*/i, '')
    .trim();

  if (!text) return { inferredType: null, patch: {} };

  // 1. True/False patterns
  const tfVals = parseTrueFalseAnswerString(text);
  if (tfVals && (sectionHint === 'true_false' || sectionHint === null)) {
    return {
      inferredType: 'true_false',
      patch: { tfValues: tfVals, answerRaw: text },
    };
  }

  // 2. MCQ single letter (optionally followed by explanation like "A. Vì ...")
  const mcqExact = text.match(/^([ABCD])(?:\s*[.)])?(?:\s|$)/i);
  if (
    mcqExact &&
    (sectionHint === 'mcq' || sectionHint === null) &&
    !/^-?\d/.test(text)
  ) {
    const letter = mcqExact[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';
    // Guard against matching English/Vietnamese words starting with A/B/C/D unless single token or followed by punctuation
    const rest = text.slice(mcqExact[0].length).trim();
    const looksLikeOptionOnly =
      rest.length === 0 || /^[.)\-–:]/.test(text.slice(1).trim());
    if (looksLikeOptionOnly || text.trim().length === 1) {
      return {
        inferredType: 'mcq',
        patch: { mcqLetter: letter, answerRaw: letter },
      };
    }
  }

  // 3. Short numeric answer (supports Vietnamese comma decimals and negatives)
  const numMatch = text.match(/^(-?\d+(?:[.,]\d+)?)(?:\s*[a-zA-Z°%µμ/]+)?$/);
  if (numMatch && (sectionHint === 'short_answer' || sectionHint === null)) {
    return {
      inferredType: 'short_answer',
      patch: {
        shortNumeric: normalizeShortNumericKey(numMatch[1]),
        answerRaw: text,
      },
    };
  }

  // Inline numeric with explanation if sectionHint === 'short_answer'
  if (sectionHint === 'short_answer') {
    const leadNum = text.match(/^(-?\d+(?:[.,]\d+)?)(?:\s|$|[.;,])/);
    if (leadNum) {
      return {
        inferredType: 'short_answer',
        patch: {
          shortNumeric: normalizeShortNumericKey(leadNum[1]),
          answerRaw: leadNum[1],
        },
      };
    }
  }

  return { inferredType: null, patch: {} };
}

function recordAnswerKey(
  store: AnswerKeyStore,
  qNum: number,
  sectionHint: QuestionType | null,
  inferredType: QuestionType | null,
  patch: Partial<BottomAnswerEntry>
) {
  if (!Number.isFinite(qNum) || qNum <= 0) return;

  const targetType = sectionHint || inferredType;
  if (targetType) {
    const sk = `${targetType}:${qNum}`;
    const cur = store.scoped.get(sk) || createEmptyEntry();
    mergeEntry(cur, patch);
    store.scoped.set(sk, cur);
  }
  if (inferredType) {
    const ik = `${inferredType}:${qNum}`;
    const cur = store.byInferredType.get(ik) || createEmptyEntry();
    mergeEntry(cur, patch);
    store.byInferredType.set(ik, cur);
  }
  const flatCur = store.flat.get(qNum) || createEmptyEntry();
  mergeEntry(flatCur, patch);
  store.flat.set(qNum, flatCur);
}

function extractQuestionNumberCell(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  const m = cleaned.match(/^(?:Câu\s*)?(\d{1,3})\s*[.:]?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 200 ? n : null;
}

function isLikelyAnswerTable(rows: ParsedTableCell[][]): boolean {
  if (rows.length === 0) return false;
  const flatText = rows
    .flat()
    .map((c) => c.text.trim())
    .join(' ');
  if (/bảng\s*đáp\s*án|đáp\s*án|chọn/i.test(flatText)) return true;

  // Check if two adjacent rows are numbers row + letters/values row
  for (let r = 0; r < rows.length - 1; r++) {
    let qNums = 0;
    let ansCells = 0;
    const cols = Math.min(rows[r].length, rows[r + 1].length);
    for (let c = 0; c < cols; c++) {
      const qn = extractQuestionNumberCell(rows[r][c].text);
      const ans = parseAnswerToken(rows[r + 1][c].text, null);
      if (qn !== null) qNums++;
      if (ans.inferredType !== null) ansCells++;
    }
    if (qNums >= 3 && ansCells >= 3) return true;
  }

  // Check if pairs inside cells match "1. A" / "Câu 1 | A"
  let pairHits = 0;
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const t = row[c].text.trim();
      if (/^(?:Câu\s*)?\d{1,3}\s*[.:=-]\s*(?:[ABCD]|(?:Đ|S))/i.test(t)) {
        pairHits++;
      } else if (c + 1 < row.length && extractQuestionNumberCell(t) !== null) {
        const nextAns = parseAnswerToken(row[c + 1].text, null);
        if (nextAns.inferredType !== null) pairHits++;
      }
    }
  }
  return pairHits >= 3;
}

function parseAnswerTable(
  rows: ParsedTableCell[][],
  sectionHint: QuestionType | null,
  store: AnswerKeyStore
): QuestionType | null {
  let activeSection = sectionHint;

  // Check if row 0 is a True/False matrix header: [Câu, a, b, c, d]
  const tfHeaderIdx = rows.findIndex((row) => {
    const joined = row.map((c) => c.text.trim().toLowerCase()).join('|');
    return /\ba\b/.test(joined) && /\bb\b/.test(joined) && /\bc\b/.test(joined) && /\bd\b/.test(joined);
  });

  if (tfHeaderIdx >= 0) {
    const hdr = rows[tfHeaderIdx];
    const slotCols: number[] = [-1, -1, -1, -1];
    hdr.forEach((cell, idx) => {
      const low = cell.text.trim().toLowerCase().replace(/[).:\s]/g, '');
      if (low === 'a' || low === 'ýa') slotCols[0] = idx;
      if (low === 'b' || low === 'ýb') slotCols[1] = idx;
      if (low === 'c' || low === 'ýc') slotCols[2] = idx;
      if (low === 'd' || low === 'ýd') slotCols[3] = idx;
    });

    if (slotCols.every((c) => c >= 0)) {
      for (let r = tfHeaderIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const qCol = row.findIndex((c) => extractQuestionNumberCell(c.text) !== null);
        if (qCol < 0) continue;
        const qNum = extractQuestionNumberCell(row[qCol].text)!;
        const tfValues: (boolean | null)[] = slotCols.map((colIdx) => {
          const val = (row[colIdx]?.text || '').trim().toUpperCase();
          if (val.startsWith('Đ')) return true;
          if (val.startsWith('S')) return false;
          return null;
        });
        if (tfValues.some((v) => v !== null)) {
          recordAnswerKey(store, qNum, 'true_false', 'true_false', {
            tfValues,
            answerRaw: tfValues.map((v) => (v ? 'Đ' : v === false ? 'S' : '?')).join('-'),
          });
        }
      }
      return 'true_false';
    }
  }

  // Check transposed True/False matrix: header has Câu 1, Câu 2..., rows start with a, b, c, d
  if (rows.length >= 5) {
    const rowLabels = rows.slice(1, 5).map((r) =>
      (r[0]?.text || '').trim().toLowerCase().replace(/^(?:ý|lệnh|mệnh\s*đề)\s*/i, '').replace(/[).:\s]/g, '')
    );
    if (
      rowLabels[0] === 'a' &&
      rowLabels[1] === 'b' &&
      rowLabels[2] === 'c' &&
      rowLabels[3] === 'd'
    ) {
      const headerRow = rows[0];
      for (let c = 1; c < headerRow.length; c++) {
        const qNum = extractQuestionNumberCell(headerRow[c].text);
        if (qNum === null) continue;
        const tfValues: (boolean | null)[] = [1, 2, 3, 4].map((rIdx) => {
          const val = (rows[rIdx]?.[c]?.text || '').trim().toUpperCase();
          if (val.startsWith('Đ')) return true;
          if (val.startsWith('S')) return false;
          return null;
        });
        if (tfValues.some((v) => v !== null)) {
          recordAnswerKey(store, qNum, 'true_false', 'true_false', {
            tfValues,
            answerRaw: tfValues.map((v) => (v ? 'Đ' : v === false ? 'S' : '?')).join('-'),
          });
        }
      }
      return 'true_false';
    }
  }

  // Check horizontal row-paired tables: Row r has question numbers, Row r+1 has answers
  const consumedRows = new Set<number>();
  for (let r = 0; r < rows.length - 1; r++) {
    if (consumedRows.has(r)) continue;
    const rowQ = rows[r];
    const rowA = rows[r + 1];
    const cols = Math.min(rowQ.length, rowA.length);
    const matches: { qNum: number; inferred: QuestionType | null; patch: Partial<BottomAnswerEntry> }[] = [];

    // Also update section if row title mentions Phần I/II/III/IV
    const rowTextAll = rowQ.map((c) => c.text).join(' ');
    const maybeSec = normalizeSectionFromLine(rowTextAll, null);
    if (maybeSec) activeSection = maybeSec;

    for (let c = 0; c < cols; c++) {
      const qNum = extractQuestionNumberCell(rowQ[c].text);
      if (qNum === null) continue;
      // Do not mistake an answer cell in rowA that is itself a question label row
      if (extractQuestionNumberCell(rowA[c].text) !== null && activeSection !== 'short_answer') {
        const nextRowIsText = parseAnswerToken(rowA[c].text, activeSection);
        if (nextRowIsText.inferredType !== 'short_answer') continue;
      }
      const parsedAns = parseAnswerToken(rowA[c].text, activeSection);
      if (parsedAns.inferredType !== null) {
        matches.push({ qNum, inferred: parsedAns.inferredType, patch: parsedAns.patch });
      }
    }

    if (matches.length >= 2 || (matches.length === 1 && /câu/i.test(rowQ[0]?.text || ''))) {
      consumedRows.add(r);
      consumedRows.add(r + 1);
      for (const m of matches) {
        recordAnswerKey(store, m.qNum, activeSection, m.inferred, m.patch);
      }
    }
  }

  // Parse remaining rows: adjacent key->val columns OR inline pairs inside single cell
  for (let r = 0; r < rows.length; r++) {
    if (consumedRows.has(r)) continue;
    const row = rows[r];
    const rowJoined = row.map((c) => c.text.trim()).join(' ');
    const maybeSec = normalizeSectionFromLine(rowJoined, null);
    if (maybeSec) activeSection = maybeSec;

    for (let c = 0; c < row.length; c++) {
      const cellText = row[c].text.trim();
      if (!cellText) continue;

      const qNumCell = extractQuestionNumberCell(cellText);
      if (qNumCell !== null && c + 1 < row.length) {
        const nextText = row[c + 1].text.trim();
        const parsedNext = parseAnswerToken(nextText, activeSection);
        if (parsedNext.inferredType !== null) {
          recordAnswerKey(store, qNumCell, activeSection, parsedNext.inferredType, {
            ...parsedNext.patch,
            explanationImages: row[c + 1].images,
          });
          c++;
          continue;
        }
      }

      // Single-cell formats like "Câu 1: A" or "1. A" or "1A 2B" or "Câu 1: a) Đ, b) S, c) Đ, d) S"
      parseCompactOrInlineKeyLine(cellText, activeSection, store, row[c].images);
    }
  }

  return activeSection;
}

function parseCompactOrInlineKeyLine(
  text: string,
  sectionHint: QuestionType | null,
  store: AnswerKeyStore,
  images: string[] = []
): boolean {
  let matchedAny = false;

  // 1. True/False explicit pairs inside one line: "Câu 1: a) Đ, b) S, c) Đ, d) S" or "1. Đ - S - Đ - S" or "1a.Đ 1b.S 1c.Đ 1d.S"
  const qPrefixTf = text.match(/^(?:Câu\s*)?(\d{1,3})\s*[.:=-]\s*(.+)$/i);
  if (qPrefixTf) {
    const qNum = Number(qPrefixTf[1]);
    const rest = qPrefixTf[2].trim();
    const tfVals = parseTrueFalseAnswerString(rest);
    if (tfVals) {
      recordAnswerKey(store, qNum, sectionHint || 'true_false', 'true_false', {
        tfValues: tfVals,
        answerRaw: rest,
        explanationImages: images,
      });
      return true;
    }
  }

  // "1a. Đ  1b. S  1c. Đ  1d. S"
  const splitTfRe = /(\d{1,3})\s*([abcd])\s*[).:=-]?\s*(Đúng|Sai|Đ|S)\b/gi;
  let sm: RegExpExecArray | null;
  const perQ = new Map<number, (boolean | null)[]>();
  while ((sm = splitTfRe.exec(text)) !== null) {
    const qNum = Number(sm[1]);
    const slot = 'abcd'.indexOf(sm[2].toLowerCase());
    const val = sm[3].toUpperCase().startsWith('Đ');
    const arr = perQ.get(qNum) || [null, null, null, null];
    arr[slot] = val;
    perQ.set(qNum, arr);
  }
  if (perQ.size > 0) {
    for (const [qNum, tfValues] of perQ.entries()) {
      if (tfValues.filter((v) => v !== null).length >= 2) {
        recordAnswerKey(store, qNum, sectionHint || 'true_false', 'true_false', {
          tfValues,
          answerRaw: tfValues.map((v) => (v ? 'Đ' : v === false ? 'S' : '?')).join('-'),
        });
        matchedAny = true;
      }
    }
    if (matchedAny) return true;
  }

  // 2. Standard separated pairs across a line: "Câu 1: A   Câu 2: B" or "1. A  2. C" or "1-2,5  2-668"
  const sepPairRe =
    /(?:^|[\s;|])(?:Câu\s*)?(\d{1,3})\s*[.:=-]\s*([ABCD]|-?\d+(?:[.,]\d+)?)(?=$|[\s,;|])/gi;
  let pm: RegExpExecArray | null;
  while ((pm = sepPairRe.exec(text)) !== null) {
    const qNum = Number(pm[1]);
    const parsed = parseAnswerToken(pm[2], sectionHint);
    if (parsed.inferredType !== null) {
      recordAnswerKey(store, qNum, sectionHint, parsed.inferredType, {
        ...parsed.patch,
        explanationImages: images,
      });
      matchedAny = true;
    }
  }
  if (matchedAny) return true;

  // 3. Compact MCQ pairs without punctuation: "1A 2B 3C 4D"
  if (sectionHint !== 'short_answer' && sectionHint !== 'true_false' && sectionHint !== 'essay') {
    const compactMatches = Array.from(
      text.matchAll(/(?:^|[\s;|])(\d{1,3})\s*([ABCD])(?=$|[\s,;|])/gi)
    );
    if (compactMatches.length >= 2 || (compactMatches.length === 1 && text.trim().length <= 6)) {
      for (const cm of compactMatches) {
        const qNum = Number(cm[1]);
        const letter = cm[2].toUpperCase() as 'A' | 'B' | 'C' | 'D';
        recordAnswerKey(store, qNum, sectionHint || 'mcq', 'mcq', {
          mcqLetter: letter,
          answerRaw: letter,
        });
        matchedAny = true;
      }
    }
  }

  return matchedAny;
}

function extractAnswerKeyMap(
  lines: LogicalLine[],
  tables: ParsedTableInfo[]
): {
  bodyLines: LogicalLine[];
  answerStore: AnswerKeyStore;
} {
  const answerStore: AnswerKeyStore = {
    scoped: new Map(),
    byInferredType: new Map(),
    flat: new Map(),
  };

  let cutIndex = lines.length;
  let seenFirstQuestion = false;
  let seenTheEnd = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].text.trim();
    const upper = raw.toUpperCase();
    if (!raw) continue;

    if (/^(?:CÂU|BÀI)\s+\d+\s*(?:\([^)]*\))?\s*[:.]/i.test(raw)) {
      seenFirstQuestion = true;
    }
    if (/^[-–—_\s]*(?:HẾT|THE END)[-–—_\s]*$/i.test(raw)) {
      seenTheEnd = true;
      continue;
    }

    const strongHeader =
      /^(?:[IVX\dAB]+\.\s*)?(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s+THAM\s+KHẢO|ĐÁP\s+ÁN\s+CHÍNH\s+THỨC|ĐÁP\s+ÁN\s+CHI\s+TIẾT|ĐÁP\s+ÁN\s*(?:&|VÀ|-|–)\s*HƯỚNG\s+DẪN|HƯỚNG\s+DẪN\s+CHẤM|PHẦN\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s+ĐỀ|HƯỚNG\s+DẪN\s+GIẢI\s+CHI\s+TIẾT|LỜI\s+GIẢI\s+CHI\s+TIẾT)\b/i.test(
        upper
      );

    const standaloneKeyHeading =
      (seenFirstQuestion || seenTheEnd) &&
      /^(?:[IVX\dAB]+\.\s*)?(?:ĐÁP\s+ÁN|HƯỚNG\s+DẪN\s+GIẢI|LỜI\s+GIẢI|BÀI\s+GIẢI|ANSWER\s+KEY|KEY)(?:\s*(?:\([^)]*\)|[-–:]+\s*(?:MÃ\s+ĐỀ|ĐỀ).*))?$/i.test(
        upper
      );

    if (strongHeader || standaloneKeyHeading) {
      cutIndex = i;
      break;
    }
  }

  // Fallback: if no explicit heading was found, check if an Answer Key Table appears after questions or after HẾT
  if (cutIndex === lines.length && (seenFirstQuestion || seenTheEnd)) {
    for (const tbl of tables) {
      if (tbl.startLineIdx > 4 && isLikelyAnswerTable(tbl.rows)) {
        cutIndex = tbl.startLineIdx;
        break;
      }
    }
  }

  if (cutIndex < lines.length) {
    let tailSection: QuestionType | null = null;
    const tailTables = tables.filter((t) => t.endLineIdx >= cutIndex);
    const tableByStartLine = new Map<number, ParsedTableInfo>();
    for (const tbl of tailTables) {
      tableByStartLine.set(tbl.startLineIdx, tbl);
    }

    let activeSolution: {
      qNum: number;
      sectionHint: QuestionType | null;
      lines: string[];
      images: string[];
      tfSubValues: (boolean | null)[];
      mcqLetter?: 'A' | 'B' | 'C' | 'D';
      shortNumeric?: string;
    } | null = null;

    const flushActiveSolution = () => {
      if (!activeSolution) return;
      const hasTf = activeSolution.tfSubValues.filter((v) => v !== null).length >= 2;
      const inferred: QuestionType | null = activeSolution.mcqLetter
        ? 'mcq'
        : hasTf
          ? 'true_false'
          : activeSolution.shortNumeric
            ? 'short_answer'
            : activeSolution.lines.length > 0
              ? 'essay'
              : null;

      recordAnswerKey(
        answerStore,
        activeSolution.qNum,
        activeSolution.sectionHint,
        inferred,
        {
          ...(activeSolution.mcqLetter ? { mcqLetter: activeSolution.mcqLetter } : {}),
          ...(hasTf ? { tfValues: activeSolution.tfSubValues } : {}),
          ...(activeSolution.shortNumeric
            ? { shortNumeric: activeSolution.shortNumeric }
            : {}),
          explanationLines: activeSolution.lines,
          explanationImages: activeSolution.images,
        }
      );
      activeSolution = null;
    };

    const tailQHeaderRe = /^(?:Câu|Bài)\s+(\d{1,3})\s*(?:\([^)]*\))?\s*[:.]\s*(.*)$/i;
    const explicitAnsRe =
      /^(?:Đáp\s*(?:án|số)|Chọn(?:\s+đáp\s+án)?|KQ|Kết\s*quả)\s*[:.]?\s*(.*)$/i;

    for (let i = cutIndex; i < lines.length; i++) {
      // If a Word table starts at line index i, parse the whole 2D table structure directly and skip its flattened lines
      const tbl = tableByStartLine.get(i);
      if (tbl) {
        flushActiveSolution();
        const updatedSec = parseAnswerTable(tbl.rows, tailSection, answerStore);
        if (updatedSec) tailSection = updatedSec;
        i = tbl.endLineIdx;
        continue;
      }

      const line = lines[i];
      const t = line.text.trim();
      if (!t && line.images.length === 0) continue;

      if (/^[-–—_\s]*(?:HẾT|THE END)[-–—_\s]*$/i.test(t)) continue;

      // Update section scope if heading indicates Phần I/II/III/IV or Hướng dẫn giải
      const nextSec = normalizeSectionFromLine(t, tailSection);
      if (nextSec !== tailSection || isSectionHeaderLine(t)) {
        flushActiveSolution();
        tailSection = nextSec;
        if (!tailQHeaderRe.test(t)) continue;
      }

      if (
        /^(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN(?:\s+THAM\s+KHẢO|\s+CHÍNH\s+THỨC|\s+CHI\s+TIẾT)?|HƯỚNG\s+DẪN\s+GIẢI(?:\s+CHI\s+TIẾT)?|LỜI\s+GIẢI(?:\s+CHI\s+TIẾT)?|HƯỚNG\s+DẪN\s+CHẤM)\s*[:.\-–—]*$/i.test(
          t
        )
      ) {
        flushActiveSolution();
        continue;
      }

      // Check if line contains multiple compact/inline keys on one row (e.g. "1A 2B 3C" or "Câu 1: A   Câu 2: B")
      const qCountInLine = (t.match(/(?:Câu|Bài)\s+\d+\s*[:.]/gi) || []).length;
      if (qCountInLine >= 2 || (!activeSolution && parseCompactOrInlineKeyLine(t, tailSection, answerStore, line.images))) {
        flushActiveSolution();
        if (qCountInLine >= 2) {
          parseCompactOrInlineKeyLine(t, tailSection, answerStore, line.images);
        }
        continue;
      }

      const qm = t.match(tailQHeaderRe);
      if (qm) {
        flushActiveSolution();
        const qNum = Number(qm[1]);
        const rest = (qm[2] || '').trim();
        activeSolution = {
          qNum,
          sectionHint: tailSection,
          lines: [],
          images: [...line.images],
          tfSubValues: [null, null, null, null],
        };

        if (rest) {
          // Try extracting an answer token at the start/end of rest (e.g. "A", "2,5", "a) Đ, b) S...", "Đ - S - Đ - S")
          const parsedRest = parseAnswerToken(rest, tailSection);
          if (parsedRest.patch.mcqLetter) activeSolution.mcqLetter = parsedRest.patch.mcqLetter;
          if (parsedRest.patch.shortNumeric) activeSolution.shortNumeric = parsedRest.patch.shortNumeric;
          if (parsedRest.patch.tfValues) activeSolution.tfSubValues = parsedRest.patch.tfValues;

          // If rest is NOT just a bare letter "A" or bare number "2,5", keep it as explanation text too
          const isBareKey =
            /^[ABCD][.)]?$/i.test(rest) ||
            /^-?\d+(?:[.,]\d+)?$/.test(rest) ||
            /^(?:[ĐS]\s*[-,]\s*){3}[ĐS]$/i.test(rest);
          if (!isBareKey) {
            // Also check "A. Vì ..." or "Chọn A. ..."
            const leadingChoice = rest.match(/^(?:Chọn\s+)?([ABCD])\s*[.:]\s*(.+)$/i);
            if (leadingChoice && (tailSection === 'mcq' || tailSection === null)) {
              activeSolution.mcqLetter = leadingChoice[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';
              activeSolution.lines.push(leadingChoice[2].trim());
            } else {
              activeSolution.lines.push(rest);
            }
          }
        }
        continue;
      }

      if (activeSolution) {
        const expMatch = t.match(explicitAnsRe);
        if (expMatch && expMatch[1]) {
          const parsedExp = parseAnswerToken(expMatch[1], activeSolution.sectionHint);
          if (parsedExp.patch.mcqLetter) activeSolution.mcqLetter = parsedExp.patch.mcqLetter;
          if (parsedExp.patch.shortNumeric) activeSolution.shortNumeric = parsedExp.patch.shortNumeric;
          if (parsedExp.patch.tfValues) {
            parsedExp.patch.tfValues.forEach((v, idx) => {
              if (v !== null && activeSolution) activeSolution.tfSubValues[idx] = v;
            });
          }
        }

        const tfSubLine = t.match(/^([abcd])\s*[).:]\s*(Đúng|Sai|Đ|S)\b(.*)$/i);
        if (tfSubLine) {
          const slot = 'abcd'.indexOf(tfSubLine[1].toLowerCase());
          activeSolution.tfSubValues[slot] = tfSubLine[2].toUpperCase().startsWith('Đ');
        }

        if (t) activeSolution.lines.push(t);
        line.images.forEach((img) => {
          if (activeSolution && !activeSolution.images.includes(img)) {
            activeSolution.images.push(img);
          }
        });
      }
    }

    flushActiveSolution();
  }

  return {
    bodyLines: lines.slice(0, cutIndex),
    answerStore,
  };
}

function lookupBottomAnswer(
  store: AnswerKeyStore,
  qType: QuestionType,
  sectionHint: QuestionType | null,
  qNumber: number
): BottomAnswerEntry | null {
  const keysToTry = [
    `${qType}:${qNumber}`,
    ...(sectionHint && sectionHint !== qType ? [`${sectionHint}:${qNumber}`] : []),
  ];

  for (const k of keysToTry) {
    const scopedHit = store.scoped.get(k);
    if (scopedHit) return scopedHit;
  }

  const inferredHit = store.byInferredType.get(`${qType}:${qNumber}`);
  if (inferredHit) return inferredHit;

  const flatHit = store.flat.get(qNumber);
  if (flatHit) {
    if (qType === 'mcq' && (flatHit.mcqLetter || flatHit.explanationLines.length > 0)) return flatHit;
    if (qType === 'true_false' && (flatHit.tfValues || flatHit.explanationLines.length > 0)) return flatHit;
    if (qType === 'short_answer' && (flatHit.shortNumeric || flatHit.explanationLines.length > 0)) return flatHit;
    if (qType === 'essay' && (flatHit.explanationLines.length > 0 || flatHit.answerRaw)) return flatHit;
  }

  return null;
}

function formatAnnotatedLine(line: LogicalLine, imagePool: string[]): string {
  let annotated = '';
  for (const seg of line.segments) {
    annotated += seg.underlined ? `[U]${seg.text}[/U]` : seg.text;
  }
  if (line.images.length > 0) {
    const tags = line.images
      .map((url) => {
        const idx = imagePool.indexOf(url);
        return idx >= 0 ? `[IMG_${idx}]` : '';
      })
      .filter(Boolean)
      .join(' ');
    if (tags) annotated = annotated ? `${annotated} ${tags}` : tags;
  }
  return annotated;
}

export async function parseDocxExam(file: File): Promise<DocxParseResult> {
  if (!file.name.toLowerCase().endsWith('.docx')) {
    throw new Error('Vui lòng chọn tệp Word định dạng .docx.');
  }

  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error('File .docx không hợp lệ (thiếu word/document.xml).');
  }

  const warnings: string[] = [];
  const mediaMap = new Map<string, string>();
  const imagePool: string[] = [];

  // 1. Parse relationships & extract + compress embedded images
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
    const relEls = getElementsByLocalName(relsDoc, 'Relationship');

    for (const rel of relEls) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      const type = rel.getAttribute('Type') || '';
      if (!id || !target) continue;
      if (!type.includes('/image') && !target.includes('media/')) continue;

      const cleanTarget = target.replace(/^\/+/, '');
      const zipPath = cleanTarget.startsWith('word/')
        ? cleanTarget
        : `word/${cleanTarget.replace(/^\.\.\//, '')}`;
      const mediaFile = zip.file(zipPath);
      if (!mediaFile) continue;

      const ext = zipPath.split('.').pop()?.toLowerCase() || '';
      const bytes = await mediaFile.async('uint8array');
      const dataUrl = await compressZipImageToDataUrl(bytes, ext);
      if (dataUrl) {
        mediaMap.set(id, dataUrl);
        if (!imagePool.includes(dataUrl)) imagePool.push(dataUrl);
      } else {
        warnings.push(
          `Ảnh "${zipPath.split('/').pop()}" có định dạng vector (${ext.toUpperCase()}) chưa hỗ trợ trực tiếp trên trình duyệt; nên lưu dạng PNG/JPG.`
        );
      }
    }
  }

  // 2. Parse word/document.xml into ordered logical lines AND structured tables
  const docXml = await documentFile.async('string');
  const docDom = new DOMParser().parseFromString(docXml, 'application/xml');
  const bodyEl = getElementsByLocalName(docDom, 'body')[0];
  if (!bodyEl) {
    throw new Error('Không đọc được nội dung văn bản trong file Word.');
  }

  const allLines: LogicalLine[] = [];
  const allTables: ParsedTableInfo[] = [];

  const collectLinesFromContainer = (container: Element): LogicalLine[] => {
    const out: LogicalLine[] = [];
    for (let i = 0; i < container.childNodes.length; i++) {
      const child = container.childNodes[i];
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.localName === 'p') {
        out.push(...extractParagraphLines(el, mediaMap));
      } else if (el.localName === 'tbl') {
        // Nested table: flatten its paragraphs
        const nestedPs = getElementsByLocalName(el, 'p');
        for (const np of nestedPs) {
          out.push(...extractParagraphLines(np, mediaMap));
        }
      } else if (el.localName === 'sdt') {
        const contents = getElementsByLocalName(el, 'sdtContent');
        for (const sc of contents) {
          out.push(...collectLinesFromContainer(sc));
        }
      }
    }
    return out;
  };

  const processBlockNode = (node: Element) => {
    if (node.localName === 'p') {
      allLines.push(...extractParagraphLines(node, mediaMap));
    } else if (node.localName === 'tbl') {
      const startLineIdx = allLines.length;
      const parsedRows: ParsedTableCell[][] = [];

      // Direct tr children (falling back to getElementsByLocalName only if wrapped)
      const rowEls: Element[] = [];
      for (let i = 0; i < node.childNodes.length; i++) {
        const ch = node.childNodes[i];
        if (ch.nodeType === 1 && (ch as Element).localName === 'tr') {
          rowEls.push(ch as Element);
        }
      }
      const effectiveRows = rowEls.length > 0 ? rowEls : getElementsByLocalName(node, 'tr');

      for (const row of effectiveRows) {
        const parsedRow: ParsedTableCell[] = [];
        const cellEls: Element[] = [];
        for (let i = 0; i < row.childNodes.length; i++) {
          const ch = row.childNodes[i];
          if (ch.nodeType === 1 && (ch as Element).localName === 'tc') {
            cellEls.push(ch as Element);
          }
        }
        const effectiveCells = cellEls.length > 0 ? cellEls : getElementsByLocalName(row, 'tc');

        for (const cell of effectiveCells) {
          const cellLines = collectLinesFromContainer(cell);
          allLines.push(...cellLines);
          const cellImages: string[] = [];
          cellLines.forEach((cl) =>
            cl.images.forEach((img) => {
              if (!cellImages.includes(img)) cellImages.push(img);
            })
          );
          parsedRow.push({
            text: cellLines.map((cl) => cl.text).join(' ').trim(),
            lines: cellLines,
            images: cellImages,
          });
        }
        if (parsedRow.length > 0) {
          parsedRows.push(parsedRow);
        }
      }

      const endLineIdx = Math.max(startLineIdx, allLines.length - 1);
      if (parsedRows.length > 0 && allLines.length > startLineIdx) {
        allTables.push({
          startLineIdx,
          endLineIdx,
          rows: parsedRows,
        });
      }
    } else if (node.localName === 'sdt') {
      const contents = getElementsByLocalName(node, 'sdtContent');
      for (const sc of contents) {
        for (let i = 0; i < sc.childNodes.length; i++) {
          const child = sc.childNodes[i];
          if (child.nodeType === 1) {
            processBlockNode(child as Element);
          }
        }
      }
    }
  };

  for (let i = 0; i < bodyEl.childNodes.length; i++) {
    const child = bodyEl.childNodes[i];
    if (child.nodeType === 1) {
      processBlockNode(child as Element);
    }
  }

  const { bodyLines, answerStore } = extractAnswerKeyMap(allLines, allTables);

  // 3. Extract metadata (title, duration, subject) from header lines before first Question
  const firstQuestionIdx = bodyLines.findIndex((l) =>
    /^(?:Câu|Bài)\s+\d+\s*(?:\([^)]*\))?\s*[:.]/i.test(l.text)
  );
  const headerLines =
    firstQuestionIdx > 0 ? bodyLines.slice(0, firstQuestionIdx) : bodyLines.slice(0, 6);

  let detectedTitle = file.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim();
  let detectedSubject = 'Vật lí';
  let detectedDuration = 45;

  for (const hl of headerLines) {
    const t = hl.text.trim();
    if (!t) continue;
    const durMatch = t.match(/thời\s*gian\s*(?:làm\s*bài)?\s*[:.]?\s*(\d+)\s*phút/i);
    if (durMatch) {
      detectedDuration = Math.min(Math.max(Number(durMatch[1]), 5), 180);
    }
    const subjMatch = t.match(/môn\s*[:.]?\s*([^\n–\-,(]+)/i);
    if (subjMatch && subjMatch[1].trim().length >= 2) {
      detectedSubject = subjMatch[1].trim();
    }
    if (/^(?:ĐỀ\s+(?:KIỂM TRA|THI|ÔN)|KIỂM TRA)/i.test(t) && t.length <= 140) {
      detectedTitle = t;
    }
  }

  // 4. Split lines into question blocks, preserving sectionHint
  interface QuestionBlock {
    qNumber: number;
    scoreHint: number | null;
    sectionHint: QuestionType | null;
    explicitEssay: boolean;
    lines: LogicalLine[];
  }

  const blocks: QuestionBlock[] = [];
  let sectionHint: QuestionType | null = null;
  let currentBlock: QuestionBlock | null = null;

  const qHeaderRegex = /^(?:Câu|Bài)\s+(\d+)\s*(?:\(([^)]*)\))?\s*[:.]\s*(.*)$/i;

  for (const line of bodyLines) {
    const trimmedText = line.text.trim();
    if (!trimmedText && line.images.length === 0) continue;

    // Stop trailing separator
    if (/^[-–—_\s]*(?:HẾT|THE END)[-–—_\s]*$/i.test(trimmedText)) {
      break;
    }

    const nextSection = normalizeSectionFromLine(trimmedText, sectionHint);
    if (nextSection !== sectionHint || isSectionHeaderLine(trimmedText)) {
      sectionHint = nextSection;
      if (!qHeaderRegex.test(trimmedText)) {
        continue;
      }
    }

    const qMatch = trimmedText.match(qHeaderRegex);
    if (qMatch) {
      const qNumber = Number(qMatch[1]);
      const metaParen = qMatch[2] || '';
      const scoreHint = parseScoreFromHeader(metaParen);
      const explicitEssay = /(?:tự\s*luận|\bTL\b)/i.test(metaParen);
      const restText = qMatch[3]?.trim() || '';
      const headerOffset = trimmedText.length - restText.length;

      currentBlock = {
        qNumber,
        scoreHint,
        sectionHint: explicitEssay ? 'essay' : sectionHint,
        explicitEssay,
        lines: [],
      };
      blocks.push(currentBlock);

      if (restText || line.images.length > 0) {
        currentBlock.lines.push({
          text: restText,
          segments: sliceSegments(line.segments, headerOffset, line.text.length),
          images: line.images,
        });
      }
      continue;
    }

    if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }

  // 5. Parse each question block into ExamQuestion
  const questions: ParsedDocxQuestion[] = blocks.map((blk, idx) => {
    const promptLines: string[] = [];
    const promptImages: string[] = [];
    const explanationLines: string[] = [];
    const explanationImages: string[] = [];
    const mcqItems: { letterIdx: number; text: string; isUnderlined: boolean }[] = [];
    const tfItems: {
      letterIdx: number;
      text: string;
      isUnderlined: boolean;
      explicit: boolean | null;
    }[] = [];

    let explicitKeyRaw = '';
    let inSolution = false;

    const solutionStartRegex =
      /^(?:Hướng\s*dẫn\s*giải|HDG|Lời\s*giải(?:\s+chi\s+tiết)?|Bài\s*giải|Hướng\s*dẫn\s*chấm|Giải)\s*[:.]?\s*(.*)$/i;
    const explicitAnsRegex =
      /^(?:Đáp\s*(?:án|số)|Chọn(?:\s+đáp\s+án)?|KQ|Kết\s*quả)\s*[:.]\s*(.*)$/i;
    const mcqOptionRegex = /^([ABCD])\s*[.)]\s*(.*)$/;
    const tfOptionRegex =
      blk.sectionHint === 'true_false'
        ? /^([abcdABCD])\s*[).]\s*(.*)$/
        : /^([abcd])\s*[).]\s*(.*)$/;

    for (const line of blk.lines) {
      const t = line.text.trim();

      const solMatch = t.match(solutionStartRegex);
      if (solMatch) {
        inSolution = true;
        if (solMatch[1]?.trim()) {
          explanationLines.push(solMatch[1].trim());
        }
        line.images.forEach((img) => {
          if (!explanationImages.includes(img)) explanationImages.push(img);
        });
        continue;
      }

      const ansMatch = t.match(explicitAnsRegex);
      if (ansMatch) {
        explicitKeyRaw = ansMatch[1].trim();
        if (inSolution && t) {
          explanationLines.push(t);
        }
        continue;
      }

      if (inSolution) {
        if (t) explanationLines.push(t);
        line.images.forEach((img) => {
          if (!explanationImages.includes(img)) explanationImages.push(img);
        });
        continue;
      }

      // Check MCQ option A/B/C/D (never when section is true_false, short_answer, or essay)
      const mcqMatch = t.match(mcqOptionRegex);
      if (
        mcqMatch &&
        blk.sectionHint !== 'true_false' &&
        blk.sectionHint !== 'essay' &&
        blk.sectionHint !== 'short_answer'
      ) {
        const letterIdx = 'ABCD'.indexOf(mcqMatch[1]);
        const bodyStart = t.length - (mcqMatch[2] || '').length;
        const prefixUnderlined = isRangeUnderlined(line.segments, 0, bodyStart);
        const bodyRatio = underlineRatioInRange(line.segments, bodyStart, t.length);
        mcqItems.push({
          letterIdx,
          text: (mcqMatch[2] || '').trim(),
          isUnderlined: prefixUnderlined || bodyRatio >= 0.35,
        });
        line.images.forEach((img) => {
          if (!promptImages.includes(img)) promptImages.push(img);
        });
        continue;
      }

      // Check True/False statement a)/b)/c)/d) (never steal sub-parts a), b) of essay/short_answer!)
      const tfMatch = t.match(tfOptionRegex);
      if (
        tfMatch &&
        blk.sectionHint !== 'essay' &&
        blk.sectionHint !== 'short_answer'
      ) {
        const letterIdx = 'abcd'.indexOf(tfMatch[1].toLowerCase());
        const bodyStart = t.length - (tfMatch[2] || '').length;
        const prefixUnderlined = isRangeUnderlined(line.segments, 0, bodyStart);
        const bodyRatio = underlineRatioInRange(line.segments, bodyStart, t.length);
        const { cleaned, explicit } = parseTrailingTrueFalseTag(tfMatch[2] || '');
        tfItems.push({
          letterIdx,
          text: cleaned,
          isUnderlined: prefixUnderlined || bodyRatio >= 0.35,
          explicit,
        });
        line.images.forEach((img) => {
          if (!promptImages.includes(img)) promptImages.push(img);
        });
        continue;
      }

      if (t) promptLines.push(t);
      line.images.forEach((img) => {
        if (!promptImages.includes(img)) promptImages.push(img);
      });
    }

    const prompt = promptLines.join('\n').trim() || `Câu hỏi ${idx + 1}`;

    // Classify question type
    let qType: QuestionType;
    if (mcqItems.length >= 2) {
      qType = 'mcq';
    } else if (tfItems.length >= 2) {
      qType = 'true_false';
    } else if (blk.sectionHint === 'short_answer') {
      qType = 'short_answer';
    } else if (blk.sectionHint === 'essay') {
      qType = 'essay';
    } else {
      const probeBottom = lookupBottomAnswer(
        answerStore,
        'short_answer',
        blk.sectionHint,
        blk.qNumber
      );
      if (
        (explicitKeyRaw &&
          /^-?\d+(?:[.,]\d+)?(?:\s*[a-zA-Z°%µμ/]+)?$/.test(explicitKeyRaw) &&
          normalizeShortNumericKey(explicitKeyRaw).length <= 4) ||
        probeBottom?.shortNumeric
      ) {
        qType = 'short_answer';
      } else {
        qType = 'essay';
      }
    }

    const bottomEntry = lookupBottomAnswer(
      answerStore,
      qType,
      blk.sectionHint,
      blk.qNumber
    );

    // Merge inline explanations with bottom-of-exam solution guide lines & images
    const mergedExplanationLines =
      explanationLines.length > 0
        ? explanationLines
        : bottomEntry?.explanationLines || [];
    const mergedExplanationImages =
      explanationImages.length > 0
        ? explanationImages
        : bottomEntry?.explanationImages || [];
    const explanationText = mergedExplanationLines.join('\n').trim();

    if (qType === 'mcq') {
      const sortedOpts = ['', '', '', ''];
      const underlinedFlags = [false, false, false, false];
      mcqItems.forEach((item, mIdx) => {
        const target = item.letterIdx >= 0 && item.letterIdx < 4 ? item.letterIdx : mIdx;
        if (target >= 0 && target < 4) {
          sortedOpts[target] = item.text;
          underlinedFlags[target] = item.isUnderlined;
        }
      });

      let correctOption = underlinedFlags.findIndex(Boolean);
      let answerSource: ParsedDocxQuestion['answerSource'] =
        correctOption >= 0 ? 'underline' : 'missing';

      if (correctOption < 0 && explicitKeyRaw) {
        const letterHit = explicitKeyRaw.toUpperCase().match(/\b([ABCD])\b/);
        if (letterHit) {
          correctOption = 'ABCD'.indexOf(letterHit[1]);
          answerSource = 'explicit';
        }
      }

      if (correctOption < 0 && bottomEntry?.mcqLetter) {
        correctOption = 'ABCD'.indexOf(bottomEntry.mcqLetter);
        if (correctOption >= 0) {
          answerSource = 'table';
        }
      }

      const needsReview = correctOption < 0;
      if (correctOption < 0) correctOption = 0;

      return {
        id: `q${idx + 1}`,
        index: idx + 1,
        type: 'mcq',
        prompt,
        maxScore: blk.scoreHint ?? 0.25,
        ...(promptImages.length > 0 ? { imageUrls: promptImages } : {}),
        options: sortedOpts.map((o, i) => o || `Phương án ${'ABCD'[i]}`),
        correctOption,
        explanation: explanationText,
        ...(mergedExplanationImages.length > 0
          ? { explanationImageUrls: mergedExplanationImages }
          : {}),
        answerSource,
        needsReview,
      };
    }

    if (qType === 'true_false') {
      const anyUnderlined = tfItems.some((it) => it.isUnderlined);
      const anyExplicit = tfItems.some((it) => it.explicit !== null);

      const inlineTokens: (boolean | null)[] = [null, null, null, null];
      if (explicitKeyRaw) {
        const parsedInline = parseTrueFalseAnswerString(explicitKeyRaw);
        if (parsedInline) {
          parsedInline.forEach((v, i) => {
            inlineTokens[i] = v;
          });
        }
      }

      const bottomTokens = bottomEntry?.tfValues || [null, null, null, null];

      const statements: TrueFalseStatement[] = [0, 1, 2, 3].map((slot) => {
        const item = tfItems.find((it) => it.letterIdx === slot) || tfItems[slot];
        if (!item) {
          return { text: `Nhận định ${'abcd'[slot]}`, isTrue: false };
        }
        let isTrue = false;
        if (item.explicit !== null) {
          isTrue = item.explicit;
        } else if (anyUnderlined) {
          isTrue = item.isUnderlined;
        } else if (inlineTokens[slot] !== null) {
          isTrue = Boolean(inlineTokens[slot]);
        } else if (bottomTokens[slot] !== null) {
          isTrue = Boolean(bottomTokens[slot]);
        }
        return { text: item.text, isTrue };
      });

      const hasInline = anyExplicit || inlineTokens.some((v) => v !== null);
      const hasBottom = bottomTokens.some((v) => v !== null);

      const answerSource: ParsedDocxQuestion['answerSource'] = anyUnderlined
        ? 'underline'
        : hasInline
          ? 'explicit'
          : hasBottom
            ? 'table'
            : 'missing';

      return {
        id: `q${idx + 1}`,
        index: idx + 1,
        type: 'true_false',
        prompt,
        maxScore: blk.scoreHint ?? 1.0,
        ...(promptImages.length > 0 ? { imageUrls: promptImages } : {}),
        statements,
        explanation: explanationText,
        ...(mergedExplanationImages.length > 0
          ? { explanationImageUrls: mergedExplanationImages }
          : {}),
        answerSource,
        needsReview: answerSource === 'missing',
      };
    }

    if (qType === 'short_answer') {
      const normalizedKey = explicitKeyRaw
        ? normalizeShortNumericKey(explicitKeyRaw)
        : bottomEntry?.shortNumeric ||
          (bottomEntry?.answerRaw ? normalizeShortNumericKey(bottomEntry.answerRaw) : '');
      const answerSource: ParsedDocxQuestion['answerSource'] = explicitKeyRaw
        ? normalizedKey
          ? 'explicit'
          : 'missing'
        : normalizedKey
          ? 'table'
          : 'missing';

      return {
        id: `q${idx + 1}`,
        index: idx + 1,
        type: 'short_answer',
        prompt,
        maxScore: blk.scoreHint ?? 0.5,
        ...(promptImages.length > 0 ? { imageUrls: promptImages } : {}),
        correctAnswer: normalizedKey,
        explanation:
          explanationText ||
          (normalizedKey ? `Đáp số: ${normalizedKey}` : ''),
        ...(mergedExplanationImages.length > 0
          ? { explanationImageUrls: mergedExplanationImages }
          : {}),
        answerSource,
        needsReview: !normalizedKey,
      };
    }

    // Essay question
    const essayKeyText = explicitKeyRaw || bottomEntry?.answerRaw || '';
    const finalEssayExplanation = explanationText || essayKeyText || '';
    const answerSource: ParsedDocxQuestion['answerSource'] = explicitKeyRaw || explanationLines.length > 0
      ? 'explicit'
      : bottomEntry && (bottomEntry.explanationLines.length > 0 || bottomEntry.answerRaw)
        ? 'table'
        : 'missing';

    return {
      id: `q${idx + 1}`,
      index: idx + 1,
      type: 'essay',
      prompt,
      maxScore: blk.scoreHint ?? 1.0,
      ...(promptImages.length > 0 ? { imageUrls: promptImages } : {}),
      correctAnswer: essayKeyText,
      explanation: finalEssayExplanation,
      ...(mergedExplanationImages.length > 0
        ? { explanationImageUrls: mergedExplanationImages }
        : {}),
      answerSource,
      needsReview: !finalEssayExplanation,
    };
  });

  // 6. Enforce Firestore 1MB document budget across all embedded question images
  const calcApproxBytes = () =>
    JSON.stringify(
      questions.map((q) => ({
        ...q,
        answerSource: undefined,
        needsReview: undefined,
      }))
    ).length;

  if (calcApproxBytes() > 750000) {
    for (const q of questions) {
      if (q.imageUrls) {
        q.imageUrls = await Promise.all(
          q.imageUrls.map((u) => shrinkDataUrl(u, 520, 0.62))
        );
      }
      if (q.explanationImageUrls) {
        q.explanationImageUrls = await Promise.all(
          q.explanationImageUrls.map((u) => shrinkDataUrl(u, 480, 0.58))
        );
      }
    }
    if (calcApproxBytes() > 880000) {
      warnings.push(
        'File Word có dung lượng ảnh lớn; hệ thống đã tự nén ảnh để đảm bảo lưu mượt trên cơ sở dữ liệu.'
      );
    }
  }

  // Pass ALL lines (body + bottom answer section) to AI fallback so AI can also read bottom answer tables if teacher triggers AI refine!
  const annotatedTextForAi = allLines
    .map((l) => formatAnnotatedLine(l, imagePool))
    .filter(Boolean)
    .join('\n');

  const bottomAnswerCount = questions.filter((q) => q.answerSource === 'table').length;
  const underlineAnswerCount = questions.filter((q) => q.answerSource === 'underline').length;

  return {
    title: detectedTitle || 'Đề kiểm tra từ file Word',
    subject: detectedSubject,
    durationMinutes: detectedDuration,
    questions,
    imageCount: imagePool.length,
    bottomAnswerCount,
    underlineAnswerCount,
    annotatedTextForAi,
    imagePool,
    warnings,
  };
}

export interface ReferenceDocxParseResult {
  title: string;
  subject: string;
  questions: ParsedDocxQuestion[];
  introKnowledgeText: string;
  plainFullText: string;
  annotatedTextForAi: string;
  bottomAnswerCount: number;
  underlineAnswerCount: number;
  warnings: string[];
}

export async function parseDocxForReferenceBank(
  file: File
): Promise<ReferenceDocxParseResult> {
  const examRes = await parseDocxExam(file);

  const plainFullText = examRes.annotatedTextForAi
    .replace(/\[IMG_\d+\]/g, '')
    .replace(/\[\/?U\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const lines = plainFullText.split('\n');
  const firstQIdx = lines.findIndex((ln) =>
    /^(?:Câu|Bài)\s+\d+\s*(?:\([^)]*\))?\s*[:.]/i.test(ln.trim())
  );
  const introLines =
    firstQIdx > 0
      ? lines.slice(0, firstQIdx)
      : examRes.questions.length === 0
        ? lines
        : [];
  const introKnowledgeText = introLines
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 7500);

  return {
    title:
      examRes.title === 'Đề kiểm tra từ file Word'
        ? file.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim() ||
          'Tài liệu chuẩn từ Word'
        : examRes.title,
    subject: examRes.subject,
    questions: examRes.questions,
    introKnowledgeText,
    plainFullText,
    annotatedTextForAi: examRes.annotatedTextForAi,
    bottomAnswerCount: examRes.bottomAnswerCount,
    underlineAnswerCount: examRes.underlineAnswerCount,
    warnings: examRes.warnings,
  };
}

