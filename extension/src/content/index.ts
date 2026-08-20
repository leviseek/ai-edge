/** Content Script：响应基座请求 + 注入悬浮快速总结卡（Shadow DOM 隔离） */
import { extractPage } from '../core/extract/extractor';
import { collectResources } from '../core/extract/resources';
import { isRequest, okResponse, errResponse, type Envelope } from '../shared/protocol';
import { toErrorCode } from '../base/errors';
import { rpc, onEvent } from '../shared/rpc';
import { buildMarkdown } from '../ui/shared/result';
import type { SummaryOutput, SummaryMode, ProgressEvent } from '../plugins/ai-summary/export';
import type { VideoInfo } from '../plugins/video-subtitle/types';

const CONTENT_TARGET = 'content:main';

// 哨兵：TabMessenger 可能在页面加载后再注入一次 content.js（executeScript），
// 重复副本不得再次注册监听/注入 UI，避免重复应答与重复 FAB。
const injected = globalThis as unknown as { __AI_EDGE_CONTENT_INJECTED__?: boolean };
if (!injected.__AI_EDGE_CONTENT_INJECTED__) {
  injected.__AI_EDGE_CONTENT_INJECTED__ = true;
  main();
}

function main(): void {
  chrome.runtime.onMessage.addListener((msg: Envelope, _sender, sendResponse) => {
    if (!isRequest(msg)) return false;
    if (msg.target !== CONTENT_TARGET) return false;

    switch (msg.action) {
      case 'extract':
        try {
          sendResponse(okResponse(msg, extractPage()));
        } catch (e) {
          sendResponse(errResponse(msg, toErrorCode(e), e instanceof Error ? e.message : String(e)));
        }
        return true;
      case 'resources':
        // 当前页网络资源采集（Performance-API，无附加权限）
        try {
          sendResponse(okResponse(msg, collectResources()));
        } catch (e) {
          sendResponse(errResponse(msg, toErrorCode(e), e instanceof Error ? e.message : String(e)));
        }
        return true;
      case 'videos':
        try {
          sendResponse(okResponse(msg, collectVideos()));
        } catch (e) {
          sendResponse(errResponse(msg, toErrorCode(e), e instanceof Error ? e.message : String(e)));
        }
        return true;
      case 'inject-vtt':
        try {
          sendResponse(okResponse(msg, injectVtt(msg.payload as { index: number; vtt: string })));
        } catch (e) {
          sendResponse(errResponse(msg, toErrorCode(e), e instanceof Error ? e.message : String(e)));
        }
        return true;
      case 'ping':
        sendResponse(okResponse(msg, { ok: true }));
        return true;
      default:
        sendResponse(errResponse(msg, 'not_found', `content 未注册 action: ${msg.action}`));
        return true;
    }
  });

  // 悬浮入口：仅顶层文档注入一次
  if (window.top === window) {
    initFloatingCard();
  }
}

const QUICK_MODES: { id: SummaryMode; label: string }[] = [
  { id: 'summary', label: '摘要' },
  { id: 'feasibility', label: '可行性' },
  { id: 'pros-cons', label: '优缺点' },
  { id: 'compare', label: '对比' },
];

interface CardCtx {
  rootEl: HTMLDivElement;
  card: HTMLDivElement;
  statusEl: HTMLElement;
  resultEl: HTMLElement;
  runBtn: HTMLButtonElement;
  selected: Set<SummaryMode>;
}

function initFloatingCard(): void {
  if (document.getElementById('ai-edge-fab')) return;
  const host = document.createElement('div');
  host.id = 'ai-edge-fab';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CARD_CSS;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.textContent = '⚡ AI 总结';

  const card = document.createElement('div');
  card.className = 'card hidden';

  shadow.append(style, fab, card);
  (document.body ?? document.documentElement).appendChild(host);

  buildCardUI(card, {
    rootEl: host,
    card,
    statusEl: document.createElement('div'),
    resultEl: document.createElement('div'),
    runBtn: document.createElement('button'),
    selected: new Set<SummaryMode>(['summary']),
  });

  fab.onclick = () => {
    const open = !card.classList.contains('hidden');
    card.classList.toggle('hidden', open);
    fab.textContent = open ? '⚡ AI 总结' : '✕ 关闭';
  };
}

function buildCardUI(card: HTMLDivElement, ctx: CardCtx): void {
  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = '<strong>AI 快速总结</strong>';

  const modeRow = document.createElement('div');
  modeRow.className = 'modes';
  for (const m of QUICK_MODES) {
    const chip = document.createElement('button');
    chip.className = 'chip on';
    chip.textContent = m.label;
    chip.dataset.mode = m.id;
    chip.onclick = () => {
      const on = chip.classList.toggle('on');
      if (on) ctx.selected.add(m.id);
      else ctx.selected.delete(m.id);
    };
    modeRow.appendChild(chip);
  }

  const status = ctx.statusEl;
  status.className = 'status';

  const runBtn = ctx.runBtn;
  runBtn.className = 'run';
  runBtn.textContent = '开始总结';
  runBtn.onclick = () => void runQuick(ctx);

  const result = ctx.resultEl;
  result.className = 'result';

  card.append(head, modeRow, status, runBtn, result);
}

