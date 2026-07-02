export type CycleTask = () => Promise<void>;

export interface SchedulerOptions {
  intervalMs: number;
  /**
   * fixedDelay: 等前一次 async task 完成后才开始计时 intervalMs
   * fixedRate (默认): 按固定间隔触发，async task 未完成会重叠（需调用方自行重入保护）
   *
   * 对于 Worker 场景，推荐 fixedDelay=false 配合重入保护，
   * 或 fixedDelay=true 完全避免重叠。
   */
  fixedDelay?: boolean;
  onError?: (err: Error) => void;
  onStop?: () => void;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private task: CycleTask,
    private options: SchedulerOptions,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.options.fixedDelay) {
      // fixedDelay: 等当前 task 完成后再等 intervalMs
      this.scheduleFixedDelay();
    } else {
      // fixedRate: 严格按 setInterval 触发
      this.timer = setInterval(async () => {
        try {
          await this.task();
        } catch (err) {
          this.options.onError?.(err as Error);
        }
      }, this.options.intervalMs);
    }
  }

  private async scheduleFixedDelay(): Promise<void> {
    while (this.running) {
      try {
        await this.task();
      } catch (err) {
        this.options.onError?.(err as Error);
      }
      if (!this.running) break;
      // 等 intervalMs 后再执行下一轮
      await new Promise((resolve) => {
        this.timer = setTimeout(resolve, this.options.intervalMs);
      });
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      if (this.options.fixedDelay) {
        clearTimeout(this.timer as ReturnType<typeof setTimeout>);
      } else {
        clearInterval(this.timer as ReturnType<typeof setInterval>);
      }
      this.timer = null;
    }
    this.options.onStop?.();
  }

  isRunning(): boolean {
    return this.running;
  }
}
