/** 资源下载器：manifest */
import type { PluginManifest } from '../../base/registry';

export const RESOURCE_MANIFEST: PluginManifest = {
  id: 'resource-downloader',
  name: '资源下载器',
  version: '0.1.0',
  description: '采集当前页面网络资源并分类，AI 语义筛选后批量下载',
  permissions: ['content-resources', 'downloads'],
};