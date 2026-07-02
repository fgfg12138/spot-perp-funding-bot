/**
 * 精确浮点数运算工具（基于 decimal.js）
 *
 * 仅在涉及金额乘除的关键路径使用，避免 IEEE 754 舍入误差。
 * 普通传值和简单加法不需要用此工具。
 */
import Decimal from "decimal.js";

/** 安全的乘法：a × b */
export function mul(a: number, b: number): number {
  return new Decimal(a).mul(b).toNumber();
}

/** 安全的除法：a ÷ b */
export function div(a: number, b: number): number {
  return new Decimal(a).div(b).toNumber();
}

/** 安全的加法：a + b */
export function add(a: number, b: number): number {
  return new Decimal(a).add(b).toNumber();
}

/** 安全的减法：a - b */
export function sub(a: number, b: number): number {
  return new Decimal(a).sub(b).toNumber();
}
