/** UI：popup 快捷入口（状态 + 打开侧栏/设置） */
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { api, type PingResult } from '../shared/api';

function App() {
  const [ping, setPing] = useState<PingResult | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    void api.ping().then(setPing).catch((e) => setErr(String(e)));
  }, []);

  const activePlugins = ping?.plugins.filter((p) => p.state === 'active') ?? [];

  return (
    <div className="popup-root">
      <div className="statusbar" style={{ border: 'none', padding: 0 }}>
        <strong>ai-edge 基座</strong>
        {ping ? <span className="badge">运行中</span> : <span className="badge muted">连接中…</span>}
      </div>

      <div className="panel">
        <div className="muted">已激活插件</div>
        {activePlugins.map((p) => (
          <div className="row" key={p.id}>
            <span className="grow">{p.name}</span>
            <span className="badge">{p.state}</span>
          </div>
        ))}
        {!activePlugins.length && <div className="muted">无激活插件（请到设置页启用）</div>}
      </div>

      <div className="panel">
        <div className="muted">默认模型</div>
        {ping ? (
          <div>
            {ping.providers.find((p) => p.id === ping.activeProviderId)?.label ?? ping.activeProviderId}
          </div>
        ) : (
          <div className="muted">—</div>
        )}
      </div>

      {err && <div className="err">{err}</div>}

      <button className="primary" onClick={() => void api.openSidePanel().catch((e) => setErr(String(e)))}>
        ⚡ AI 总结当前页
      </button>
      <button onClick={() => void chrome.runtime.openOptionsPage()}>设置</button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);