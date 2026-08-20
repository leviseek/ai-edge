/**
 * M4 冒烟：轻量 Markdown tokenizer（纯函数）结构正确性。
 * 运行：npm run smoke:m4
 */
import { tokenizeMarkdown, type Inline, type MdBlock } from '../src/ui/shared/markdown';

type Loose = { t: string; [k: string]: unknown };

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log('\n[场景1] 块级结构（标题/段落/列表/引用/代码/分隔线）');
  {
    const src = [
      '# 一级标题',
      '',
      '**加粗** 和 *斜体* 与 `code` 及 [链接](https://example.com)。',
      '',
      '- 第一',
      '- 第二',
      '',
      '1. 甲',
      '2. 乙',
      '',
      '> 引用行',
      '',
      '```js',
      'let x = 1;',
      '```',
      '',
      '---',
    ].join('\n');

    const blocks = tokenizeMarkdown(src) as Loose[];
    const has = (t: string) => blocks.some((b) => b.t === t);
    assert(has('heading'), '识别标题块');
    assert((blocks.find((b) => b.t === 'heading') as Loose).level === 1, '标题级别=1');
    assert(has('paragraph'), '识别段落块');
    assert(has('ul') && (blocks.find((b) => b.t === 'ul') as Loose).items.length === 2, '无序列表 2 项');
    assert(has('ol') && (blocks.find((b) => b.t === 'ol') as Loose).items.length === 2, '有序列表 2 项');
    assert(has('quote'), '识别引用块');
    assert(has('code') && (blocks.find((b) => b.t === 'code') as Loose).lang === 'js', '围栏代码语言=js');
    assert((blocks.find((b) => b.t === 'code') as Loose).text.includes('let x = 1;'), '代码内容保留');
    assert(has('hr'), '识别分隔线');
  }

  console.log('\n[场景2] 行内 token（加粗/斜体/代码/链接/普通文本）');
  {
    const para = tokenizeMarkdown('**加粗** 和 *斜体* 与 `code` 及 [链接](https://example.com) 结尾。') as Loose[];
    const p = para.find((b) => b.t === 'paragraph') as unknown as { inline: Inline[] };
    const inl = p.inline;
    const kinds = inl.map((t) => t.t);
    assert(kinds.includes('bold'), '识别加粗');
    assert(kinds.includes('italic'), '识别斜体');
    assert(kinds.includes('code'), '识别行内代码');
    assert(kinds.includes('link'), '识别链接');
    const link = inl.find((t) => t.t === 'link');
    if (link && link.t === 'link') assert(link.href === 'https://example.com', '链接 href 解析正确');
    const text = inl.filter((t) => t.t === 'text').map((t) => (t.t === 'text' ? t.v : '')).join('');
    assert(text.includes('和') && text.includes('结尾'), '普通文本保留且顺序正确');
  }

  console.log('\n[场景3] 嵌套引用与空行容忍');
  {
    const blocks = tokenizeMarkdown('> 第一行\n> 第二行\n\n尾部段落') as Loose[];
    const q = blocks.find((b) => b.t === 'quote') as unknown as { blocks: MdBlock[] };
    assert(q.blocks.length === 1, '多行引用合并为单个段落');
    const text = q.blocks[0].t === 'paragraph' ? q.blocks[0].inline.map((t) => (t.t === 'text' ? t.v : '')).join('') : '';
    assert(text.includes('第一行') && text.includes('第二行'), '引用两行内容均保留且合并');
    assert(blocks.some((b) => b.t === 'paragraph'), '引用后续段落正常解析');
  }

  console.log('\nM4 冒烟测试全部通过 ✅');
}

main().catch((e) => {
  console.error('\nM4 冒烟测试失败 ✗');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});