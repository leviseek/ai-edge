/** stage: 同品类横向比较（网络搜索召回 → LLM 综合） */
import type { Stage, StageContext } from '../../../core/pipeline/pipeline';
import type { AIProvider } from '../../../core/ai/provider';
import type { SearchServiceRegistry } from '../../../core/search/registry';
import type { SearchResult } from '../../../core/search/service';
import { EdgeError, ErrorCodes } from '../../../base/errors';
import { parseJsonLoose } from '../../../shared/protocol';
import { SYSTEM_PROMPT, comparePrompt } from '../prompts';
import type { SummaryFlow, ComparisonOutput } from '../types';

export interface CompareOptions {
  /** 每个查询召回条数 */
  limit?: number;
  /** 最多执行几次搜索查询 */
  maxQueries?: number;
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
    ctx.emit(this.name, `搜索召回 ${results.length} 条候选`);
    if (!results.length) ctx.log.warn('无搜索结果，compare 将基于页面自身分析');

    const res = await this.ai.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: comparePrompt(flow.extract, classify, results.slice(0, (this.opts.limit ?? 5) * 3)) },
      ],
      { model: this.model, temperature: 0.3, signal: ctx.signal },
    );
    const comparison = parseJsonLoose<ComparisonOutput>(res.text, {
      entity: classify?.entity ?? '',
      category: classify?.category ?? '',
      items: [],
      recommendation: '',
    });
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