/** 内容分块：按字符预算切分，段落边界对齐 + 重叠，适配长文摘要 */
export interface Chunk {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
}

export function chunkText(text: string, maxChars = 8000, overlap = 400): Chunk[] {
  if (!text) return [];
  if (text.length <= maxChars) return [{ index: 0, text, startChar: 0, endChar: text.length }];
  const out: Chunk[] = [];
  let pos = 0;
  let i = 0;
  while (pos < text.length) {
    let end = Math.min(pos + maxChars, text.length);
    if (end < text.length) {
      // 优先在段落/句号边界截断（预算 50% 以上时才允许提前切）
      const nl = text.lastIndexOf('\n\n', end);
      const dot = text.lastIndexOf('. ', end);
      const cut = Math.max(nl, dot);
      if (cut > pos + maxChars * 0.5) end = cut + 1;
    }
    out.push({ index: i++, text: text.slice(pos, end).trim(), startChar: pos, endChar: end });
    if (end >= text.length) break; // 已覆盖到文末，终止（避免尾部逐字小块）
    pos = Math.max(end - overlap, pos + 1);
  }
  return out;
}