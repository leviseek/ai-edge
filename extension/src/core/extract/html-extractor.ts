/** SW 侧 HTML → 正文（用于深抓候选页；无 DOM 环境，靠正则启发式） */
export interface HtmlExtraction {
  title: string;
  text: string;
  charCount: number;
}

export function extractTextFromHtml(html: string, url = ''): HtmlExtraction {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  let title = '';
  if (titleMatch) title = decodeHtml(stripTags(titleMatch[1])).trim();
  if (!title) {
    try {
      title = new URL(url).hostname;
    } catch {
      /* 空 */
    }
  }

  const text = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\t\r ]+/g, ' ')
  )
    .replace(/\n\s*\n+/g, '\n')
    .trim();

  return { title, text, charCount: text.length };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)));
}