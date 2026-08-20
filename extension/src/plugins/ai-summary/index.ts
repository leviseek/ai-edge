/** ai-summary 插件：入口与注册（action: summarize / extract / 流式 Port） */
import type { EdgePlugin } from '../../base/registry';
import type { PluginContext } from '../../base/context';
import type { Disposer } from '../../base/message-bus';
import { SUMMARY_MANIFEST } from './manifest';
import { runSummarize } from './run';
import { setupStreamHandler } from './stream';
import type { SummaryRequest } from './types';

export function createAiSummaryPlugin(): EdgePlugin<PluginContext> {
  let disposers: Disposer[] = [];

  return {
    manifest: SUMMARY_MANIFEST,

    async activate(ctx: PluginContext) {
      // 仅提取正文（供 UI 预览，不调用 LLM）
      disposers.push(
        ctx.bus.register('plugin:ai-summary', 'extract', async (req: { tabId: number }) => {
          return ctx.tabs.send(req.tabId, 'content:main', 'extract', {});
        }),
      );

      // RPC 路径：返回完整结果（非流式）
      disposers.push(
        ctx.bus.register('plugin:ai-summary', 'summarize', async (req: SummaryRequest) => {
          return runSummarize(ctx, req);
        }),
      );

      // 流式 Port 路径（Side Panel 实时 token 渲染）
      disposers.push(setupStreamHandler(ctx));

      ctx.log.info('ai-summary 插件已激活（RPC + 流式 Port）');
    },

    async deactivate() {
      disposers.forEach((d) => d());
      disposers = [];
    },
  };
}