// Packaged CLI launches have a marked CommonJS main; Electron's development loader imports the explicitly named file.
if (process.versions.electron && process.type === 'browser'
    && (require.main === module || (process.defaultApp === true && process.argv[1] && require('node:path').resolve(process.argv[1]) === __filename))) {
  void Promise.all([import('./electron-entry.mjs'), import('electron')])
    .then(([{ runElectronEntry }, electron]) => runElectronEntry(electron))
    .catch(error => {
      console.error('ONEM1ND failed to start:', error);
      require('electron').app.exit(1);
    });
}
