/** UI：Side Panel —— 增强总结主舞台（模式选择 → 进度 → 结果） */
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import type { SummaryOutput, SummaryMode, ProgressEvent } from '../../plugins/ai-summary/export';
import { api, activeTabId, onEvent } from '../shared/api';
import { buildMarkdown, buildJson, copyToClipboard } from '../shared/result';

const MODES: { id: SummaryMode; label: string; hint: string }[] = [
  { id: 'summary', label: '核心摘要', hint: '执行摘要 + 要点 + 结论（长文自动分段）' },
  { id: 'feasibility', label: '可行性', hint: '技术/成本/风险/工作量' },
  { id: 'pros-cons', label: '优缺点', hint: '结构化优缺点' },
  { id: 'compare', label: '同品类比较', hint: '网络搜索横向对比' },
];

interface ProviderStatus {
  label: string;
  model: string;
  ok: boolean;
  message: string;
  latencyMs?: number;
}

function App() {
  const [modes, setModes] = useState<SummaryMode[]>(['summary']);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<SummaryOutput | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerChecking, setProviderChecking] = useState(true);

  // 订阅进度事件
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
        setProvider({
          label,
          model: h.model ?? '',
          ok: h.ok,
          message: h.message ?? '',
          latencyMs: h.latencyMs,
        });
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

  const run = async () => {
    const tabId = await activeTabId();
    if (!tabId) return setErr('未找到活动标签页');
    if (!modes.length) return setErr('请至少选择一个模式');
    setBusy(true);
    setErr('');
    setProgress([]);
    setResult(null);
    try {
      const res = await api.summarize(tabId, modes);
      setResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (kind: 'md' | 'json') => {
    if (!result) return;
    await copyToClipboard(kind === 'md' ? buildMarkdown(result) : buildJson(result));
    setCopied(kind);
    setTimeout(() => setCopied(''), 1500);
  };

  const needConfig = /(API Key|未配置|无法连接|鉴权|Base|设置页)/.test(err);

  return (
    <div className="sp-root">
      <div className="statusbar">
        <strong>AI 总结</strong>
        <span className="muted">对当前页面</span>
        <span className="grow" />
        {providerChecking ? (
          <span className="muted">探测连接…</span>
        ) : provider ? (
          <span className={provider.ok ? 'badge ok' : 'badge bad'}>
            {provider.ok ? '● 已连接' : '● 未连接'} · {provider.label}
          </span>
        ) : null}
      </div>

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
              {result.pageType ? ` · 页面类型：${result.pageType}` : ''}
            </div>
          </section>

          <section>
            <h2>执行摘要</h2>
            <p>{result.executiveSummary}</p>
            {result.keyPoints.length > 0 && (
              <>
                <h3>要点</h3>
                <ul>{result.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
              </>
            )}
            {result.verdict && <><h3>结论</h3><p>{result.verdict}</p></>}
          </section>

          {result.feasibility && (
            <section>
              <h2>可行性调研</h2>
              <p><strong>{result.feasibility.verdict}</strong></p>
              {result.feasibility.aspects.length > 0 && (
                <table>
                  <thead><tr><th>方面</th><th>评估</th><th>风险</th></tr></thead>
                  <tbody>
                    {result.feasibility.aspects.map((a, i) => (
                      <tr key={i}><td>{a.name}</td><td>{a.assessment}</td><td>{a.risk}</td></tr>
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
              <table>
                <thead><tr><th>候选</th><th>一句话</th><th>适合</th></tr></thead>
                <tbody>
                  {result.comparison.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.url ? <a href={it.url} target="_blank" rel="noreferrer">{it.name} ↗</a> : it.name}</td>
                      <td>{it.summary}</td>
                      <td>{it.suitableFor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.comparison.items.map((it, i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <strong>{it.name}</strong>
                  {it.pros.length > 0 && <div>+ {it.pros.join('；')}</div>}
                  {it.cons.length > 0 && <div>- {it.cons.join('；')}</div>}
                </div>
              ))}
              {result.comparison.recommendation && <p><strong>建议：</strong>{result.comparison.recommendation}</p>}
              <p className="muted">信息来自搜索与页面分析，时效性请以来源为准。</p>
            </section>
          )}

          <div className="row">
            <button onClick={() => void copy('md')} disabled={copied === 'md'}>
              {copied === 'md' ? '已复制 ✓' : '复制 Markdown'}
            </button>
            <button onClick={() => void copy('json')} disabled={copied === 'json'}>
              {copied === 'json' ? '已复制 ✓' : '复制 JSON'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);