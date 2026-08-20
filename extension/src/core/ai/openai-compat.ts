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

  private hostIsLocal(): boolean {
    try {
      const host = new URL(this.cfg.baseUrl).hostname;
      return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/.test(host);
    } catch {
      return false;
    }
  }

  private async friendly(prefix: string, res: Response): Promise<never> {
    let body = '';
    try {
      body = (await res.text()).slice(0, 200);
    } catch {
      /* 忽略 */
    }
    const code = ErrorCodes.PROVIDER;
    if (res.status === 401 && !this.cfg.apiKey && !this.hostIsLocal()) {
      throw new EdgeError(code, `「${this.label}」需要 API Key：请在设置页填写后再试（HTTP 401）`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new EdgeError(code, `「${this.label}」鉴权失败（HTTP ${res.status}）：请检查 API Key 是否正确${body ? `：${body}` : ''}`);
    }
    if (res.status === 429) {
      throw new EdgeError(code, '请求过于频繁（HTTP 429 · 限流）——稍后重试，或可在设置页配置 fallback 提供商');
    }
    if (res.status >= 500) {
      throw new EdgeError(code, `「${this.label}」服务端错误（HTTP ${res.status}）：请稍后再试`);
    }
    throw new EdgeError(code, `${prefix} HTTP ${res.status}${body ? `：${body}` : ''}`);
  }

  private async guardFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(input, init);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new EdgeError(ErrorCodes.CANCELED, '请求已取消');
      throw new EdgeError(
        ErrorCodes.PROVIDER,
        `无法连接 ${this.cfg.baseUrl}（${this.hostIsLocal() ? '请确认本地服务已启动' : '请检查地址/网络'}）：${e instanceof Error ? e.message : String(e)}`,
      );
    }
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
    const res = await this.guardFetch(`${this.base()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(messages, opts, false)),
      signal: opts.signal,
    });
    if (!res.ok) await this.friendly('AI 请求失败', res);
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
    const res = await this.guardFetch(`${this.base()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(messages, opts, true)),
      signal: opts.signal,
    });
    if (!res.ok) await this.friendly('AI 请求失败', res);
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
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; model?: string };
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta || chunk.model) yield { delta, model: chunk.model };
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
}