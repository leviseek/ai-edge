/** UI 共享：对基座/插件的 API 封装 */
import { rpc, onEvent } from '../../shared/rpc';
import type { BaseSettings } from '../../base/settings';
import type { SummaryOutput, SummaryRequest, SummaryMode } from '../../plugins/ai-summary/export';

export interface PingResult {
  ok: boolean;
  ts: number;
  plugins: { id: string; name: string; version: string; description: string; state: string; error?: string }[];
  providers: { id: string; label: string }[];
  activeProviderId: string;
  searchServices: { id: string; label: string }[];
}

export interface ProviderHealth {
  providerId: string;
  ok: boolean;
  latencyMs?: number;
  message?: string;
  model?: string;
}

export const api = {
  ping: () => rpc<unknown, PingResult>('base', 'ping', {}),
  getSettings: () => rpc<unknown, BaseSettings>('base', 'get-settings', {}),
  resetSettings: () => rpc<unknown, BaseSettings>('base', 'reset-settings', {}),
  updateSettings: (patch: Partial<BaseSettings>) =>
    rpc<Partial<BaseSettings>, BaseSettings>('base', 'update-settings', patch),
  setPluginEnabled: (id: string, enabled: boolean) =>
    rpc<{ id: string; enabled: boolean }, string>('base', 'set-plugin-enabled', { id, enabled }),
  openSidePanel: () => rpc<unknown, { ok: boolean; reason?: string }>('base', 'open-side-panel', {}),
  healthCheckProvider: (providerId: string) =>
    rpc<{ providerId: string }, ProviderHealth>('base', 'health-check-provider', { providerId }),
  summarize: (tabId: number, modes: SummaryMode[]) =>
    rpc<SummaryRequest, SummaryOutput>('plugin:ai-summary', 'summarize', { tabId, modes }),
  extract: (tabId: number) => rpc<{ tabId: number }, { title: string; charCount: number }>('plugin:ai-summary', 'extract', { tabId }),
};

export { onEvent };

export async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}