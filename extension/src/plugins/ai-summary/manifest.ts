/** ai-summary 插件：manifest */
import type { PluginManifest } from '../../base/registry';

export const SUMMARY_MANIFEST: PluginManifest = {
  id: 'ai-summary',
  name: 'AI 总结',
  version: '0.1.0',
  description: 'AI 总结当前页面：核心摘要 / 可行性调研 / 优缺点 / 同品类横向比较（网络搜索）',
  permissions: ['content-extract', 'side-panel', 'search'],
};