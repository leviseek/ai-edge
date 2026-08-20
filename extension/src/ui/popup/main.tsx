/** UI：Popup —— 概览（AI 总结入口 / 插件状态）+ 资源下载器 */
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { api, type PingResult } from '../shared/api';
import { ResourcePanel } from '../shared/ResourcePanel';

type Tab = 'overview' | 'download';

function App() {
  const [ping, setPing] = useState<PingResult | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  const allPlugins = ping?.plugins ?? [];
  const downloaderEnabled = allPlugins.some((p) => p.id === 'resource-downloader' && p.state === 'active');
  const downloaderPresent = allPlugins.some((p) => p.id === 'resource-downloader');

  useEffect(() => {
    void api.ping().then(setPing).catch((e) => setErr(String(e)));
  }, []);

  const refresh = async () => {
    try {
      setPing(await api.ping());
    } catch (e) {
      setErr(String(e));
    }
  };

  const enablePlugin = async (id: string) => {
    try {
      await api.setPluginEnabled(id, true);
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="popup-root">
      <div className="statusbar" style={{ border: 'none', padding: 0 }}>
        <strong>ai-edge</strong>
        <span className="badge">v{chrome.runtime.getManifest().version}</span>
        {ping ? <span className="badge">运行中</span> : <span className="badge muted">连接中…</span>}
        <span className="grow" />
        <span className="row">
          <button className={tab === 'overview' ? 'primary' : ''} onClick={() => setTab('overview')}>概览</button>
          {downloaderPresent && (
            <button className={tab === 'download' ? 'primary' : ''} onClick={() => setTab('download')}>资源下载</button>
          )}
        </span>
      </div>

      {err && <div className="err">{err}</div>}

      {tab === 'overview' && (
        <>
          <div className="panel">
            <div className="muted">插件</div>
            {allPlugins.length ? (
              allPlugins.map((p) => (
                <div className="row" key={p.id} style={{ marginTop: 4 }}>
                  <span className="grow">
                    {p.name}
                    {p.state === 'error' && p.error ? <span className="err"> · {p.error}</span> : null}
                  </span>
                  {p.state === 'active' ? (
                    <span className="badge">运行中</span>
                  ) : (
                    <button onClick={() => void enablePlugin(p.id)}>启用</button>
                  )}
                </div>
              ))
            ) : (
              <div className="muted">无插件（请重新加载扩展）</div>
            )}
          </div>

          <div className="panel">
            <div className="muted">默认模型</div>
            <div>{ping ? ping.providers.find((p) => p.id === ping.activeProviderId)?.label ?? ping.activeProviderId : '—'}</div>
          </div>

          <button className="primary" onClick={() => void api.openSidePanel().catch((e) => setErr(String(e)))}>
            ⚡ AI 总结当前页
          </button>
          <button onClick={() => void chrome.runtime.openOptionsPage()}>设置</button>
        </>
      )}

      {tab === 'download' && (
        <>
          {!downloaderEnabled && (
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="muted">资源下载器插件未启用，启用后即可扫描/下载当前页面资源。</div>
              <button className="primary" onClick={() => void enablePlugin('resource-downloader')}>启用资源下载器</button>
            </div>
          )}
          {downloaderEnabled && <ResourcePanel />}
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);