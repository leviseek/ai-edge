/** 基座：统一错误类型与错误码 */
export class EdgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EdgeError';
  }
}

export const ErrorCodes = {
  NOT_FOUND: 'not_found',
  NOT_ACTIVE: 'not_active',
  BUSY: 'busy',
  PROVIDER: 'provider_error',
  SEARCH: 'search_error',
  EXTRACT: 'extract_error',
  LLM_PARSE: 'llm_parse_error',
  CANCELED: 'canceled',
  INTERNAL: 'internal',
} as const;

export function toErrorCode(e: unknown): string {
  if (e instanceof Error && 'code' in e) return String((e as { code: unknown }).code);
  return ErrorCodes.INTERNAL;
}