import os from "node:os";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { createWizardServer } from "./server.mjs";
import { defaultMind } from '../engine/service/paths.mjs';
import { startConfiguredViewer } from '../engine/service/install.mjs';

export const secureWebPreferences = Object.freeze({
  contextIsolation: true,
  devTools: false,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
});

export function parseElectronOptions(argv, homeDir, env = process.env) {
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
  if (!hasMindPath) options.mindPath = defaultMind({ platform: process.platform, env, home: options.homeDir });
  return options;
}

export function electronCliArgs(argv, { isPackaged = false, kitPath, platform = process.platform } = {}) {
  if (!Array.isArray(argv) || typeof kitPath !== 'string') return null;
  const args = argv.slice(isPackaged ? 1 : 2);
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (typeof args[0] !== 'string' || !paths.isAbsolute(args[0]) || !paths.isAbsolute(kitPath)) return null;
  const normalize = value => platform === 'win32' ? paths.resolve(value).toLowerCase() : paths.resolve(value);
  if (normalize(args[0]) !== normalize(paths.join(kitPath, 'cli', 'index.mjs'))) return null;
  return args.slice(1);
}

export function createWindowOptions(icon, preload) {
  return {
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 600,
    useContentSize: true,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    backgroundColor: "#07040a",
    show: false,
    title: "ONEM1ND setup",
    ...(icon ? { icon } : {}),
    autoHideMenuBar: true,
    webPreferences: { ...secureWebPreferences, ...(preload ? { preload } : {}) },
  };
}

// Only a plain http or https address of bounded length, without credentials, may leave the app for the system browser.
export function externalLink(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const target = new URL(value);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return null;
    return target.href;
  } catch {
    return null;
  }
}

