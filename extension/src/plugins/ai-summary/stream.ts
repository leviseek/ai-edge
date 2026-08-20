/** ai-summary 流式：chrome.runtime Port 通道（token / progress / result / error） */
import type { PluginContext } from '../../base/context';
import { runStreaming } from './run';
import type { SummaryRequest } from './types';

const PORT_NAME = 'ai-summary-stream';

export function setupStreamHandler(ctx: PluginContext): () => void {
  const listener = (port: chrome.runtime.Port): void => {
    if (port.name !== PORT_NAME) return;
    let controller: AbortController | null = null;
    let running = false;

    const send = (msg: unknown): void => {
      try {
        port.postMessage(msg);
      } catch {
        /* 端口已断开 */
      }
    };

    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as { type?: string; request?: SummaryRequest };
      if (m.type === 'start' && m.request) {
        if (running) return;
        running = true;
        controller = new AbortController();
        void runStreaming(ctx, m.request, { send }, controller).finally(() => {
          running = false;
        });
      } else if (m.type === 'abort') {
        controller?.abort();
      }
    });

    port.onDisconnect.addListener(() => controller?.abort());
  };

  chrome.runtime.onConnect.addListener(listener);
  return () => chrome.runtime.onConnect.removeListener(listener);
}