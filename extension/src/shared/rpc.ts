/** 跨上下文 RPC 便捷封装：UI / content 调用 SW 基座与插件 */
import { makeRequest, type Envelope, type ResponseEnvelope } from './protocol';

export class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export async function rpc<TReq = unknown, TRes = unknown>(
  target: string,
  action: string,
  payload: TReq,
): Promise<TRes> {
  const res = (await chrome.runtime.sendMessage(makeRequest(target, action, payload))) as
    | ResponseEnvelope<TRes>
    | undefined;
  if (!res) throw new RpcError('no_response', `无响应: ${target}:${action}`);
  if (!res.ok) throw new RpcError(res.error?.code ?? 'unknown', res.error?.message ?? 'RPC 失败');
  return res.data as TRes;
}

/** 监听事件通道（SW 广播的 event 信封） */
export function onEvent(channel: string, fn: (data: unknown, env: Envelope) => void): () => void {
  const listener = (msg: Envelope) => {
    if (msg && typeof msg === 'object' && msg.kind === 'event' && msg.channel === channel) {
      fn(msg.data, msg);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}