export async function startElectronApp(electron, argv = process.argv.slice(2), dependencies = {}) {
  const { app, BrowserWindow, dialog, ipcMain, session, shell } = electron;
  const launchOptions = parseElectronOptions(argv, app.getPath("home"));
  launchOptions.kitPath ??= app.getAppPath();
  if (launchOptions.userDataDir) app.setPath("userData", launchOptions.userDataDir);
  else if (app.setPath) {
    for (const directory of ['HIVEM1ND', 'hivem1nd']) { // Compatibility: retain an existing Electron profile and its stored viewer preferences.
      const candidate = path.join(app.getPath('appData'), directory);
      const state = await lstat(candidate).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!state?.isDirectory() || state.isSymbolicLink()) continue;
      app.setPath('userData', candidate);
      break;
    }
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  if (dependencies.upgrade) {
    const migrated = await dependencies.upgrade(launchOptions);
    for (const key of ['mindPath', 'kitPath']) {
      if (!launchOptions[key]) continue;
      const target = path.resolve(launchOptions[key]);
      for (const move of migrated?.relocatedPaths ?? []) {
        const relative = path.relative(path.resolve(move.source), target);
        if (relative !== '' && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) continue;
        launchOptions[key] = path.join(move.destination, relative);
        break;
      }
    }
  }

  let wizard;
  let window;
  let closing = false;
  let viewerTarget;
  let viewerHost;

  const viewerFrame = event => {
    if (!viewerTarget || !window || window.isDestroyed() || event.sender !== window.webContents
        || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) throw new Error('The verified local Map is required.');
    const target = new URL(event.senderFrame.url);
    if (target.origin !== viewerTarget.origin || target.pathname !== viewerTarget.pathname || target.username || target.password) throw new Error('The verified local Map is required.');
  };

  const closeWizard = async () => {
    if (closing || !wizard) return;
    closing = true;
    try {
      await wizard.close();
      await viewerHost?.stop();
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
      sessionOptions.serviceSetup = true;
      sessionOptions.serviceDryRun = false;
      sessionOptions.shortcuts = true;
      sessionOptions.serviceStart = async config => {
        const started = await (dependencies.startConfiguredViewer ?? startConfiguredViewer)(config, {
          homeDir: launchOptions.homeDir, hostname: launchOptions.hostname,
        });
        const target = new URL(started.viewerUrl);
        if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password
          || !/^\/gui\/(?:viewer|[0-9a-f-]{36})\/?$/.test(target.pathname)) throw new Error('The local Map URL could not be verified.');
        viewerTarget = { origin: target.origin, pathname: target.pathname };
        viewerHost = started.recovery;
        return started;
      };
      wizard = await (dependencies.createWizardServer ?? createWizardServer)({
        sessionOptions,
        async openCompletedViewer(url) {
          const target = new URL(url);
          if (!viewerTarget || target.origin !== viewerTarget.origin || target.pathname !== viewerTarget.pathname
            || target.username || target.password || !window || window.isDestroyed()) {
            throw new Error('The local Map window is unavailable.');
          }
          await window.loadURL(url);
        },
      });
    }

    const createdWindow = new BrowserWindow(createWindowOptions(
      path.join(launchOptions.kitPath, "assets", "installer.ico"),
      path.join(launchOptions.kitPath, "gui", "preload.cjs"),
    ));
    window = createdWindow;
    const allowedOrigin = wizard.origin;
    // A link the verified Map follows, such as one in a Void text, opens in the system browser; the window itself never leaves.
    const openOutside = (value) => {
      const link = externalLink(value);
      if (!link || !viewerTarget || createdWindow.isDestroyed()) return;
      try {
        const shown = new URL(createdWindow.webContents.mainFrame.url);
        if (shown.origin !== viewerTarget.origin || shown.pathname !== viewerTarget.pathname) return;
      } catch {
        return;
      }
      Promise.resolve(shell?.openExternal?.(link)).catch(() => {});
    };
    createdWindow.webContents.setWindowOpenHandler(({ url } = {}) => {
      openOutside(url);
      return { action: "deny" };
    });
    createdWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
    createdWindow.webContents.on("will-navigate", (event, targetUrl) => {
      try {
        const target = new URL(targetUrl);
        if (target.username || target.password) throw new Error('Invalid navigation target');
        if (target.origin === allowedOrigin && target.pathname === "/") return;
        if (viewerTarget && target.origin === viewerTarget.origin && target.pathname === viewerTarget.pathname) return;
      } catch {
        // Invalid navigation targets are blocked below.
      }
      event.preventDefault();
      openOutside(targetUrl);
    });
    createdWindow.once("ready-to-show", () => createdWindow.show());
    createdWindow.on("closed", () => {
      if (window === createdWindow) window = undefined;
    });
    await createdWindow.loadURL(wizard.url);
    if (!createdWindow.isDestroyed() && !createdWindow.isVisible()) createdWindow.show();
    return createdWindow;
  };

  ipcMain.handle("hivem1nd:browse-folder", async (event) => { // Compatibility: retain the preload IPC channel identity.
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner, { properties: ["openDirectory"] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  ipcMain.handle('hivem1nd:service-status', async event => { // Compatibility: retain the preload IPC channel identity.
    viewerFrame(event);
    if (!viewerHost) throw new Error('Reopen ONEM1ND using its local launcher.');
    return viewerHost.serviceStatus();
  });
  ipcMain.handle('hivem1nd:recover-service', async event => { // Compatibility: retain the preload IPC channel identity.
    viewerFrame(event);
    if (!viewerHost) throw new Error('Reopen ONEM1ND using its local launcher.');
    return viewerHost.recover();
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
  const failLaunch = error => {
    console.error("ONEM1ND failed to start:", error);
    electron.app.exit(1);
  };
  try {
    const cliArgs = electronCliArgs(process.argv, { isPackaged: electron.app.isPackaged, kitPath: electron.app.getAppPath() });
    if (cliArgs) {
      const { runCli } = await import('../cli/index.mjs');
      electron.app.exit(await runCli(cliArgs, { upgrade: true }));
    } else {
      void startElectronApp(electron, argv, {
        async upgrade(options) {
          const { migrate } = await import('../migrations/3.0.0-onem1nd.mjs');
          return migrate({ platform: process.platform, env: process.env, homeDir: options.homeDir, kitPath: options.kitPath, nodePath: process.execPath });
        }
      }).catch(failLaunch);
    }
  } catch (error) {
    failLaunch(error);
  }
}
