/** AI 提供商 Fallback 链：主提供商失败时按顺序自动降级 */
import { toErrorCode, ErrorCodes } from '../../base/errors';
import type { AIProvider, ChatMessage, ChatOptions, ChatResult, ChatChunk, ModelInfo, HealthResult } from './provider';

/** 仅在“提供商级错误”时降级（网络/限流/5xx/鉴权）；解析错、取消等不降级 */
function shouldFallback(e: unknown): boolean {
  return toErrorCode(e) === ErrorCodes.PROVIDER;
}

export class FallbackChainProvider implements AIProvider {
  readonly id: string;
  readonly label: string;
  /** 最近一次成功调用的提供商 */
  lastUsed: AIProvider | null = null;
  /** 实际命中过调用的提供商 id（按序） */
  usedIds: string[] = [];

  constructor(private readonly chain: AIProvider[]) {
    this.id = chain[0]?.id ?? 'fallback-empty';
    this.label = chain[0]?.label ?? 'fallback-empty';
  }

  get length(): number {
    return this.chain.length;
  }

  private markTried(p: AIProvider): void {
    if (!this.usedIds.includes(p.id)) this.usedIds.push(p.id);
  }

  private async attempt<T>(fn: (p: AIProvider) => Promise<T>): Promise<T> {
    let lastErr: unknown = new Error('Fallback 链为空');
    for (const p of this.chain) {
      this.markTried(p);
      try {
        const r = await fn(p);
        this.lastUsed = p;
        return r;
      } catch (e) {
        lastErr = e;
        if (!shouldFallback(e)) throw e;
      }
    }
    throw lastErr;
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    return this.attempt((p) => p.chat(messages, opts));
  }

  async *chatStream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<ChatChunk> {
    let lastErr: unknown = new Error('Fallback 链为空');
    for (const p of this.chain) {
      this.markTried(p);
      try {
        for await (const c of p.chatStream(messages, opts)) {
          this.lastUsed = p;
          yield c;
        }
        return;
      } catch (e) {
        lastErr = e;
        if (!shouldFallback(e)) throw e;
      }
    }
    throw lastErr;
  }

  async listModels(): Promise<ModelInfo[]> {
    const p = this.chain[0];
    return p ? p.listModels() : [];
  }

  async healthCheck(): Promise<HealthResult> {
    const p = this.chain[0];
    return p ? p.healthCheck() : { ok: false, message: '无可用提供商' };
  }
}

/** 把有序 provider 列表包装为（必要时）fallback 链；单provider 时原样返回 */
export function createProviderChain(
  providers: AIProvider[],
): { provider: AIProvider; chain: FallbackChainProvider | null } {
  if (providers.length <= 1) return { provider: providers[0], chain: null };
  const chain = new FallbackChainProvider(providers);
  return { provider: chain, chain };
}