/** 搜索服务注册表：按设置同步实例 */
import type { SearchService } from './service';
import { TavilyService } from './tavily';
import { SearxngService } from './searxng';
import { EdgeError, ErrorCodes } from '../../base/errors';
import type { SearchConfig } from '../../base/settings';
import type { Logger } from '../../base/logger';

export class SearchServiceRegistry {
  private services = new Map<string, SearchService>();

  constructor(private readonly log: Logger) {}

  syncFromSettings(cfg: Record<string, SearchConfig>): void {
    this.services.clear();
    for (const [id, c] of Object.entries(cfg)) {
      try {
        if (c.kind === 'tavily') this.services.set(id, new TavilyService(c.apiKey ?? '', id, c.label ?? 'Tavily'));
        else if (c.kind === 'searxng') this.services.set(id, new SearxngService(c.baseUrl ?? '', id, c.label ?? 'SearXNG'));
      } catch (e) {
        this.log.warn(`搜索服务配置无效，跳过: ${id}`, e);
      }
    }
  }

  get(id: string): SearchService {
    const s = this.services.get(id);
    if (!s) throw new EdgeError(ErrorCodes.NOT_FOUND, `搜索服务未配置: ${id}`);
    return s;
  }

  list(): SearchService[] {
    return [...this.services.values()];
  }
}