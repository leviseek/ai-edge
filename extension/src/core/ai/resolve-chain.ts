/** 从设置解析“主提供商 + fallbackChain”为有序链（AI 与插件共用） */
import type { AIProviderRegistry } from './registry';
import { createProviderChain, type FallbackChainProvider } from './fallback';
import type { AIProvider } from './provider';
import type { BaseSettings } from '../../base/settings';

export function buildProviderChain(
  ai: AIProviderRegistry,
  settings: BaseSettings,
): { provider: AIProvider; chain: FallbackChainProvider | null } {
  const ids = [settings.ai.activeProviderId, ...settings.ai.fallbackChain];
  const seen = new Set<string>();
  const providers: AIProvider[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      providers.push(ai.get(id));
    } catch {
      /* 配置缺失跳过 */
    }
  }
  return createProviderChain(providers);
}