/** stage: 优缺点（结构化输出 + 校验规范化） */
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
    const raw = parseJsonLoose<ProsConsOutput>(res.text, { pros: [], cons: [] });
    const strings = (arr: unknown): string[] =>
      (Array.isArray(arr) ? arr.map((x) => String(x ?? '')) : []).slice(0, 12);
    const prosCons: ProsConsOutput = {
      pros: strings(raw?.pros).filter(Boolean),
      cons: strings(raw?.cons).filter(Boolean),
    };
    return { ...flow, prosCons };
  }
}