/** 背景服务（SW）：装配基座、注册插件、接线运行时消息 */
import { Logger } from '../base/logger';
import { SettingsStore, type BaseSettings } from '../base/settings';
import { MessageBus } from '../base/message-bus';
import { TabMessenger } from '../base/tab-messenger';
import { OffscreenManager } from '../base/offscreen';
import { PluginRegistry } from '../base/registry';
import { AIProviderRegistry } from '../core/ai/registry';
import { SearchServiceRegistry } from '../core/search/registry';
import { ASRProviderRegistry } from '../core/asr/registry';
import type { PluginContext } from '../base/context';
import { isRequest, type Envelope } from '../shared/protocol';
import { SUMMARY_MANIFEST } from '../plugins/ai-summary/manifest';
import { createAiSummaryPlugin } from '../plugins/ai-summary/index';
import { RESOURCE_MANIFEST } from '../plugins/resource-downloader/manifest';
import { createResourceDownloaderPlugin } from '../plugins/resource-downloader/index';
import { SUBTITLE_MANIFEST } from '../plugins/video-subtitle/manifest';
import { createVideoSubtitlePlugin } from '../plugins/video-subtitle/index';

const log = new Logger('base');
const settings = new SettingsStore();
const bus = new MessageBus(log);
const tabs = new TabMessenger();
const ai = new AIProviderRegistry(log);
const search = new SearchServiceRegistry(log);
const asr = new ASRProviderRegistry(log);
const media = new OffscreenManager(log);
const registry = new PluginRegistry<PluginContext>(log);

const pluginCtx: PluginContext = {
  bus,
  tabs,
  settings,
  ai,
  search,
  asr,
  media,
  log: log.child('plugin'),
};

let inited = false;

async function init(): Promise<void> {
  if (inited) return;
  inited = true;
  log.info('ai-edge 基座启动');

  await settings.load();
  ai.syncFromSettings(settings.get().ai.providers);
  search.syncFromSettings(settings.get().search.services);
  asr.syncFromSettings(settings.get().asr.providers);

  registerBaseActions();

  // 注册插件
  registry.register(SUMMARY_MANIFEST, createAiSummaryPlugin);
  registry.register(RESOURCE_MANIFEST, createResourceDownloaderPlugin);
  registry.register(SUBTITLE_MANIFEST, createVideoSubtitlePlugin);
  await registry.activateAll(pluginCtx, settings.get().plugins.enabled);

  // 打开侧栏的默认行为（action 点击）
  try {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    log.warn('sidePanel.setPanelBehavior 不可用', e);
  }

  wireRuntimeMessages();
  log.info(`基座就绪；插件：${registry.list().map((p) => `${p.id}:${p.state}`).join(', ')}`);
}

function registerBaseActions(): void {
  bus.register('base', 'ping', async () => ({
    ok: true,
    ts: Date.now(),
    plugins: registry.list(),
    providers: ai.list().map((p) => ({ id: p.id, label: p.label })),
    activeProviderId: settings.get().ai.activeProviderId,
    searchServices: search.list().map((s) => ({ id: s.id, label: s.label })),
    asrServices: asr.list().map((a) => ({ id: a.id, label: a.label })),
    activeAsrId: settings.get().asr.activeAsrId,
    mediaCapable: media.capable,
  }));

  bus.register('base', 'get-settings', async () => settings.get());

  bus.register('base', 'reset-settings', async () => {
    const s = await settings.resetToDefaults();
    ai.syncFromSettings(s.ai.providers);
    search.syncFromSettings(s.search.services);
    asr.syncFromSettings(s.asr.providers);
    bus.postEvent('base:settings-changed', s);
    return s;
  });

  bus.register('base', 'update-settings', async (patch: Partial<BaseSettings>) => {
    await settings.patch(patch);
    ai.syncFromSettings(settings.get().ai.providers);
    search.syncFromSettings(settings.get().search.services);
    asr.syncFromSettings(settings.get().asr.providers);
    bus.postEvent('base:settings-changed', settings.get());
    return settings.get();
  });

  bus.register(
    'base',
    'set-plugin-enabled',
    async (req: { id: string; enabled: boolean }) => {
      const cur = settings.get();
      const list = new Set(cur.plugins.enabled);
      if (req.enabled) list.add(req.id);
      else list.delete(req.id);
      await settings.set('plugins', { enabled: [...list] });

      if (req.enabled && registry.getState(req.id) !== 'active') await registry.activate(req.id, pluginCtx);
      if (!req.enabled && registry.getState(req.id) === 'active') await registry.deactivate(req.id);
      return registry.getState(req.id);
    },
  );

  bus.register('base', 'open-side-panel', async (_payload, sender) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return { ok: false, reason: 'no-tab' };
    try {
      await chrome.sidePanel.open({ tabId });
      return { ok: true };
    } catch (e) {
      log.warn('未能在当前标签打开侧栏', e);
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  });

  bus.register('base', 'health-check-provider', async (req: { providerId: string }) => {
    const st = settings.get();
    const p = ai.get(req.providerId);
    const h = await p.healthCheck();
    return { providerId: req.providerId, ...h, model: st?.ai.providers[req.providerId]?.model };
  });
}

function wireRuntimeMessages(): void {
  chrome.runtime.onMessage.addListener((msg: Envelope, sender, sendResponse) => {
    if (!isRequest(msg)) {
      // event / response 信封不在此处理
      return false;
    }
    bus.dispatch(msg, sender).then(sendResponse);
    return true; // 异步响应
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void init();
});
chrome.runtime.onStartup.addListener(() => {
  void init();
});
void init();