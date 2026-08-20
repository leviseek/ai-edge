/** 搜索适配器：Tavily */
import type { SearchResult, SearchOptions, SearchService, HealthResult } from './service';
import { EdgeError, ErrorCodes } from '../../base/errors';

export class TavilyService implements SearchService {
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly apiKey: string,
    id = 'tavily',
    label = 'Tavily',
  ) {
    this.id = id;
    this.label = label;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.apiKey) throw new EdgeError(ErrorCodes.SEARCH, 'Tavily 未配置 API Key（设置页填写）');
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: opts.limit ?? 5,
        search_depth: 'basic',
      }),
      signal: opts.signal,
    });
    if (!res.ok) throw new EdgeError(ErrorCodes.SEARCH, `Tavily 请求失败 HTTP ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (data.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
    }));
  }

  async healthCheck(): Promise<HealthResult> {
    return { ok: Boolean(this.apiKey), message: this.apiKey ? '已配置' : '未配置 API Key' };
  }
}