/** 自研轻量 Markdown tokenizer（纯函数，无依赖，可 Node 测试）。
 * 支持：标题 / 段落 / 无序·有序列表 / 引用 / 围栏代码块 / 分隔线 /
 * 行内：**加粗**、*斜体*、`代码`、[链接](url)。
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string };

export type MdBlock =
  | { t: 'heading'; level: number; inline: Inline[] }
  | { t: 'paragraph'; inline: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'quote'; blocks: MdBlock[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'hr' };

const INLINE_PATTERN = String.raw`\*\*([^*]+)\*\*|\*([^*]+)\*|\`([^\`]+)\`|\[([^\]\n]+)\]\(([^)\s]+)\)`;

export function parseInline(src: string): Inline[] {
  // 局部正则：避免全局 g 在递归（加粗/斜体内再解析）时重入互相重置 lastIndex 造成死循环
  const re = new RegExp(INLINE_PATTERN, 'g');
  const out: Inline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
    // 组索引：1=加粗内容, 2=斜体内容, 3=行内代码, 4=链接文本, 5=链接 href
    if (m[1] !== undefined) out.push({ t: 'bold', c: parseInline(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'italic', c: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ t: 'code', v: m[3] });
    else if (m[4] !== undefined && m[5] !== undefined) out.push({ t: 'link', v: m[4], href: m[5] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

const BLOCK_START = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|```|---|\*\*\*)/;

export function tokenizeMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  const n = lines.length;

  const cur = (): string | undefined => lines[i];

  while (i < n) {
    const line = cur() ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }

    // 围栏代码块
    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      i++;
      const buf: string[] = [];
      while (i < n && !/^```\s*$/.test(cur() ?? '')) {
        buf.push(cur() as string);
        i++;
      }
      i++; // 结束围栏
      blocks.push({ t: 'code', lang: fence[1] ?? '', text: buf.join('\n') });
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ t: 'heading', level: h[1].length, inline: parseInline(h[2]) });
      i++;
      continue;
    }

    // 分隔线
    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < n && /^[-*+]\s+/.test(cur() ?? '')) {
        items.push(parseInline((cur() as string).replace(/^[-*+]\s+/, '')));
        i++;
      }
      blocks.push({ t: 'ul', items });
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < n && /^\d+\.\s+/.test(cur() ?? '')) {
        items.push(parseInline((cur() as string).replace(/^\d+\.\s+/, '')));
        i++;
      }
      blocks.push({ t: 'ol', items });
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < n && /^>\s?/.test(cur() ?? '')) {
        buf.push((cur() as string).replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ t: 'quote', blocks: tokenizeMarkdown(buf.join('\n')) });
      continue;
    }

    // 段落（连续非块起头行合并）
    const buf: string[] = [line];
    i++;
    while (i < n) {
      const l = cur() ?? '';
      if (!l.trim() || BLOCK_START.test(l)) break;
      buf.push(l);
      i++;
    }
    blocks.push({ t: 'paragraph', inline: parseInline(buf.join(' ')) });
  }

  return blocks;
}