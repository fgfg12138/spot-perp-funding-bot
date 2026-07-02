/**
 * Electron 主进程 —— 启动 Next.js server + 打开 BrowserWindow
 *
 * 打包后目录结构:
 *   [安装目录]/
 *     FundingArbitrageDashboard.exe
 *     resources/
 *       app/              ← Next.js 应用整体拷贝（.next/ + node_modules/ 等）
 *       .env              ← 打包内置的配置文件（用户可到 AppData 下修改副本）
 *
 * 用户数据目录:
 *   %APPDATA%/FundingArbitrageDashboard/data/
 *     .env           ← 从 resources/.env 首次复制过来，用户可修改
 *     v121.sqlite    ← SQLite 数据库，首次使用时自动创建
 */
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { fork } = require("child_process");
const fs = require("fs");

// --------------- 环境判断 ---------------
const isDev = !app.isPackaged;
const PORT = process.env.ELECTRON_PORT || 3000;

// --------------- 路径工具 ---------------
/** 应用资源根目录（开发: 项目根目录; 生产: resources/） */
function resourceRoot() {
  if (isDev) return path.join(__dirname, "..");
  return process.resourcesPath;
}

/** app 目录路径（开发: 项目根目录; 生产: resources/app/） */
function appRoot() {
  if (isDev) return path.join(__dirname, "..");
  return path.join(process.resourcesPath, "app");
}

// --------------- 用户数据目录 ---------------
const userDataDir = path.join(app.getPath("userData"), "data");
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

// --------------- 环境变量 ---------------
function loadEnv() {
  const builtInEnv = path.join(resourceRoot(), ".env");
  const userEnv = path.join(userDataDir, ".env");

  // 首次运行：从打包的 .env 复制到用户数据目录
  if (!fs.existsSync(userEnv) && fs.existsSync(builtInEnv)) {
    try {
      fs.copyFileSync(builtInEnv, userEnv);
      console.log("[electron] copied .env to:", userEnv);
    } catch (err) {
      console.warn("[electron] cannot copy .env:", err.message);
    }
  }

  // 优先级：用户数据目录 > 打包内置
  const target = fs.existsSync(userEnv) ? userEnv : builtInEnv;
  if (fs.existsSync(target)) {
    const content = fs.readFileSync(target, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
    console.log("[electron] loaded .env from:", target);
  }
}
loadEnv();

// 给 Next.js 设置运行时所需的环境变量
process.env.PORT = String(PORT);

// 设置 SQLite 数据库路径到用户数据目录
const sqliteDir = path.join(userDataDir);
process.env.V121_SQLITE_PATH = path.join(sqliteDir, "v121.sqlite");
process.env.V121_PERSISTENCE_MODE = "sqlite-active";
// JSONL 的 fallback 路径也指向用户数据目录
process.env.V121_JSONL_DIR = path.join(sqliteDir, ".v121-data");

// --------------- 启动 Next.js Server ---------------
function startNextServer() {
  return new Promise((resolve, reject) => {
    const serverScript = path.join(appRoot(), "node_modules", "next", "dist", "bin", "next");
    const args = isDev
      ? ["dev", "--port", String(PORT)]
      : ["start", "--port", String(PORT)];

    console.log("[electron] cwd:", appRoot());
    console.log("[electron] script:", serverScript);

    const server = fork(serverScript, args, {
      cwd: appRoot(),
      env: { ...process.env, NODE_ENV: isDev ? "development" : "production" },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    server.stdout?.on("data", (data) => {
      const msg = data.toString();
      console.log("[next]", msg.trim());
      if (msg.includes("Ready") || msg.includes(`localhost:${PORT}`)) {
        resolve(server);
      }
    });

    server.stderr?.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[next:err]", msg);
    });

    server.on("error", reject);
    server.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[next] exited with code ${code}`);
        reject(new Error(`Next.js exited with code ${code}`));
      }
    });

    // 如果 20 秒后还没检测到 ready 也继续（生产模式启动可能慢些）
    setTimeout(() => resolve(server), 20000);
  });
}

// --------------- 创建窗口 ---------------
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Funding Arbitrage Dashboard",
    icon: path.join(appRoot(), "public", "favicon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
    backgroundColor: "#0f172a",
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

// --------------- 应用生命周期 ---------------
let serverProcess = null;

app.whenReady().then(async () => {
  try {
    console.log("[electron] starting on port", PORT);
    serverProcess = await startNextServer();
    console.log("[electron] server ready, creating window...");
    createWindow();
  } catch (err) {
    console.error("[electron] fatal:", err);
    dialog.showErrorBox("启动失败", `无法启动应用服务器:\n${err.message}`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
});
