/** stage: 优缺点 */
import type { Stage, StageContext } from '../../../core/pipeline/pipeline';
import type { AIProvider } from '../../../core/ai/provider';
import { parseJsonLoose } from '../../../shared/protocol';
import { SYSTEM_PROMPT, prosConsPrompt } from '../prompts';
import type { SummaryFlow, ProsConsOutput } from '../types';

export class ProsConsStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'pros-cons';

  constructor(
    private readonly ai: AIProvider,
    private readonly model?: string,
  ) {}

  async run(flow: SummaryFlow, ctx: StageContext): Promise<SummaryFlow> {
    const res = await this.ai.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prosConsPrompt(flow.extract) },
      ],
      { model: this.model, temperature: 0.3, signal: ctx.signal },
    );
    const prosCons = parseJsonLoose<ProsConsOutput>(res.text, { pros: [], cons: [] });
    return { ...flow, prosCons };
  }
}