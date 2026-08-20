/** stage: 可行性调研 */
import type { Stage, StageContext } from '../../../core/pipeline/pipeline';
import type { AIProvider } from '../../../core/ai/provider';
import { parseJsonLoose } from '../../../shared/protocol';
import { SYSTEM_PROMPT, feasibilityPrompt } from '../prompts';
import type { SummaryFlow, FeasibilityOutput } from '../types';

export class FeasibilityStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'feasibility';

  constructor(
    private readonly ai: AIProvider,
    private readonly model?: string,
  ) {}

  async run(flow: SummaryFlow, ctx: StageContext): Promise<SummaryFlow> {
    const res = await this.ai.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: feasibilityPrompt(flow.extract) },
      ],
      { model: this.model, temperature: 0.3, signal: ctx.signal },
    );
    const feasibility = parseJsonLoose<FeasibilityOutput>(res.text, {
      verdict: res.text.slice(0, 300),
      aspects: [],
      effortEstimate: '',
    });
    return { ...flow, feasibility };
  }
}