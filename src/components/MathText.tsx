import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Fragment, useMemo } from 'react';

interface MathTextProps {
  text?: string | null;
  className?: string;
  inline?: boolean;
}

type Segment =
  | { kind: 'text'; content: string }
  | { kind: 'inline'; content: string }
  | { kind: 'display'; content: string };

const KATEX_MACROS: Record<string, string> = {
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
  '\\degree': '^\\circ',
  '\\tg': '\\tan',
  '\\cotg': '\\cot',
  '\\arctg': '\\arctan',
  '\\arccotg': '\\operatorname{arccot}',
  '\\lg': '\\log_{10}',
};

const DISPLAY_ENV_NAMES = new Set([
  'cases',
  'dcases',
  'rcases',
  'aligned',
  'align',
  'align*',
  'gathered',
  'gather',
  'gather*',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'matrix',
  'smallmatrix',
  'array',
]);

function repairAccidentalControlEscapes(raw: string): string {
  // Recover cases where JSON/JS string literals turned \frac, \beta, \begin, \rightarrow into \f, \b, \r
  return raw
    .replace(/\f(?=[a-zA-Z])/g, '\\f')
    .replace(/\u0008(?=[a-zA-Z])/g, '\\b')
    .replace(/\r(?!\n)(?=[a-zA-Z])/g, '\\r');
}

function normalizeLatexBody(tex: string): string {
  return tex
    .replace(/\u00a0/g, ' ')
    .replace(/\\hoac\s*\{/g, '\\left[\\begin{array}{l}')
    .trim();
}

function renderKatexHtml(tex: string, displayMode: boolean): string {
  const cleaned = normalizeLatexBody(tex);
  if (!cleaned) return '';
  try {
    return katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      errorColor: '#B91C1C',
      macros: KATEX_MACROS,
    });
  } catch {
    return cleaned;
  }
}

function readBalancedGroup(src: string, openIdx: number, openCh = '{', closeCh = '}'): number {
  if (src[openIdx] !== openCh) return -1;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '\\') {
      i++;
      continue;
    }
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const BARE_LATEX_COMMAND_WITH_ARGS =
  /^\\(?:dfrac|tfrac|frac|binom|sqrt|vec|overrightarrow|overleftarrow|overline|underline|widehat|widetilde|hat|bar|dot|ddot|text|textbf|mathrm|mathbf|mathit|mathcal|mathbb|operatorname|overset|underset|stackrel|lim|int|iint|iiint|oint|sum|prod)\b/;

const BARE_LATEX_SYMBOL =
  /^\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|cdot|times|div|pm|mp|le|leq|ge|geq|ne|neq|approx|equiv|propto|sim|simeq|cong|infty|partial|nabla|forall|exists|nexists|in|notin|ni|subset|subseteq|supset|supseteq|cup|cap|setminus|emptyset|varnothing|Rightarrow|Leftarrow|Leftrightarrow|implies|iff|rightarrow|leftarrow|leftrightarrow|to|mapsto|perp|parallel|angle|triangle|circ|degree|sin|cos|tan|cot|tg|cotg|arcsin|arccos|arctan|arctg|log|ln|lg|exp|max|min|sup|inf|R|N|Z|Q|C)\b/;

