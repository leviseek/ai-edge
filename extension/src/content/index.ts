/** Content Script：响应基座请求 + 注入悬浮入口（Shadow DOM 隔离） */
import { extractPage } from '../core/extract/extractor';
import { isRequest, okResponse, errResponse, makeRequest, type Envelope } from '../shared/protocol';
import { toErrorCode } from '../base/errors';

const CONTENT_TARGET = 'content:main';

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
  initFloatingButton();
}

function initFloatingButton(): void {
  if (document.getElementById('ai-edge-fab')) return;
  const host = document.createElement('div');
  host.id = 'ai-edge-fab';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .fab {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      display: flex; align-items: center; gap: 6px;
      padding: 10px 14px; border: none; border-radius: 999px;
      background: #1f63ff; color: #fff; font: 600 13px/1 "Segoe UI", "Microsoft YaHei", sans-serif;
      box-shadow: 0 4px 16px rgba(31,99,255,.35); cursor: pointer;
      opacity: .92; transition: opacity .15s, transform .15s;
    }
    .fab:hover { opacity: 1; transform: translateY(-2px); }
  `;
  const btn = document.createElement('button');
  btn.textContent = '⚡ AI 总结';
  btn.className = 'fab';
  btn.onclick = () => {
    void chrome.runtime
      .sendMessage(makeRequest('base', 'open-side-panel', {}))
      .catch(() => undefined);
  };

  shadow.append(style, btn);
  (document.body ?? document.documentElement).appendChild(host);
}