/**
 * M6 冒烟：项目事实锚（去幻觉）——导入解析 / Brief / 断言提取 / 幻觉检测（纯函数，无网络）。
 * 运行：npm run smoke:m6
 */
import {
  parseImport,
  buildBrief,
  hasAssertion,
  extractClaim,
  checkClaim,
  detectHallucinations,
  buildClarify,
  normalizeEntry,
} from '../src/plugins/project-facts/kb';
import type { FactEntry, ScanMessage } from '../src/plugins/project-facts/types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log('\n[场景1] 导入解析（Markdown 小节 / [KIND] 前缀 / JSON）');
  {
    const md = [
      '## 已实现',
      '- 消息总线：Envelope 协议 + MessageBus 路由',
      '- 长文摘要分段合并：chunkText + SummarizeStage',
      '## 决策',
      '- 使用 TypeScript strict，UI 用 React',
      '- [限制] API Key 仅存本机扩展存储',
    ].join('\n');
    const entries = parseImport(md);
    assert(entries.filter((e) => e.kind === '已实现').length === 2, '已实现 2 条');
    assert(entries.filter((e) => e.kind === '决策').length === 1, '决策 1 条');
    assert(entries.some((e) => e.kind === '限制' && e.title.includes('API Key')), '[限制] 前缀条目正确');

    const json = JSON.stringify([
      { kind: '已实现', title: 'fallback 链', detail: '自动降级' },
      { kind: '待办', title: '资源下载器二期' },
    ]);
    const je = parseImport(json);
    assert(je.length === 2 && je[0].kind === '已实现', 'JSON 数组导入');
  }

  console.log('\n[场景2] 会话锚定 Brief');
  {
    const facts: FactEntry[] = [
      normalizeEntry({ kind: '已实现', title: '消息总线', detail: 'Envelope 协议' }) as FactEntry,
      normalizeEntry({ kind: '决策', title: 'TypeScript strict' }) as FactEntry,
      normalizeEntry({ kind: '待办', title: 'M5 二期' }) as FactEntry,
    ];
    const brief = buildBrief(facts);
    assert(brief.includes('## 已实现') && brief.includes('消息总线'), '包含已实现清单');
    assert(brief.includes('## 待办 / 未实现') && brief.includes('M5 二期'), '包含待办');
    assert(brief.includes('不要默认为已存在'), '包含防幻觉规则');
    assert(brief.indexOf('## 已实现') < brief.indexOf('## 待办'), '顺序：已实现在待办前');
  }

  console.log('\n[场景3] 断言提取与匹配');
  {
    const facts = [normalizeEntry({ kind: '已实现', title: '消息总线 MessageBus' }) as FactEntry];
    const claimHit = '当前实现已经改成了 MessageBus 统一协议';
    assert(hasAssertion(claimHit), '识别“当前实现已经改成”类断言');
    assert(hasAssertion('今天天气很好') === false, '普通句不误报');
    const claim = extractClaim('当前版本已经实现了时钟同步模块');
    assert(claim.length >= 4, `提取断言短语（${claim}）`);
    assert(checkClaim(facts, '当前实现使用 MessageBus 统一协议').found, '命中 KB：MessageBus 判定为已实现');
    assert(checkClaim(facts, '当前版本已经实现了时钟同步').found === false, '未见 KB：时钟同步判定为未实现');
  }

  console.log('\n[场景4] 会话幻觉检测 + 澄清话术');
  {
    const facts = [normalizeEntry({ kind: '已实现', title: '消息总线 MessageBus' }) as FactEntry];
    const messages: ScanMessage[] = [
      { role: 'assistant', text: '我们之前已经实现了消息总线，你直接在它上面加即可。' },
      { role: 'assistant', text: '另外当前版本已经实现了多语言字幕切换，下一步做导出。' },
      { role: 'user', text: '好的。' },
    ];
    const flagged = detectHallucinations(facts, messages);
    assert(flagged.length === 1, `仅 1 条被标记（实际 ${flagged.length}：${flagged.map((f) => f.claim).join('，')}）`);
    const clarify = buildClarify('多语言字幕切换');
    assert(clarify.includes('尚未实现') && clarify.includes('多语言字幕切换'), '澄清话术包含事实与断言');
  }

  console.log('\nM6 冒烟测试全部通过 ✅');
}

main().catch((e) => {
  console.error('\nM6 冒烟测试失败 ✗');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});