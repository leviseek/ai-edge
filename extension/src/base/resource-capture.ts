/** 基座能力：webRequest 旁路资源抓包（滚动环形缓冲，捕获 performance 漏掉的流媒体请求） */
import { isStreamUrl } from '../core/extract/resources';
import type { Logger } from './logger';

export interface CapturedResource {
  url: string;
  normalized: string;
  name: string;
  size: number;
  durationMs: number;
  type: string;
}

const CAP_PER_TAB = 2000;

export class ResourceCapture {
  private byTab = new Map<number, Map<string, { url: string; type: string; ts: number }>>();

  constructor(private readonly log: Logger) {}

  /** 安装 webRequest 旁路（仅观察，不阻塞；需站点访问权限才会收到事件） */
  install(): void {
    try {
      chrome.webRequest.onBeforeRequest.addListener(
        (d) => {
          if (d.tabId < 0 || !/^https?:\/\//i.test(d.url)) return;
          if (d.type === 'main_frame' || d.type === 'sub_frame') return;
          this.push(d.tabId, d.url, d.type);
        },
        {
          urls: ['http://*/*', 'https://*/*'],
          types: ['media', 'xmlhttprequest', 'font', 'image', 'script', 'stylesheet', 'other'],
        },
        [],
      );
      this.log.info('webRequest 资源旁路已安装');
    } catch (e) {
      this.log.warn('webRequest 安装失败（可能未授予站点访问）', e);
    }
  }

  private push(tabId: number, url: string, type: string): void {
    let m = this.byTab.get(tabId);
    if (!m) {
      m = new Map();
      this.byTab.set(tabId, m);
    }
    const normalized = url.split(/[?#]/)[0];
    // 视频流按完整 URL（含 token）保留；其余按去 query
    const key = isStreamUrl(url) ? url : normalized;
    if (!m.has(key)) {
      if (m.size >= CAP_PER_TAB) {
        const first = m.keys().next().value;
        if (first) m.delete(first);
      }
      m.set(key, { url, type, ts: Date.now() });
    }
  }

  /** 返回某标签旁路捕获的资源（无 body，size=0） */
  list(tabId: number): CapturedResource[] {
    const m = this.byTab.get(tabId);
    if (!m) return [];
    const out: CapturedResource[] = [];
    for (const v of m.values()) {
      const normalized = v.url.split(/[?#]/)[0];
      out.push({ url: v.url, normalized, name: basename(normalized), size: 0, durationMs: 0, type: v.type });
    }
    return out;
  }

  clear(tabId: number): void {
    this.byTab.delete(tabId);
  }
}

function basename(url: string): string {
  const seg = url.split('/').pop() || 'file';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}