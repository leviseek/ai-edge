/** ai-summary 插件：入口与编排（action: summarize / extract） */
import type { EdgePlugin } from '../../base/registry';
import type { PluginContext } from '../../base/context';
import type { Disposer } from '../../base/message-bus';
import { Pipeline, type Stage, type StageContext } from '../../core/pipeline/pipeline';
import { chunkText } from '../../core/extract/chunker';
import type { ExtractionResult } from '../../core/extract/extractor';
import type { EdgeError } from '../../base/errors';
import { SUMMARY_MANIFEST } from './manifest';
import { ClassifyStage } from './stages/classify';
import { SummarizeStage } from './stages/summarize';
import { FeasibilityStage } from './stages/feasibility';
import { ProsConsStage } from './stages/pros-cons';
import { CompareStage } from './stages/compare';
import type { SummaryRequest, SummaryOutput, SummaryFlow, ProgressEvent } from './types';

const PROGRESS_CHANNEL = 'plugin:ai-summary:progress';

export function createAiSummaryPlugin(): EdgePlugin<PluginContext> {
  let disposers: Disposer[] = [];

  return {
    manifest: SUMMARY_MANIFEST,

    async activate(ctx: PluginContext) {
      // 只提取正文（供 UI 预览，不调用 LLM）
      disposers.push(
        ctx.bus.register('plugin:ai-summary', 'extract', async (req: { tabId: number }, sender) => {
          return ctx.tabs.send(req.tabId, 'content:main', 'extract', {});
        }),
      );

      // 主 action：运行增强总结流水线
      disposers.push(
        ctx.bus.register('plugin:ai-summary', 'summarize', async (req: SummaryRequest, sender) => {
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

async function runSummarize(ctx: PluginContext, req: SummaryRequest): Promise<SummaryOutput> {
  const settings = ctx.settings.get();
  const provider = ctx.ai.get(settings.ai.activeProviderId);
  const trace = ctx.log.child(`run:${req.tabId}`);
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const controller = new AbortController();
  const t0 = Date.now();

  const emit = (stage: string, message: string, progress?: number): void => {
    const ev: ProgressEvent = { runId, stage, message, progress };
    ctx.bus.postEvent(PROGRESS_CHANNEL, ev);
  };

  const stageCtx: StageContext = {
    log: trace,
    signal: controller.signal,
    emit,
  };

  // 1) 提取正文（content script）
  emit('extract', '正在提取当前页面正文…');
  let extract: ExtractionResult;
  try {
    extract = await ctx.tabs.send<{ tabId: number }, ExtractionResult>(req.tabId, 'content:main', 'extract', {
      tabId: req.tabId,
    });
  } catch (e) {
    throw e; // 结构化错误已由 TabMessenger 抛出
  }
  if (!extract.text.trim()) {
    throw new Error('页面正文为空（可能是图片站/空白页）');
  }
  const sample = chunkText(extract.text, 8000, 400)[0]?.text ?? extract.text;
  emit('extract', `提取到正文 ${extract.charCount} 字符（页面：${extract.title}）`, 1);

  // 2) 组装 stages（按模式）
  const flow0: SummaryFlow = { extract: { ...extract, text: sample }, model: '' };
  const stages: Stage[] = [new ClassifyStage(provider), new SummarizeStage(provider)];
  const modes = new Set(req.modes);
  if (modes.has('feasibility')) stages.push(new FeasibilityStage(provider));
  if (modes.has('pros-cons')) stages.push(new ProsConsStage(provider));
  if (modes.has('compare')) {
    const searchServiceId = settings.search.activeServiceId;
    stages.push(new CompareStage(provider, ctx.search, searchServiceId, { limit: 5, maxQueries: 2 }));
  }

  // 3) 执行
  trace.info(`开始流水线 modes=${[...modes].join(',')}`);
  const flow = (await new Pipeline(stages).run(flow0, stageCtx)) as SummaryFlow;

  // 4) 组装结果
  const durationMs = Date.now() - t0;
  const out: SummaryOutput = {
    meta: {
      providerId: provider.id,
      providerLabel: provider.label,
      model: flow.model || 'unknown',
      durationMs,
      url: extract.url,
      title: extract.title,
    },
    pageType: flow.classify?.pageType ?? '',
    executiveSummary: flow.core?.executiveSummary ?? '',
    keyPoints: flow.core?.keyPoints ?? [],
    verdict: flow.core?.verdict ?? '',
    feasibility: flow.feasibility,
    prosCons: flow.prosCons,
    comparison: flow.comparison,
  };
  emit('done', `完成（${durationMs}ms，模型 ${out.meta.model}）`, 1);
  return out;
}

export type { EdgeError };