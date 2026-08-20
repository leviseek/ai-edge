/** AI 提供商抽象：统一接口 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: Usage;
}

export interface ChatChunk {
  delta: string;
  done?: boolean;
  usage?: Usage;
}

export interface ModelInfo {
  id: string;
}

export interface HealthResult {
  ok: boolean;
  latencyMs?: number;
  message?: string;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  chatStream(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<ChatChunk>;
  listModels(): Promise<ModelInfo[]>;
  healthCheck(): Promise<HealthResult>;
}