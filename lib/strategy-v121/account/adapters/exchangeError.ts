/**
 * ExchangeError — 交易所错误类型扩展。
 *
 * 在标准 Error 基础上扩展 `code`（交易所错误码）和 `raw`（原始响应体），
 * 用于在 adapter 层统一传递交易所错误信息，避免 `(err as any).code = ...` 写法。
 */

export interface ExchangeError extends Error {
  code?: number | string;
  raw?: unknown;
}

export function createExchangeError(
  message: string,
  code?: number | string,
  raw?: unknown,
): ExchangeError {
  const err = new Error(message) as ExchangeError;
  err.code = code;
  err.raw = raw;
  return err;
}

export function isExchangeError(err: unknown): err is ExchangeError {
  return err instanceof Error && "code" in err;
}

export function getErrorCode(err: unknown): number | string | undefined {
  if (isExchangeError(err)) return err.code;
  return undefined;
}

export function setErrorCode(err: Error, code: number | string): ExchangeError {
  const exchangeErr = err as ExchangeError;
  exchangeErr.code = code;
  return exchangeErr;
}
