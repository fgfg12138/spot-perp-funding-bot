/**
 * P5.1 — 统一错误重试工具
 *
 * 提供指数退避 + 随机抖动 + 错误分类的可配置重试策略。
 * 同时引入 type-safe 的错误分类系统，允许区分临时错误（可重试）和永久错误（立即失败）。
 */

// ── 错误分类 ──────────────────────────────────────────────

/** 临时错误 — 可安全重试（网络抖动、限流、超时） */
export class TransientError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TransientError";
  }
}

/** 永久错误 — 重试无意义（参数无效、配置错误、账户冻结） */
export class PermanentError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PermanentError";
  }
}

/** 判断是否为可重试的错误 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TransientError) return true;
  if (err instanceof PermanentError) return false;
  // 无明确分类的 Error 默认可重试（保守安全）
  if (err instanceof Error) return true;
  return true; // 未知错误默认重试
}

// ── 重试配置 ──────────────────────────────────────────────

export interface RetryOptions {
  /** 最大重试次数（默认 3） */
  maxAttempts?: number;
  /** 初始延迟（ms，默认 1000） */
  baseDelayMs?: number;
  /** 最大延迟（ms，默认 30000） */
  maxDelayMs?: number;
  /** 退避因子（默认 2，即指数退避） */
  backoffFactor?: number;
  /** 是否启用随机抖动（默认 true） */
  jitter?: boolean;
  /** 自定义重试判定（返回 true 可重试） */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** 每次重试前的回调（用于日志） */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** 超时（ms，单次尝试超过此时间视为 TransientError） */
  timeoutMs?: number;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  jitter: true,
  shouldRetry: (_err, _attempt) => true,
  onRetry: () => {},
  timeoutMs: 0, // 0 = 不启用超时
};

/**
 * 带指数退避和抖动的异步重试函数。
 *
 * @example
 * ```ts
 * const result = await withRetry(() => fetchBalances(), {
 *   maxAttempts: 5,
 *   baseDelayMs: 500,
 *   onRetry: (err, attempt) => logger.warn({ err, attempt }, "retrying"),
 * });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts: Required<RetryOptions> = { ...defaultOptions, ...options };

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      if (opts.timeoutMs > 0) {
        return await withTimeout(fn, opts.timeoutMs);
      }
      return await fn();
    } catch (err) {
      lastError = err;

      // 永久错误 — 立即失败
      if (!opts.shouldRetry(err, attempt) || !isRetryable(err)) {
        throw err;
      }

      // 最后一次尝试也失败了 — 抛出
      if (attempt >= opts.maxAttempts) {
        throw err;
      }

      // 计算退避延迟
      const delay = calculateDelay(attempt, opts);
      opts.onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }

  // 不会执行到这里，但 TypeScript 需要
  throw lastError;
}

// ── 内部工具 ──────────────────────────────────────────────

function calculateDelay(attempt: number, opts: Required<RetryOptions>): number {
  const exponential = opts.baseDelayMs * Math.pow(opts.backoffFactor, attempt - 1);
  const clamped = Math.min(exponential, opts.maxDelayMs);
  if (!opts.jitter) return clamped;
  // 随机抖动：±25%
  const jitterFactor = 0.75 + Math.random() * 0.5; // [0.75, 1.25]
  return Math.round(clamped * jitterFactor);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TransientError(`操作超时 ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}
