/**
 * P5.4 — 告警分发器
 *
 * 支持 Telegram Bot 和 Email 两种通知渠道。
 * 所有告警事件通过统一 dispatch 入口发送到已配置的渠道。
 * 每个渠道均可独立启用/禁用。
 *
 * 配置方式（通过 runtimeConfig 读取环境变量）：
 *   V121_ALERT_TELEGRAM_BOT_TOKEN=<token>
 *   V121_ALERT_TELEGRAM_CHAT_ID=<chat_id>
 *   V121_ALERT_EMAIL_SMTP_HOST=smtp.example.com
 *   V121_ALERT_EMAIL_SMTP_PORT=587
 *   V121_ALERT_EMAIL_USER=user@example.com
 *   V121_ALERT_EMAIL_PASS=password
 *   V121_ALERT_EMAIL_TO=recipient@example.com
 *   V121_ALERT_EMAIL_FROM=sender@example.com
 */

// ── 告警级别 ──────────────────────────────────────────────

export type AlertLevel = "INFO" | "WARNING" | "CRITICAL" | "SECURITY";

// ── 告警事件 ──────────────────────────────────────────────

export interface AlertEvent {
  level: AlertLevel;
  title: string;
  message: string;
  exchange?: string;
  symbol?: string;
  positionId?: string;
  pnlValue?: number;
  fundingRate?: number;
  timestampUtc: number;
}

// ── 渠道配置 ──────────────────────────────────────────────

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  user: string;
  pass: string;
  to: string;
  from: string;
}

// ── 告警历史（内存中去重） ────────────────────────────────

const recentAlerts = new Map<string, number>(); // dedupKey → timestampUtc
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 分钟内相同的告警只发一次

// ── 全局开关 ──────────────────────────────────────────────

let alertEnabled = true;

export function setAlertEnabled(enabled: boolean): void {
  alertEnabled = enabled;
}

export function isAlertEnabled(): boolean {
  return alertEnabled;
}

// ── 渠道状态探测 ──────────────────────────────────────────

import { getRuntimeConfig } from "../config/runtimeConfig";

/** 从 runtimeConfig 读取 Telegram 配置（替代 direct process.env） */
export function getTelegramConfig(): TelegramConfig | null {
  const cfg = getRuntimeConfig();
  return cfg.alert.telegram;
}

/** 从 runtimeConfig 读取 Email 配置（替代 direct process.env） */
export function getEmailConfig(): EmailConfig | null {
  const cfg = getRuntimeConfig();
  return cfg.alert.email;
}

// ── Telegram 发送 ─────────────────────────────────────────

/**
 * 通过 Telegram Bot API 发送消息。
 * 使用原生 fetch（Node 18+），无需额外依赖。
 */
export async function sendTelegram(
  config: TelegramConfig,
  event: AlertEvent,
): Promise<boolean> {
  const emoji = levelEmoji(event.level);
  const text = formatMessage(event, emoji);

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[alertDispatcher] Telegram 发送失败: ${res.status} ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[alertDispatcher] Telegram 异常:`, (err as Error).message);
    return false;
  }
}

// ── Email 发送 ────────────────────────────────────────────

/**
 * 通过 SMTP 发送告警邮件。
 * 使用原生 Node.js net/tls 实现简单 SMTP 客户端。
 * 如需完整 MIME 支持，建议后续迁移到 nodemailer。
 *
 * 目前使用 build-in 的轻量实现发送纯文本邮件。
 */
export async function sendEmail(
  config: EmailConfig,
  event: AlertEvent,
): Promise<boolean> {
  const subject = `[${event.level}] ${event.title}`;
  const body = formatMessage(event, levelEmoji(event.level));

  try {
    const { sendPlainEmail } = await import("./smtpClient");
    return await sendPlainEmail(config, subject, body);
  } catch (err) {
    console.error(`[alertDispatcher] Email 发送失败:`, (err as Error).message);
    return false;
  }
}

// ── 统一分发入口 ──────────────────────────────────────────

export interface DispatchResult {
  sent: boolean;
  channels: string[];
  errors: string[];
  deduplicated: boolean;
}

/**
 * 将告警事件分发到所有已配置的渠道。
 * 自动去重（5 分钟内相同 title 不重复发送）。
 */
export async function dispatchAlert(event: AlertEvent): Promise<DispatchResult> {
  const result: DispatchResult = {
    sent: false,
    channels: [],
    errors: [],
    deduplicated: false,
  };

  if (!alertEnabled) {
    result.errors.push("alert 全局关闭");
    return result;
  }

  // 去重
  const dedupKey = `${event.level}:${event.title}:${event.exchange ?? ""}:${event.symbol ?? ""}`;
  const lastSent = recentAlerts.get(dedupKey);
  if (lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS) {
    result.deduplicated = true;
    return result; // 静默丢弃重复告警
  }
  recentAlerts.set(dedupKey, Date.now());

  // Telegram
  const tgConfig = getTelegramConfig();
  if (tgConfig) {
    const ok = await sendTelegram(tgConfig, event);
    if (ok) {
      result.channels.push("telegram");
      result.sent = true;
    } else {
      result.errors.push("telegram 发送失败");
    }
  }

  // Email
  const emailConfig = getEmailConfig();
  if (emailConfig) {
    const ok = await sendEmail(emailConfig, event);
    if (ok) {
      result.channels.push("email");
      result.sent = true;
    } else {
      result.errors.push("email 发送失败");
    }
  }

  return result;
}

// ── 便捷工厂 ──────────────────────────────────────────────

export function createAlertEvent(
  level: AlertLevel,
  title: string,
  message: string,
  meta?: {
    exchange?: string;
    symbol?: string;
    positionId?: string;
    pnlValue?: number;
    fundingRate?: number;
  },
): AlertEvent {
  return {
    level,
    title,
    message,
    exchange: meta?.exchange,
    symbol: meta?.symbol,
    positionId: meta?.positionId,
    pnlValue: meta?.pnlValue,
    fundingRate: meta?.fundingRate,
    timestampUtc: Date.now(),
  };
}

// ── 内部工具 ──────────────────────────────────────────────

function levelEmoji(level: AlertLevel): string {
  switch (level) {
    case "CRITICAL": return "🚨";
    case "SECURITY": return "🔒";
    case "WARNING": return "⚠️";
    case "INFO": return "ℹ️";
  }
}

function formatMessage(event: AlertEvent, emoji: string): string {
  const lines: string[] = [
    `${emoji} <b>${escapeHtml(event.title)}</b>`,
    "",
    escapeHtml(event.message),
    "",
  ];

  if (event.exchange) lines.push(`📍 交易所: ${event.exchange}`);
  if (event.symbol) lines.push(`📊 交易对: ${event.symbol}`);
  if (event.positionId) lines.push(`🆔 仓位: ${event.positionId}`);
  if (event.pnlValue !== undefined) lines.push(`💰 PNL: ${event.pnlValue > 0 ? "+" : ""}${event.pnlValue} USDT`);
  if (event.fundingRate !== undefined) lines.push(`📈 资金费率: ${(event.fundingRate * 100).toFixed(4)}%`);

  lines.push("");
  lines.push(`🕐 ${new Date(event.timestampUtc).toISOString()}`);

  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
