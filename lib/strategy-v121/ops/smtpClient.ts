/**
 * 简易 SMTP 客户端 — 发送纯文本邮件。
 *
 * 使用 Node.js 原生 net/tls 模块。
 * 支持 STARTTLS 和直接 TLS（SSL）加密。
 *
 * 如需附件/HTML 等高级功能，请迁移到 nodemailer。
 */
import * as net from "node:net";
import * as tls from "node:tls";
import type { EmailConfig } from "./alertDispatcher";

/**
 * 发送纯文本邮件。
 * 自动判断使用 STARTTLS（端口 587）还是直接 TLS（端口 465）。
 */
export async function sendPlainEmail(
  config: EmailConfig,
  subject: string,
  body: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const useDirectTls = config.smtpPort === 465;

      const connectTarget = useDirectTls
        ? { host: config.smtpHost, port: config.smtpPort }
        : { host: config.smtpHost, port: config.smtpPort };

      const socket = useDirectTls
        ? tls.connect(connectTarget, () => onConnected(socket, config, subject, body, resolve))
        : net.connect(connectTarget, () => onConnected(socket, config, subject, body, resolve));

      let buffer = "";
      let step = 0;
      let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 15000);

      function onConnected(
        sock: net.Socket,
        cfg: EmailConfig,
        subj: string,
        msg: string,
        res: (ok: boolean) => void,
      ) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => { sock.destroy(); res(false); }, 15000);

        let heloDone = false;
        let authDone = false;
        let mailFromDone = false;
        let rcptToDone = false;
        let dataDone = false;

        sock.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\r\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            // SMTP 回复格式: "code message"
            const code = parseInt(line.substring(0, 3), 10);
            if (code >= 400) {
              sock.destroy();
              res(false);
              return;
            }

            // 只处理最后一行（code + space 开头）
            if (line.length < 4 || line[3] !== " ") continue;

            step++;

            switch (step) {
              case 1: // 连接成功后的 banner
                sock.write(`EHLO spot-perp-bot\r\n`);
                break;
              case 2: // EHLO 回复
                if (!useDirectTls && cfg.smtpPort !== 465) {
                  sock.write(`STARTTLS\r\n`);
                } else {
                  heloDone = true;
                  sock.write(`AUTH LOGIN\r\n`);
                }
                break;
              case 3: // STARTTLS 回复（如果发送了）
                if (!useDirectTls && cfg.smtpPort !== 465) {
                  // 升级到 TLS
                  const tlsSocket = tls.connect({ socket: sock as any, host: cfg.smtpHost });
                  (sock as any).destroy(); // 替换 socket
                  heloDone = true;
                  tlsSocket.write(`EHLO spot-perp-bot\r\n`);
                  // 重新绑定数据监听
                  tlsSocket.on("data", (d: Buffer) => {
                    // 简单的递归处理
                    const resp = d.toString();
                    if (resp.includes("250 ")) {
                      tlsSocket.write(`AUTH LOGIN\r\n`);
                    }
                  });
                  return;
                }
                sock.write(`AUTH LOGIN\r\n`);
                break;
              case 4: // AUTH LOGIN 回复（等待 username base64）
                sock.write(Buffer.from(cfg.user).toString("base64") + "\r\n");
                break;
              case 5: // username ok，等待 password
                sock.write(Buffer.from(cfg.pass).toString("base64") + "\r\n");
                break;
              case 6: // auth ok
                authDone = true;
                sock.write(`MAIL FROM:<${cfg.from}>\r\n`);
                break;
              case 7: // MAIL FROM ok
                mailFromDone = true;
                sock.write(`RCPT TO:<${cfg.to}>\r\n`);
                break;
              case 8: // RCPT TO ok
                rcptToDone = true;
                sock.write(`DATA\r\n`);
                break;
              case 9: // DATA ok
                dataDone = true;
                const email = buildEmail(cfg.from, cfg.to, subj, msg);
                sock.write(email + "\r\n.\r\n");
                break;
              case 10: // 发送完成
                sock.write(`QUIT\r\n`);
                break;
              case 11: // QUIT ok
                if (timeout) clearTimeout(timeout);
                sock.destroy();
                res(true);
                break;
            }
          }
        });

        sock.on("error", () => {
          if (timeout) clearTimeout(timeout);
          res(false);
        });

        sock.on("close", () => {
          if (timeout) clearTimeout(timeout);
          // 如果还没到 QUIT 完成就关闭了，视为失败
          if (step < 10) res(false);
        });
      }

    } catch {
      resolve(false);
    }
  });
}

/** 构建简单的纯文本邮件（RFC 2822） */
function buildEmail(from: string, to: string, subject: string, body: string): string {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    body,
  ];
  return lines.join("\r\n");
}
