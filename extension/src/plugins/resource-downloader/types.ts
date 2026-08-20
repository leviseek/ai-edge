/** 资源下载器：共享类型 */
export type ResourceCategory = '图片' | '视频' | '音频' | '文档' | '字体' | '样式' | '脚本' | '数据接口' | '其他';

export interface RawResource {
  url: string;
  normalized: string;
  name: string;
  size: number;
  durationMs: number;
  type: string;
}

export interface ResourceInfo extends RawResource {
  category: ResourceCategory;
}

export interface DownloadStatus {
  url: string;
  name: string;
  ok: boolean;
  message?: string;
  downloadId?: number;
}

export interface AiFilterResult {
  selected: string[];
  reason: string;
  total: number;
}