function splitPlainTextWithBareLatex(text: string): Segment[] {
  // Fast path: no backslash and no ^/_ math markers -> pure text
  if (!/[\\^_]/.test(text)) {
    return [{ kind: 'text', content: text }];
  }

  const out: Segment[] = [];
  let i = 0;
  let plainBuf = '';

  const flushPlain = () => {
    if (plainBuf) {
      out.push({ kind: 'text', content: plainBuf });
      plainBuf = '';
    }
  };

  while (i < text.length) {
    // 1. Bare \begin{env}...\end{env}
    if (text[i] === '\\' && text.startsWith('\\begin{', i)) {
      const endNameIdx = text.indexOf('}', i + 7);
      if (endNameIdx > i + 7) {
        const envName = text.slice(i + 7, endNameIdx).trim();
        if (DISPLAY_ENV_NAMES.has(envName)) {
          const endMarker = `\\end{${envName}}`;
          const closeIdx = text.indexOf(endMarker, endNameIdx + 1);
          if (closeIdx !== -1) {
            flushPlain();
            out.push({
              kind: 'display',
              content: text.slice(i, closeIdx + endMarker.length),
            });
            i = closeIdx + endMarker.length;
            continue;
          }
        }
      }
    }

    // 2. Bare \command with arguments (e.g. \frac{1}{2}, \sqrt[3]{x}, \vec{AB}, \int_{0}^{1})
    if (text[i] === '\\') {
      const slice = text.slice(i);
      const cmdMatch = slice.match(BARE_LATEX_COMMAND_WITH_ARGS);
      if (cmdMatch) {
        let cursor = i + cmdMatch[0].length;
        // Skip optional whitespace before [ or { or _ or ^
        let consumedArg = false;
        while (cursor < text.length) {
          let probe = cursor;
          while (probe < text.length && text[probe] === ' ') probe++;
          if (text[probe] === '[' || text[probe] === '{') {
            const close = readBalancedGroup(
              text,
              probe,
              text[probe],
              text[probe] === '[' ? ']' : '}'
            );
            if (close !== -1) {
              cursor = close + 1;
              consumedArg = true;
              continue;
            }
          }
          if (text[probe] === '_' || text[probe] === '^') {
            let argPos = probe + 1;
            while (argPos < text.length && text[argPos] === ' ') argPos++;
            if (text[argPos] === '{') {
              const close = readBalancedGroup(text, argPos, '{', '}');
              if (close !== -1) {
                cursor = close + 1;
                consumedArg = true;
                continue;
              }
            } else if (argPos < text.length && /[A-Za-z0-9+\-]/.test(text[argPos])) {
              cursor = argPos + 1;
              consumedArg = true;
              continue;
            }
          }
          break;
        }
        if (consumedArg || /^\\(?:lim|int|iint|iiint|oint|sum|prod)$/.test(cmdMatch[0])) {
          flushPlain();
          out.push({ kind: 'inline', content: text.slice(i, cursor) });
          i = cursor;
          continue;
        }
      }

      const symMatch = slice.match(BARE_LATEX_SYMBOL);
      if (symMatch) {
        flushPlain();
        out.push({ kind: 'inline', content: symMatch[0] });
        i += symMatch[0].length;
        continue;
      }
    }

    // 3. Inline braced superscript/subscript tokens like x^{2}, 10^{-6}, U_{AB}, x^2 (avoid URLs)
    if (
      /[A-Za-z0-9)\]]/.test(text[i]) &&
      (i === 0 || !/[A-Za-z0-9_/:.-]/.test(text[i - 1]) || text[i - 1] === ' ' || text[i - 1] === '(')
    ) {
      const m = text
        .slice(i)
        .match(/^([A-Za-z0-9]+(?:\^\{[^{}]+\}|\^[A-Za-z0-9-]+|_\{[^{}]+\}|_[0-9]+)+)/);
      if (m && (m[0].includes('^{') || m[0].includes('_{') || m[0].includes('^'))) {
        // Skip false positives inside URLs
        const preceding = text.slice(Math.max(0, i - 16), i);
        if (!/https?:\/\//i.test(preceding)) {
          flushPlain();
          out.push({ kind: 'inline', content: m[0] });
          i += m[0].length;
          continue;
        }
      }
    }

    plainBuf += text[i];
    i++;
  }

  flushPlain();
  return out;
}

