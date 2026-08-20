/** 网络搜索服务抽象（供横向比较等召回候选） */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface HealthResult {
  ok: boolean;
  message?: string;
}

export interface SearchService {
  readonly id: string;
  readonly label: string;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  healthCheck(): Promise<HealthResult>;
}