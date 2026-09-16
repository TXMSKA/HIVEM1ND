import os from "node:os";
import path from "node:path";
import { createWizardServer } from "./server.mjs";

export const secureWebPreferences = Object.freeze({
  contextIsolation: true,
  devTools: false,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
});

export function parseElectronOptions(argv, homeDir) {
  const options = {
    homeDir,
    hostname: os.hostname(),
    resume: true,
  };
  let hasMindPath = false;
  const valueFlags = new Map([
    ["--kit-path", "kitPath"],
    ["--mind-path", "mindPath"],
    ["--home-dir", "homeDir"],
    ["--hostname", "hostname"],
    ["--language", "language"],
    ["--user-data-dir", "userDataDir"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const equals = token.startsWith("--user-data-dir=") ? token.slice("--user-data-dir=".length) : undefined;
    if (equals !== undefined) {
      if (!equals) throw new Error("--user-data-dir requires a value.");
      options.userDataDir = path.resolve(equals);
      continue;
    }
    const key = valueFlags.get(token);
    if (!key) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${argv[index]} requires a value.`);
    options[key] = ["kitPath", "mindPath", "homeDir", "userDataDir"].includes(key) ? path.resolve(value) : value;
    if (key === "mindPath") hasMindPath = true;
    index += 1;
  }
  if (options.language && !["en", "es"].includes(options.language)) throw new Error("--language must be en or es.");
  if (!hasMindPath) options.mindPath = path.join(options.homeDir, "HIVEM1ND");
  return options;
}

export function createWindowOptions(icon, preload) {
  return {
    width: 694,
    height: 540,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#0e0a12",
    show: false,
    title: "HIVEM1ND setup",
    ...(icon ? { icon } : {}),
    autoHideMenuBar: true,
    webPreferences: { ...secureWebPreferences, ...(preload ? { preload } : {}) },
  };
}

export async function startElectronApp(electron, argv = process.argv.slice(2)) {
  const { app, BrowserWindow, dialog, ipcMain, session } = electron;
  const launchOptions = parseElectronOptions(argv, app.getPath("home"));
  if (launchOptions.userDataDir) app.setPath("userData", launchOptions.userDataDir);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let wizard;
  let window;
  let closing = false;

  const closeWizard = async () => {
    if (closing || !wizard) return;
    closing = true;
    try {
      await wizard.close();
    } finally {
      wizard = undefined;
    }
  };

  const createWindow = async () => {
    if (window && !window.isDestroyed()) {
      window.focus();
      return window;
    }
    if (!wizard) {
      const { userDataDir: _userDataDir, ...sessionOptions } = launchOptions;
      sessionOptions.kitPath ??= app.getAppPath();
      wizard = await createWizardServer({ sessionOptions });
    }

    const createdWindow = new BrowserWindow(createWindowOptions(
      path.join(app.getAppPath(), "assets", "installer.ico"),
      path.join(app.getAppPath(), "gui", "preload.cjs"),
    ));
    window = createdWindow;
    const allowedOrigin = wizard.origin;
    createdWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    createdWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
    createdWindow.webContents.on("will-navigate", (event, targetUrl) => {
      try {
        const target = new URL(targetUrl);
        if (target.origin === allowedOrigin && target.pathname === "/") return;
      } catch {
        // Invalid navigation targets are blocked below.
      }
      event.preventDefault();
    });
    createdWindow.once("ready-to-show", () => createdWindow.show());
    createdWindow.on("closed", () => {
      if (window === createdWindow) window = undefined;
    });
    await createdWindow.loadURL(wizard.url);
    if (!createdWindow.isDestroyed() && !createdWindow.isVisible()) createdWindow.show();
    return createdWindow;
  };

  ipcMain.handle("hivem1nd:browse-folder", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner, { properties: ["openDirectory"] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });

  await app.whenReady();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await createWindow();

  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("activate", () => void createWindow());
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (!wizard || closing) return;
    event.preventDefault();
    void closeWizard().then(() => app.quit());
  });
}

if (process.versions.electron && process.type === "browser") {
  const electron = await import("electron");
  const argv = electron.app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
  void startElectronApp(electron, argv).catch((error) => {
    console.error("HIVEM1ND failed to start:", error);
    electron.app.exit(1);
  });
}
