/** UI：Popup —— 概览（AI 总结入口 / 状态）+ 资源下载器 */
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { api, type PingResult } from '../shared/api';
import { rpc } from '../../shared/rpc';
import type { ResourceInfo, DownloadStatus } from '../../plugins/resource-downloader/types';
import { RESOURCE_CATEGORIES, formatSize } from '../../plugins/resource-downloader/classify';

type Tab = 'overview' | 'download';

function App() {
  const [ping, setPing] = useState<PingResult | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  // 资源下载器状态
  const [resources, setResources] = useState<ResourceInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [cat, setCat] = useState<string>('全部');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aiQuery, setAiQuery] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReason, setAiReason] = useState('');
  const [dlMsg, setDlMsg] = useState('');

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

  const enablePlugin = async (id: string, enabled = true) => {
    try {
      await api.setPluginEnabled(id, enabled);
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  };

  const scan = async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t?.id) return setErr('未找到活动标签页');
    setLoading(true);
    setErr('');
    setDlMsg('');
    setAiReason('');
    try {
      const list = await rpc<{ tabId: number }, ResourceInfo[]>('plugin:resource-downloader', 'list', { tabId: t.id });
      setResources(list);
      setSel(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => resources?.filter((r) => cat === '全部' || r.category === cat) ?? [], [resources, cat]);

  const toggleSel = (url: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  const aiFilter = async () => {
    if (!aiQuery.trim() || !resources) return;
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t?.id) return;
    setAiBusy(true);
    setErr('');
    try {
      const res = await rpc<{ tabId: number; query: string }, { selected: string[]; reason: string; total: number }>(
        'plugin:resource-downloader',
        'ai-filter',
        { tabId: t.id, query: aiQuery },
      );
      setSel(new Set(res.selected));
      setAiReason(`${res.reason}（命中 ${res.selected.length}/${res.total}）`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const download = async () => {
    if (!sel.size) return setDlMsg('请先选择要下载的资源');
    setDlMsg('');
    try {
      const res = await rpc<{ urls: string[] }, { okCount: number; failCount: number }>('plugin:resource-downloader', 'download', {
        urls: [...sel],
      });
      setDlMsg(`已发起下载：成功 ${res.okCount} / 失败 ${res.failCount}（见浏览器下载列表）`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const netSize = (list: ResourceInfo[]): string =>
    formatSize(list.reduce((s, r) => s + r.size, 0));

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
                    <button onClick={() => void enablePlugin(p.id, true)}>启用</button>
                  )}
                </div>
              ))
            ) : (
              <div className="muted">无插件（请重新加载扩展）</div>
            )}
          </div>

          <div className="panel">
            <div className="muted">默认模型</div>
            <div>
              {ping
                ? ping.providers.find((p) => p.id === ping.activeProviderId)?.label ?? ping.activeProviderId
                : '—'}
            </div>
          </div>

          {downloaderEnabled && (
            <div className="panel">
              <div className="muted">资源下载器</div>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="primary grow" onClick={scan} disabled={loading}>
                  {loading ? '扫描中…' : '🔍 扫描当前页资源'}
                </button>
                {resources && (
                  <button onClick={() => setTab('download')}>查看列表（{resources.length}）</button>
                )}
              </div>
            </div>
          )}

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
          {downloaderEnabled && (
          <>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row">
              <button className="primary grow" onClick={scan} disabled={loading}>
                {loading ? '扫描中…' : `🔍 扫描（当前${resources ? resources.length : 0}项）`}
              </button>
              {resources && resources.length > 0 && (
                <button
                  onClick={() => setSel(resources.length === sel.size ? new Set() : new Set(resources.map((r) => r.url)))}
                >
                  {resources.length === sel.size ? '全不选' : '全选'}
                </button>
              )}
              <button onClick={download} disabled={!sel.size}>下载({sel.size})</button>
            </div>
            {resources && resources.length > 0 && (
              <div>
                <input value={aiQuery} placeholder="AI 筛选：如 高清 banner 图 / 视频" onChange={(e) => setAiQuery(e.target.value)} />
                <button style={{ marginTop: 4 }} onClick={() => void aiFilter()} disabled={aiBusy || !aiQuery.trim()}>
                  {aiBusy ? 'AI 筛选中…' : '✨ AI 筛选'}
                </button>
                {aiReason && <div className="muted">{aiReason}</div>}
              </div>
            )}
            {dlMsg && <div className="ok">{dlMsg}</div>}
            {resources && (
              <div className="muted">已选 {sel.size} 项 · 合计 {netSize(shown)}</div>
            )}
          </div>

          {resources && (
            <>
              <div className="mode-row" style={{ gap: 4 }}>
                {['全部', ...RESOURCE_CATEGORIES].map((c) => (
                  <span
                    key={c}
                    className={`mode-chip${cat === c ? ' on' : ''}`}
                    style={{ fontSize: 12, padding: '3px 8px' }}
                    onClick={() => setCat(c)}
                  >
                    {c}
                  </span>
                ))}
              </div>
              <div className="res-list panel">
                {shown.length ? (
                  shown.map((r) => (
                    <div className="res-item" key={r.url}>
                      <input type="checkbox" checked={sel.has(r.url)} onChange={() => toggleSel(r.url)} style={{ width: 'auto' }} />
                      <span className="grow res-name" title={r.url}>{r.name}</span>
                      {r.size > 0 && <span className="muted res-size">{formatSize(r.size)}</span>}
                      <span className="badge">{r.category}</span>
                    </div>
                  ))
                ) : (
                  <div className="muted">{loading ? '扫描中…' : '该分类暂无资源'}</div>
                )}
              </div>
            </>
          )}
          {!resources && !loading && <div className="muted">点「扫描当前页资源」开始采集</div>}
          </>
          )}
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);