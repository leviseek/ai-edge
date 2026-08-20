/** ASR 提供商：OpenAI-compatible Whisper（/audio/transcriptions） */
import { EdgeError, ErrorCodes } from '../../base/errors';
import { encodeWav } from './wav';
import type { AsrProvider, Transcript } from './provider';

export interface WhisperConfig {
  id: string;
  label?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAIWhisperProvider implements AsrProvider {
  readonly id: string;
  readonly label: string;

  constructor(private readonly cfg: WhisperConfig) {
    this.id = cfg.id;
    this.label = cfg.label ?? cfg.id;
  }

  async transcribe(samples: number[] | Float32Array, sampleRate: number, opts?: { signal?: AbortSignal }): Promise<Transcript> {
    if (!this.cfg.apiKey) throw new EdgeError(ErrorCodes.PROVIDER, `「${this.label}」未配置 API Key（设置页填写）`);
    const wav = encodeWav(samples, sampleRate);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.cfg.model || 'whisper-1');
    form.append('response_format', 'verbose_json');

    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        body: form,
        signal: opts?.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new EdgeError(ErrorCodes.CANCELED, '转写已取消');
      throw new EdgeError(ErrorCodes.PROVIDER, `无法连接 ${base}：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new EdgeError(ErrorCodes.PROVIDER, `ASR 请求失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const data = (await res.json()) as {
      text?: string;
      language?: string;
      segments?: { start?: number; end?: number; text?: string }[];
    };
    const segments = (data.segments ?? [])
      .map((s) => ({
        start: Number(s.start ?? 0),
        end: Number(s.end ?? 0),
        text: String(s.text ?? '').trim(),
      }))
      .filter((s) => s.text);
    return {
      text: (data.text ?? '').trim() || segments.map((s) => s.text).join(' '),
      segments,
      language: data.language,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: Boolean(this.cfg.apiKey), message: this.cfg.apiKey ? '已配置' : '未配置 API Key' };
  }
}