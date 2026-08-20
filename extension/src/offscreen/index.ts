/** Offscreen 文档：承担 SW 无法执行的媒体/DOM 任务（音频解码等） */
const SAMPLE_RATE = 16000;

let ac: OfflineAudioContext | null = null;
function audioCtx(): OfflineAudioContext {
  ac ??= new OfflineAudioContext(1, 1, SAMPLE_RATE);
  return ac;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { kind?: string; action?: string; bytes?: ArrayBuffer };
  if (m.kind !== 'offscreen-request') return false;

  if (m.action === 'decode-audio') {
    if (!(m.bytes instanceof ArrayBuffer)) {
      sendResponse({ kind: 'offscreen-reply', action: 'decode-audio', ok: false, error: '无效的音频字节' });
      return false;
    }
    void decodeAudio(m.bytes)
      .then((data) => sendResponse({ kind: 'offscreen-reply', action: 'decode-audio', ok: true, data }))
      .catch((e) =>
        sendResponse({ kind: 'offscreen-reply', action: 'decode-audio', ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
    return true;
  }

  return false;
});

async function decodeAudio(bytes: ArrayBuffer): Promise<{ sampleRate: number; samples: number[]; durationSec: number }> {
  const ctx = audioCtx();
  const buffer = await ctx.decodeAudioData(bytes.slice(0));
  const sr = buffer.sampleRate;
  const len = Math.ceil(buffer.length * (SAMPLE_RATE / sr));
  const out = new Float32Array(len);
  const data = buffer.getChannelData(0); // 取首声道（骨架：单声道）
  for (let i = 0; i < len; i++) {
    const src = Math.min(buffer.length - 1, Math.floor(i * (sr / SAMPLE_RATE)));
    out[i] = data[src];
  }
  return { sampleRate: SAMPLE_RATE, samples: Array.from(out), durationSec: buffer.duration };
}