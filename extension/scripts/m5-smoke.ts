/**
 * M5 冒烟：资源下载器分类 + WAV 编码 + 字幕格式化（纯函数，无网络）。
 * 运行：npm run smoke:m5
 */
import { classifyResource, formatSize } from '../src/plugins/resource-downloader/classify';
import { encodeWav } from '../src/core/asr/wav';
import { formatTimecode, segmentsToSrt, srtToVtt } from '../src/plugins/video-subtitle/format';
import type { SubtitleSegment } from '../src/plugins/video-subtitle/types';
import { resourceKey, collectResources } from '../src/core/extract/resources';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log('\n[场景1] 资源分类');
  {
    assert(classifyResource({ url: 'https://a.com/img/pic.png', type: 'img' }) === '图片', 'png+img → 图片');
    assert(classifyResource({ url: 'https://a.com/v/movie.mp4', type: 'media' }) === '视频', '.mp4 → 视频');
    assert(classifyResource({ url: 'https://a.com/a/song.mp3', type: 'media' }) === '音频', '.mp3 → 音频');
    assert(classifyResource({ url: 'https://a.com/d/doc.pdf', type: 'link' }) === '文档', '.pdf → 文档');
    assert(classifyResource({ url: 'https://a.com/f/icon.woff2', type: 'css' }) === '字体', '.woff2 → 字体');
    assert(classifyResource({ url: 'https://a.com/s/main.css', type: 'stylesheet' }) === '样式', '.css → 样式');
    assert(classifyResource({ url: 'https://a.com/js/app.js', type: 'script' }) === '脚本', '.js → 脚本');
    assert(classifyResource({ url: 'https://api.x.com/users', type: 'xmlhttprequest' }) === '数据接口', 'xhr → 数据接口');
    assert(classifyResource({ url: 'https://x.com/thing.xyz', type: 'other' }) === '其他', '未知 → 其他');
  }

  console.log('\n[场景2] 大小格式化');
  {
    assert(formatSize(0) === '-', '0 → "-"');
    assert(formatSize(512) === '512B', '512 → 512B');
    assert(formatSize(2048) === '2.0KB', '2048 → 2.0KB');
    assert(formatSize(2097152) === '2.0MB', '2097152 → 2.0MB');
  }

  console.log('\n[场景3] WAV 编码（16bit 单声道）');
  {
    const wav = encodeWav([0, 0.5, -0.5], 16000);
    assert(wav.byteLength === 44 + 2 * 3, `wav 长度 44+2N（实际 ${wav.byteLength}）`);
    const view = new DataView(wav);
    assert(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) === 'RIFF', 'RIFF 头');
    assert(view.getUint32(24, true) === 16000, '采样率=16000');
    assert(view.getUint32(40, true) === 6, 'data 块=3样本*2字节');
  }

  console.log('\n[场景4] 字幕时间码 / SRT / VTT');
  {
    assert(formatTimecode(3723.456) === '01:02:03,456', '时间码 hh:mm:ss,mmm');
    const segs: SubtitleSegment[] = [
      { start: 1, end: 2.5, text: '你好' },
      { start: 3, end: 4, text: '世界' },
    ];
    const srt = segmentsToSrt(segs);
    assert(srt.includes('1\n00:00:01,000 --> 00:00:02,500\n你好'), 'SRT 第 1 条');
    assert(srt.includes('2\n00:00:03,000 --> 00:00:04,000\n世界'), 'SRT 第 2 条');
    const vtt = srtToVtt(srt);
    assert(vtt.startsWith('WEBVTT') && !vtt.includes(',000 -->'), 'VTT 头 + 逗号转点');
  }

  console.log('\n[场景5] HLS/MSE 视频流分类');
  {
    assert(classifyResource({ url: 'https://a.com/v.m3u8?sign=1', type: 'fetch' }) === '视频流', 'm3u8 播放列表 → 视频流');
    assert(classifyResource({ url: 'https://a.com/video.m4s?r=1', type: 'fetch' }) === '视频流', 'm4s 分片 → 视频流');
    assert(classifyResource({ url: 'https://a.com/s/seg.ts?r=1', type: 'media' }) === '视频流', '.ts 分片 → 视频流');
    assert(classifyResource({ url: 'https://a.com/movie.mp4?x=1', type: 'media' }) === '视频', 'mp4 仍为 视频');
  }

  console.log('\n[场景6] 去重：视频流按完整 URL（token）保留，普通资源按去 query 去重');
  {
    const fakeEntries = [
      { name: 'https://a.com/v.m3u8?token=1', startTime: 1, transferSize: 100, duration: 1, initiatorType: 'fetch' },
      { name: 'https://a.com/v.m3u8?token=2', startTime: 2, transferSize: 101, duration: 1, initiatorType: 'fetch' },
      { name: 'https://a.com/img/a.png?v=1', startTime: 3, transferSize: 50, duration: 1, initiatorType: 'img' },
      { name: 'https://a.com/img/a.png?v=2', startTime: 4, transferSize: 51, duration: 1, initiatorType: 'img' },
      { name: 'data:image/png;base64,xxx', startTime: 5, transferSize: 0, duration: 0, initiatorType: 'css' },
    ] as unknown as PerformanceResourceTiming[];
    const orig = globalThis.performance;
    (globalThis as unknown as { performance: Performance }).performance = {
      getEntriesByType: (t: string) => (t === 'resource' ? (fakeEntries as unknown as PerformanceResourceTiming[]) : []),
    } as Performance;
    const list = collectResources();
    (globalThis as unknown as { performance: Performance }).performance = orig;
    assert(list.length === 3, `流+图共 3 条（实际 ${list.length}）`);
    assert(list.filter((r) => r.url.includes('m3u8')).length === 2, '两条不同 token 的 m3u8 均保留');
    assert(list.filter((r) => r.url.includes('a.png')).length === 1, 'png 不同 query 去重为一条');
    assert(
      resourceKey({ url: 'https://a.com/v.m4s?t=1', normalized: 'https://a.com/v.m4s' }) === 'https://a.com/v.m4s?t=1',
      '流传键=完整 URL',
    );
    assert(
      resourceKey({ url: 'https://a.com/i.png?x=1', normalized: 'https://a.com/i.png' }) === 'https://a.com/i.png',
      '普通资源键=去 query',
    );
  }

  console.log('\nM5 冒烟测试全部通过 ✅');
}

main().catch((e) => {
  console.error('\nM5 冒烟测试失败 ✗');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});