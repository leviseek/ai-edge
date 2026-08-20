/** content 侧资源采集（Performance-API，逐 frame 采集后由后台聚合） */
export interface RawResource {
  url: string;
  normalized: string;
  name: string;
  size: number;
  durationMs: number;
  type: string;
}

/** HLS/MSE 视频流 URL（m3u8 播放列表 / m4s 分片 / .ts 分片） */
export const RE_STREAM = /\.(m3u8|m4s|ts)(\?|$)/i;

export function isStreamUrl(url: string): boolean {
  return RE_STREAM.test(url);
}

/**
 * 去重键：视频流按完整 URL（含 query/token，保留多条清晰度与分片）；
 * 其余按去掉 query 的规范化 URL 去重。
 */
export function resourceKey(r: { url: string; normalized: string }): string {
  return isStreamUrl(r.url) ? r.url : r.normalized;
}

function basename(url: string): string {
  const seg = url.split('/').pop() || 'file';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export function collectResources(): RawResource[] {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return [];
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const sorted = entries.slice().sort((a, b) => a.startTime - b.startTime);
  const seen = new Set<string>();
  const out: RawResource[] = [];
  for (const e of sorted) {
    let url: string;
    try {
      url = e.name;
      if (!/^https?:\/\//i.test(url)) continue;
    } catch {
      continue;
    }
    const normalized = url.split(/[?#]/)[0];
    const key = resourceKey({ url, normalized });
    if (seen.has(key)) continue;
    seen.add(key);
    const size = e.transferSize || e.encodedBodySize || 0;
    out.push({ url, normalized, name: basename(normalized), size, durationMs: e.duration, type: e.initiatorType || '' });
  }
  return out;
}