/** stage: 核心摘要（长文自动分段摘要 + 合并） */
import type { Stage, StageContext } from '../../../core/pipeline/pipeline';
import type { AIProvider } from '../../../core/ai/provider';
import { chunkText } from '../../../core/extract/chunker';
import { parseJsonLoose } from '../../../shared/protocol';
import { EdgeError, ErrorCodes } from '../../../base/errors';
import {
  SYSTEM_PROMPT,
  summarizePrompt,
  perChunkSummaryPrompt,
  mergeSummaryPrompt,
} from '../prompts';
import type { SummaryFlow, SummaryCore } from '../types';

export interface SummarizeOptions {
  chunkMaxChars?: number;
  chunkOverlap?: number;
  maxChunks?: number;
}

export const SUMMARIZE_DEFAULTS: Required<SummarizeOptions> = {
  chunkMaxChars: 8000,
  chunkOverlap: 400,
  maxChunks: 24,
};

const EMPTY_CORE: SummaryCore = { executiveSummary: '', keyPoints: [], verdict: '' };

export class SummarizeStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'summarize';
  private readonly opts: Required<SummarizeOptions>;

  constructor(
    private readonly ai: AIProvider,
    private readonly model?: string,
    opts: SummarizeOptions = {},
  ) {
    this.opts = { ...SUMMARIZE_DEFAULTS, ...opts };
  }

  async run(flow: SummaryFlow, ctx: StageContext): Promise<SummaryFlow> {
    const chunks = chunkText(flow.extract.text, this.opts.chunkMaxChars, this.opts.chunkOverlap);
    let truncated = false;
    if (chunks.length > this.opts.maxChunks) {
      truncated = true;
      ctx.emit(this.name, `正文过长（${flow.extract.text.length} 字符），仅总结前 ${this.opts.maxChunks}/${chunks.length} 段`);
    }
    const used = chunks.slice(0, this.opts.maxChunks);
    const trace = ctx.log.child(this.name);

    let core: SummaryCore | undefined;
    let model = flow.model;

    // 单段：一次成形
    if (used.length <= 1) {
      const text = used[0]?.text ?? flow.extract.text;
      const res = await this.ai.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: summarizePrompt({ ...flow.extract, text }, flow.classify) },
        ],
        { model: this.model, temperature: 0.4, signal: ctx.signal },
      );
      model = res.model;
      core = parseJsonLoose<SummaryCore>(res.text, { ...EMPTY_CORE, executiveSummary: res.text.slice(0, 500) });
    } else {
      // 多段：逐段摘要 → 合并
      ctx.emit(this.name, `全文分 ${used.length} 段，开始逐段摘要`);
      const parts: string[] = [];
      for (const c of used) {
        const res = await this.ai.chat(
          [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: perChunkSummaryPrompt(c.text, c.index, used.length) },
          ],
          { model: this.model, temperature: 0.3, signal: ctx.signal },
        );
        const parsed = parseJsonLoose<{ summary?: string }>(res.text, {});
        const part = (parsed.summary ?? '').trim() || res.text.slice(0, 300).trim();
        parts.push(part);
        model = res.model;
        ctx.emit(this.name, `分段 ${c.index + 1}/${used.length} 摘要完成`, (c.index + 1) / used.length);
      }
      trace.info(`分段摘要完成，共 ${parts.length} 段，开始合并`);
      ctx.emit(this.name, '合并分段摘要，生成最终总结');
      const res = await this.ai.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: mergeSummaryPrompt(parts, flow.classify, {
              title: flow.extract.title,
              url: flow.extract.url,
              truncated,
            }),
          },
        ],
        { model: this.model, temperature: 0.4, signal: ctx.signal },
      );
      model = res.model;
      core = parseJsonLoose<SummaryCore>(res.text, { ...EMPTY_CORE, executiveSummary: res.text.slice(0, 500) });
    }

    if (!core || !core.executiveSummary.trim()) {
      throw new EdgeError(ErrorCodes.LLM_PARSE, '摘要阶段输出解析失败（未得到可用摘要）');
    }
    return { ...flow, core, model };
  }
}