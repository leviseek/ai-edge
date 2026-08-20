/** UI：Side Panel —— 增强总结主舞台（流式实时渲染 + 进度条 + 结构化/Markdown 双视图） */
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SummaryOutput, SummaryMode, ProgressEvent } from '../../plugins/ai-summary/export';
import { api, activeTabId, onEvent } from '../shared/api';
import { buildMarkdown, buildJson, copyToClipboard } from '../shared/result';
import { renderMarkdown } from '../shared/markdown-render';
import { ensureNetworkPermission } from '../shared/net-permission';
import { ResourcePanel } from '../shared/ResourcePanel';

const MODES: { id: SummaryMode; label: string; hint: string }[] = [
  { id: 'summary', label: '核心摘要', hint: '执行摘要 + 要点 + 结论（长文自动分段）' },
  { id: 'feasibility', label: '可行性', hint: '技术/成本/风险/工作量' },
  { id: 'pros-cons', label: '优缺点', hint: '结构化优缺点' },
  { id: 'compare', label: '同品类比较', hint: '网络搜索 + 候选深抓横向对比' },
];

interface ProviderStatus {
  label: string;
  model: string;
  ok: boolean;
  message: string;
  latencyMs?: number;
}

interface StreamMsg {
  type?: string;
  delta?: string;
  ev?: ProgressEvent;
  result?: SummaryOutput;
  message?: string;
}

function Verified({ v }: { v: 'ok' | 'fail' | 'skip' | undefined }) {
  if (v === 'ok') return <span className="verified-ok" title="来源可达"> ✓</span>;
  if (v === 'fail') return <span className="verified-fail" title="来源不可达/404"> ✗</span>;
  return <span className="verified-skip" title="未验证"> ·</span>;
}

