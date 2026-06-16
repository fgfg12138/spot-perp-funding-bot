export type CycleTask = () => Promise<void>;

export interface SchedulerOptions {
  intervalMs: number;
  onError?: (err: Error) => void;
  onStop?: () => void;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private task: CycleTask,
    private options: SchedulerOptions,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(async () => {
      try {
        await this.task();
      } catch (err) {
        this.options.onError?.(err as Error);
      }
    }, this.options.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.options.onStop?.();
  }

  isRunning(): boolean {
    return this.running;
  }
}
