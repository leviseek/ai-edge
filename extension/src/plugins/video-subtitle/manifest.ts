/** 视频字幕插件：manifest */
import type { PluginManifest } from '../../base/registry';

export const SUBTITLE_MANIFEST: PluginManifest = {
  id: 'video-subtitle',
  name: '视频字幕',
  version: '0.1.0',
  description: '由视频/音频生成 AI 字幕（骨架：音频转写核心可用；页面捕获二期）',
  permissions: ['content-media', 'offscreen', 'asr'],
};