function App() {
  const [modes, setModes] = useState<SummaryMode[]>(['summary']);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState<SummaryOutput | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const [hint, setHint] = useState('');
  const [viewMode, setViewMode] = useState<'structured' | 'md'>('structured');
  const [section, setSection] = useState<'summary' | 'download'>('summary');
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerChecking, setProviderChecking] = useState(true);
  const busyRef = useRef(false);

  // RPC 路径的全局进度广播（仅 fallback 时用）
  useEffect(() => {
    const off = onEvent('plugin:ai-summary:progress', (data) => {
      const ev = data as ProgressEvent;
      setProgress((p) => (p.length && p[p.length - 1]?.message === ev.message ? p : [...p, ev]));
    });
    return off;
  }, []);

  // 载入时探测当前 AI 提供商（一键冒烟）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ping = await api.ping();
        const pid = ping.activeProviderId;
        const label = ping.providers.find((p) => p.id === pid)?.label ?? pid;
        const h = await api.healthCheckProvider(pid);
        if (!alive) return;
        setProvider({ label, model: h.model ?? '', ok: h.ok, message: h.message ?? '', latencyMs: h.latencyMs });
        if (!h.ok) setHint(`AI 提供商「${label}」连接异常：${h.message ?? ''}（可到设置页配置）`);
      } catch (e) {
        if (alive) setProvider({ label: '？', model: '', ok: false, message: String(e) });
      } finally {
        if (alive) setProviderChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 整体进度 = 最近进度事件 (step+progress)/steps，单调递增
  const overall = useMemo(() => {
    let best = 0;
    if (busy || result || progress.length) {
      for (const e of progress) {
        if (typeof e.step === 'number' && typeof e.steps === 'number' && e.steps > 0) {
          const f = (e.step + (e.progress ?? 0)) / e.steps;
          if (f > best) best = f;
        }
      }
    }
    return Math.max(0, Math.min(1, best));
  }, [progress, busy, result]);

  const toggle = (m: SummaryMode) => {
    setModes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  };

  const finishRun = () => {
    busyRef.current = false;
    setBusy(false);
  };

  const run = async () => {
    const tabId = await activeTabId();
    if (!tabId) return setErr('未找到活动标签页');
    if (!modes.length) return setErr('请至少选择一个模式');
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErr('');
    setHint('');
    setProgress([]);
    setStreamText('');
    setResult(null);

    // 运行时网络授权（首次会弹窗；拒绝则搜索/深抓受限）
    const granted = await ensureNetworkPermission();
    if (!granted) setHint('未授予网络权限：联网分析/搜索可能受限（可在授权弹窗中允许）。');

    const request = { tabId, modes };
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      finishRun();
    };

    let port: chrome.runtime.Port | null = null;
    try {
      port = chrome.runtime.connect({ name: 'ai-summary-stream' });
    } catch {
      port = null;
    }
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const clearWatchdog = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    const cleanupPort = () => {
      clearWatchdog();
      try {
        port?.disconnect();
      } catch {
        /* noop */
      }
    };
    const rpcRun = (): Promise<void> => {
      clearWatchdog();
      return api
        .summarize(tabId, modes)
        .then((res) => {
          setResult(res);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
        .finally(done);
    };

    if (!port) {
      void rpcRun();
      return;
    }

    watchdog = setTimeout(() => {
      port?.disconnect();
      void rpcRun();
    }, 3000);

    port.onMessage.addListener((msg: StreamMsg) => {
      clearWatchdog();
      if (msg.type === 'token') {
        setStreamText((s) => s + (msg.delta ?? ''));
      } else if (msg.type === 'progress' && msg.ev) {
        setProgress((p) => [...p, msg.ev as ProgressEvent]);
      } else if (msg.type === 'result' && msg.result) {
        setResult(msg.result);
        cleanupPort();
        done();
      } else if (msg.type === 'error') {
        setErr(msg.message ?? '流式生成失败');
        cleanupPort();
        done();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!finished) {
        void rpcRun();
      }
    });
    port.postMessage({ type: 'start', request });
  };

  const copy = async (kind: 'md' | 'json') => {
    if (!result) return;
    await copyToClipboard(kind === 'md' ? buildMarkdown(result) : buildJson(result));
    setCopied(kind);
    setTimeout(() => setCopied(''), 1500);
  };

  const needConfig = /(API Key|未配置|无法连接|鉴权|Base|设置页|注入|受限|权限|刷新)/.test(err);

  return (
    <div className="sp-root">
      <div className="statusbar">
        <strong>ai-edge</strong>
        <span className="grow" />
        <span className="row">
          <button className={section === 'summary' ? 'primary' : ''} onClick={() => setSection('summary')}>AI 总结</button>
          <button className={section === 'download' ? 'primary' : ''} onClick={() => setSection('download')}>资源下载</button>
        </span>
        {section === 'summary' && (providerChecking ? (
          <span className="muted">探测连接…</span>
        ) : provider ? (
          <span className={provider.ok ? 'badge ok' : 'badge bad'}>
            {provider.ok ? '● 已连接' : '● 未连接'} · {provider.label}
          </span>
        ) : null)}
      </div>

      {section === 'download' ? (
        <ResourcePanel />
      ) : (
        <>
      <div className="mode-row">
        {MODES.map((m) => (
          <div
            key={m.id}
            className={`mode-chip${modes.includes(m.id) ? ' on' : ''}`}
            title={m.hint}
            onClick={() => toggle(m.id)}
          >
            <input type="checkbox" checked={modes.includes(m.id)} readOnly style={{ width: 'auto', pointerEvents: 'none' }} />
            {m.label}
          </div>
        ))}
      </div>

      <button className="primary" onClick={() => void run()} disabled={busy}>
        {busy ? '生成中…' : '开始总结'}
      </button>

      {hint && <div className="muted">{hint}</div>}

      {(busy || progress.length > 0) && (
        <div>
          <div className="progress-wrap">
            <div className="progress-fill" style={{ width: `${overall * 100}%` }} />
          </div>
          <div className="progress-list">
            {progress.map((p, i) => (
              <div key={i} className={i === progress.length - 1 ? 'cur' : ''}>
                {p.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {busy && streamText && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="muted">实时生成摘要（预览）…</span>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{streamText}<span className="cur">▌</span></p>
        </div>
      )}

      {err && (
        <div className="err">
          {err}
          {needConfig && (
            <div>
              <button style={{ marginTop: 6 }} onClick={() => void chrome.runtime.openOptionsPage()}>
                去设置页配置
              </button>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="result">
          <section>
            <div className="kv">
              <span>{result.meta.title}</span>
              <a href={result.meta.url} target="_blank" rel="noreferrer">原文 ↗</a>
            </div>
            <div className="muted">
              模型 {result.meta.providerLabel} / {result.meta.model} · {result.meta.durationMs}ms
              {result.meta.usedFallback && (
                <span className="badge" style={{ marginLeft: 6, background: '#fff3e0', color: '#b26a00' }}>自动降级</span>
              )}
              {result.pageType ? ` · 页面类型：${result.pageType}` : ''}
            </div>
          </section>

          <div className="row">
            <button className={viewMode === 'structured' ? 'primary' : ''} onClick={() => setViewMode('structured')}>
              结构化
            </button>
            <button className={viewMode === 'md' ? 'primary' : ''} onClick={() => setViewMode('md')}>
              Markdown 报告
            </button>
          </div>

          {viewMode === 'md' ? (
            <section>
              <div className="md">{renderMarkdown(buildMarkdown(result))}</div>
            </section>
          ) : (
            <>
              <section>
                <h2>执行摘要</h2>
                <div className="md">{renderMarkdown(result.executiveSummary)}</div>
                {result.keyPoints.length > 0 && (
                  <>
                    <h3>要点</h3>
                    <ul>{result.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
                  </>
                )}
                {result.verdict && <><h3>结论</h3><div className="md">{renderMarkdown(result.verdict)}</div></>}
              </section>

              {result.feasibility && (
                <section>
                  <h2>可行性调研</h2>
                  <div className="md">{renderMarkdown(result.feasibility.verdict)}</div>
                  {result.feasibility.aspects.length > 0 && (
                    <table>
                      <thead><tr><th>方面</th><th>评估</th><th>风险</th></tr></thead>
                      <tbody>
                        {result.feasibility.aspects.map((a, i) => (
                          <tr key={i}>
                            <td>{a.name}</td>
                            <td className="md">{renderMarkdown(a.assessment)}</td>
                            <td>{a.risk}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {result.feasibility.effortEstimate && <p className="muted">工作量：{result.feasibility.effortEstimate}</p>}
                </section>
              )}

              {result.prosCons && (
                <section>
                  <h2>优缺点</h2>
                  <h3>优点</h3>
                  <ul>{result.prosCons.pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  <h3>缺点</h3>
                  <ul>{result.prosCons.cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </section>
              )}

              {result.comparison && (
                <section>
                  <h2>同品类比较{result.comparison.category ? `（${result.comparison.category}）` : ''}</h2>
                  {result.comparison.at && (
                    <p className="muted">信息截至 {new Date(result.comparison.at).toLocaleString()} · 时效性请以最新来源为准</p>
                  )}
                  <table>
                    <thead><tr><th>候选</th><th>一句话</th><th>适合</th></tr></thead>
                    <tbody>
                      {result.comparison.items.map((it, i) => (
                        <tr key={i}>
                          <td>
                            {it.url ? <a href={it.url} target="_blank" rel="noreferrer">{it.name} ↗</a> : it.name}
                            <Verified v={it.verified} />
                          </td>
                          <td className="md">{renderMarkdown(it.summary)}</td>
                          <td>{it.suitableFor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted">✓ 来源可达 · ✗ 不可达/404 · · 未验证</p>
                  {result.comparison.items.map((it, i) => (
                    <div key={i} style={{ marginTop: 10 }}>
                      <strong>{it.name}</strong>
                      {it.pros.length > 0 && <div>+ {it.pros.join('；')}</div>}
                      {it.cons.length > 0 && <div>- {it.cons.join('；')}</div>}
                    </div>
                  ))}
                  {result.comparison.recommendation && (
                    <p><strong>建议：</strong><span className="md">{renderMarkdown(result.comparison.recommendation)}</span></p>
                  )}
                </section>
              )}
            </>
          )}

          <div className="row">
            <button onClick={() => void copy('md')} disabled={copied === 'md'}>
              {copied === 'md' ? '已复制 ✓' : '复制 Markdown'}
            </button>
            <button onClick={() => void copy('json')} disabled={copied === 'json'}>
              {copied === 'json' ? '已复制 ✓' : '复制 JSON'}
            </button>
          </div>
          <p className="muted">由 ai-edge 生成 · AI 输出可能存在偏差，请以原始来源为准</p>
        </div>
      )}
      </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);