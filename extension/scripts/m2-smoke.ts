/**
 * M2 冒烟：验证「长文多 chunk 分段摘要 + 合并」的核心流水线逻辑。
 * 用 mock AIProvider（不发真实请求），断言调用序列与产出结构。
 * 运行：npm run smoke:summary
 */
import { chunkText } from '../src/core/extract/chunker';
import { Pipeline, type StageContext } from '../src/core/pipeline/pipeline';
import { Logger } from '../src/base/logger';
import { ClassifyStage } from '../src/plugins/ai-summary/stages/classify';
import { SummarizeStage, SUMMARIZE_DEFAULTS } from '../src/plugins/ai-summary/stages/summarize';
import type { AIProvider, ChatMessage, ChatResult, ChatChunk, ModelInfo, HealthResult } from '../src/core/ai/provider';
import type { SummaryFlow } from '../src/plugins/ai-summary/types';

type CallKind = 'classify' | 'single' | 'chunk' | 'merge';

class MockProvider implements AIProvider {
  readonly id = 'mock';
  readonly label = 'Mock';
  calls: CallKind[] = [];

  kind(u: string): CallKind {
    if (u.includes('综合这些分段摘要')) return 'merge';
    if (u.includes('被切分后的第')) return 'chunk';
    if (u.includes('"pageType"')) return 'classify';
    return 'single';
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const last = messages[messages.length - 1].content;
    const k = this.kind(last);
    this.calls.push(k);
    return { text: this.respond(k), model: 'mock-model' };
  }

  private respond(k: CallKind): string {
    switch (k) {
      case 'classify':
        return JSON.stringify({ pageType: '文章', entity: 'MockProject', category: '测试', keywords: ['mock'] });
      case 'chunk':
        return JSON.stringify({ summary: '分段摘要：本段核心要点。' });
      case 'merge':
        return JSON.stringify({ executiveSummary: '合并后的全文摘要', keyPoints: ['要点一', '要点二'], verdict: '结论mock' });
      default:
        return JSON.stringify({ executiveSummary: '单段摘要', keyPoints: ['k1'], verdict: 'v1' });
    }
  }

  async *chatStream(): AsyncIterable<ChatChunk> {
    /* 未使用 */
  }
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async healthCheck(): Promise<HealthResult> {
    return { ok: true };
  }
}

function makeCtx(emit: (s: string, m: string, p?: number) => void): StageContext {
  return { log: new Logger('smoke'), signal: new AbortController().signal, step: 0, steps: 1, emit };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  const paragraph = 'M2 冒烟段落：ai-edge 是一个基座加插件的浏览器扩展架构。';
  // 场景 1：长文（>1 chunk）→ 逐段摘要 + 合并
  console.log('\n[场景1] 长文多 chunk（期望 classify → N×chunk → merge）');
  {
    const body = paragraph.repeat(400); // ~13000 字符 → 默认 8000 切 2 段
    const chunks = chunkText(body, SUMMARIZE_DEFAULTS.chunkMaxChars, SUMMARIZE_DEFAULTS.chunkOverlap);
    console.log(`  文本长度=${body.length}，预期分段数=${chunks.length}`);
    assert(chunks.length >= 2, `长文应切成 >=2 段（实际 ${chunks.length}）`);

    const mock = new MockProvider();
    const flow0: SummaryFlow = { extract: { title: 'T', url: 'https://x.example', lang: 'zh', byline: '', text: body, charCount: body.length }, model: '' };
    const flow = (await new Pipeline([new ClassifyStage(mock), new SummarizeStage(mock)]).run(flow0, makeCtx(() => undefined))) as SummaryFlow;
    assert(flow.core?.executiveSummary === '合并后的全文摘要', '合并输出被采用（executiveSummary 正确）');
    assert(flow.core?.keyPoints.length === 2, '合并 keyPoints 为 2 条');
    assert(flow.model === 'mock-model', 'model 传递正确');

    const chunksDone = mock.calls.filter((c) => c === 'chunk').length;
    const merges = mock.calls.filter((c) => c === 'merge').length;
    assert(chunksDone === chunks.length, `逐段摘要调用数 = 分段数（${chunksDone} === ${chunks.length}）`);
    assert(merges === 1, `合并仅 1 次（实际 ${merges}）`);
    assert(mock.calls[0] === 'classify', '首个 LLM 调用为分类（顺序正确）');
    assert(mock.calls[mock.calls.length - 1] === 'merge', '末次调用为合并');
  }

  // 场景 2：短文 → 单次成形，无分段/合并
  console.log('\n[场景2] 短文单段（期望 classify → single）');
  {
    const body = paragraph.repeat(5); // ~320 字符
    const mock = new MockProvider();
    const flow0: SummaryFlow = { extract: { title: 'T2', url: 'u', lang: 'zh', byline: '', text: body, charCount: body.length }, model: '' };
    const flow = (await new Pipeline([new ClassifyStage(mock), new SummarizeStage(mock)]).run(flow0, makeCtx(() => undefined))) as SummaryFlow;
    assert(flow.core?.executiveSummary === '单段摘要', '短文走单段摘要路径');
    assert(!mock.calls.includes('chunk') && !mock.calls.includes('merge'), '短文不触发分段/合并');
  }

  // 场景 3：超长文 → 上限截断，仍产出合并摘要
  console.log('\n[场景3] 超长文截断（期望 chunk 调用数 = maxChunks）');
  {
    const body = paragraph.repeat(6000); // ~360k 字符
    const mock = new MockProvider();
    const flow0: SummaryFlow = { extract: { title: 'T3', url: 'u3', lang: 'zh', byline: '', text: body, charCount: body.length }, model: '' };
    const flow = (await new Pipeline([new ClassifyStage(mock), new SummarizeStage(mock)]).run(flow0, makeCtx(() => undefined))) as SummaryFlow;
    const chunksDone = mock.calls.filter((c) => c === 'chunk').length;
    assert(chunksDone === SUMMARIZE_DEFAULTS.maxChunks, `截断为 maxChunks=${SUMMARIZE_DEFAULTS.maxChunks} 段（实际 ${chunksDone}）`);
    assert(flow.core?.executiveSummary === '合并后的全文摘要', '超长文仍产出合并摘要');
  }

  console.log('\nM2 冒烟测试全部通过 ✅');
  await Promise.resolve();
}

main().catch((e) => {
  console.error('\nM2 冒烟测试失败 ✗');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});