async function runQuick(ctx: CardCtx): Promise<void> {
  const modes = [...ctx.selected];
  if (!modes.length) {
    setStatus(ctx, '请至少选择一个模式', true);
    return;
  }
  ctx.runBtn.disabled = true;
  setStatus(ctx, '准备中…', false);
  ctx.resultEl.innerHTML = '';
  try {
    const res = await rpc<{ modes: SummaryMode[] }, SummaryOutput>('plugin:ai-summary', 'summarize', { modes });
    renderResult(ctx, res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(ctx, `失败：${msg}`, true);
    const go = document.createElement('button');
    go.textContent = '去设置页';
    go.onclick = () => void chrome.runtime.openOptionsPage();
    ctx.resultEl.appendChild(go);
  } finally {
    ctx.runBtn.disabled = false;
  }
}

function renderResult(ctx: CardCtx, res: SummaryOutput): void {
  setStatus(ctx, `完成（${res.meta.model} · ${res.meta.durationMs}ms）`, false);
  const el = ctx.resultEl;
  el.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'r-title';
  title.textContent = res.meta.title;

  const sum = document.createElement('p');
  sum.textContent = res.executiveSummary;

  const points = document.createElement('ul');
  for (const k of res.keyPoints) {
    const li = document.createElement('li');
    li.textContent = k;
    points.appendChild(li);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const copy = document.createElement('button');
  copy.textContent = '复制 Markdown';
  copy.onclick = () => {
    void navigator.clipboard
      .writeText(buildMarkdown(res))
      .then(() => {
        copy.textContent = '已复制 ✓';
      })
      .catch(() => undefined);
  };
  const detail = document.createElement('button');
  detail.textContent = '侧栏详情';
  detail.onclick = () => {
    void rpc('base', 'open-side-panel', {}).catch(() => undefined);
    // 兜底：无法发送时直接关闭卡片
    ctx.card.classList.add('hidden');
  };

  actions.append(copy, detail);
  el.append(title, sum, points, actions);
}

function setStatus(ctx: CardCtx, text: string, error: boolean): void {
  ctx.statusEl.textContent = text;
  ctx.statusEl.classList.toggle('err', error);
}

// 进度事件（RPC 路径广播）
onEvent('plugin:ai-summary:progress', (data) => {
  const ev = data as ProgressEvent;
  const host = document.getElementById('ai-edge-fab');
  if (!host) return;
  const shadow = host.shadowRoot;
  const status = shadow?.querySelector<HTMLElement>('.status');
  if (status) status.textContent = ev.message;
});

/** 收集页面 <video> 元信息 */
function collectVideos(): VideoInfo[] {  const vids = Array.from(document.querySelectorAll('video'));
  return vids
    .map((v, index) => {
      const el = v as HTMLVideoElement;
      const src = (el.currentSrc || el.src || '').split(/[?#]/)[0];
      return {
        index,
        src,
        name: src.split('/').pop() || 'video',
        duration: el.duration || 0,
        currentTime: el.currentTime || 0,
        readyState: el.readyState,
      };
    })
    .filter((v) => /^https?:\/\//i.test(v.src));
}

/** UTF-8 → base64（VTT data URL 用，避免 unescape 兼容问题） */
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 为指定 <video> 注入原生字幕轨 */
function injectVtt(payload: { index: number; vtt: string }): { ok: boolean; videoIndex: number } {
  const vids = document.querySelectorAll('video');
  const el = vids[payload.index];
  if (!el) throw new Error(`未找到视频 #${payload.index}`);
  [...el.querySelectorAll('track[data-ai-edge]')].forEach((t) => t.remove());
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = 'AI';
  track.srclang = 'zh';
  track.default = true;
  track.setAttribute('data-ai-edge', '1');
  track.src = 'data:text/vtt;base64,' + utf8ToBase64(payload.vtt);
  el.appendChild(track);
  try {
    const tt = (el as HTMLVideoElement).textTracks?.[0];
    if (tt) tt.mode = 'showing';
  } catch {
    /* noop */
  }
  return { ok: true, videoIndex: payload.index };
}

const CARD_CSS = `
  :host { all: initial; }
  .fab {
    position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
    display: flex; align-items: center; gap: 6px;
    padding: 10px 14px; border: none; border-radius: 999px;
    background: #1f63ff; color: #fff;
    font: 600 13px/1 "Segoe UI", "Microsoft YaHei", sans-serif;
    box-shadow: 0 4px 16px rgba(31,99,255,.35); cursor: pointer;
    opacity: .92; transition: opacity .15s, transform .15s;
  }
  .fab:hover { opacity: 1; transform: translateY(-2px); }
  .card {
    position: fixed; right: 18px; bottom: 74px; z-index: 2147483647;
    width: 320px; max-height: 58vh; overflow: auto;
    background: #fff; color: #1f2933; border: 1px solid #dce3ea;
    border-radius: 12px; box-shadow: 0 8px 28px rgba(15,34,66,.18);
    padding: 12px; font: 13px/1.6 "Segoe UI", "Microsoft YaHei", sans-serif;
    display: flex; flex-direction: column; gap: 8px;
  }
  .card.hidden { display: none; }
  .card-head { font-weight: 700; font-size: 14px; }
  .modes { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    border: 1px solid #dce3ea; border-radius: 999px; padding: 4px 10px;
    background: #fff; color: #1f2933; font-size: 12px; cursor: pointer;
  }
  .chip.on { background: #e8efff; border-color: #1f63ff; color: #1f63ff; }
  .status { font-size: 12px; color: #6b7a8c; min-height: 1em; }
  .status.err { color: #d33f49; white-space: pre-wrap; }
  .run {
    border: none; border-radius: 8px; padding: 7px 12px; cursor: pointer;
    background: #1f63ff; color: #fff; font-weight: 600;
  }
  .run:disabled { opacity: .5; cursor: not-allowed; }
  .result { display: flex; flex-direction: column; gap: 6px; }
  .r-title { font-weight: 700; }
  .result p { margin: 0; }
  .result ul { margin: 0; padding-left: 18px; }
  .actions { display: flex; gap: 6px; margin-top: 2px; }
  .actions button {
    border: 1px solid #dce3ea; border-radius: 8px; padding: 5px 10px;
    background: #fff; cursor: pointer; font-size: 12px;
  }
`;