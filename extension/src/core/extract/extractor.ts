/** 内容提取：content 脚本侧 DOM 启发式（正文识别 + 去噪） */
export interface ExtractionResult {
  title: string;
  url: string;
  lang: string;
  byline: string;
  text: string;
  charCount: number;
}

const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', 'aside', 'form', 'svg', 'canvas',
  '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
  '.ad', '.ads', '.advertisement', '.banner-ad', '.cookie', '.cookie-banner', '.popup', '.modal',
  '.newsletter', '.share', '.social', '#comments', '.comments', '.related', '.recommend', '.footer',
];

const CANDIDATE_SELECTORS = 'main, article, [role="main"], #content, .content, .article, .post, .entry';

export function extractPage(doc: Document = document, url = location.href, title = document.title): ExtractionResult {
  const rootEl = findMainContent(doc) ?? doc.body ?? doc.documentElement;
  const clone = rootEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NOISE_SELECTORS.join(',')).forEach((n) => n.remove());
  const text = normalizeText(clone.innerText);
  return {
    title: title.trim() || new URL(url).hostname,
    url,
    lang: doc.documentElement.lang || 'zh',
    byline: meta(doc, 'author') || meta(doc, 'article:author'),
    text,
    charCount: text.length,
  };
}

function findMainContent(doc: Document): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>(CANDIDATE_SELECTORS));
  let best: HTMLElement | null = null;
  let bestDist = 0;
  for (const el of candidates) {
    const d = score(el);
    if (d > bestDist) {
      bestDist = d;
      best = el;
    }
  }
  if (best && bestDist >= 400) return best;
  // 兜底：正文根节点
  const body = doc.body ?? doc.documentElement;
  return score(body) >= 200 ? body : null;
}

/** 文本密度评分：正文 ≈ 长文本 + 少链接 */
function score(el: HTMLElement): number {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script,style,nav,footer,header,aside,iframe,form,svg,button').forEach((n) => n.remove());
  const textLen = (clone.innerText ?? '').trim().length;
  const linkLen = Array.from(clone.querySelectorAll('a')).reduce((s, a) => s + (a.innerText ?? '').length, 0);
  return Math.max(0, textLen - linkLen * 0.8);
}

function meta(doc: Document, name: string): string {
  return (
    doc.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content ??
    ''
  );
}

function normalizeText(t: string): string {
  return t
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}