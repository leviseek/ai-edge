/** ai-summary 编排：RPC（summarize）与 Port 流式共用同一流水线组装 */
import type { PluginContext } from '../../base/context';
import { Pipeline, type Stage, type StageContext } from '../../core/pipeline/pipeline';
import { createProviderChain, type FallbackChainProvider } from '../../core/ai/fallback';
import type { AIProvider } from '../../core/ai/provider';
import type { ExtractionResult } from '../../core/extract/extractor';
import { EdgeError, ErrorCodes, toErrorCode } from '../../base/errors';
import type { Logger } from '../../base/logger';
import { ClassifyStage } from './stages/classify';
import { SummarizeStage } from './stages/summarize';
import { FeasibilityStage } from './stages/feasibility';
import { ProsConsStage } from './stages/pros-cons';
import { CompareStage } from './stages/compare';
import type { SummaryRequest, SummaryOutput, SummaryFlow, SummaryMeta, ProgressEvent } from './types';

export const PROGRESS_CHANNEL = 'plugin:ai-summary:progress';

export interface RunOptions {
  tokenSink?: (delta: string) => void;
}

export interface StreamIO {
  send(msg: unknown): void;
}

const EMPTY_EXTRACT: ExtractionResult = { title: '', url: '', lang: 'zh', byline: '', text: '', charCount: 0 };

/** stage 0：从 content script 提取正文 */
class ExtractStage implements Stage<SummaryFlow, SummaryFlow> {
  readonly name = 'extract';

  constructor(
    private readonly tabs: PluginContext['tabs'],
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

/** 主提供商 + fallbackChain → 有序提供商链（单提供商时原样） */
function buildProvider(ctx: PluginContext): { provider: AIProvider; chain: FallbackChainProvider | null } {
  const settings = ctx.settings.get();
  const ids = [settings.ai.activeProviderId, ...settings.ai.fallbackChain];
  const seen = new Set<string>();
  const providers: AIProvider[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      providers.push(ctx.ai.get(id));
    } catch (e) {
      ctx.log.warn('提供商配置不可用，跳过', id, e);
    }
  }
  if (providers.length === 0) {
    throw new EdgeError(ErrorCodes.NOT_FOUND, '未配置任何可用的 AI 提供商（请到设置页填写）');
  }
  return createProviderChain(providers);
}

function buildStages(
  ctx: PluginContext,
  req: SummaryRequest,
  provider: AIProvider,
  opts: RunOptions,
): { flow0: SummaryFlow; stages: Stage[] } {
  const settings = ctx.settings.get();
  const flow0: SummaryFlow = { extract: EMPTY_EXTRACT, model: '' };
  const stages: Stage[] = [
    new ExtractStage(ctx.tabs, req.tabId),
    new ClassifyStage(provider),
    new SummarizeStage(provider, undefined, { tokenSink: opts.tokenSink }),
  ];
  const modes = new Set(req.modes);
  if (modes.has('feasibility')) stages.push(new FeasibilityStage(provider));
  if (modes.has('pros-cons')) stages.push(new ProsConsStage(provider));
  if (modes.has('compare')) {
    stages.push(
      new CompareStage(provider, ctx.search, settings.search.activeServiceId, {
        limit: 5,
        maxQueries: 2,
        deepFetch: 3,
        deepFetchMaxChars: 6000,
      }),
    );
  }
  return { flow0, stages };
}

function makeStageCtx(
  runId: string,
  log: Logger,
  controller: AbortController,
  post: (ev: ProgressEvent) => void,
): StageContext {
  const ctx: StageContext = {
    log,
    signal: controller.signal,
    step: 0,
    steps: 1,
    emit: () => {},
  };
  // 延迟绑定：emit 需读取 ctx 自身的 step/steps（Pipeline 运行期更新）
  ctx.emit = (stage, message, progress) => {
    post({ runId, stage, message, progress, step: ctx.step, steps: ctx.steps });
  };
  return ctx;
}

function assemble(
  flow: SummaryFlow,
  provider: AIProvider,
  chain: FallbackChainProvider | null,
  durationMs: number,
): SummaryOutput {
  const lastUsed = chain?.lastUsed ?? null;
  const meta: SummaryMeta = {
    providerId: lastUsed?.id ?? provider.id,
    providerLabel: lastUsed?.label ?? provider.label,
    model: flow.model || (lastUsed?.id ?? provider.id),
    durationMs,
    url: flow.extract.url,
    title: flow.extract.title,
    usedFallback: !!chain && lastUsed !== null && lastUsed.id !== chain.id,
    fallbackChain: chain ? chain.usedIds : undefined,
  };
  return {
    meta,
    pageType: flow.classify?.pageType ?? '',
    executiveSummary: flow.core?.executiveSummary ?? '',
    keyPoints: flow.core?.keyPoints ?? [],
    verdict: flow.core?.verdict ?? '',
    feasibility: flow.feasibility,
    prosCons: flow.prosCons,
    comparison: flow.comparison,
  };
}

/** RPC 路径（非流式）：返回完整结果 */
export async function runSummarize(ctx: PluginContext, req: SummaryRequest): Promise<SummaryOutput> {
  const { provider, chain } = buildProvider(ctx);
  const trace = ctx.log.child(`run:${req.tabId}`);
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const controller = new AbortController();
  const stageCtx = makeStageCtx(runId, trace, controller, (ev) => ctx.bus.postEvent(PROGRESS_CHANNEL, ev));

  const { flow0, stages } = buildStages(ctx, req, provider, {});
  trace.info(`流水线 stages=${stages.map((s) => s.name).join(' > ')}`);
  const t0 = Date.now();
  const flow = (await new Pipeline(stages).run(flow0, stageCtx)) as SummaryFlow;
  const out = assemble(flow, provider, chain, Date.now() - t0);

  stageCtx.step = stageCtx.steps;
  stageCtx.emit('done', `完成（${out.meta.durationMs}ms，模型 ${out.meta.model}）`, 1);
  return out;
}

/** Port 流式路径：token / progress / result / error 实时推送 */
export async function runStreaming(
  ctx: PluginContext,
  req: SummaryRequest,
  io: StreamIO,
  controller: AbortController,
): Promise<void> {
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const trace = ctx.log.child(`stream:${req.tabId}`);
  const { provider, chain } = buildProvider(ctx);

  const post = (ev: ProgressEvent) => io.send({ type: 'progress', ev });
  const stageCtx = makeStageCtx(runId, trace, controller, post);
  const { flow0, stages } = buildStages(ctx, req, provider, {
    tokenSink: (delta) => io.send({ type: 'token', runId, stage: 'summarize', delta }),
  });
  trace.info(`streaming stages=${stages.map((s) => s.name).join(' > ')}`);
  const t0 = Date.now();

  try {
    const flow = (await new Pipeline(stages).run(flow0, stageCtx)) as SummaryFlow;
    const out = assemble(flow, provider, chain, Date.now() - t0);
    stageCtx.step = stageCtx.steps;
    stageCtx.emit('done', `完成（${out.meta.durationMs}ms，模型 ${out.meta.model}）`, 1);
    io.send({ type: 'result', result: out });
  } catch (e) {
    io.send({ type: 'error', code: toErrorCode(e), message: e instanceof Error ? e.message : String(e) });
  }
}