function parseMathSegments(rawText: string): Segment[] {
  const text = repairAccidentalControlEscapes(rawText);
  const segments: Segment[] = [];
  let i = 0;
  let plainStart = 0;

  const pushPlain = (endIdx: number) => {
    if (endIdx > plainStart) {
      const chunk = text.slice(plainStart, endIdx);
      segments.push(...splitPlainTextWithBareLatex(chunk));
    }
  };

  while (i < text.length) {
    // Escaped dollar \$ inside plain text
    if (text[i] === '\\' && text[i + 1] === '$') {
      i += 2;
      continue;
    }

    // 1. Display $$ ... $$
    if (text[i] === '$' && text[i + 1] === '$') {
      const closeIdx = text.indexOf('$$', i + 2);
      if (closeIdx !== -1) {
        pushPlain(i);
        segments.push({ kind: 'display', content: text.slice(i + 2, closeIdx) });
        i = closeIdx + 2;
        plainStart = i;
        continue;
      }
    }

    // 2. Display \[ ... \]
    if (text[i] === '\\' && text[i + 1] === '[') {
      const closeIdx = text.indexOf('\\]', i + 2);
      if (closeIdx !== -1) {
        pushPlain(i);
        segments.push({ kind: 'display', content: text.slice(i + 2, closeIdx) });
        i = closeIdx + 2;
        plainStart = i;
        continue;
      }
    }

    // 3. Inline \( ... \)
    if (text[i] === '\\' && text[i + 1] === '(') {
      const closeIdx = text.indexOf('\\)', i + 2);
      if (closeIdx !== -1) {
        pushPlain(i);
        segments.push({ kind: 'inline', content: text.slice(i + 2, closeIdx) });
        i = closeIdx + 2;
        plainStart = i;
        continue;
      }
    }

    // 4. Inline $ ... $ (cannot span blank lines or unescaped newlines unless short)
    if (text[i] === '$' && text[i + 1] !== '$') {
      let closeIdx = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '\\') {
          j++;
          continue;
        }
        if (text[j] === '\n') {
          // Stop single-$ matching across paragraph breaks
          break;
        }
        if (text[j] === '$' && text[j + 1] !== '$') {
          closeIdx = j;
          break;
        }
      }
      if (closeIdx > i + 1) {
        const inner = text.slice(i + 1, closeIdx);
        // Guard against stray currency like "$5 ... $10" if inner looks purely like prose sentences
        const looksLikeMath =
          inner.length <= 160 || /[\\^_{}=+\-*/<>|()[\]]/.test(inner);
        if (looksLikeMath) {
          pushPlain(i);
          segments.push({ kind: 'inline', content: inner });
          i = closeIdx + 1;
          plainStart = i;
          continue;
        }
      }
    }

    i++;
  }

  pushPlain(text.length);
  return segments;
}

export function containsLatexFormula(text?: string | null): boolean {
  if (!text) return false;
  return (
    /(?:\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/.test(text) ||
    /\\(?:frac|dfrac|tfrac|binom|sqrt|vec|overrightarrow|overline|underline|widehat|int|iint|sum|prod|lim|begin|alpha|beta|gamma|delta|Delta|lambda|omega|Omega|pi|theta|phi|varphi|mu|cdot|times|div|pm|le|leq|ge|geq|ne|neq|approx|infty|in|notin|subset|cup|cap|forall|exists|Rightarrow|Leftrightarrow|rightarrow|to|perp|parallel|angle|triangle|sin|cos|tan|cot|tg|cotg|log|ln|degree|R|N|Z|Q|C)\b/.test(
      text
    ) ||
    /[A-Za-z0-9)\]}](?:\^\{[^{}]+\}|_\{[^{}]+\})/.test(text)
  );
}

export function MathText({ text, className = '', inline = false }: MathTextProps) {
  const segments = useMemo(() => {
    if (!text) return [];
    return parseMathSegments(text);
  }, [text]);

  if (!text) return null;

  const Wrapper = inline ? 'span' : 'div';

  return (
    <Wrapper className={`math-text-root ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.kind === 'text') {
          return <Fragment key={idx}>{seg.content}</Fragment>;
        }
        const isDisplay = seg.kind === 'display' && !inline;
        const html = renderKatexHtml(seg.content, isDisplay);
        if (isDisplay) {
          return (
            <span
              key={idx}
              className="math-display-block block my-2 overflow-x-auto max-w-full"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        return (
          <span
            key={idx}
            className="math-inline-node"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </Wrapper>
  );
}
