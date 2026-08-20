/** UI 共享：总结结果渲染 + Markdown 导出 */
import type { SummaryOutput } from '../../plugins/ai-summary/export';

export function buildMarkdown(r: SummaryOutput): string {
  const lines: string[] = [];
  lines.push(`# ${r.meta.title}`);
  lines.push('');
  lines.push(`> 模型：${r.meta.providerLabel} / ${r.meta.model} · 耗时 ${r.meta.durationMs}ms · 来源：${r.meta.url}`);
  lines.push('');
  lines.push(`## 执行摘要`);
  lines.push(r.executiveSummary);
  lines.push('');
  if (r.keyPoints.length) {
    lines.push(`## 要点`);
    r.keyPoints.forEach((k) => lines.push(`- ${k}`));
    lines.push('');
  }
  if (r.verdict) {
    lines.push(`## 结论`);
    lines.push(r.verdict);
    lines.push('');
  }
  if (r.feasibility) {
    lines.push(`## 可行性`);
    lines.push(r.feasibility.verdict);
    lines.push('');
    if (r.feasibility.aspects.length) {
      lines.push(`| 方面 | 评估 | 风险 |`);
      lines.push(`| --- | --- | --- |`);
      r.feasibility.aspects.forEach((a) => lines.push(`| ${a.name} | ${a.assessment} | ${a.risk} |`));
      lines.push('');
    }
    if (r.feasibility.effortEstimate) {
      lines.push(`**工作量估算**：${r.feasibility.effortEstimate}`);
      lines.push('');
    }
  }
  if (r.prosCons) {
    lines.push(`## 优点`);
    r.prosCons.pros.forEach((p) => lines.push(`- ${p}`));
    lines.push('');
    lines.push(`## 缺点`);
    r.prosCons.cons.forEach((c) => lines.push(`- ${c}`));
    lines.push('');
  }
  if (r.comparison) {
    lines.push(`## 同品类比较（${r.comparison.category || r.comparison.entity}）`);
    lines.push('');
    lines.push(`| 候选 | 一句话 | 适合 |`);
    lines.push(`| --- | --- | --- |`);
    r.comparison.items.forEach((i) => lines.push(`| [${i.name}](${i.url}) | ${i.summary} | ${i.suitableFor} |`));
    lines.push('');
    for (const i of r.comparison.items) {
      lines.push(`### ${i.name}`);
      lines.push(i.summary);
      if (i.pros.length) {
        lines.push('');
        lines.push(i.pros.map((p) => `  + ${p}`).join('\n'));
      }
      if (i.cons.length) {
        lines.push('');
        lines.push(i.cons.map((c) => `  - ${c}`).join('\n'));
      }
      if (i.url) lines.push(`来源：${i.url}`);
      lines.push('');
    }
    if (r.comparison.recommendation) {
      lines.push(`**建议**：${r.comparison.recommendation}`);
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('> 由 ai-edge 生成 · 内容仅供参考，重要事实请核对原始来源');
  return lines.join('\n');
}

export function buildJson(r: SummaryOutput): string {
  return JSON.stringify(r, null, 2);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}