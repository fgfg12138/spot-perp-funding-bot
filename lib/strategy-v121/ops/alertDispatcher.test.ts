import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  dispatchAlert,
  createAlertEvent,
  sendTelegram,
  sendEmail,
  getTelegramConfig,
  getEmailConfig,
  setAlertEnabled,
  isAlertEnabled,
  type TelegramConfig,
  type EmailConfig,
} from "./alertDispatcher";
import { resetRuntimeConfig } from "../config/runtimeConfig";

// Mock global fetch for Telegram tests
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

// Mock SMTP client
vi.mock("./smtpClient", () => ({
  sendPlainEmail: vi.fn(),
}));

const mockSendPlainEmail = (await import("./smtpClient")).sendPlainEmail as ReturnType<typeof vi.fn>;

describe("alertDispatcher", () => {
  beforeEach(() => {
    setAlertEnabled(true);
    mockFetch.mockReset();
    mockSendPlainEmail.mockReset();
    // Clear env vars
    delete process.env.V121_ALERT_TELEGRAM_BOT_TOKEN;
    delete process.env.V121_ALERT_TELEGRAM_CHAT_ID;
    delete process.env.V121_ALERT_EMAIL_SMTP_HOST;
    delete process.env.V121_ALERT_EMAIL_SMTP_PORT;
    delete process.env.V121_ALERT_EMAIL_USER;
    delete process.env.V121_ALERT_EMAIL_PASS;
    delete process.env.V121_ALERT_EMAIL_TO;
    delete process.env.V121_ALERT_EMAIL_FROM;
    resetRuntimeConfig();
  });

  describe("getTelegramConfig", () => {
    it("环境变量完整时返回配置", () => {
      process.env.V121_ALERT_TELEGRAM_BOT_TOKEN = "bot123";
      process.env.V121_ALERT_TELEGRAM_CHAT_ID = "chat456";
      resetRuntimeConfig();
      const config = getTelegramConfig();
      expect(config).toEqual({ botToken: "bot123", chatId: "chat456" });
    });

    it("环境变量缺失时返回 null", () => {
      expect(getTelegramConfig()).toBeNull();
    });
  });

  describe("getEmailConfig", () => {
    it("环境变量完整时返回配置", () => {
      process.env.V121_ALERT_EMAIL_SMTP_HOST = "smtp.test.com";
      process.env.V121_ALERT_EMAIL_SMTP_PORT = "587";
      process.env.V121_ALERT_EMAIL_USER = "user@test.com";
      process.env.V121_ALERT_EMAIL_PASS = "pass";
      process.env.V121_ALERT_EMAIL_TO = "to@test.com";
      process.env.V121_ALERT_EMAIL_FROM = "from@test.com";
      resetRuntimeConfig();
      const config = getEmailConfig();
      expect(config?.smtpHost).toBe("smtp.test.com");
      expect(config?.smtpPort).toBe(587);
    });

    it("环境变量缺失时返回 null", () => {
      expect(getEmailConfig()).toBeNull();
    });
  });

  describe("sendTelegram", () => {
    it("成功发送", async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const config: TelegramConfig = { botToken: "bot123", chatId: "chat456" };
      const ok = await sendTelegram(config, createAlertEvent("INFO", "测试", "消息内容"));
      expect(ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArg = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArg.chat_id).toBe("chat456");
      expect(callArg.text).toContain("测试");
      expect(callArg.parse_mode).toBe("HTML");
    });

    it("HTTP 错误时返回 false", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403, text: () => "Forbidden" });
      const config: TelegramConfig = { botToken: "bot123", chatId: "chat456" };
      const ok = await sendTelegram(config, createAlertEvent("WARNING", "测试", "消息"));
      expect(ok).toBe(false);
    });

    it("网络异常时返回 false", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      const config: TelegramConfig = { botToken: "bot123", chatId: "chat456" };
      const ok = await sendTelegram(config, createAlertEvent("CRITICAL", "测试", "消息"));
      expect(ok).toBe(false);
    });
  });

  describe("sendEmail", () => {
    it("成功发送", async () => {
      mockSendPlainEmail.mockResolvedValue(true);
      const config: EmailConfig = { smtpHost: "smtp.test.com", smtpPort: 587, user: "u", pass: "p", to: "t@t.com", from: "f@f.com" };
      const ok = await sendEmail(config, createAlertEvent("INFO", "测试", "消息"));
      expect(ok).toBe(true);
      expect(mockSendPlainEmail).toHaveBeenCalledTimes(1);
    });

    it("发送失败返回 false", async () => {
      mockSendPlainEmail.mockResolvedValue(false);
      const config: EmailConfig = { smtpHost: "smtp.test.com", smtpPort: 587, user: "u", pass: "p", to: "t@t.com", from: "f@f.com" };
      const ok = await sendEmail(config, createAlertEvent("WARNING", "测试", "消息"));
      expect(ok).toBe(false);
    });
  });

  describe("dispatchAlert", () => {
    it("无渠道配置时发送空结果", async () => {
      const result = await dispatchAlert(createAlertEvent("INFO", "测试", "无渠道"));
      expect(result.sent).toBe(false);
      expect(result.channels).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("通过 Telegram 发送", async () => {
      process.env.V121_ALERT_TELEGRAM_BOT_TOKEN = "bot123";
      process.env.V121_ALERT_TELEGRAM_CHAT_ID = "chat456";
      resetRuntimeConfig();
      mockFetch.mockResolvedValue({ ok: true });

      const result = await dispatchAlert(createAlertEvent("CRITICAL", "严重告警", "请立即处理", {
        exchange: "binance",
        symbol: "BTCUSDT",
        pnlValue: -500,
      }));

      expect(result.sent).toBe(true);
      expect(result.channels).toContain("telegram");
      expect(result.errors).toHaveLength(0);
      // 验证 fetch 调用包含了必要信息
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("🚨");
      expect(body.text).toContain("严重告警");
      expect(body.text).toContain("binance");
      expect(body.text).toContain("-500 USDT");
    });

    it("通过 Email 发送", async () => {
      process.env.V121_ALERT_EMAIL_SMTP_HOST = "smtp.test.com";
      process.env.V121_ALERT_EMAIL_SMTP_PORT = "587";
      process.env.V121_ALERT_EMAIL_USER = "u@t.com";
      process.env.V121_ALERT_EMAIL_PASS = "p";
      process.env.V121_ALERT_EMAIL_TO = "t@t.com";
      process.env.V121_ALERT_EMAIL_FROM = "f@t.com";
      resetRuntimeConfig();
      mockSendPlainEmail.mockResolvedValue(true);

      const result = await dispatchAlert(createAlertEvent("INFO", "测试邮件", "内容"));
      expect(result.sent).toBe(true);
      expect(result.channels).toContain("email");
    });

    it("通过 Telegram + Email 双渠道发送", async () => {
      process.env.V121_ALERT_TELEGRAM_BOT_TOKEN = "bot123";
      process.env.V121_ALERT_TELEGRAM_CHAT_ID = "chat456";
      process.env.V121_ALERT_EMAIL_SMTP_HOST = "smtp.test.com";
      process.env.V121_ALERT_EMAIL_SMTP_PORT = "587";
      process.env.V121_ALERT_EMAIL_USER = "u@t.com";
      process.env.V121_ALERT_EMAIL_PASS = "p";
      process.env.V121_ALERT_EMAIL_TO = "t@t.com";
      process.env.V121_ALERT_EMAIL_FROM = "f@t.com";
      resetRuntimeConfig();
      mockFetch.mockResolvedValue({ ok: true });
      mockSendPlainEmail.mockResolvedValue(true);

      const result = await dispatchAlert(createAlertEvent("SECURITY", "安全事件", "密钥泄露检测"));
      expect(result.sent).toBe(true);
      expect(result.channels).toContain("telegram");
      expect(result.channels).toContain("email");
    });

    it("Telegram 失败 + Email 成功", async () => {
      process.env.V121_ALERT_TELEGRAM_BOT_TOKEN = "bot123";
      process.env.V121_ALERT_TELEGRAM_CHAT_ID = "chat456";
      process.env.V121_ALERT_EMAIL_SMTP_HOST = "smtp.test.com";
      process.env.V121_ALERT_EMAIL_SMTP_PORT = "587";
      process.env.V121_ALERT_EMAIL_USER = "u@t.com";
      process.env.V121_ALERT_EMAIL_PASS = "p";
      process.env.V121_ALERT_EMAIL_TO = "t@t.com";
      process.env.V121_ALERT_EMAIL_FROM = "f@t.com";
      resetRuntimeConfig();
      mockFetch.mockResolvedValue({ ok: false, status: 403, text: () => "Forbidden" });
      mockSendPlainEmail.mockResolvedValue(true);

      const result = await dispatchAlert(createAlertEvent("WARNING", "部分失败", "内容"));
      expect(result.sent).toBe(true); // 至少有 Email 成功
      expect(result.channels).toContain("email");
      expect(result.errors).toContain("telegram 发送失败");
    });

    it("alertEnabled=false 时不发送", async () => {
      setAlertEnabled(false);
      process.env.V121_ALERT_TELEGRAM_BOT_TOKEN = "bot123";
      process.env.V121_ALERT_TELEGRAM_CHAT_ID = "chat456";
      resetRuntimeConfig();
      mockFetch.mockResolvedValue({ ok: true });

      const result = await dispatchAlert(createAlertEvent("INFO", "测试", "内容"));
      expect(result.sent).toBe(false);
      expect(result.errors).toContain("alert 全局关闭");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("重复告警在去重窗口内去重", async () => {
      process.env.V121_ALERT_TELEGRAM_BOT_TOKEN = "bot123";
      process.env.V121_ALERT_TELEGRAM_CHAT_ID = "chat456";
      resetRuntimeConfig();
      mockFetch.mockResolvedValue({ ok: true });

      const event = createAlertEvent("WARNING", "重复告警", "内容", { exchange: "binance", symbol: "BTCUSDT" });
      const result1 = await dispatchAlert(event);
      expect(result1.sent).toBe(true);
      expect(result1.deduplicated).toBe(false);

      const result2 = await dispatchAlert(event);
      expect(result2.sent).toBe(false);
      expect(result2.deduplicated).toBe(true);
      // fetch 应该只被调用一次
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("不同的告警不会被去重", async () => {
      process.env.V121_ALERT_TELEGRAM_BOT_TOKEN = "bot123";
      process.env.V121_ALERT_TELEGRAM_CHAT_ID = "chat456";
      resetRuntimeConfig();
      mockFetch.mockResolvedValue({ ok: true });

      await dispatchAlert(createAlertEvent("INFO", "告警A", "内容"));
      await dispatchAlert(createAlertEvent("WARNING", "告警B", "内容"));

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("setAlertEnabled / isAlertEnabled", () => {
    it("默认启用", () => {
      expect(isAlertEnabled()).toBe(true);
    });

    it("可以切换", () => {
      setAlertEnabled(false);
      expect(isAlertEnabled()).toBe(false);
      setAlertEnabled(true);
      expect(isAlertEnabled()).toBe(true);
    });
  });
});
