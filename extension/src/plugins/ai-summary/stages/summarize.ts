/** stage: 核心摘要（长文自动分段摘要 + 合并；支持流式输出 token） */
import type { Stage, StageContext } from '../../../core/pipeline/pipeline';
import type { AIProvider, ChatMessage, ChatOptions } from '../../../core/ai/provider';
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
  /** 置入后最终摘要走 chatStream，逐 token 回调（实时渲染） */
  tokenSink?: (delta: string) => void;
}

export const SUMMARIZE_DEFAULTS: Required<Omit<SummarizeOptions, 'tokenSink'>> = {
  chunkMaxChars: 8000,
  chunkOverlap: 400,
  maxChunks: 24,
};

const EMPTY_CORE: SummaryCore = { executiveSummary: '', keyPoints: [], verdict: '' };

function normalizeCore(raw: SummaryCore, fallbackText: string): SummaryCore {
  const executiveSummary = String(raw?.executiveSummary ?? '').trim() || fallbackText.slice(0, 500).trim();
  return {
    executiveSummary,
    keyPoints: (Array.isArray(raw?.keyPoints) ? raw.keyPoints : []).map((k) => String(k ?? '')).filter(Boolean).slice(0, 8),
    verdict: String(raw?.verdict ?? '').trim().slice(0, 300),
  };
}

export class SummarizeStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'summarize';
  private readonly opts: Required<Omit<SummarizeOptions, 'tokenSink'>> & { tokenSink?: (delta: string) => void };

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

    // 单段：一次成形（可流式）
    if (used.length <= 1) {
      const text = used[0]?.text ?? flow.extract.text;
      const out = await this.chatMaybeStream(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: summarizePrompt({ ...flow.extract, text }, flow.classify) },
        ],
        { model: this.model, temperature: 0.4, signal: ctx.signal },
        ctx,
      );
      model = out.model || model;
      core = normalizeCore(parseJsonLoose<SummaryCore>(out.text, EMPTY_CORE), out.text);
    } else {
      // 多段：逐段摘要（非流式）→ 合并（流式，若配置）
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
      ctx.emit(this.name, '合并分段摘要，生成最终总结（可能流式输出）');
      const out = await this.chatMaybeStream(
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
        ctx,
      );
      model = out.model || model;
      core = normalizeCore(parseJsonLoose<SummaryCore>(out.text, EMPTY_CORE), out.text);
    }

    if (!core || !core.executiveSummary.trim()) {
      throw new EdgeError(ErrorCodes.LLM_PARSE, '摘要阶段输出解析失败（未得到可用摘要）');
    }
    return { ...flow, core, model };
  }

  /** 配置了 tokenSink 则用 chatStream 逐 token 回调并累积全文 */
  private async chatMaybeStream(
    messages: ChatMessage[],
    opts: ChatOptions,
    ctx: StageContext,
  ): Promise<{ text: string; model: string }> {
    if (!this.opts.tokenSink) {
      const r = await this.ai.chat(messages, opts);
      return { text: r.text, model: r.model };
    }
    ctx.emit(this.name, '开始生成…');
    let text = '';
    let model = '';
    let started = false;
    for await (const c of this.ai.chatStream(messages, opts)) {
      if (c.delta) {
        text += c.delta;
        if (!started) {
          started = true;
          ctx.emit(this.name, '正在流式生成摘要…');
        }
        this.opts.tokenSink(c.delta);
      }
      if (c.model) model = c.model;
      if (c.done) break;
    }
    return { text, model };
  }
}