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
  mergeFacts,
} from './kb';
import { EdgeError, ErrorCodes } from '../../base/errors';
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

      // 从本地项目事实服务同步（facts-scan 产生的 facts.json）
      disposers.push(
        ctx.bus.register('plugin:project-facts', 'sync-local', async (req: { url?: string }) => {
          const url = String(req.url || ctx.settings.get().ui.localFactsUrl || 'http://127.0.0.1:8787/facts.json');
          let res: Response;
          try {
            res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          } catch (e) {
            throw new EdgeError(ErrorCodes.PROVIDER, `无法连接本地事实服务（${url}）：${e instanceof Error ? e.message : String(e)}`);
          }
          if (!res.ok) throw new EdgeError(ErrorCodes.PROVIDER, `本地事实服务返回 HTTP ${res.status}`);
          const data = (await res.json()) as { project?: string; facts?: Partial<FactEntry>[] };
          const incoming = (data.facts ?? [])
            .map((it) => normalizeEntry(it))
            .filter(Boolean) as FactEntry[];
          const existing = await loadFacts();
          const merged = mergeFacts(existing, incoming);
          await saveFacts(merged.list);
          ctx.log.info(`本地同步完成：+${merged.added} / 更新 ${merged.updated}`);
          return { url, project: data.project ?? '', added: merged.added, updated: merged.updated, total: merged.list.length };
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