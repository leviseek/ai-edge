/** 跨上下文共享：消息协议信封 */
export type Target = string; // 'base' | 'plugin:<id>' | 'content:<id>'

export interface RequestEnvelope<T = unknown> {
  kind: 'request';
  id: string;
  target: Target;
  action: string;
  payload: T;
  ts: number;
}

export interface ResponseEnvelope<T = unknown> {
  kind: 'response';
  id: string;
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface EventEnvelope<T = unknown> {
  kind: 'event';
  channel: string;
  data: T;
  ts: number;
}

export type Envelope = RequestEnvelope | ResponseEnvelope | EventEnvelope;

export function uid(prefix = ''): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}-${rnd}`;
}

export function makeRequest<T>(target: Target, action: string, payload: T): RequestEnvelope<T> {
  return { kind: 'request', id: uid('req-'), target, action, payload, ts: Date.now() };
}

export function okResponse<T>(req: RequestEnvelope, data: T): ResponseEnvelope<T> {
  return { kind: 'response', id: req.id, ok: true, data };
}

export function errResponse(req: RequestEnvelope, code: string, message: string): ResponseEnvelope {
  return { kind: 'response', id: req.id, ok: false, error: { code, message } };
}

export function isRequest(e: Envelope): e is RequestEnvelope {
  return e.kind === 'request';
}

export function isResponse(e: Envelope): e is ResponseEnvelope {
  return e.kind === 'response';
}

export function isEvent(e: Envelope): e is EventEnvelope {
  return e.kind === 'event';
}

/** 非标 JSON 容错解析（LLM 输出经常夹带前后文） */
export function parseJsonLoose<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    /* 尝试提取最外层 { ... } */
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      /* fallback */
    }
  }
  return fallback;
}