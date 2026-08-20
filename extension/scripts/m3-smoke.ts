/**
 * M3 冒烟：验证 fallback 链（主提供商故障自动降级）与 SW 侧 HTML 深抓提取。
 * mock provider，不发真实请求。运行：npm run smoke:m3
 */
import { createProviderChain, FallbackChainProvider } from '../src/core/ai/fallback';
import { EdgeError, ErrorCodes } from '../src/base/errors';
import { extractTextFromHtml } from '../src/core/extract/html-extractor';
import { Pipeline, type StageContext } from '../src/core/pipeline/pipeline';
import { Logger } from '../src/base/logger';
import { SummarizeStage } from '../src/plugins/ai-summary/stages/summarize';
import type { AIProvider, ChatMessage, ChatResult, ChatChunk, ModelInfo, HealthResult } from '../src/core/ai/provider';
import type { SummaryFlow } from '../src/plugins/ai-summary/types';

class Mock implements AIProvider {
  readonly label = `mock-${this.id}`;
  constructor(
    readonly id: string,
    private readonly handler: (messages: ChatMessage[]) => ChatResult,
  ) {}

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    return this.handler(messages);
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

function ctx(): StageContext {
  return { log: new Logger('m3'), signal: new AbortController().signal, step: 0, steps: 1, emit: () => {} };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log('\n[场景1] HTML 深抓提取（SW 侧无 DOM）');
  {
    const html = `<!doctype html><html><head><title>候选产品页</title><style>p{color:red}</style><script>alert(1)</script></head>
      <body><nav>导航 广告 赞助</nav><article><h1>标题</h1><p>这里是深抓到的正文，包含真正的产品指标与价格。</p></article><footer>版权 备案 链接</footer></body></html>`;
    const ex = extractTextFromHtml(html, 'https://c.example/p');
    assert(ex.title === '候选产品页', '解析出 <title>');
    assert(ex.text.includes('深抓到的正文') && ex.text.includes('产品指标'), '保留正文核心内容');
    assert(!ex.text.includes('导航') && !ex.text.includes('广告') && !ex.text.includes('版权'), '剔除 nav/footer/script/style');
  }

  console.log('\n[场景2] fallback 链：主提供商故障自动降级');
  {
    const broken = new Mock('broken', () => {
      throw new EdgeError(ErrorCodes.PROVIDER, '模拟网络故障');
    });
    const working = new Mock('working', () => ({
      text: JSON.stringify({ executiveSummary: '工作摘要', keyPoints: ['k1'], verdict: 'v' }),
      model: 'working-model',
    }));
    const { provider, chain } = createProviderChain([broken, working]);
    assert(chain !== null, '多提供商应生成 FallbackChainProvider');

    const flow0: SummaryFlow = { extract: { title: 't', url: 'u', lang: 'zh', byline: '', text: '短文内容', charCount: 4 }, model: '' };
    const flow = (await new Pipeline([new SummarizeStage(provider)]).run(flow0, ctx())) as SummaryFlow;
    assert(flow.core?.executiveSummary === '工作摘要', '降级后采用次提供商输出');
    assert(chain!.lastUsed?.id === 'working', `最近命中提供商为 working（实际 ${chain!.lastUsed?.id}）`);
    assert(chain!.usedIds.join(',') === 'broken,working', '记录按序调用链 broken,working');
    assert(chain!.lastUsed!.id !== chain!.id, 'usedFallback 判定成立（命中非首选）');
  }

  console.log('\n[场景3] 非提供商错误不触发降级');
  {
    const a = new Mock('a', () => {
      throw new EdgeError(ErrorCodes.LLM_PARSE, '输出解析失败');
    });
    const b = new Mock('b', () => ({
      text: JSON.stringify({ executiveSummary: '不应被调用', keyPoints: [], verdict: '' }),
      model: 'b',
    }));
    const { chain } = createProviderChain([a, b]);
    let threw = false;
    try {
      await chain!.chat([{ role: 'user', content: 'x' }]);
    } catch {
      threw = true;
    }
    assert(threw, '解析类错误直接抛出（不降级）');
    assert(chain!.usedIds.join(',') === 'a', '仅尝试首提供商 a，次提供商未被调用');
  }

  console.log('\n[场景4] 单提供商原样返回（无链包装）');
  {
    const only = new Mock('only', () => ({ text: 'x', model: 'm' }));
    const { provider, chain } = createProviderChain([only]);
    assert(chain === null, '单 provider 不生成链');
    assert(provider.id === 'only', '原样返回原 provider');
  }

  console.log('\nM3 冒烟测试全部通过 ✅');
}

main().catch((e) => {
  console.error('\nM3 冒烟测试失败 ✗');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});