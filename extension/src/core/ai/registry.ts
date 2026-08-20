/** AI 提供商注册表：按设置同步实例 */
import type { AIProvider } from './provider';
import { OpenAICompatProvider } from './openai-compat';
import { EdgeError, ErrorCodes } from '../../base/errors';
import type { ProviderConfig } from '../../base/settings';
import type { Logger } from '../../base/logger';

export class AIProviderRegistry {
  private providers = new Map<string, AIProvider>();

  constructor(private readonly log: Logger) {}

  /** 依据设置重建 provider 集合（M3：增量更新 + fallback 链） */
  syncFromSettings(cfg: Record<string, ProviderConfig>): void {
    this.providers.clear();
    for (const [id, c] of Object.entries(cfg)) {
      try {
        this.providers.set(
          id,
          new OpenAICompatProvider({ id, label: c.label ?? id, baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model }),
        );
      } catch (e) {
        this.log.warn(`provider 配置无效，跳过: ${id}`, e);
      }
    }
  }

  get(id: string): AIProvider {
    const p = this.providers.get(id);
    if (!p) throw new EdgeError(ErrorCodes.NOT_FOUND, `AI provider 未配置: ${id}（请到设置页填写）`);
    return p;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): AIProvider[] {
    return [...this.providers.values()];
  }
}