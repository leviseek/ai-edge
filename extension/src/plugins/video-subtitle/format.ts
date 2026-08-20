/** 视频字幕插件：时间戳 / SRT / VTT 格式化 */
import type { SubtitleSegment } from './types';

export function formatTimecode(sec: number): string {
  const abs = Math.max(0, sec);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = Math.floor(abs % 60);
  const ms = Math.floor((abs * 1000) % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function segmentsToSrt(segments: SubtitleSegment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${formatTimecode(s.start)} --> ${formatTimecode(s.end)}\n${s.text}\n`)
    .join('\n')
    .trim();
}

export function srtToVtt(srt: string): string {
  return 'WEBVTT\n\n' + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}