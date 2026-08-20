/** content 侧资源采集（Performance-API，需 no 额外权限） */
export interface RawResource {
  url: string;
  normalized: string;
  name: string;
  size: number;
  durationMs: number;
  type: string;
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
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const size = e.transferSize || e.encodedBodySize || 0;
    out.push({ url, normalized, name: basename(normalized), size, durationMs: e.duration, type: e.initiatorType || '' });
  }
  return out;
}