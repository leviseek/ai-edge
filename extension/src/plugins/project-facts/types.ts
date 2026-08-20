/** 项目事实锚（去幻觉）：共享类型 */
export type FactKind = '已实现' | '决策' | '架构' | '待办' | '限制';

export interface FactEntry {
  id: string;
  kind: FactKind;
  title: string;
  detail: string;
  path: string;
  tags: string[];
  updatedAt: number;
}

export interface ScanMessage {
  role: string;
  text: string;
}

export interface HallucinationItem {
  claim: string;
  score: number;
  sample: string;
}