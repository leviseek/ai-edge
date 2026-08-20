/** 基座：插件上下文（插件可见的能力面） */
import type { MessageBus } from './message-bus';
import type { TabMessenger } from './tab-messenger';
import type { SettingsStore } from './settings';
import type { OffscreenManager } from './offscreen';
import type { ResourceCapture } from './resource-capture';
import type { Logger } from './logger';
import type { AIProviderRegistry } from '../core/ai/registry';
import type { SearchServiceRegistry } from '../core/search/registry';
import type { ASRProviderRegistry } from '../core/asr/registry';

export interface PluginContext {
  bus: MessageBus;
  tabs: TabMessenger;
  settings: SettingsStore;
  ai: AIProviderRegistry;
  search: SearchServiceRegistry;
  asr: ASRProviderRegistry;
  media: OffscreenManager;
  resources: ResourceCapture;
  log: Logger;
}