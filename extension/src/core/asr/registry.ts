/** ASR 提供商注册表 */
import type { AsrProvider, Transcript } from './provider';
import { OpenAIWhisperProvider } from './whisper';
import { EdgeError, ErrorCodes } from '../../base/errors';
import type { AsrConfig } from '../../base/settings';
import type { Logger } from '../../base/logger';

export class ASRProviderRegistry {
  private providers = new Map<string, AsrProvider>();

  constructor(private readonly log: Logger) {}

  syncFromSettings(cfg: Record<string, AsrConfig>): void {
    this.providers.clear();
    for (const [id, c] of Object.entries(cfg)) {
      try {
        if (c.kind === 'openai-whisper') {
          this.providers.set(id, new OpenAIWhisperProvider({ id, label: c.label ?? 'Whisper', baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model }));
        }
      } catch (e) {
        this.log.warn(`ASR 配置无效，跳过: ${id}`, e);
      }
    }
  }

  get(id: string): AsrProvider {
    const p = this.providers.get(id);
    if (!p) throw new EdgeError(ErrorCodes.NOT_FOUND, `ASR 提供商未配置: ${id}（设置页填写）`);
    return p;
  }

  list(): AsrProvider[] {
    return [...this.providers.values()];
  }

  transcribe(providerId: string, samples: number[] | Float32Array, sampleRate: number): Promise<Transcript> {
    return this.get(providerId).transcribe(samples, sampleRate);
  }
}