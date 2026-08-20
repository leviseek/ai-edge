/** UI：Options —— AI 提供商 / 搜索服务 / 插件启停 / 健康检查 */
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { BaseSettings, ProviderConfig, SearchConfig } from '../../base/settings';
import { api, type PingResult, type ProviderHealth } from '../shared/api';
import { hasNetworkPermission, ensureNetworkPermission } from '../shared/net-permission';

function App() {
  const [settings, setSettings] = useState<BaseSettings | null>(null);
  const [ping, setPing] = useState<PingResult | null>(null);
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [netPerm, setNetPerm] = useState(true);

  useEffect(() => {
    void Promise.all([api.getSettings(), api.ping()])
      .then(async ([s, p]) => {
        setSettings(structuredClone(s));
        setPing(p);
        // 自动冒烟：加载即检查默认提供商
        const pid = p.activeProviderId;
        const h = await api.healthCheckProvider(pid);
        setHealth((m) => ({ ...m, [pid]: h }));
      })
      .catch((e) => setErr(String(e)));
  }, []);

  // 展示当前网络授权状态（不自动弹窗）
  useEffect(() => {
    void hasNetworkPermission().then(setNetPerm).catch(() => undefined);
  }, []);

  if (!settings) return <div className="opt-root"><div className="err">{err || '加载中…'}</div></div>;

  const setProvider = (id: string, patch: Partial<ProviderConfig>) => {
    setSettings((s) => (s ? { ...s, ai: { ...s.ai, providers: { ...s.ai.providers, [id]: { ...s.ai.providers[id], ...patch } as ProviderConfig } } } : s));
  };
  const setSearch = (id: string, patch: Partial<SearchConfig>) => {
    setSettings((s) => (s ? { ...s, search: { ...s.search, services: { ...s.search.services, [id]: { ...s.search.services[id], ...patch } as SearchConfig } } } : s));
  };
  const setActiveProvider = (id: string) => setSettings((s) => (s ? { ...s, ai: { ...s.ai, activeProviderId: id } } : s));
  const setActiveSearch = (id: string) => setSettings((s) => (s ? { ...s, search: { ...s.search, activeServiceId: id } } : s));

  const save = async () => {
    if (!settings) return;
    setErr('');
    try {
      const updated = await api.updateSettings({
        ai: settings.ai,
        search: settings.search,
        ui: settings.ui,
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const check = async (providerId: string) => {
    const granted = await ensureNetworkPermission();
    setNetPerm(granted);
    if (!granted) {
      setHealth((m) => ({ ...m, [providerId]: { providerId, ok: false, message: '未授予网络权限（请点击“允许联网”）' } }));
      return;
    }
    const h = await api.healthCheckProvider(providerId);
    setHealth((m) => ({ ...m, [providerId]: h }));
  };

  const grantNet = async () => {
    const ok = await ensureNetworkPermission();
    setNetPerm(ok);
  };

  const reset = async () => {
    if (!window.confirm('确定恢复默认设置并清除已保存的 API Key 吗？')) return;
    setErr('');
    try {
      const s = await api.resetSettings();
      setSettings(s);
      setHealth({});
      setPing(await api.ping());
    } catch (e) {
      setErr(String(e));
    }
  };

  const togglePlugin = async (id: string, enabled: boolean) => {
    const state = await api.setPluginEnabled(id, enabled);
    setPing((p0) => (p0 ? { ...p0, plugins: p0.plugins.map((pl) => (pl.id === id ? { ...pl, state } : pl)) } : p0));
  };

  const addProvider = () => {
    const id = 'custom-' + Date.now().toString(36).slice(-4);
    setSettings((s) =>
      s ? { ...s, ai: { ...s.ai, providers: { ...s.ai.providers, [id]: { kind: 'openai-compat', label: '自定义', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' } } } } : s,
    );
  };

  const removeProvider = (id: string) => {
    if (!settings) return;
    const providers = { ...settings.ai.providers };
    delete providers[id];
    const nextActive = settings.ai.activeProviderId === id ? Object.keys(providers)[0] ?? settings.ai.activeProviderId : settings.ai.activeProviderId;
    setSettings((s) => (s ? { ...s, ai: { ...s.ai, providers, activeProviderId: nextActive } } : s));
  };

  return (
    <div className="opt-root">
      <h1>ai-edge 设置</h1>

      {ping && health[ping.activeProviderId] && (
        <div
          className="panel"
          style={{ borderLeft: `4px solid ${health[ping.activeProviderId].ok ? 'var(--ok)' : 'var(--danger)'}` }}
        >
          <div className="row">
            <span className="grow">
              <strong>{ping.providers.find((p) => p.id === ping.activeProviderId)?.label ?? ping.activeProviderId}</strong>{' '}
              <span className={health[ping.activeProviderId].ok ? 'ok' : 'err'}>
                {health[ping.activeProviderId].ok ? '✓ 已连接' : '✗ 未连接'}
              </span>
            </span>
            <span className="muted">
              {health[ping.activeProviderId].model ? `${health[ping.activeProviderId].model} · ` : ''}
              {health[ping.activeProviderId].latencyMs !== undefined ? `${health[ping.activeProviderId].latencyMs}ms` : ''}
            </span>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>{health[ping.activeProviderId].message}</div>
        </div>
      )}

      <div className="panel">
        <h2>AI 提供商</h2>
        <div className="muted">API Key 仅保存在本机扩展存储，只由后台服务读取</div>
        {Object.entries(settings.ai.providers).map(([id, p]) => (
          <div key={id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 8 }}>
            <div className="row">
              <span className="grow"><strong>{p.label ?? id}</strong></span>
              <input type="radio" checked={settings.ai.activeProviderId === id} onChange={() => setActiveProvider(id)} title="设为默认" />
              <button onClick={() => void check(id)}>检查</button>
              {id.startsWith('custom-') && <button onClick={() => removeProvider(id)}>删除</button>}
            </div>
            <div className="opt-grid" style={{ marginTop: 8 }}>
              <div className="field"><span>标识</span><input value={id} readOnly /></div>
              <div className="field"><span>名称</span><input value={p.label ?? ''} onChange={(e) => setProvider(id, { label: e.target.value })} /></div>
              <div className="field"><span>Base URL</span><input value={p.baseUrl} onChange={(e) => setProvider(id, { baseUrl: e.target.value })} /></div>
              <div className="field"><span>模型</span><input value={p.model} onChange={(e) => setProvider(id, { model: e.target.value })} placeholder="如 deepseek-chat" /></div>
              <div className="field"><span>API Key（留空表示无鉴权，如本地 Ollama）</span><input type="password" value={p.apiKey} onChange={(e) => setProvider(id, { apiKey: e.target.value })} autoComplete="off" /></div>
            </div>
            {health[id] && (
              <div className={`muted ${health[id].ok ? 'ok' : 'err'}`} style={{ marginTop: 6 }}>
                {health[id].ok ? '✓ ' : '✗ '}{health[id].message}（{health[id].latencyMs}ms）
              </div>
            )}
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={addProvider}>+ 新增提供商</button>
        </div>
      </div>

      <div className="panel">
        <h2>搜索服务（用于同品类横向比较）</h2>
        {Object.entries(settings.search.services).map(([id, s]) => (
          <div key={id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 8 }}>
            <div className="row">
              <span className="grow"><strong>{s.label ?? id}</strong></span>
              <input type="radio" checked={settings.search.activeServiceId === id} onChange={() => setActiveSearch(id)} title="设为默认" />
            </div>
            <div className="opt-grid" style={{ marginTop: 8 }}>
              {s.kind === 'searxng' && (
                <div className="field"><span>Base URL</span><input value={s.baseUrl ?? ''} onChange={(e) => setSearch(id, { baseUrl: e.target.value })} placeholder="http://localhost:8080" /></div>
              )}
              {s.kind === 'tavily' && (
                <div className="field"><span>API Key</span><input type="password" value={s.apiKey ?? ''} onChange={(e) => setSearch(id, { apiKey: e.target.value })} autoComplete="off" /></div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>插件</h2>
        {(ping?.plugins ?? []).map((p) => {
          const enabled = p.state === 'active' || p.state === 'activating';
          return (
            <div className="row" key={p.id} style={{ marginTop: 6 }}>
              <span className="grow">
                <strong>{p.name}</strong> <span className="muted">{p.version} · {p.description}</span>
              </span>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={enabled} onChange={(e) => void togglePlugin(p.id, e.target.checked)} style={{ width: 'auto' }} />
                启用
              </label>
              {p.error && <span className="err">{p.error}</span>}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2>数据与隐私</h2>
        <ul style={{ margin: '6px 0 10px', paddingLeft: 20 }}>
          <li>API Key 仅保存在本机扩展存储（chrome.storage.local），只由后台 Service Worker 读取，Content 脚本永远接触不到。</li>
          <li>使用「AI 总结」时，当前页面提取的正文会发送给你自选的 AI 提供商；「同品类比较」会额外把查询发给配置的搜索服务，并对候选页发起抓取。</li>
          <li>无任何遥测/统计上报；所有历史仅存在于本机与对应 AI/搜索服务间。</li>
        </ul>
        <div className="row">
          <span className="grow">
            网络访问权限：<span className={netPerm ? 'ok' : 'err'}>{netPerm ? '已授予' : '未授予'}</span>
            <span className="muted">（用于 AI / 搜索 / 候选深抓，按需在运行时申请）</span>
          </span>
          <button onClick={() => void grantNet()}>{netPerm ? '重新确认' : '允许联网'}</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button style={{ color: 'var(--danger)' }} onClick={() => void reset()}>恢复默认设置（清除 Key）</button>
        </div>
      </div>

      <div className="row">
        <button className="primary" onClick={() => void save()}>保存设置</button>
        {saved && <span className="ok">已保存 ✓</span>}
        {err && <span className="err">{err}</span>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);