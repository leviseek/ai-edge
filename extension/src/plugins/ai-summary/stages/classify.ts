/** stage: 页面分类 / 实体识别（结构化 JSON） */
import type { Stage, StageContext } from '../../../core/pipeline/pipeline';
import type { AIProvider } from '../../../core/ai/provider';
import type { ExtractionResult } from '../../../core/extract/extractor';
import { parseJsonLoose } from '../../../shared/protocol';
import { EdgeError, ErrorCodes } from '../../../base/errors';
import { SYSTEM_PROMPT, classifyPrompt } from '../prompts';
import type { ClassifyOutput, SummaryFlow } from '../types';

export class ClassifyStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'classify';

  constructor(
    private readonly ai: AIProvider,
    private readonly model?: string,
  ) {}

  async run(flow: SummaryFlow, ctx: StageContext): Promise<SummaryFlow> {
    const res = await this.ai.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: classifyPrompt(flow.extract) },
      ],
      { model: this.model, temperature: 0.2, signal: ctx.signal },
    );
    const parsed = parseJsonLoose<ClassifyOutput>(res.text, {
      pageType: '其他',
      entity: '',
      category: '',
      keywords: [],
    });
    if (!parsed.pageType) throw new EdgeError(ErrorCodes.LLM_PARSE, '分类阶段输出解析失败');
    return { ...flow, classify: parsed, model: res.model };
  }
}