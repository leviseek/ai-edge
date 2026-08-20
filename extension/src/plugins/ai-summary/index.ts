/** ai-summary 插件：入口与编排（action: summarize / extract） */
import type { EdgePlugin } from '../../base/registry';
import type { PluginContext } from '../../base/context';
import type { Disposer } from '../../base/message-bus';
import type { TabMessenger } from '../../base/tab-messenger';
import { Pipeline, type Stage, type StageContext } from '../../core/pipeline/pipeline';
import type { ExtractionResult } from '../../core/extract/extractor';
import { SUMMARY_MANIFEST } from './manifest';
import { ClassifyStage } from './stages/classify';
import { SummarizeStage } from './stages/summarize';
import { FeasibilityStage } from './stages/feasibility';
import { ProsConsStage } from './stages/pros-cons';
import { CompareStage } from './stages/compare';
import type { SummaryRequest, SummaryOutput, SummaryFlow, ProgressEvent } from './types';

const PROGRESS_CHANNEL = 'plugin:ai-summary:progress';

const EMPTY_EXTRACT: ExtractionResult = { title: '', url: '', lang: 'zh', byline: '', text: '', charCount: 0 };

export function createAiSummaryPlugin(): EdgePlugin<PluginContext> {
  let disposers: Disposer[] = [];

  return {
    manifest: SUMMARY_MANIFEST,

    async activate(ctx: PluginContext) {
      // 只提取正文（供 UI 预览，不调用 LLM）
      disposers.push(
        ctx.bus.register('plugin:ai-summary', 'extract', async (req: { tabId: number }) => {
          return ctx.tabs.send(req.tabId, 'content:main', 'extract', {});
        }),
      );

      // 主 action：运行增强总结流水线
      disposers.push(
        ctx.bus.register('plugin:ai-summary', 'summarize', async (req: SummaryRequest) => {
          return runSummarize(ctx, req);
        }),
      );

      ctx.log.info('ai-summary 插件已激活');
    },

    async deactivate() {
      disposers.forEach((d) => d());
      disposers = [];
    },
  };
}

/** stage 0：从 content script 提取正文 */
class ExtractStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'extract';

  constructor(
    private readonly tabs: TabMessenger,
    private readonly tabId: number,
  ) {}

  async run(flow: SummaryFlow, ctx: StageContext): Promise<SummaryFlow> {
    const extract = await this.tabs.send<{ tabId: number }, ExtractionResult>(this.tabId, 'content:main', 'extract', {
      tabId: this.tabId,
    });
    if (!extract?.text?.trim()) throw new Error('页面正文为空（可能是图片站/空白页）');
    const url = extract.url || flow.extract.url;
    const title = extract.title || flow.extract.title;
    ctx.emit(this.name, `提取到正文 ${extract.charCount} 字符（页面：${title}）`, 1);
    return { ...flow, extract: { ...extract, text: extract.text, url, title } };
  }
}

async function runSummarize(ctx: PluginContext, req: SummaryRequest): Promise<SummaryOutput> {
  const settings = ctx.settings.get();
  const provider = ctx.ai.get(settings.ai.activeProviderId);
  const trace = ctx.log.child(`run:${req.tabId}`);
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const controller = new AbortController();
  const t0 = Date.now();

  const stageCtx: StageContext = {
    log: trace,
    signal: controller.signal,
    step: 0,
    steps: 1,
    emit: (stage, message, progress) => {
      const ev: ProgressEvent = { runId, stage, message, progress, step: stageCtx.step, steps: stageCtx.steps };
      ctx.bus.postEvent(PROGRESS_CHANNEL, ev);
    },
  };

  // 固定骨架：提取 → 分类 → 核心摘要（长文自动分段+合并）；增强模式按需拼接
  const flow0: SummaryFlow = { extract: EMPTY_EXTRACT, model: '' };
  const stages: Stage[] = [
    new ExtractStage(ctx.tabs, req.tabId),
    new ClassifyStage(provider),
    new SummarizeStage(provider),
  ];
  const modes = new Set(req.modes);
  if (modes.has('feasibility')) stages.push(new FeasibilityStage(provider));
  if (modes.has('pros-cons')) stages.push(new ProsConsStage(provider));
  if (modes.has('compare')) {
    stages.push(new CompareStage(provider, ctx.search, settings.search.activeServiceId, { limit: 5, maxQueries: 2 }));
  }

  trace.info(`流水线 stages=${stages.map((s) => s.name).join(' > ')}`);
  const flow = (await new Pipeline(stages).run(flow0, stageCtx)) as SummaryFlow;

  const durationMs = Date.now() - t0;
  const out: SummaryOutput = {
    meta: {
      providerId: provider.id,
      providerLabel: provider.label,
      model: flow.model || 'unknown',
      durationMs,
      url: flow.extract.url,
      title: flow.extract.title,
    },
    pageType: flow.classify?.pageType ?? '',
    executiveSummary: flow.core?.executiveSummary ?? '',
    keyPoints: flow.core?.keyPoints ?? [],
    verdict: flow.core?.verdict ?? '',
    feasibility: flow.feasibility,
    prosCons: flow.prosCons,
    comparison: flow.comparison,
  };

  stageCtx.step = stageCtx.steps;
  stageCtx.emit('done', `完成（${durationMs}ms，模型 ${out.meta.model}）`, 1);
  return out;
}