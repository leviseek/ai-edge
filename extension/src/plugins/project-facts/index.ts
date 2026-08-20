/** 项目事实锚（去幻觉）：action——facts / import / brief / scan */
import type { EdgePlugin } from '../../base/registry';
import type { PluginContext } from '../../base/context';
import type { Disposer } from '../../base/message-bus';
import { PROJECT_FACTS_MANIFEST } from './manifest';
import {
  loadFacts,
  saveFacts,
  normalizeEntry,
  parseImport,
  buildBrief,
  detectHallucinations,
} from './kb';
import type { FactEntry, ScanMessage, HallucinationItem } from './types';

export function createProjectFactsPlugin(): EdgePlugin<PluginContext> {
  let disposers: Disposer[] = [];

  return {
    manifest: PROJECT_FACTS_MANIFEST,

    async activate(ctx: PluginContext) {
      // 读取全部事实
      disposers.push(
        ctx.bus.register('plugin:project-facts', 'facts', async () => {
          const list = await loadFacts();
          return { list, count: list.length, kinds: ['已实现', '决策', '架构', '待办', '限制'] };
        }),
      );

      // 整表保存（面板增删改后回写）
      disposers.push(
        ctx.bus.register('plugin:project-facts', 'facts-save', async (req: { list: Partial<FactEntry>[] }) => {
          const saved = (req.list ?? [])
            .map((it) => normalizeEntry(it))
            .filter(Boolean) as FactEntry[];
          await saveFacts(saved);
          return { list: saved, count: saved.length };
        }),
      );

      // 导入（JSON / Markdown）
      disposers.push(
        ctx.bus.register('plugin:project-facts', 'import', async (req: { text: string }) => {
          const parsed = parseImport(req.text ?? '');
          const existing = await loadFacts();
          const next = [...parsed, ...existing];
          await saveFacts(next);
          return { added: parsed.length, total: next.length };
        }),
      );

      // 生成会话锚定 Brief
      disposers.push(
        ctx.bus.register('plugin:project-facts', 'brief', async () => {
          const facts = await loadFacts();
          return { brief: buildBrief(facts), count: facts.length };
        }),
      );

      // 扫描当前 LLM 页面会话 → 疑似幻觉清单
      disposers.push(
        ctx.bus.register('plugin:project-facts', 'scan', async (req: { tabId: number }) => {
          const scan = await ctx.tabs.send<{ tabId: number }, { host: string; supported: boolean; messages: ScanMessage[] }>(
            req.tabId,
            'content:main',
            'grounding-scan',
            { tabId: req.tabId },
          );
          const facts = await loadFacts();
          const flagged = detectHallucinations(facts, scan.messages ?? []);
          return { ...scan, factsCount: facts.length, flagged };
        }),
      );

      ctx.log.info('project-facts 插件已激活（项目事实锚）');
    },

    async deactivate() {
      disposers.forEach((d) => d());
      disposers = [];
    },
  };
}

export type { HallucinationItem };