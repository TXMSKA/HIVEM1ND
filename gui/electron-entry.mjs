import { electronCliArgs, startElectronApp } from './electron.mjs';

export async function runElectronEntry(electron, argv = process.argv, dependencies = {}) {
  const failLaunch = error => {
    console.error('ONEM1ND failed to start:', error);
    electron.app.exit(1);
  };
  try {
    const cliArgs = electronCliArgs(argv, { isPackaged: electron.app.isPackaged, kitPath: electron.app.getAppPath() });
    if (cliArgs) {
      const runCli = dependencies.runCli ?? (await import('../cli/index.mjs')).runCli;
      electron.app.exit(await runCli(cliArgs, { upgrade: true }));
    } else {
      void (dependencies.startElectronApp ?? startElectronApp)(electron, argv.slice(electron.app.isPackaged ? 1 : 2), {
        async upgrade(options) {
          const migrate = dependencies.migrate ?? (await import('../migrations/3.0.0-onem1nd.mjs')).migrate;
          return migrate({ platform: process.platform, env: process.env, homeDir: options.homeDir, kitPath: options.kitPath, nodePath: process.execPath });
        },
      }).catch(failLaunch);
    }
  } catch (error) {
    failLaunch(error);
  }
}
