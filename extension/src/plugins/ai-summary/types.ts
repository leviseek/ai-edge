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
  /** 是否发生过提供商降级（fallback 链命中非首选） */
  usedFallback?: boolean;
  /** 实际按序调用的提供商 id */
  fallbackChain?: string[];
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
  /** 来源可及性校验：'ok' 可达 | 'fail' 404/不可达 | 'skip' 未验证 */
  verified?: 'ok' | 'fail' | 'skip';
}

export interface ComparisonOutput {
  entity: string;
  category: string;
  items: ComparisonItem[];
  recommendation: string;
  /** 生成时刻（ISO），用于时效性标注 */
  at?: string;
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
  /** 本阶段内部进度 0..1（整体 = (step + progress)/steps） */
  progress?: number;
  /** 阶段序号（0-based） */
  step?: number;
  /** 阶段总数 */
  steps?: number;
}

/** 流水线中间态 */
export interface ClassifyOutput {
  pageType: string;
  entity: string;
  category: string;
  keywords: string[];
}

/** compare 候选：搜索结果 + 可选深抓正文 */
export interface CompareCandidate {
  title: string;
  url: string;
  snippet: string;
  /** SW 深抓到的正文（可能为空串表示抓取失败） */
  content?: string;
}export interface SummaryFlow {
  extract: import('../../core/extract/extractor').ExtractionResult & { text: string };
  model: string;
  classify?: ClassifyOutput;
  core?: SummaryCore;
  feasibility?: FeasibilityOutput;
  prosCons?: ProsConsOutput;
  comparison?: ComparisonOutput;
}