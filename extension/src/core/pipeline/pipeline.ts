/** 流水线引擎：多阶段顺序执行（进度 + 中止） */
import { EdgeError, ErrorCodes } from '../../base/errors';
import type { Logger } from '../../base/logger';

export interface StageContext {
  log: Logger;
  signal: AbortSignal;
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
    for (const s of this.stages) {
      if (ctx.signal.aborted) throw new EdgeError(ErrorCodes.CANCELED, '流水线已中止');
      ctx.emit(s.name, `进行中：${s.name}`);
      const t0 = Date.now();
      value = await s.run(value, ctx);
      ctx.emit(s.name, `完成：${s.name}（${Date.now() - t0}ms）`, 1);
    }
    return value;
  }
}