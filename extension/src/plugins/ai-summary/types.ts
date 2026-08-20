/** ai-summary 插件：共享类型（UI 亦引用） */
export type SummaryMode = 'summary' | 'feasibility' | 'pros-cons' | 'compare';

export interface SummaryRequest {
  tabId: number;
  modes: SummaryMode[];
}

export interface SummaryMeta {
  providerId: string;
  providerLabel: string;
  model: string;
  durationMs: number;
  url: string;
  title: string;
}

export interface SummaryCore {
  executiveSummary: string;
  keyPoints: string[];
  verdict: string;
}

export interface FeasibilityAspect {
  name: string;
  assessment: string;
  risk: string;
}

export interface FeasibilityOutput {
  verdict: string;
  aspects: FeasibilityAspect[];
  effortEstimate: string;
}

export interface ProsConsOutput {
  pros: string[];
  cons: string[];
}

export interface ComparisonItem {
  name: string;
  url: string;
  summary: string;
  pros: string[];
  cons: string[];
  suitableFor: string;
}

export interface ComparisonOutput {
  entity: string;
  category: string;
  items: ComparisonItem[];
  recommendation: string;
}

export interface SummaryOutput extends SummaryCore {
  meta: SummaryMeta;
  pageType: string;
  feasibility?: FeasibilityOutput;
  prosCons?: ProsConsOutput;
  comparison?: ComparisonOutput;
}

export interface ProgressEvent {
  runId: string;
  stage: string;
  message: string;
  progress?: number;
}

/** 流水线中间态 */
export interface ClassifyOutput {
  pageType: string;
  entity: string;
  category: string;
  keywords: string[];
}

export interface SummaryFlow {
  extract: import('../../core/extract/extractor').ExtractionResult & { text: string };
  model: string;
  classify?: ClassifyOutput;
  core?: SummaryCore;
  feasibility?: FeasibilityOutput;
  prosCons?: ProsConsOutput;
  comparison?: ComparisonOutput;
}