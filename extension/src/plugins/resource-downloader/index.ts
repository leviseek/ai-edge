/** 资源下载器：action——list / ai-filter / download */
import type { EdgePlugin } from '../../base/registry';
import type { PluginContext } from '../../base/context';
import type { Disposer } from '../../base/message-bus';
import { buildProviderChain } from '../../core/ai/resolve-chain';
import { parseJsonLoose } from '../../shared/protocol';
import { RESOURCE_MANIFEST } from './manifest';
import { classifyResource } from './classify';
import type { ResourceInfo, RawResource, DownloadStatus, AiFilterResult } from './types';

const FILTER_SYSTEM =
  '你是资源筛选器。仅从给出的资源列表中挑出“符合用户需求”的条目，不要编造列表中不存在的 URL。输出严格 JSON：{"selected": ["确切匹配的 url"], "reason": "80字内理由"}';

function basename(url: string): string {
  const seg = url.split(/[?#]/)[0].split('/').pop() || 'file';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

async function listResources(ctx: PluginContext, tabId: number): Promise<ResourceInfo[]> {
  const raw = await ctx.tabs.send<{ tabId: number }, RawResource[]>(tabId, 'content:main', 'resources', { tabId });
  return raw
    .map((r) => ({ ...r, category: classifyResource(r) }))
    .sort((a, b) => b.size - a.size);
}

export function createResourceDownloaderPlugin(): EdgePlugin<PluginContext> {
  let disposers: Disposer[] = [];

  return {
    manifest: RESOURCE_MANIFEST,

    async activate(ctx: PluginContext) {
      // 采集当前页资源（content 侧 Performance-API）
      disposers.push(
        ctx.bus.register('plugin:resource-downloader', 'list', async (req: { tabId: number }) => {
          return listResources(ctx, req.tabId);
        }),
      );

      // AI 语义筛选
      disposers.push(
        ctx.bus.register('plugin:resource-downloader', 'ai-filter', async (req: { tabId: number; query: string }) => {
          const items = await listResources(ctx, req.tabId);
          const { provider } = buildProviderChain(ctx.ai, ctx.settings.get());
          const listStr = items
            .slice(0, 200)
            .map((r, i) => `${i}. [${r.category}] ${r.name}（${r.size}B）${r.type} ${r.url}`)
            .join('\n');
          const res = await provider.chat([
            { role: 'system', content: FILTER_SYSTEM },
            { role: 'user', content: `用户需求：${req.query}\n资源列表：\n${listStr}` },
          ]);
          const parsed = parseJsonLoose<{ selected?: unknown; reason?: unknown }>(res.text, {});
          const known = new Set(items.map((r) => r.url));
          const selected = (Array.isArray(parsed.selected) ? parsed.selected : [])
            .map((u) => String(u))
            .filter((u) => known.has(u))
            .slice(0, 100);
          const result: AiFilterResult = {
            selected,
            reason: String(parsed.reason ?? '').slice(0, 120),
            total: items.length,
          };
          ctx.log.info(`AI 筛选命中 ${selected.length}/${items.length} 项`);
          return result;
        }),
      );

      // 批量下载（downloads API）
      disposers.push(
        ctx.bus.register('plugin:resource-downloader', 'download', async (req: { urls: string[] }) => {
          const statuses: DownloadStatus[] = [];
          for (const url of req.urls.slice(0, 100)) {
            try {
              const downloadId = await chrome.downloads.download({ url, conflictAction: 'uniquify', saveAs: false });
              statuses.push({ url, name: basename(url), ok: true, downloadId });
            } catch (e) {
              statuses.push({ url, name: basename(url), ok: false, message: e instanceof Error ? e.message : String(e) });
            }
          }
          return {
            statuses,
            okCount: statuses.filter((s) => s.ok).length,
            failCount: statuses.filter((s) => !s.ok).length,
          };
        }),
      );

      ctx.log.info('resource-downloader 插件已激活');
    },

    async deactivate() {
      disposers.forEach((d) => d());
      disposers = [];
    },
  };
}