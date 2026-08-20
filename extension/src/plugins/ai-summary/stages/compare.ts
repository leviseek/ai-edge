/** stage: 同品类横向比较（搜索召回 → SW 深抓候选正文 → LLM 综合） */
import type { Stage, StageContext } from '../../../core/pipeline/pipeline';
import type { AIProvider } from '../../../core/ai/provider';
import type { SearchServiceRegistry } from '../../../core/search/registry';
import type { SearchResult } from '../../../core/search/service';
import { extractTextFromHtml } from '../../../core/extract/html-extractor';
import { EdgeError, ErrorCodes } from '../../../base/errors';
import { parseJsonLoose } from '../../../shared/protocol';
import { SYSTEM_PROMPT, comparePrompt } from '../prompts';
import type { SummaryFlow, ComparisonOutput, ComparisonItem, CompareCandidate } from '../types';

export interface CompareOptions {
  /** 每个查询召回条数 */
  limit?: number;
  /** 最多执行几次搜索查询 */
  maxQueries?: number;
  /** 深抓候选数量（0 表示不深抓） */
  deepFetch?: number;
  /** 深抓正文保留字符上限 */
  deepFetchMaxChars?: number;
  /** 深抓单页超时 ms */
  deepFetchTimeoutMs?: number;
  /** 是否校验来源可及性（默认 true） */
  verifySources?: boolean;
  /** 单链接校验超时 ms */
  verifyTimeoutMs?: number;
}

export class CompareStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'compare';

  constructor(
    private readonly ai: AIProvider,
    private readonly search: SearchServiceRegistry,
    private readonly searchServiceId: string,
    private readonly opts: CompareOptions = {},
    private readonly model?: string,
  ) {}

  async run(flow: SummaryFlow, ctx: StageContext): Promise<SummaryFlow> {
    const classify = flow.classify;
    const queries = this.buildQueries(classify?.entity, classify?.keywords ?? []);

    // 1) 搜索召回
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const q of queries.slice(0, this.opts.maxQueries ?? 2)) {
      if (ctx.signal.aborted) throw new EdgeError(ErrorCodes.CANCELED, '搜索已中止');
      try {
        const found = await this.search.get(this.searchServiceId).search(q, {
          limit: this.opts.limit ?? 5,
          signal: ctx.signal,
        });
        for (const item of found) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          results.push(item);
        }
      } catch (e) {
        ctx.log.warn('搜索失败', q, e);
      }
    }
    const candidates: CompareCandidate[] = results.map((r) => ({ ...r }));
    ctx.emit(this.name, `搜索召回 ${candidates.length} 条候选`);

    // 2) SW 深抓候选正文（失败静默降级为 snippet）
    const deepFetch = this.opts.deepFetch ?? 3;
    const maxChars = this.opts.deepFetchMaxChars ?? 6000;
    for (const c of candidates.slice(0, deepFetch)) {
      if (ctx.signal.aborted) throw new EdgeError(ErrorCodes.CANCELED, '搜索已中止');
      try {
        const html = await fetchPageText(c.url, {
          timeoutMs: this.opts.deepFetchTimeoutMs ?? 8000,
          signal: ctx.signal,
        });
        const ex = extractTextFromHtml(html, c.url);
        c.content = ex.text.slice(0, maxChars);
        c.title = ex.title || c.title;
        ctx.emit(this.name, `已深抓候选：${(c.title || c.url).slice(0, 28)}`);
      } catch (e) {
        ctx.log.warn('深抓失败', c.url, e);
        c.content = '';
      }
    }
    const deepCount = candidates.filter((c) => c.content).length;
    ctx.emit(this.name, deepCount > 0 ? `深抓成功 ${deepCount} 个候选，开始综合` : '候选深抓均失败，将基于 snippet 综合');

    // 3) LLM 综合对比表
    const res = await this.ai.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: comparePrompt(flow.extract, classify, candidates.slice(0, (this.opts.limit ?? 5) * 3)) },
      ],
      { model: this.model, temperature: 0.3, signal: ctx.signal },
    );
    const comparison = parseJsonLoose<ComparisonOutput>(res.text, {
      entity: classify?.entity ?? '',
      category: classify?.category ?? '',
      items: [],
      recommendation: '',
    });
    comparison.at = new Date().toISOString();

    // 4) 来源可及性校验（404 打标；失败/越权静默标记 skip，不影响整体）
    if (this.opts.verifySources !== false) {
      await verifySources(comparison.items, this.opts.verifyTimeoutMs ?? 6000, ctx);
    }

    return { ...flow, comparison, model: res.model };
  }

  private buildQueries(entity: string | undefined, keywords: string[]): string[] {
    const queries: string[] = [];
    const e = entity?.trim();
    if (e) {
      queries.push(`${e} 同类产品 对比`);
      queries.push(`${e} 评测 优缺点`);
    }
    for (const kw of keywords.slice(0, 3)) {
      if (kw && kw !== e) queries.push(`${kw} 推荐 对比`);
    }
    return queries.length ? queries : ['当前页面产品 同类 对比'];
  }
}

async function fetchPageText(
  url: string,
  opts: { timeoutMs: number; signal: AbortSignal; maxBytes?: number },
): Promise<string> {  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('无效 URL');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('仅支持 http/https');

  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = AbortSignal.any ? AbortSignal.any([opts.signal, timeout]) : opts.signal;
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; ai-edge-summary/0.1)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = buf.slice(0, opts.maxBytes ?? 300_000);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** 来源可及性校验：HEAD 优先，GET 兜底；2xx 记 ok，其余记 fail，异常/越权记 skip */
async function verifySources(
  items: ComparisonItem[],
  timeoutMs: number,
  ctx: StageContext,
): Promise<void> {
  await Promise.all(
    items
      .slice(0, 12)
      .map(async (it) => {
        if (!it.url) {
          it.verified = 'skip';
          return;
        }
        try {
          const u = new URL(it.url);
          if (!/^https?:$/.test(u.protocol)) {
            it.verified = 'skip';
            return;
          }
          const res = await fetch(it.url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; ai-edge-verify)' },
          });
          if (res.ok || res.redirected) it.verified = 'ok';
          else it.verified = 'fail';
        } catch {
          try {
            const res = await fetch(it.url, {
              method: 'GET',
              redirect: 'follow',
              signal: AbortSignal.timeout(timeoutMs),
              headers: { 'user-agent': 'Mozilla/5.0 (compatible; ai-edge-verify)' },
            });
            it.verified = res.ok ? 'ok' : 'fail';
          } catch {
            it.verified = 'skip';
          }
        }
      }),
  );
  ctx.emit(
    'compare',
    `来源校验：${items.filter((i) => i.verified === 'ok').length} 可达 / ${items.filter((i) => i.verified === 'fail').length} 异常 / ${items.filter((i) => i.verified === 'skip').length} 未验证`,
  );
}