/** UI 共享：项目事实锚——事实 KB / 会话 Brief / 幻觉扫描（Popup 与 Side Panel 共用） */
import { useEffect, useState } from 'react';
import { rpc } from '../../shared/rpc';
import type { FactEntry, FactKind, HallucinationItem } from '../../plugins/project-facts/types';
import type { ScanMessage } from '../../plugins/project-facts/types';

const KINDS: FactKind[] = ['已实现', '决策', '架构', '待办', '限制'];

interface FactsResp {
  list: FactEntry[];
  count: number;
  kinds: string[];
}
interface ScanResp {
  host: string;
  supported: boolean;
  messages: ScanMessage[];
  factsCount: number;
  flagged: HallucinationItem[];
}

export function GroundingPanel() {
  const [facts, setFacts] = useState<FactEntry[]>([]);
  const [filter, setFilter] = useState<string>('全部');
  const [importText, setImportText] = useState('');
  const [brief, setBrief] = useState('');
  const [scan, setScan] = useState<ScanResp | null>(null);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // 新增/编辑表单
  const [editId, setEditId] = useState('');
  const [kind, setKind] = useState<FactKind>('已实现');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [path, setPath] = useState('');

  const refresh = async () => {
    try {
      const r = await rpc<unknown, FactsResp>('plugin:project-facts', 'facts', {});
      setFacts(r.list);
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async (list: Partial<FactEntry>[]) => {
    const r = await rpc<{ list: Partial<FactEntry>[] }, FactsResp>('plugin:project-facts', 'facts-save', { list });
    setFacts(r.list);
  };

  const submit = async () => {
    if (!title.trim()) return setErr('请输入标题');
    const next = editId
      ? facts.map((f) => (f.id === editId ? { ...f, kind, title: title.trim(), detail: detail.trim(), path: path.trim(), updatedAt: Date.now() } : f))
      : [...facts, { id: '', kind, title: title.trim(), detail: detail.trim(), path: path.trim(), tags: [], updatedAt: Date.now() }];
    await save(next);
    setEditId('');
    setTitle('');
    setDetail('');
    setPath('');
  };

  const remove = async (id: string) => {
    await save(facts.filter((f) => f.id !== id));
  };

  const doImport = async () => {
    if (!importText.trim()) return;
    try {
      const r = await rpc<{ text: string }, { added: number; total: number }>('plugin:project-facts', 'import', { text: importText });
      setMsg(`导入 ${r.added} 条，KB 共 ${r.total} 条`);
      setImportText('');
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  };

  const genBrief = async () => {
    const r = await rpc<unknown, { brief: string; count: number }>('plugin:project-facts', 'brief', {});
    setBrief(r.brief);
    setMsg(`已生成 Brief（基于 ${r.count} 条事实）`);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('已复制到剪贴板 ✓');
    } catch (e) {
      setErr(String(e));
    }
  };

  const doScan = async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t?.id) return setErr('未找到活动标签页');
    setScanning(true);
    setErr('');
    try {
      const r = await rpc<{ tabId: number }, ScanResp>('plugin:project-facts', 'scan', { tabId: t.id });
      setScan(r);
      setMsg(r.supported ? `扫描 ${r.messages.length} 条消息，发现疑似幻觉 ${r.flagged.length} 条（KB ${r.factsCount} 条）` : '当前站点不受支持');
    } catch (e) {
      setErr(String(e));
    } finally {
      setScanning(false);
    }
  };

  const shown = facts.filter((f) => filter === '全部' || f.kind === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {msg && <div className="ok">{msg}</div>}
      {err && <div className="err">{err}</div>}

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row">
          <span className="grow muted">事实库（{facts.length} 条）</span>
          <button onClick={() => void genBrief()}>生成 Brief</button>
          <button onClick={() => void doScan()} disabled={scanning}>{scanning ? '扫描中…' : '扫描当前会话'}</button>
        </div>
        {(msg || brief) && brief && (
          <div>
            <textarea rows={8} readOnly value={brief} style={{ fontFamily: 'monospace', fontSize: 11 }} />
            <button style={{ marginTop: 4 }} onClick={() => void copy(brief)}>复制会话 Brief</button>
          </div>
        )}
        {scan && (
          <div>
            <div className="muted">
              {scan.host} · 支持:{scan.supported ? '是' : '否'} · 消息 {scan.messages.length} · 疑似幻觉 {scan.flagged.length}
            </div>
            {scan.flagged.map((it, i) => (
              <div key={i} className="err" style={{ fontSize: 12, border: '1px solid #f0c6c9', borderRadius: 6, padding: 6, marginTop: 4 }}>
                ⚠ 「{it.claim}」（匹配度 {it.score.toFixed(2)}）
                <button style={{ marginLeft: 6 }} onClick={() => void copy(`请先核对：你提到的「${it.claim}」目前在项目里尚未实现（ai-edge 事实锚）。请按真实状态重新说明。`)}>
                  复制澄清
                </button>
              </div>
            ))}
            {scan.flagged.length === 0 && <div className="muted">未发现与 KB 冲突的“已完成”断言。</div>}
          </div>
        )}
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="muted">导入知识（Markdown 小节 / [KIND] 前缀 / JSON 数组）</div>
        <textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'## 已实现\n- XxxOffer 模块：...\n## 决策\n- 消息走 MessageBus 统一协议：...'} style={{ fontSize: 11 }} />
        <button onClick={() => void doImport()}>导入</button>
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="muted">新增 / 编辑事实</div>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as FactKind)} style={{ flex: '0 0 auto', width: 110 }}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题（必填）" />
        </div>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="代码路径（可选）" />
        <textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="详情（可选）" />
        <div className="row">
          <button className="primary" onClick={() => void submit()}>{editId ? '保存修改' : '添加'}</button>
          {editId && <button onClick={() => setEditId('')}>取消</button>}
        </div>
      </div>

      <div className="mode-row" style={{ gap: 4 }}>
        {['全部', ...KINDS].map((k) => (
          <span key={k} className={`mode-chip${filter === k ? ' on' : ''}`} style={{ fontSize: 12, padding: '3px 8px' }} onClick={() => setFilter(k)}>
            {k}
          </span>
        ))}
      </div>

      <div className="res-list panel" style={{ maxHeight: 360 }}>
        {shown.length ? (
          shown.map((f) => (
            <div className="res-item" key={f.id} style={{ alignItems: 'flex-start' }}>
              <span className="badge">{f.kind}</span>
              <span className="grow">
                <span style={{ fontWeight: 600 }}>{f.title}</span>
                {f.detail && <div className="muted" style={{ fontSize: 11 }}>{f.detail}</div>}
                {f.path && <div className="muted" style={{ fontSize: 10 }}>{f.path}</div>}
              </span>
              <button style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => { setEditId(f.id); setKind(f.kind); setTitle(f.title); setDetail(f.detail); setPath(f.path); }}>✎</button>
              <button style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => void remove(f.id)}>✕</button>
            </div>
          ))
        ) : (
          <div className="muted">还没有事实，先导入或用表单添加一条。</div>
        )}
      </div>
    </div>
  );
}