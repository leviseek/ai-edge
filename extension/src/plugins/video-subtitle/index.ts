/** 视频字幕插件（骨架）：list-videos / status / transcribe-uri / inject-vtt */
import type { EdgePlugin } from '../../base/registry';
import type { PluginContext } from '../../base/context';
import type { Disposer } from '../../base/message-bus';
import { EdgeError, ErrorCodes } from '../../base/errors';
import { SUBTITLE_MANIFEST } from './manifest';
import { segmentsToSrt, srtToVtt } from './format';
import type { VideoInfo, SubtitleResult, SubtitleStatus } from './types';

export function createVideoSubtitlePlugin(): EdgePlugin<PluginContext> {
  let disposers: Disposer[] = [];

  return {
    manifest: SUBTITLE_MANIFEST,

    async activate(ctx: PluginContext) {
      // 列出页面 <video>
      disposers.push(
        ctx.bus.register('plugin:video-subtitle', 'list-videos', async (req: { tabId: number }) => {
          return ctx.tabs.send<{ tabId: number }, VideoInfo[]>(req.tabId, 'content:main', 'videos', { tabId: req.tabId });
        }),
      );

      // 能力状态（骨架进度）
      disposers.push(
        ctx.bus.register('plugin:video-subtitle', 'status', async () => {
          const settings = ctx.settings.get();
          const asrId = settings.asr.activeAsrId;
          let asrLabel = asrId;
          let asrConfigured = false;
          try {
            const p = ctx.asr.get(asrId);
            asrLabel = p.label;
            asrConfigured = (await p.healthCheck()).ok;
          } catch {
            /* 未配置 */
          }
          const status: SubtitleStatus = {
            mediaCapable: ctx.media.capable,
            asrId,
            asrLabel,
            asrConfigured,
            pipeline: '骨架：音频→转写核心可用（transcribe-uri）；页面 <video> 音频捕获 → 二期',
          };
          return status;
        }),
      );

      // 音频/媒体 URL → 转录（核心链路：fetch → offscreen 解码 → ASR → SRT）
      disposers.push(
        ctx.bus.register('plugin:video-subtitle', 'transcribe-uri', async (req: { url: string }) => {
          const settings = ctx.settings.get();
          const asrId = settings.asr.activeAsrId;
          const asr = ctx.asr.get(asrId);

          const u = new URL(req.url);
          if (!/^https?:$/.test(u.protocol)) throw new EdgeError(ErrorCodes.PROVIDER, '仅支持 http/https 音频 URL');
          const res = await fetch(req.url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
          if (!res.ok) throw new EdgeError(ErrorCodes.PROVIDER, `下载音频失败 HTTP ${res.status}`);
          const bytes = await res.arrayBuffer();

          const decoded = await ctx.media.decodeAudio(bytes);
          const transcript = await asr.transcribe(decoded.samples, decoded.sampleRate);

          const segments = (transcript.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text }));
          // 无精确分段时生成整段
          if (!segments.length && transcript.text) segments.push({ start: 0, end: decoded.durationSec, text: transcript.text });

          const result: SubtitleResult = {
            text: transcript.text,
            segments,
            language: transcript.language,
            srt: segmentsToSrt(segments),
          };
          return result;
        }),
      );

      // 把 SRT/VTT 注入页内 <video>
      disposers.push(
        ctx.bus.register('plugin:video-subtitle', 'inject-vtt', async (req: { tabId: number; index: number; vtt: string }) => {
          return ctx.tabs.send(req.tabId, 'content:main', 'inject-vtt', { index: req.index, vtt: req.vtt });
        }),
      );

      // 便捷：SRT → VTT（UI 复制用）
      disposers.push(
        ctx.bus.register('plugin:video-subtitle', 'srt-to-vtt', async (req: { srt: string }) => ({
          vtt: srtToVtt(req.srt || ''),
        })),
      );

      ctx.log.info('video-subtitle 插件已激活（骨架）');
    },

    async deactivate() {
      disposers.forEach((d) => d());
      disposers = [];
    },
  };
}