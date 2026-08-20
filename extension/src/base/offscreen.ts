/** 基座能力：Offscreen 会话管理（SW 无法执行媒体/DOM 任务时委托 offscreen 页面） */
import type { Logger } from './logger';

const OFFSCREEN_URL = 'offscreen.html';

export interface DecodedAudio {
  sampleRate: number;
  /** 16kHz 单声道 Float32 PCM */
  samples: number[];
  durationSec: number;
}

interface OffscreenReply<T> {
  kind: 'offscreen-reply';
  action: string;
  ok: boolean;
  data?: T;
  error?: string;
}

export class OffscreenManager {
  private ensured = false;

  constructor(private readonly log: Logger) {}

  get capable(): boolean {
    return typeof chrome.offscreen !== 'undefined';
  }

  async ensure(): Promise<void> {
    if (!this.capable) throw new Error('当前浏览器不支持 Offscreen API');
    if (this.ensured) return;
    if (chrome.offscreen?.hasDocument) {
      try {
        if (await chrome.offscreen.hasDocument()) {
          this.ensured = true;
          return;
        }
      } catch {
        /* 忽略并重建 */
      }
    }
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['AUDIO_PLAYBACK', 'DOM_SCRAPING'] as chrome.offscreen.Reason[],
      justification: '解析页面音视频为 PCM 用于 AI 字幕（ai-edge 视频字幕骨架）',
    });
    this.ensured = true;
    this.log.info('offscreen document 已创建');
  }

  async close(): Promise<void> {
    try {
      if (chrome.offscreen?.closeDocument) await chrome.offscreen.closeDocument();
    } catch (e) {
      this.log.warn('close offscreen 失败', e);
    }
    this.ensured = false;
  }

  /** 把音频字节解码为 16kHz Mono Float32（经 offscreen 页 WebAudio） */
  async decodeAudio(bytes: ArrayBuffer): Promise<DecodedAudio> {
    await this.ensure();
    const reply = (await chrome.runtime.sendMessage({
      kind: 'offscreen-request',
      action: 'decode-audio',
      bytes,
    })) as OffscreenReply<DecodedAudio> | undefined;
    if (!reply || reply.kind !== 'offscreen-reply') {
      throw new Error('Offscreen 未响应（文档可能未就绪）');
    }
    if (!reply.ok) throw new Error(reply.error ?? '音频解码失败');
    return reply.data as DecodedAudio;
  }
}