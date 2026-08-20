/** 搜索适配器：SearXNG（自托管，免 Key） */
import type { SearchResult, SearchOptions, SearchService, HealthResult } from './service';
import { EdgeError, ErrorCodes } from '../../base/errors';

export class SearxngService implements SearchService {
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly baseUrl: string,
    id = 'searxng',
    label = 'SearXNG (自托管)',
  ) {
    this.id = id;
    this.label = label;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.baseUrl) throw new EdgeError(ErrorCodes.SEARCH, 'SearXNG 未配置地址');
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) throw new EdgeError(ErrorCodes.SEARCH, `SearXNG 请求失败 HTTP ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (data.results ?? [])
      .slice(0, opts.limit ?? 5)
      .map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' }));
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      const res = await fetch(new URL('/search', this.baseUrl), { signal: AbortSignal.timeout(5000) });
      return { ok: res.ok, message: res.ok ? '可达' : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}