/** 视频字幕插件：共享类型 */
export interface VideoInfo {
  index: number;
  src: string;
  name: string;
  duration: number;
  currentTime: number;
  readyState: number;
}

export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleResult {
  text: string;
  segments: SubtitleSegment[];
  language?: string;
  srt: string;
}

export interface SubtitleStatus {
  mediaCapable: boolean;
  asrId: string;
  asrLabel: string;
  asrConfigured: boolean;
  pipeline: string;
}