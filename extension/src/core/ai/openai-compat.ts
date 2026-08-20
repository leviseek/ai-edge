/** AI 提供商：OpenAI-compatible 适配器（覆盖 DeepSeek/通义/Moonshot/Ollama/自建网关） */
import type {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatChunk,
  ModelInfo,
  HealthResult,
  Usage,
} from './provider';
import { EdgeError, ErrorCodes } from '../../base/errors';

export interface OpenAICompatConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAICompatProvider implements AIProvider {
  readonly id: string;
  readonly label: string;

  constructor(private readonly cfg: OpenAICompatConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
  }

  private base(): string {
    return this.cfg.baseUrl.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) h.Authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  private body(messages: ChatMessage[], opts: ChatOptions, stream: boolean): Record<string, unknown> {
    const b: Record<string, unknown> = {
      model: opts.model ?? this.cfg.model,
      messages,
      stream,
    };
    if (opts.temperature !== undefined) b.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) b.max_tokens = opts.maxTokens;
    return b;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const res = await fetch(`${this.base()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(messages, opts, false)),
      signal: opts.signal,
    });
    if (!res.ok) throw new EdgeError(ErrorCodes.PROVIDER, `AI 请求失败 HTTP ${res.status}: ${await this.safeText(res)}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: Usage;
      model?: string;
    };
    if (!data.choices?.[0]?.message) throw new EdgeError(ErrorCodes.PROVIDER, 'AI 响应缺少 choices');
    return {
      text: data.choices[0].message.content ?? '',
      model: data.model ?? opts.model ?? this.cfg.model,
      usage: data.usage,
    };
  }

  async *chatStream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const res = await fetch(`${this.base()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(messages, opts, true)),
      signal: opts.signal,
    });
    if (!res.ok) throw new EdgeError(ErrorCodes.PROVIDER, `AI 请求失败 HTTP ${res.status}: ${await this.safeText(res)}`);
    if (!res.body) throw new EdgeError(ErrorCodes.PROVIDER, 'AI 响应无 body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }
        try {
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) yield { delta };
        } catch {
          /* 忽略畸形 SSE 行 */
        }
      }
    }
    yield { delta: '', done: true };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.base()}/models`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: { id: string }[] };
      return (data.data ?? []).map((m) => ({ id: m.id }));
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<HealthResult> {
    const t0 = Date.now();
    try {
      const models = await this.listModels();
      return {
        ok: models.length > 0,
        latencyMs: Date.now() - t0,
        message: models.length ? `可用模型 ${models.length} 个（含 ${models.slice(0, 3).map((m) => m.id).join(', ')}）` : '未能获取模型列表（Key 无效或端点不可达）',
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, message: e instanceof Error ? e.message : String(e) };
    }
  }

  private async safeText(res: Response): Promise<string> {
    try {
      return (await res.text()).slice(0, 300);
    } catch {
      return '';
    }
  }
}