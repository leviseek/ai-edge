/** ai-summary 插件：提示词 */
import type { ExtractionResult } from '../../core/extract/extractor';
import type { ClassifyOutput } from './types';
import type { SearchResult } from '../../core/search/service';

export const SYSTEM_PROMPT =
  '你是一位严谨的 AI 研究助理。回答使用简体中文，除非原文明确要求其他语言。' +
  '输出结构遵循用户要求，事实性内容基于提供的页面正文与搜索结果，不编造来源。' +
  '涉及评价时区分“原文观点”与“你的推断”。';

export function classifyPrompt(extract: ExtractionResult): string {
  return [
    '分析以下页面正文，输出严格 JSON（不要包含任何其他文字）：',
    '{"pageType": "文章|产品页|教程|对比页|论坛|其他", "entity": "该页面讨论的主体（产品/概念/项目名，无则空串）", "category": "所属品类（如：AI写作工具、开源数据库），无则空串", "keywords": ["2-5个代表性关键词"]}',
    '',
    `标题：${extract.title}`,
    `URL：${extract.url}`,
    '正文（截断）：',
    extract.text.slice(0, 2000),
  ].join('\n');
}

export function summarizePrompt(extract: ExtractionResult, classify: ClassifyOutput | undefined): string {
  const meta = `页面类型：${classify?.pageType ?? '未知'}\n主体：${classify?.entity ?? '-'}\n品类：${classify?.category ?? '-'}`;
  return [
    '基于提供的页面正文生成总结，输出严格 JSON：',
    '{"executiveSummary": "140字以内的执行摘要", "keyPoints": ["3-6条要点，每条不超过40字"], "verdict": "一句话结论/价值判断"}',
    '',
    meta,
    `标题：${extract.title}`,
    `出发页：${extract.url}`,
    '正文（可能截断，若超长请以最重要的信息为准）：',
    extract.text.slice(0, 12000),
  ].join('\n');
}

export function feasibilityPrompt(extract: ExtractionResult): string {
  return [
    '基于页面正文做“可行性调研”，输出严格 JSON：',
    '{"verdict": "总体可行性判断（可行/有条件可行/不可行 + 一句话理由）", "aspects": [{"name": "方面（如 技术/成本/合规/市场）", "assessment": "评估", "risk": "主要风险"}], "effortEstimate": "工作量/周期粗略估算"}',
    '',
    `标题：${extract.title}`,
    '正文（截断）：',
    extract.text.slice(0, 6000),
  ].join('\n');
}

export function prosConsPrompt(extract: ExtractionResult): string {
  return [
    '基于页面正文归纳优缺点，输出严格 JSON：',
    '{"pros": ["3-6条优点"], "cons": ["3-6条缺点"]}',
    '仅依据正文内容，不过度引申。',
    '',
    `标题：${extract.title}`,
    '正文（截断）：',
    extract.text.slice(0, 6000),
  ].join('\n');
}

export function comparePrompt(
  extract: ExtractionResult,
  classify: ClassifyOutput | undefined,
  results: SearchResult[],
): string {
  const lines = results
    .map((r, i) => `${i + 1}. [${r.title}](${r.url}) ${(r.snippet || '').slice(0, 300)}`)
    .join('\n');
  return [
    '你要做“同品类横向比较”。当前页面主体见下，另附网络搜索结果作为候选。',
    '输出严格 JSON：',
    '{"entity": "被比较主体", "category": "品类", "items": [{"name": "候选名称", "url": "来源URL", "summary": "一句话简介", "pros": ["优点"], "cons": ["缺点"], "suitableFor": "适合谁/什么场景"}], "recommendation": "客观建议"}',
    'items 应包含当前页主体 + 搜索结果中 2-6 个同类候选；没有把握的候选标注来源链接；不要编造搜索结果中没有的信息。',
    '',
    `当前页主体：${classify?.entity ?? '未知'}（品类：${classify?.category ?? '未知'}）`,
    `标题：${extract.title}`,
    '正文背景（截断）：',
    extract.text.slice(0, 3000),
    '',
    '网络搜索结果：',
    lines || '（无搜索结果，仅基于页面自身分析）',
  ].join('\n');
}