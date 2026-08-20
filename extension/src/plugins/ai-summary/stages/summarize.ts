/** stage: 核心摘要 */
import type { Stage, StageContext } from '../../../core/pipeline/pipeline';
import type { AIProvider } from '../../../core/ai/provider';
import { parseJsonLoose } from '../../../shared/protocol';
import { EdgeError, ErrorCodes } from '../../../base/errors';
import { SYSTEM_PROMPT, summarizePrompt } from '../prompts';
import type { SummaryFlow, SummaryCore } from '../types';

export class SummarizeStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'summarize';

  constructor(
    private readonly ai: AIProvider,
    private readonly model?: string,
  ) {}

  async run(flow: SummaryFlow, ctx: StageContext): Promise<SummaryFlow> {
    const res = await this.ai.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: summarizePrompt(flow.extract, flow.classify) },
      ],
      { model: this.model, temperature: 0.4, signal: ctx.signal },
    );
    const core = parseJsonLoose<SummaryCore>(res.text, {
      executiveSummary: res.text.slice(0, 500),
      keyPoints: [],
      verdict: '',
    });
    if (!core.executiveSummary) throw new EdgeError(ErrorCodes.LLM_PARSE, '摘要阶段输出解析失败');
    return { ...flow, core, model: res.model };
  }
}