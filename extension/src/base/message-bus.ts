/** 基座：消息总线（SW 内路由 request + 广播 event） */
import { okResponse, errResponse, isEvent, type RequestEnvelope, type ResponseEnvelope } from '../shared/protocol';
import { toErrorCode } from './errors';
import type { Logger } from './logger';

export type Disposer = () => void;

export type Handler<TReq = unknown, TRes = unknown> = (
  payload: TReq,
  sender: chrome.runtime.MessageSender,
) => Promise<TRes> | TRes;

export class MessageBus {
  private handlers = new Map<string, Handler>();
  private eventListeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(private readonly log: Logger) {}

  /** 注册处理器（target:action），返回反注册函数 */
  register<TReq = unknown, TRes = unknown>(target: string, action: string, handler: Handler<TReq, TRes>): Disposer {
    const key = `${target}:${action}`;
    if (this.handlers.has(key)) throw new Error(`duplicate handler: ${key}`);
    this.handlers.set(key, handler as Handler);
    this.log.debug('registered handler', key);
    return () => {
      this.handlers.delete(key);
    };
  }

  onEvent(channel: string, fn: (data: unknown) => void): Disposer {
    let set = this.eventListeners.get(channel);
    if (!set) {
      set = new Set();
      this.eventListeners.set(channel, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** 本地派发 + 广播到所有扩展上下文（UI 订阅进度等） */
  postEvent(channel: string, data: unknown): void {
    const many = this.eventListeners.get(channel);
    if (many) {
      for (const fn of [...many]) {
        try {
          fn(data);
        } catch (e) {
          this.log.error('event listener failed', channel, e);
        }
      }
    }
    // 广播给其它上下文（popup/sidepanel/options/content）
    void chrome.runtime
      .sendMessage({ kind: 'event', channel, data, ts: Date.now() })
      .catch(() => undefined);
  }

  /** 分发 request → response；未知 handler 返回结构化错误，不抛 */
  async dispatch(req: RequestEnvelope, sender: chrome.runtime.MessageSender): Promise<ResponseEnvelope> {
    const key = `${req.target}:${req.action}`;
    const handler = this.handlers.get(key);
    if (!handler) return errResponse(req, 'not_found', `未注册的处理器: ${key}`);
    try {
      const data = await handler(req.payload, sender);
      return okResponse(req, data);
    } catch (e) {
      const code = toErrorCode(e);
      this.log.warn(`handler failed ${key}`, e);
      return errResponse(req, code, e instanceof Error ? e.message : String(e));
    }
  }

  /** 判断消息是否为该上下文的 event（供 onMessage 入口复用） */
  static isEventLike(msg: unknown): msg is { kind: 'event'; channel: string; data: unknown } {
    return isEvent(msg as never);
  }
}