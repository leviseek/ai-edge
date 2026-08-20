/**
 * M7 冒烟：本地项目扫描器（facts-scan）解析 + KB 合并（纯函数）。
 * 运行：npm run smoke:m7
 */
import { parseMarkdownFacts } from '../../tools/facts-scan-lib.mjs';
import { mergeFacts, normalizeEntry } from '../src/plugins/project-facts/kb';
import type { FactEntry } from '../src/plugins/project-facts/types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log('\n[场景1] 扫描器：Markdown 章节 → 事实条目');
  {
    const md = [
      '## 已实现',
      '- 消息总线：Envelope 协议 + MessageBus 路由',
      '- 长文摘要分段合并：chunkText + SummarizeStage',
      '## 待办',
      '- 视频字幕二期',
      '## 架构',
      '- 基座分层：base / core / plugins',
    ].join('\n');
    const facts = parseMarkdownFacts(md, 'README.md');
    assert(facts.filter((f) => f.kind === '已实现').length === 2, '已实现 2 条');
    assert(facts.some((f) => f.kind === '已实现' && f.title === '消息总线' && f.detail.includes('Envelope')), '标题/详情解析正确');
    assert(facts.some((f) => f.kind === '待办' && f.title === '视频字幕二期'), '待办小节归属正确');
    assert(facts.every((f) => f.id && f.kind), '条目含稳定 id 与 kind');
  }

  console.log('\n[场景2] 合并：本地扫描结果并入 KB（kind+title 去重）');
  {
    const existing: FactEntry[] = [
      normalizeEntry({ id: 'u1', kind: '已实现', title: '消息总线', detail: '旧版详情' }) as FactEntry,
      normalizeEntry({ id: 'u2', kind: '决策', title: 'TypeScript strict' }) as FactEntry,
    ];
    const incoming: FactEntry[] = [
      { id: 's1', kind: '已实现', title: '消息总线', detail: '新版详情', path: 'src/base/message-bus.ts', tags: [], updatedAt: Date.now() },
      { id: 's2', kind: '待办', title: '视频字幕二期', detail: '', path: '', tags: [], updatedAt: Date.now() },
    ];
    const r = mergeFacts(existing, incoming);
    assert(r.added === 1 && r.updated === 1, `+${r.added} / 更新 ${r.updated}`);
    assert(r.list.length === 3, '总数 3（用户 2 + 新增 1）');
    assert(r.list[0].kind + ':' + r.list[0].title === '已实现:消息总线', '既有条目顺序保留在最前');
    const mb = r.list[0];
    assert(mb.detail === '新版详情' && mb.path === 'src/base/message-bus.ts', '扫描详情/路径覆盖旧条目但不重建');
    assert(r.list[1].id === 'u2', '用户条目 id 不变');
  }

  console.log('\n[场景3] 合并幂等：相同详情再次同步无变化');
  {
    const existing = [normalizeEntry({ kind: '已实现', title: 'A', detail: 'x' }) as FactEntry];
    const r = mergeFacts(existing, [{ ...existing[0], id: 'scan-xx' }]);
    assert(r.added === 0 && r.updated === 0 && r.list.length === 1, '重复详情不新增不更新');
  }

  console.log('\nM7 冒烟测试全部通过 ✅');
}

main().catch((e) => {
  console.error('\nM7 冒烟测试失败 ✗');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});