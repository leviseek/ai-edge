/** 项目事实锚：KB 纯逻辑 + 存储 + 幻觉检测（可在 SW / content / 测试复用） */
import type { FactEntry, FactKind, HallucinationItem, ScanMessage } from './types';

const KB_KEY = 'ai-edge:facts';

export const FACT_KINDS: FactKind[] = ['已实现', '决策', '架构', '待办', '限制'];

export async function loadFacts(): Promise<FactEntry[]> {
  try {
    const stored = await chrome.storage.local.get(KB_KEY);
    const arr = stored[KB_KEY];
    return Array.isArray(arr) ? (arr as unknown as FactEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveFacts(facts: FactEntry[]): Promise<void> {
  await chrome.storage.local.set({ [KB_KEY]: facts });
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function normalizeEntry(f: Partial<FactEntry>): FactEntry | null {
  const kind = (FACT_KINDS as string[]).includes(f.kind as string) ? (f.kind as FactKind) : '架构';
  const title = String(f.title ?? '').trim();
  if (!title) return null;
  return {
    id: f.id || newId(),
    kind,
    title: title.slice(0, 80),
    detail: String(f.detail ?? '').slice(0, 500),
    path: String(f.path ?? '').slice(0, 160),
    tags: Array.isArray(f.tags) ? f.tags.map(String).slice(0, 6) : [],
    updatedAt: f.updatedAt || Date.now(),
  };
}

const KIND_MAP: Record<string, FactKind> = { 已实现: '已实现', 决策: '决策', 架构: '架构', 待办: '待办', 限制: '限制' };

/** 宽松的导入解析：支持 JSON 数组 / Markdown 小节 + 列表项 / [KIND] 前缀 */
export function parseImport(raw: string): FactEntry[] {
  const text = (raw || '').replace(/\r\n/g, '\n');
  // JSON 数组
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) {
      return arr.map((it) => normalizeEntry(it as Partial<FactEntry>)).filter(Boolean) as FactEntry[];
    }
  } catch {
    /* 继续尝试文本 */
  }
  const out: FactEntry[] = [];
  let kind: FactKind = '架构';
  for (const line0 of text.split('\n')) {
    const line = line0.trim();
    if (!line) continue;
    const section = /^#{1,3}\s*(已实现|决策|架构|待办|限制)\s*$/.exec(line);
    if (section) {
      kind = KIND_MAP[section[1]];
      continue;
    }
    const item = line.replace(/^[-*+]\s*/, '');
    const bracket = /^\[(已实现|决策|架构|待办|限制)\]\s*(.+)$/.exec(item);
    if (bracket) {
      const e = normalizeEntry({ kind: KIND_MAP[bracket[1]], title: bracket[2] });
      if (e) out.push(e);
      continue;
    }
    const sep = item.indexOf('：');
    const title = (sep > 0 ? item.slice(0, sep) : item).trim();
    const detail = sep > 0 ? item.slice(sep + 1).trim() : '';
    if (title) {
      const e = normalizeEntry({ kind, title, detail });
      if (e) out.push(e);
    }
  }
  return out;
}

/** 生成“会话锚定”Brief（复制粘贴给 AI 会话开头） */
export function buildBrief(facts: FactEntry[]): string {
  const by = (k: FactKind): FactEntry[] => facts.filter((f) => f.kind === k).sort((a, b) => b.updatedAt - a.updatedAt);
  const lines: string[] = ['【项目当前事实（由 ai-edge 生成，回答本项目相关问题时请以此为准）】'];
  const sections: Array<[FactKind, string]> = [
    ['已实现', '已实现（以这些为准，勿把未实现当已完成）'],
    ['决策', '重要决策（后续设计/代码须与此一致，冲突时先说明再让我选择）'],
    ['架构', '架构（模块/命名/依赖约定）'],
    ['待办', '待办 / 未实现'],
    ['限制', '限制 / 已知问题'],
  ];
  for (const [k, head] of sections) {
    const list = by(k);
    if (!list.length) continue;
    lines.push('\n## ' + head);
    for (const f of list) {
      lines.push(`- ${f.title}${f.detail ? `：${f.detail.slice(0, 140)}` : ''}${f.path ? ` （${f.path}）` : ''}`);
    }
  }
  lines.push(
    '\n补充规则：',
    '1) 若你提到某功能“已完成/已实现”，但“已实现”清单没有列出，请先向我确认并说明当前真实状态，不要默认为已存在；',
    '2) 技术选型、命名、模块划分应与“决策/架构”一致，不要无提示地更换；',
    '3) 本项目所有实现类回答必须与上述清单一致。',
  );
  return lines.join('\n');
}

/* ---------- 幻觉（事实漂移）检测 ---------- */
const ASSERT_RE =
  /(已(?:经)?实现|已(?:经)?完成|已经做(?:过|好)?|我们(?:之前|前面|此前|上次)|当前(?:版本|实现|代码|项目)|之前的实现|目前(?:已)?(?:实现|支持|就有))/;

export function hasAssertion(text: string): boolean {
  return ASSERT_RE.test(text || '');
}

export function extractClaim(text: string): string {
  const m =
    /(?:已(?:经)?实现|已(?:经)?完成|已经做(?:过|好)?|当前(?:版本|实现|代码|项目)|之前的实现|目前(?:已)?(?:实现|支持))\s*[：:，,、]?\s*([^\n，。；；!？!?（(]{2,42})/.exec(
      text || '',
    );
  return m ? m[1].trim() : '';
}

/** 一条消息/大段文本中提取多个断言短语 */
export function extractAllClaims(text: string, limit = 6): string[] {
  const re =
    /(?:已(?:经)?实现|已(?:经)?完成|已经做(?:过|好)?|当前(?:版本|实现|代码|项目)|之前的实现|目前(?:已)?(?:实现|支持))\s*[：:，,、]?\s*([^\n，。；！?！?（(]{2,42})/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || '')) && out.length < limit) {
    const c = m[1].trim();
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 把粘贴的转写文本切成消息块（DOM 无关的兜底输入） */
export function messagesFromText(text: string, role = 'assistant'): ScanMessage[] {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter((b) => b.length >= 8)
    .map((b) => ({ role, text: b }));
}

export interface ClaimCheck {
  found: boolean;
  score: number;
  matched?: FactEntry;
}

function splitTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,，。;；、/()（）"'“”：:]+/)
    .filter((w) => w.length >= 2);
}

/** 断言与 KB「已实现」条目的匹配度：标题归一化后子串命中或有显著分词重叠 */
export function checkClaim(facts: FactEntry[], claim: string): ClaimCheck {
  const claimRaw = String(claim ?? '');
  const cn = claimRaw.toLowerCase().replace(/\s+/g, '');
  if (!cn) return { found: false, score: 0 };
  let best = { score: 0, entry: undefined as FactEntry | undefined };
  for (const e of facts.filter((f) => f.kind === '已实现')) {
    const tn = e.title.toLowerCase().replace(/\s+/g, '');
    let score = 0;
    if (tn && (cn.includes(tn) || tn.includes(cn))) {
      score = 1;
    } else {
      const tt = splitTokens(e.title);
      if (tt.length) {
        const hit = tt.filter((t) => cn.includes(t.toLowerCase())).length;
        score = hit / tt.length;
      }
    }
    if (score > best.score) best = { score, entry: e };
  }
  return { found: best.score >= 0.5, score: best.score, matched: best.entry };
}

/** 扫描助手消息，找出 KB 中无对应实现的断言（疑似幻觉）；一条消息可产出多条断言 */
export function detectHallucinations(facts: FactEntry[], messages: ScanMessage[], limit = 60): HallucinationItem[] {
  const out: HallucinationItem[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    if (!hasAssertion(msg.text)) continue;
    for (const claim of extractAllClaims(msg.text)) {
      const chk = checkClaim(facts, claim);
      if (chk.found) continue;
      const idx = msg.text.indexOf(claim);
      out.push({
        claim,
        score: chk.score,
        sample: msg.text.slice(Math.max(0, idx - 28), idx + claim.length + 40),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function buildClarify(claim: string): string {
  return `在继续前请先核对：你提到的「${claim}」目前项目里**尚未实现**（ai-edge·项目事实锚检测，且“已实现”清单中无对应条目）。请按项目真实状态重新说明，不要将未完成项当作已完成，也不要在此之上继续叠加实现。`;
}

/** 合并本地扫描结果到 KB：按 kind+title 去重，扫描条目更新详情/路径，保留用户条目与顺序 */
export function mergeFacts(
  existing: FactEntry[],
  incoming: FactEntry[],
): { list: FactEntry[]; added: number; updated: number } {
  const list = existing.slice();
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const idx = list.findIndex((f) => f.kind + ':' + f.title === inc.kind + ':' + inc.title);
    if (idx >= 0) {
      const cur = list[idx];
      if (inc.detail && inc.detail !== cur.detail) {
        list[idx] = { ...cur, detail: inc.detail, path: inc.path || cur.path, updatedAt: Date.now() };
        updated++;
      }
    } else {
      list.push({ ...inc, id: inc.id || newId() });
      added++;
    }
  }
  return { list, added, updated };
}

export { KB_KEY };