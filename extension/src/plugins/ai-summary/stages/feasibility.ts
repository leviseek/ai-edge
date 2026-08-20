/** stage: 可行性调研（结构化输出 + 校验规范化） */
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
    const raw = parseJsonLoose<FeasibilityOutput>(res.text, {
      verdict: res.text.slice(0, 300),
      aspects: [],
      effortEstimate: '',
    });
    const feasibility: FeasibilityOutput = {
      verdict: String(raw?.verdict ?? '').trim().slice(0, 400) || res.text.slice(0, 120),
      aspects: (Array.isArray(raw?.aspects) ? raw.aspects : [])
        .slice(0, 8)
        .map((a) => ({
          name: String(a?.name ?? '').slice(0, 40),
          assessment: String(a?.assessment ?? '').slice(0, 400),
          risk: String(a?.risk ?? '').slice(0, 240),
        }))
        .filter((a) => a.name || a.assessment),
      effortEstimate: String(raw?.effortEstimate ?? '').slice(0, 240),
    };
    return { ...flow, feasibility };
  }
}