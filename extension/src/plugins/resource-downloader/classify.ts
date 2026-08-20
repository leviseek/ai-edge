/** 资源下载器：分类与格式化 */
import type { ResourceCategory } from './types';
import { isStreamUrl } from '../../core/extract/resources';

const RE_IMG = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|heic)$/i;
const RE_VIDEO = /\.(mp4|webm|mkv|3gpp|mpeg|mov|avi|flv)$/i;
const RE_AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;
const RE_DOC = /\.(pdf|docx?|xlsx?|pptx?|zip|epub|7z|rar)$/i;
const RE_FONT = /\.(woff2?|ttf|otf|eot)$/i;
const RE_CSS = /\.css$/i;
const RE_JS = /\.(js|mjs)$/i;

export function classifyResource(raw: { url: string; type: string }): ResourceCategory {
  const url = raw.url.split(/[?#]/)[0];
  const t = raw.type.toLowerCase();
  if (t === 'img' || RE_IMG.test(url)) return '图片';
  if (isStreamUrl(raw.url)) return '视频流';
  if (RE_VIDEO.test(url)) return '视频';
  if (RE_AUDIO.test(url)) return '音频';
  if (RE_DOC.test(url)) return '文档';
  if (RE_FONT.test(url)) return '字体';
  if (RE_CSS.test(url)) return '样式';
  if (t === 'script' || RE_JS.test(url)) return '脚本';
  if (t === 'xmlhttprequest' || t === 'fetch') return '数据接口';
  return '其他';
}

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
  '图片', '视频', '视频流', '音频', '文档', '字体', '样式', '脚本', '数据接口', '其他',
];

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}