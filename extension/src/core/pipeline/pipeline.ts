/** 流水线引擎：多阶段顺序执行（进度 + 中止） */
import { EdgeError, ErrorCodes } from '../../base/errors';
import type { Logger } from '../../base/logger';

export interface StageContext {
  log: Logger;
  signal: AbortSignal;
  /** 当前阶段序号（0-based），由 Pipeline 在每阶段运行前赋值 */
  step: number;
  /** 阶段总数，由 Pipeline 赋值 */
  steps: number;
  /** 派发进度：stage=阶段名，progress=0..1 表示“本阶段内部”进度（整体进度 = (step+progress)/steps） */
  emit(stage: string, message: string, progress?: number): void;
}

export interface Stage<I = unknown, O = unknown> {
  name: string;
  run(input: I, ctx: StageContext): Promise<O>;
}

export class Pipeline {
  constructor(private readonly stages: Stage[]) {}

  async run(initial: unknown, ctx: StageContext): Promise<unknown> {
    let value: unknown = initial;
    const n = this.stages.length;
    ctx.steps = n;
    for (let i = 0; i < n; i++) {
      const s = this.stages[i];
      if (ctx.signal.aborted) throw new EdgeError(ErrorCodes.CANCELED, '流水线已中止');
      ctx.step = i;
      ctx.emit(s.name, `进行中：${s.name}`);
      const t0 = Date.now();
      value = await s.run(value, ctx);
      ctx.emit(s.name, `完成：${s.name}（${Date.now() - t0}ms）`, 1);
    }
    return value;
  }
}