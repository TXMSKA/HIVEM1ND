import { lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  detectExistingMind,
  discoverAgents,
  discoverContent,
  discoverHomeProjects,
  discoverOtherMinds,
  discoverProjects,
  envValue,
  loadAdapters,
} from './discovery.mjs';
import { configureOwnedService } from './service/install.mjs';
import { assertLocalStaging, assertNoLinks, defaultMind, mindKeyFor, oneDriveRoots, MIND_DIRECTORY_NAME } from './service/paths.mjs';
import { canonicalJson, CoreError } from './service/identity.mjs';
import { protectLocalFile } from './service/security.mjs';
import { copyLegacyTree, legacyTreeInventory } from './legacy-copy.mjs';
import { legacySessions, verifiedLegacyStop, writeLegacyClosure } from './relay/local-wake.mjs';
import {
  applyInstallPlan,
  combinePlans,
  prepareSetupAgentAssets,
  planDataFile,
  planKitCopy,
  planManagedFileRemovals,
  publicPreview,
  readPeerHashes,
  registerLinkConflicts,
  retiredKitSources,
  writeInstallReport,
} from './install.mjs';
import {
  ensureSafeDirectory,
  atomicWriteFile,
  parseMachineRecord,
  readMachineRecord,
  readTextIfPresent,
  serializeMachineRecord,
  hashContent,
  writeMachineRecord,
} from './records.mjs';
import { applyFolderIcon } from './folder-icon.mjs';
import { applyShortcuts, removeOwnedShortcuts, shortcutPlan, windowsShortcutFolders } from './shortcuts.mjs';
import { estimateStagedFiles, syncProgress } from './setup-progress.mjs';
import { detectLanguage, LANGUAGES, option, relayLine, text } from './texts.mjs';

const SETUP_PHASES = ['prepare', 'close-legacy', 'copy', 'migrate', 'configure', 'start', 'open', 'ready'];
const SETUP_COPY = {
  en: { joinTitle: 'Join this M1ND', join: 'Join', closeTitle: 'Close HIVEM1ND 2.x first', close: 'Sessions closed, migrate',
    offline: 'A session on an offline machine closes the next time that machine starts HIVEM1ND.', review: 'Review changes in Settings' },
  es: { joinTitle: 'Unirse a esta M1ND', join: 'Unirse', closeTitle: 'Cerrar HIVEM1ND 2.x primero', close: 'Sesiones cerradas, migrar',
    offline: 'Una sesión en una máquina desconectada se cierra la próxima vez que esa máquina inicia HIVEM1ND.', review: 'Revisar cambios en Configuración' },
};

export async function createSetupSession(options = {}) {
  const kitPath = path.resolve(requireValue(options.kitPath, 'kitPath'));
  await requireDirectory(kitPath, 'kitPath');
  if (!options.env || typeof options.env === 'object') {
    // An omitted env intentionally uses this process environment.
  } else {
    throw new Error('env must be an environment object');
  }
  const env = options.env ?? process.env;
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const hostname = String(options.hostname ?? os.hostname()).trim();
  if (!hostname) throw new Error('hostname is required');
  const adapters = await loadAdapters({ kitPath });
  const presets = await computeMindPresets({ kitPath, homeDir, env });
  const defaultMindPath = options.mindPath
    ? path.resolve(options.mindPath)
    : options.cosmicPath
      ? path.join(path.resolve(options.cosmicPath), MIND_DIRECTORY_NAME)
      : cosmicMind(env, homeDir);
  validateMindSelection(defaultMindPath, kitPath);

  const session = new SetupSession({
    kitPath,
    mindPath: defaultMindPath,
    homeDir,
    hostname,
    language: normalizeLanguage(options.language ?? detectLanguage(env)),
    env,
    adapters,
    presets,
    resume: options.resume !== false,
    relaySetup: options.relaySetup === true,
    serviceSetup: options.serviceSetup === true,
    serviceDryRun: options.serviceDryRun !== false,
    serviceRunner: options.serviceRunner ?? null,
    serviceStart: options.serviceStart ?? null,
    serviceQuery: options.serviceQuery ?? null,
    aclRunner: options.aclRunner ?? null,
    folderIconPlatform: options.folderIconPlatform ?? null,
    shortcuts: options.shortcuts === true,
    desktopShortcut: options.desktopShortcut !== false,
    shortcutFolders: options.shortcutFolders ?? null,
    shortcutRunner: options.shortcutRunner ?? null,
    nodePath: options.nodePath ?? null,
    attribRunner: options.attribRunner ?? null,
    sid: options.sid ?? null,
    serviceProtect: options.serviceProtect !== false,
    openViewer: options.openViewer ?? null,
    cosmicPath: options.cosmicPath ? path.resolve(options.cosmicPath) : null,
    originKind: options.originKind ?? 'folder',
    originPath: options.originPath ?? '',
    legacySourcePath: options.legacySourcePath ? path.resolve(options.legacySourcePath) : null,
    legacyControl: options.legacyControl ?? null,
    copyCheckpoint: options.copyCheckpoint ?? null,
    migrationFaultAfterMoves: options.migrationFaultAfterMoves ?? null,
  });
  await session.initialize();
  return session;
}

class SetupSession {
  constructor(options) {
    Object.assign(this, options);
    this.currentStep = 1;
    this.detectedLegacyPath = options.legacySourcePath;
    this.installing = false;
    this.answers = {
      language: options.language,
      installMode: 'custom',
      mindPath: options.mindPath,
      agentsScanned: false,
      agents: [],
      onDemandNoticeShown: false,
      included: undefined,
      projectRoots: [],
      projects: [],
      projectsScanned: false,
      projectsConfirmed: false,
      updateCheck: 'daily',
      skipPreferences: false,
      addressStyle: 'impersonal',
      customPreference: '',
      keepExistingPreferences: true,
      attach: null,
      conflicts: {},
      confirm: false,
      originKind: options.originKind,
      originPath: options.originPath,
    };
    this.machineRecord = null;
    this.result = null;
    this.discoveryCache = null;
    this.contentCache = null;
    this.preferenceFiles = [];
    this.existingMind = null;
    this.attachOutdated = null;
    this.alertedMind = null;
    this.checkpoint = null;
    this.checkpointProof = {};
  }

  async initialize() {
    const draft = this.resume ? await this.readLocal('setup-draft.json') : null;
    if (draft) {
      if (draft.destinationPath !== this.mindPath || !draft.answers || !Number.isInteger(draft.step)) throw new CoreError(409, 'checkpoint_changed', 'The local setup draft does not match this M1ND.');
      this.answers = { ...this.answers, ...draft.answers, mindPath: this.mindPath };
      this.legacySourcePath = draft.answers.legacySourcePath ?? this.legacySourcePath;
      this.detectedLegacyPath ??= this.legacySourcePath;
      this.answers.language = normalizeLanguage(this.answers.language);
      this.currentStep = clampStep(draft.step);
    }
    const { record } = await readMachineRecord(this.mindPath, this.hostname);
    this.machineRecord = record;
    this.existingMind = await this.inspectMind(this.mindPath);
    if (!this.detectedLegacyPath) {
      const found = await this.findInstalledMind();
      if (/^2\./.test(found?.version ?? '')) this.detectedLegacyPath = found.path;
    }
    this.checkpoint = this.resume ? await this.readLocal('setup.json') : null;
    if (this.checkpoint) {
      await this.verifyCheckpoint();
      this.legacySourcePath = this.checkpoint.sourcePath;
      this.answers.attach = this.checkpoint.mode === 'join';
      this.currentStep = this.checkpoint.phase === 'ready' && this.checkpoint.completed.includes('ready') ? 8 : 7;
      this.result = this.completionResult([], []);
      if (this.currentStep === 7) {
        if (this.checkpoint.completed.includes('configure')) this.answers.serviceOnly = true;
        this.result.completed = false;
        if (this.checkpoint.error) this.result.service = { status: 'failed', phase: this.checkpoint.phase, code: this.checkpoint.error.code, error: this.checkpoint.error.message };
      } else if (this.serviceSetup) {
        if (record) await this.writeSetupMachineRecord({ ...record, setup: 7 });
        const service = await this.configureService();
        this.result.service = service;
        this.result.completed = service.status !== 'failed';
        this.result.viewerUrl = service.viewerUrl ?? null;
        if (service.status === 'failed') {
          this.answers.serviceOnly = true;
          this.currentStep = 7;
          this.checkpoint.completed = SETUP_PHASES.slice(0, 5);
          this.checkpoint.phase = 'start';
          const failure = safeServiceFailure(service, this.answers.language, 'start');
          this.checkpoint.error = { code: failure.code, message: failure.safeSetupMessage };
          await this.saveCheckpoint();
        } else if (this.openViewer && service.viewerUrl) {
          await this.openViewer(service.viewerUrl);
          this.viewerOpened = true;
        }
        if (service.status !== 'failed' && record) await this.writeSetupMachineRecord(record);
      }
      return;
    }
    if (draft) return;
    if (!record) return;
    if (record.machine && record.machine !== this.hostname) return;

    if (this.resume) {
      this.answers = { ...this.answers, language: record.language ?? this.answers.language, ...(record.draft ?? {}) };
      this.answers.mindPath = this.mindPath;
      this.answers.language = normalizeLanguage(this.answers.language);
      this.currentStep = record.setup === 'done' ? 8 : clampStep(record.setup);
      if (record.setup === 'done') this.result = this.completionResult([], []);
      if (this.serviceSetup && (record.setup === 'done' || record.draft?.serviceOnly === true)) {
        this.answers.serviceOnly = true;
        this.currentStep = record.setup === 'done' ? 7 : this.currentStep;
        this.result = this.completionResult([], []);
        if (record.setup === 'done') await this.resumeInstalledService();
      }
    } else {
      this.answers.agents = record.agents.map((agent) => ({
        id: agent.name,
        selected: true,
        attach: agent.mode === 'auto' ? 'auto' : 'onDemand',
        detected: false,
      }));
      this.answers.updateCheck = record.updateCheck;
      this.answers.keepExistingPreferences = record.keepExistingPreferences;
    }
  }

  async getStep() {
    const language = this.answers.language;
    const number = this.currentStep === 7 ? 3 : this.currentStep === 8 ? 4 : this.currentStep === 1 ? 1 : 2;
    const id = ['install', 'location', 'service', 'ready'][number - 1];
    const base = {
      id, number, total: 4, title: text(language, `step${number}Title`),
      description: text(language, `step${number}Description`, { machine: this.hostname }),
      fields: [], values: {}, done: number === 4, result: number === 4 ? this.result : null,
      language, languages: LANGUAGES.map(code => option(language, code, code === 'es' ? 'spanish' : 'english')),
      back: number === 2, busy: this.installing === true,
      action: text(language, number === 1 ? 'startSetup' : number === 4 ? 'openMap' : number === 3 ? this.checkpoint?.error ? 'retry' : 'installing' : 'continue'),
    };
    if (id === 'install') base.bullets = ['setupMap', 'setupObjectives', 'setupRelay'].map(key => text(language, key));
    if (id === 'location') {
      base.fields = [field('mindPath', 'text', text(language, 'folder'), true)];
      base.values = { mindPath: this.mindPath };
      base.relayPlus = { title: text(language, 'relayPlus'), badge: text(language, 'comingSoon'),
        body: text(language, 'relayPlusCopy'), disabled: true };
      if (this.canAttach()) {
        const summary = await this.joinSummary();
        base.fields.push(field('attach', 'boolean', text(language, 'joinMind'), true));
        base.values.attach = this.answers.attach ?? true;
        base.join = { title: text(language, 'joinMind'), action: text(language, 'join'),
          body: text(language, 'joinOffer', summary), ...summary };
        base.action = base.join.action;
        this.alertedMind = normalizePath(this.mindPath);
      } else if (this.detectedLegacyPath) {
        const sessions = recentLegacy(await legacySessions(this.detectedLegacyPath), Date.now());
        base.fields.push(field('migrateLegacy', 'boolean', text(language, 'migrateLegacy'), false));
        base.values.migrateLegacy = this.answers.migrateLegacy !== false;
        base.legacy = { sourcePath: this.detectedLegacyPath, title: text(language, 'migrateLegacy'),
          body: text(language, 'legacyOffer', { path: this.detectedLegacyPath }), confirmation: this.legacyConfirmation === true,
          closeTitle: text(language, 'closeLegacyTitle'), closeCopy: text(language, 'closeLegacyCopy'),
          action: text(language, 'closeLegacy'), offline: text(language, 'offlineLegacy'),
          sessions: sessions.map(({ binding }) => ({ unit: binding.unit, client: binding.client, machine: binding.machine,
            local: binding.machine === this.hostname })) };
      }
      if (this.offersDesktopShortcut()) {
        base.fields.push(field('desktopShortcut', 'boolean', text(language, 'desktopShortcut'), false));
        base.values.desktopShortcut = this.desktopShortcut !== false;
        base.shortcut = { title: text(language, 'desktopShortcut') };
      }
    }
    if (id === 'service') {
      base.progress = this.setupProgress();
      await this.attachSyncProgress(base.progress, language);
      base.failure = this.checkpoint?.error ? { code: this.checkpoint.error.code,
        headline: this.checkpoint.error.message, body: text(language, 'failureScope') } : null;
      const preview = this.checkpoint?.completed.includes('configure') ? { conflicts: [] }
        : this.installing || this.checkpoint ? this.setupPreview ?? { conflicts: [] } : await this.preview();
      base.preview = { ...preview, conflicts: (preview.conflicts ?? []).map(conflict => ({
        ...conflict, selection: this.answers.conflicts[conflict.path] ?? conflict.selection,
      })) };
      base.fields = (base.preview.conflicts ?? []).map((conflict, index) => field(
        `conflict.${index}`, 'select', conflict.path, true,
        conflict.choices.map(choice => option(language, choice, conflictChoiceKey(conflict, choice))), conflict.reason));
      base.values = { confirm: this.answers.confirm, conflicts: { ...this.answers.conflicts } };
    }
    if (id === 'ready') {
      const agents = (this.answers.agents ?? []).filter(agent => agent.selected !== false).map(agent => displayAgent(agent.id, this.adapters));
      const projects = this.answers.projects ?? [];
      const folders = new Set(projects.map(project => path.dirname(project.path))).size;
      base.summary = [
        { id: 'mind', label: 'M1ND', value: this.mindPath },
        ...(this.result?.mode === 'migrate' ? [{ id: 'legacy', label: text(language, 'legacyMind'), value: text(language, 'migratedLegacy') }] : []),
        { id: 'service', label: text(language, 'service'), value: this.result?.service?.status === 'started' ? text(language, 'running') : text(language, 'serviceNotStarted'), running: this.result?.service?.status === 'started' },
        { id: 'agents', label: text(language, 'agentsFound'), value: agents.join(', '), count: agents.length },
        { id: 'projects', label: text(language, 'step5Title'), value: text(language, 'repositoriesInFolders', { repositories: projects.length, folders }), repositories: projects.length, folders },
      ];
      base.notice = text(language, 'detectedDefaults');
    }
    return base;
  }

  async joinSummary() {
    const files = await legacyTreeInventory(this.mindPath);
    const units = new Set();
    const machines = [];
    for (const entry of files) {
      if (entry.kind !== 'file') continue;
      if (/^user\/(?:state|(?:projects|envs)\/[^/]+\/state)\/[^/]+\.md$/.test(entry.path)) {
        const content = await readFile(path.join(this.mindPath, entry.path), 'utf8');
        const unit = /^unit:\s*(\S+)/m.exec(content)?.[1];
        if (unit && !['master', 'user'].includes(unit)) units.add(entry.path);
      }
      if (/^user\/machines\/[^/]+\.md$/.test(entry.path)) {
        const record = parseMachineRecord(await readFile(path.join(this.mindPath, entry.path), 'utf8'));
        machines.push(record);
      }
    }
    machines.sort((left, right) => String(right.lastCheck ?? '').localeCompare(String(left.lastCheck ?? '')));
    return { units: units.size, machine: machines[0]?.machine || text(this.answers.language, 'unknownMachine'),
      time: machines[0]?.lastCheck || text(this.answers.language, 'unknownTime') };
  }

  setupProgress() {
    const phases = [this.checkpoint?.mode === 'migrate' ? ['prepare', 'close-legacy', 'copy'] : ['prepare'],
      ['close-legacy', 'copy', 'migrate'], ['configure'], ['start'], ['open', 'ready']];
    const keys = ['progressFolder', 'progressLegacy', 'progressRegistration', 'progressStart', 'progressOpen'];
    const completed = new Set(this.checkpoint?.completed ?? []);
    const phase = this.checkpoint?.phase;
    // Without a migration there is no previous M1ND to copy, so its row is left out instead of ticked.
    const migrating = this.checkpoint ? this.checkpoint.mode === 'migrate' : Boolean(this.detectedLegacyPath) && this.answers.migrateLegacy !== false;
    return keys.map((key, index) => {
      const group = phases[index];
      const done = group.every(value => completed.has(value));
      const current = group.includes(phase);
      const state = done ? 'done' : current && this.checkpoint?.error ? 'fail' : current && this.installing ? 'busy' : 'todo';
      const timings = this.checkpointProof.timings ?? {};
      const duration = group.reduce((sum, value) => sum + (timings[value] ?? 0), 0)
        + (state === 'busy' && this.phaseStartedAt ? Date.now() - this.phaseStartedAt : 0);
      return { id: ['folder', 'legacy', 'registration', 'start', 'open'][index], label: text(this.answers.language, key),
        state, elapsedSeconds: duration > 0 ? Math.ceil(duration / 1000) : null };
    }).filter(row => migrating || row.id !== 'legacy');
  }

  // While the service starts for the first time it stages and publishes every file of the M1ND, which takes minutes.
  // The counts come from the staging folders the service writes, so the step can show a bar instead of a bare spinner.
  async attachSyncProgress(rows, language) {
    const row = rows.find(item => item.id === 'start' && item.state === 'busy');
    if (!row) return;
    try {
      const directory = this.localDirectory();
      if (this.stagingEstimate === undefined) {
        this.stagingEstimate = null;
        estimateStagedFiles(this.mindPath).then(count => { this.stagingEstimate = count; }, () => {});
      }
      const found = await syncProgress({ localDirectory: directory, estimate: this.stagingEstimate });
      const numbers = { done: found.done.toLocaleString(language), total: found.total === null ? '' : found.total.toLocaleString(language) };
      const key = found.phase === 'preparing' ? 'syncPreparing' : found.phase === 'publishing' ? 'syncPublishing'
        : found.total === null ? 'syncStagingUnknown' : 'syncStaging';
      row.sync = { phase: found.phase, done: found.done, total: found.total, detail: text(language, key, numbers) };
    } catch {
      // The count is a courtesy; the step keeps its spinner and its seconds when the folders cannot be read.
    }
  }

  async setLanguage(value) {
    this.answers.language = normalizeLanguage(value);
    await this.persistDraft();
    return this.getStep();
  }

  async answer(values = {}) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new SetupValidationError('Answers must be an object');
    if (this.installing) throw new CoreError(409, 'setup_busy', 'Setup is already running.');
    if (this.currentStep === 8) return this.getStep();
    if (this.currentStep === 1) {
      this.currentStep = 2;
    } else if (this.currentStep === 2) {
      if (values.desktopShortcut !== undefined) {
        if (typeof values.desktopShortcut !== 'boolean') throw new SetupValidationError('desktopShortcut must be a boolean');
        this.desktopShortcut = values.desktopShortcut;
      }
      const selected = path.resolve(requireValue(values.mindPath ?? this.mindPath, 'mindPath'));
      validateMindSelection(selected, this.kitPath);
      await validateDestinationType(selected);
      await this.selectMind(selected);
      if (/^2\./.test(this.existingMind?.version ?? '')) throw new SetupValidationError('Choose a separate destination for the legacy M1ND copy.');
      if (values.changeFolder === true) { this.legacyConfirmation = false; await this.persistDraft(); return this.getStep(); }
      if (this.canAttach() && this.alertedMind !== normalizePath(selected)) { await this.persistDraft(); return this.getStep(); }
      this.answers.attach = this.canAttach();
      if (this.answers.attach && values.attach === false) throw new SetupValidationError('Choose another folder to create a new M1ND.');
      if (values.migrateLegacy !== undefined && typeof values.migrateLegacy !== 'boolean') throw new SetupValidationError('migrateLegacy must be a boolean');
      this.answers.migrateLegacy = values.migrateLegacy ?? this.answers.migrateLegacy ?? true;
      this.legacySourcePath = !this.answers.attach && this.answers.migrateLegacy ? this.detectedLegacyPath : null;
      if (values.closeLegacy === false) { this.legacyConfirmation = false; await this.persistDraft(); return this.getStep(); }
      if (this.legacySourcePath && recentLegacy(await legacySessions(this.legacySourcePath), Date.now()).length && values.closeLegacy !== true) {
        this.legacyConfirmation = true;
        await this.persistDraft();
        return this.getStep();
      }
      this.answers.closeLegacy = values.closeLegacy === true;
      await this.applySimpleDefaults();
      this.currentStep = 7;
      this.setupPreview = await this.preview();
    } else if (this.currentStep === 7) {
      const preview = await this.preview();
      const nested = values.conflicts && typeof values.conflicts === 'object' ? values.conflicts : {};
      for (const [index, conflict] of preview.conflicts.entries()) {
        const choice = nested[conflict.path] ?? values[`conflict.${index}`];
        if (choice !== undefined) {
          if (!conflict.choices.includes(choice)) throw new SetupValidationError(`Invalid conflict choice for ${conflict.path}`);
          this.answers.conflicts[conflict.path] = choice;
        }
      }
      this.answers.confirm = values.confirm === true;
    }
    await this.persistDraft();
    return this.getStep();
  }

  async back() {
    if (this.currentStep >= 7 || this.installing) throw new CoreError(409, 'back_unavailable', text(this.answers.language, 'backUnavailable'));
    if (this.currentStep === 2) this.currentStep = 1;
    this.legacyConfirmation = false;
    await this.persistDraft();
    return this.getStep();
  }

  async preview() {
    if (this.currentStep < 7) throw new Error('Preview is available at step 7');
    if (this.answers.serviceOnly || this.checkpoint?.completed.includes('configure')) return { files: [], kept: [], warnings: [], conflicts: [] };
    const plan = await this.buildPlan();
    const preview = publicPreview(plan, this.answers.language);
    preview.conflicts = preview.conflicts.map((conflict) => ({
      ...conflict,
      selection: this.answers.conflicts[conflict.path] ?? conflict.selection ?? null,
    }));
    preview.clientChanges = { ...publicPreview(this.clientPlan, this.answers.language), requiresReview: true,
      action: SETUP_COPY[this.answers.language].review };
    return preview;
  }

  localDirectory() {
    const directory = path.join(this.cosmicPath ?? path.dirname(defaultMind({ platform: process.platform, env: this.env, home: this.homeDir })),
      'hivem1nd-service', mindKeyFor(this.mindPath, process.platform), this.hostname);
    if (isWithin(this.mindPath, directory) || isWithin(directory, this.mindPath)
      || this.legacySourcePath && (isWithin(this.legacySourcePath, directory) || isWithin(directory, this.legacySourcePath))) {
      throw new CoreError(422, 'invalid_path', 'Local setup storage must stay outside both M1ND trees.');
    }
    return directory;
  }

  async readLocal(name) {
    const file = path.join(this.localDirectory(), name);
    await assertNoLinks(file);
    return readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  }

  async writeLocal(name, value) {
    const directory = this.localDirectory();
    const file = path.join(directory, name);
    await assertLocalStaging(directory, { platform: process.platform, origin: this.mindPath,
      syncedRoots: oneDriveRoots({ platform: process.platform, env: this.env }), env: this.env });
    for (let ancestor = directory; ancestor !== path.dirname(ancestor); ancestor = path.dirname(ancestor)) {
      const mind = await this.inspectMind(ancestor);
      if (/^[23]\./.test(mind?.version ?? '')) throw new CoreError(422, 'invalid_path', 'Local setup storage cannot be inside an existing M1ND.');
    }
    await assertNoLinks(file);
    await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`, { root: directory });
    if (this.serviceProtect !== false) await protectLocalFile(file, { aclRunner: this.aclRunner });
  }

  async saveCheckpoint() {
    this.checkpoint.updatedAt = new Date().toISOString();
    await this.writeLocal('setup-proof.json', this.checkpointProof);
    await this.writeLocal('setup.json', this.checkpoint);
  }

  async verifyCheckpoint() {
    const checkpoint = this.checkpoint;
    const fields = ['format', 'mode', 'sourcePath', 'destinationPath', 'phase', 'completed', 'error', 'updatedAt'];
    if (JSON.stringify(Object.keys(checkpoint).sort()) !== JSON.stringify(fields.sort())
      || checkpoint.format !== 'hivem1nd-setup-v1' || !['create', 'join', 'migrate'].includes(checkpoint.mode)
      || checkpoint.destinationPath !== this.mindPath || !SETUP_PHASES.includes(checkpoint.phase)
      || !Array.isArray(checkpoint.completed) || checkpoint.completed.some((phase, index) => phase !== SETUP_PHASES[index])
      || checkpoint.completed.length > SETUP_PHASES.length || !Number.isFinite(Date.parse(checkpoint.updatedAt))
      || checkpoint.mode === 'migrate' && typeof checkpoint.sourcePath !== 'string'
      || checkpoint.mode !== 'migrate' && checkpoint.sourcePath !== null
      || checkpoint.phase !== (SETUP_PHASES[checkpoint.completed.length] ?? 'ready')) {
      throw new CoreError(409, 'checkpoint_changed', 'The setup checkpoint is invalid.');
    }
    this.checkpointProof = await this.readLocal('setup-proof.json');
    if (!this.checkpointProof) throw new CoreError(409, 'checkpoint_changed', 'The setup checkpoint has no verification record.');
    await assertNoLinks(this.mindPath);
    if (this.checkpointProof.pendingProgress) {
      const pending = this.checkpointProof.pendingProgress;
      const file = path.join(this.mindPath, '.migration', 'migration-3.0.0.json');
      await assertNoLinks(file);
      const bytes = await readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const hash = bytes ? hashContent(bytes) : null;
      if (hash === pending.sha256) {
        this.checkpointProof.destination = (this.checkpointProof.destination ?? []).filter(entry => entry.path !== '.migration/migration-3.0.0.json');
        this.checkpointProof.destination.push({ path: '.migration/migration-3.0.0.json', kind: 'file', sha256: hash });
        this.checkpointProof.pendingPersonMove = pending.progress.pendingMove ?? null;
        for (const move of pending.progress.moves) {
          if ([move.from, move.to].some(value => typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..'))) {
            throw new CoreError(409, 'checkpoint_changed', 'A pending migration progress entry is invalid.');
          }
          const target = path.join(this.mindPath, 'user', move.to);
          const source = path.join(this.mindPath, 'user', move.from);
          await assertNoLinks(target);
          await assertNoLinks(source);
          if (hashContent(await readFile(target)) !== move.sha256) throw new CoreError(409, 'checkpoint_changed', 'A pending migration target changed.');
          const exists = await lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (!exists) this.checkpointProof.destination = this.checkpointProof.destination.filter(entry => entry.path !== `user/${move.from}`);
        }
      } else if (hash !== pending.previousSha256) throw new CoreError(409, 'checkpoint_changed', 'The migration progress write could not be verified.');
    }
    if (this.checkpointProof.pendingMove) {
      const move = this.checkpointProof.pendingMove;
      if (!['user/relay/sessions/', 'user/relay/wake/policies/', '.migration/migration-3.0.0.json'].some(prefix => move.from.startsWith(prefix))
        || !move.to.startsWith('.migration/') || [move.from, move.to].some(value => value.split(/[\\/]/).includes('..') || path.isAbsolute(value))) {
        throw new CoreError(409, 'checkpoint_changed', 'The pending migration move is invalid.');
      }
      const source = path.join(this.mindPath, move.from);
      const target = path.join(this.mindPath, move.to);
      await assertNoLinks(source);
      await assertNoLinks(target);
      const input = await readFile(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const output = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (input && !output && hashContent(input) === move.sha256) {
        // The move was recorded before mutation and can be retried normally.
      } else if (!input && output && hashContent(output) === move.sha256) {
        this.checkpointProof.destination = (this.checkpointProof.destination ?? []).filter(entry => entry.path !== move.from);
        this.checkpointProof.destination.push({ path: move.to, kind: 'file', sha256: move.sha256 });
      } else throw new CoreError(409, 'checkpoint_changed', 'A pending migration move could not be verified.');
    }
    if (this.checkpointProof.pendingPersonMove) {
      const move = this.checkpointProof.pendingPersonMove;
      if ([move.from, move.to].some(value => typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..'))) {
        throw new CoreError(409, 'checkpoint_changed', 'The pending person move is invalid.');
      }
      const from = path.join(this.mindPath, 'user', move.from);
      const to = path.join(this.mindPath, 'user', move.to);
      await assertNoLinks(from);
      await assertNoLinks(to);
      const input = await readFile(from).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const output = await readFile(to);
      if (hashContent(output) !== move.sha256 || input && hashContent(input) !== move.sourceSha256) {
        throw new CoreError(409, 'checkpoint_changed', 'A pending person move changed.');
      }
      if (!input) this.checkpointProof.destination = this.checkpointProof.destination.filter(entry => entry.path !== `user/${move.from}`);
    }
    if (checkpoint.mode === 'migrate' && checkpoint.completed.includes('prepare') && !checkpoint.completed.includes('ready')) {
      if (JSON.stringify(await legacyTreeInventory(checkpoint.sourcePath)) !== JSON.stringify(this.checkpointProof.inventory)) {
        throw new CoreError(409, 'legacy_changed', 'The legacy M1ND changed after setup was prepared.');
      }
    }
    if (checkpoint.completed.includes('prepare') && !(await lstat(this.mindPath).catch(error => {
      if (checkpoint.mode === 'migrate' && !checkpoint.completed.includes('copy') && error.code === 'ENOENT') return null;
      throw error;
    }))?.isDirectory() && (checkpoint.mode !== 'migrate' || checkpoint.completed.includes('copy'))) throw new CoreError(409, 'checkpoint_changed', 'The prepared M1ND folder is missing.');
    if (!checkpoint.completed.includes('ready')) {
      if (this.checkpointProof.activeMigration?.version === '2.0.0-experimental.4') await verifyInterruptedCoordinatorMigration(this);
      if (checkpoint.completed.includes('close-legacy')) {
        for (const session of this.checkpointProof.sessions ?? []) {
          if (session.binding.machine === this.hostname && session.status === 'closed' && !session.closedBy) await this.verifyClosedSession(session.binding);
        }
      }
      for (const entry of this.checkpointProof.destination ?? []) {
        const file = path.join(this.mindPath, entry.path);
        await assertNoLinks(file);
        const current = await readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!current || hashContent(current) !== entry.sha256) {
          throw new CoreError(409, 'checkpoint_changed', 'A completed setup entry is missing or changed.');
        }
      }
      for (const entry of this.checkpointProof.service ?? []) {
        const file = path.join(this.localDirectory(), entry.path);
        await assertNoLinks(file);
        if (hashContent(await readFile(file)) !== entry.sha256) throw new CoreError(409, 'checkpoint_changed', 'A completed service configuration entry changed.');
      }
    }
  }

  async phase(phase, operation) {
    if (this.checkpoint.completed.includes(phase)) return;
    if (this.checkpoint.phase !== phase) throw new CoreError(409, 'checkpoint_changed', 'Setup phases cannot be skipped.');
    this.checkpoint.error = null;
    this.phaseStartedAt = Date.now();
    await this.saveCheckpoint();
    try { await operation(); }
    finally {
      this.checkpointProof.timings ??= {};
      this.checkpointProof.timings[phase] = Date.now() - this.phaseStartedAt;
      this.phaseStartedAt = null;
    }
    this.checkpoint.completed.push(phase);
    this.checkpoint.phase = SETUP_PHASES[this.checkpoint.completed.length] ?? 'ready';
    await this.saveCheckpoint();
  }

  async destinationProof() {
    this.checkpointProof.destination = (await legacyTreeInventory(this.mindPath))
      .filter(entry => entry.kind === 'file' && !entry.path.startsWith(`user/machines/${this.hostname}.`));
    await this.saveCheckpoint();
  }

  async prepareSetup() {
    if (this.checkpoint) {
      await this.verifyCheckpoint();
      return;
    }
    const selected = await this.inspectMind(this.mindPath);
    if (/^2\./.test(selected?.version ?? '')) throw new SetupValidationError('Choose a separate destination for the legacy M1ND copy.');
    const mode = selected ? 'join' : this.legacySourcePath ? 'migrate' : 'create';
    this.answers.attach = mode === 'join';
    this.checkpoint = { format: 'hivem1nd-setup-v1', mode, sourcePath: mode === 'migrate' ? this.legacySourcePath : null,
      destinationPath: this.mindPath, phase: 'prepare', completed: [], error: null, updatedAt: new Date().toISOString() };
    this.checkpointProof = {};
    await this.saveCheckpoint();
  }

  async prepareDestination() {
    if (this.checkpoint.mode === 'migrate') {
      const source = await this.inspectMind(this.legacySourcePath);
      if (!/^2\./.test(source?.version ?? '')) throw new SetupValidationError('Migration requires a detected HIVEM1ND 2.x M1ND.');
      if (isWithin(this.legacySourcePath, this.mindPath) || isWithin(this.mindPath, this.legacySourcePath)) {
        throw new CoreError(422, 'invalid_path', 'The source and destination must be separate folders.');
      }
      await assertNoLinks(this.legacySourcePath);
      await assertNoLinks(this.mindPath);
      const exists = await lstat(this.mindPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (exists) throw new CoreError(409, 'destination_exists', 'The migration destination must be a new folder.');
      this.checkpointProof.sourceVersion = source.version;
      this.checkpointProof.inventory = await legacyTreeInventory(this.legacySourcePath);
      // A registration older than a week belongs to a chat long gone; only recent ones are listed and confirmed.
      const recent = new Set(recentLegacy(await legacySessions(this.legacySourcePath), Date.now()).map(session => session.file));
      this.checkpointProof.sessions = (await legacySessions(this.legacySourcePath)).map(session => recent.has(session.file)
        ? session : { ...session, status: 'closed', closedBy: 'stale' });
      this.checkpointProof.copied = [];
    } else {
      await this.createMindLayout();
      if (this.checkpoint.mode === 'join') await this.destinationProof();
    }
  }

  async closeLegacy() {
    if (this.checkpoint.mode !== 'migrate') return;
    const sessions = this.checkpointProof.sessions;
    const open = sessions.filter(session => session.status !== 'closed' && (session.binding.machine === this.hostname || !this.legacyControl));
    if (open.length && this.answers.closeLegacy !== true) {
      throw new CoreError(409, 'legacy_closure_required', SETUP_COPY[this.answers.language].closeTitle);
    }
    for (const session of sessions) {
      if (session.status === 'closed') {
        if (!session.closedBy && session.binding.machine === this.hostname) await this.verifyClosedSession(session.binding);
      } else if (!this.legacyControl) {
        // No client offers a channel to close a 2.x chat, so the person closes them and confirms it here. The copy never
        // adopts their registrations or wake policies, which stay quarantined, and the previous M1ND is not written.
        session.status = 'closed';
        session.closedBy = 'person';
      } else if (session.binding.machine !== this.hostname) session.status = 'required';
      else {
        await verifiedLegacyStop(session.binding, { machine: this.hostname, control: this.legacyControl });
        session.status = 'closed';
      }
      await this.saveCheckpoint();
    }
  }

  async verifyClosedSession(binding) {
    const state = await this.legacyControl?.confirm?.(binding);
    if (!state || state.owned !== true || state.live !== false || ['registrationId', 'unit', 'unitId', 'client', 'machine', 'nativeSessionId']
      .some(key => state.binding?.[key] !== binding[key])) throw new CoreError(409, 'legacy_closure_required', 'The legacy session closure could not be verified.');
  }

  // A move updates the destination proof by its two entries; hashing the whole M1ND again after each of hundreds of
  // legacy registrations made the migrate phase take hours.
  async recordQuarantine(from, to, sha256) {
    this.checkpointProof.destination = (this.checkpointProof.destination ?? []).filter(entry => entry.path !== from && entry.path !== to);
    this.checkpointProof.destination.push({ path: to, kind: 'file', sha256 });
    await this.saveCheckpoint();
  }

  async quarantineLegacy(from, target) {
    await assertNoLinks(from);
    await assertNoLinks(target);
    const relative = value => path.relative(this.mindPath, value).split(path.sep).join('/');
    const pending = this.checkpointProof.pendingMove;
    const input = await readFile(from).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const output = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!input && output && pending?.from === relative(from) && pending.to === relative(target) && hashContent(output) === pending.sha256) {
      if (pending.from === '.migration/migration-3.0.0.json') this.checkpointProof.legacyProgressPrepared = true;
      delete this.checkpointProof.pendingMove;
      await this.recordQuarantine(pending.from, pending.to, pending.sha256);
      return;
    }
    if (!input || output) throw new CoreError(409, 'checkpoint_changed', 'Legacy Relay evidence could not be moved safely.');
    this.checkpointProof.pendingMove = { from: relative(from), to: relative(target), sha256: hashContent(input) };
    await this.saveCheckpoint();
    await mkdir(path.dirname(target), { recursive: true });
    await rename(from, target);
    if (relative(from) === '.migration/migration-3.0.0.json') this.checkpointProof.legacyProgressPrepared = true;
    const moved = this.checkpointProof.pendingMove;
    delete this.checkpointProof.pendingMove;
    await this.recordQuarantine(moved.from, moved.to, moved.sha256);
  }

  async copyLegacy() {
    if (this.checkpoint.mode !== 'migrate') return;
    await mkdir(path.dirname(this.mindPath), { recursive: true });
    const partial = await lstat(this.mindPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    // Saving the whole growing proof, with its ACL, after every file made a large M1ND take hours. The proof is saved
    // every two seconds and on any failure; an entry copied after the last save is verified by its hash on resume.
    const copied = new Set(this.checkpointProof.copied.map(item => item.path));
    let savedAt = Date.now();
    await copyLegacyTree(this.legacySourcePath, this.mindPath, { inventory: this.checkpointProof.inventory,
      completed: this.checkpointProof.copied, resume: Boolean(partial), onCheckpoint: async entry => {
        if (!copied.has(entry.path)) { copied.add(entry.path); this.checkpointProof.copied.push(entry); }
        if (Date.now() - savedAt >= 2000) { await this.saveCheckpoint(); savedAt = Date.now(); }
        await this.copyCheckpoint?.(entry);
      } });
    await this.destinationProof();
  }

  async migrateDestination() {
    if (this.checkpoint.mode === 'join') return;
    if (this.checkpoint.mode === 'migrate') {
      if (this.checkpointProof.pendingMove) {
        const move = this.checkpointProof.pendingMove;
        await this.quarantineLegacy(path.join(this.mindPath, move.from), path.join(this.mindPath, move.to));
      }
      await writeLegacyClosure(this.mindPath, { format: 'hivem1nd-legacy-closure-v1', sourcePath: this.legacySourcePath,
        sessions: this.checkpointProof.sessions.map(({ binding, status }) => ({ binding, status })) });
      // Legacy registrations are evidence, never 3.0 live bindings. Quarantine
      // inside the destination before any service can adopt its copied policies.
      const relay = path.join(this.mindPath, 'user', 'relay');
      for (const bucket of ['sessions', path.join('wake', 'policies')]) {
        const directory = path.join(relay, bucket);
        await assertNoLinks(directory);
        const entries = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        for (const name of entries) {
          const from = path.join(directory, name);
          await assertNoLinks(from);
          if (!(await lstat(from)).isFile()) throw new CoreError(422, 'unsafe_path', 'Legacy Relay evidence must be a regular file.');
          const target = path.join(this.mindPath, '.migration', 'legacy-relay', bucket, name);
          await assertNoLinks(target);
          await this.quarantineLegacy(from, target);
        }
      }
      if (!this.checkpointProof.legacyProgressPrepared) {
        const progress = path.join(this.mindPath, '.migration', 'migration-3.0.0.json');
        const copied = this.checkpointProof.inventory.find(entry => entry.path === '.migration/migration-3.0.0.json');
        if (copied) {
          await assertNoLinks(progress);
          if (hashContent(await readFile(progress)) !== copied.sha256) throw new CoreError(409, 'checkpoint_changed', 'The copied migration evidence changed.');
          const target = path.join(this.mindPath, '.migration', 'legacy-migration-3.0.0.json');
          await assertNoLinks(target);
          if (await readTextIfPresent(target) !== null) throw new CoreError(409, 'checkpoint_changed', 'The copied migration evidence conflicts.');
          await this.quarantineLegacy(progress, target);
        }
        this.checkpointProof.legacyProgressPrepared = true;
      }
      await this.destinationProof();
      await runSetupMigrations(this);
    } else {
      await (await import('../migrations/3.0.0.mjs')).migrate({ userPath: path.join(this.mindPath, 'user'),
        progressDirectory: path.join(this.mindPath, '.migration') });
    }
    await this.destinationProof();
  }

  async writeSetupMachineRecord(record) {
    if (this.checkpoint?.mode === 'join') {
      const file = path.join(this.mindPath, 'user', 'machines', `${this.hostname}.md`);
      const existing = await readTextIfPresent(file);
      if (existing !== null && parseMachineRecord(existing).machine !== this.hostname) throw new SetupValidationError('The joining machine record is not owned by this machine.');
      await atomicWriteFile(file, serializeMachineRecord(record), { root: this.mindPath });
    } else await writeMachineRecord(this.mindPath, this.hostname, record);
    this.machineRecord = record;
  }

  async install() {
    if (this.currentStep !== 7) throw new Error('Install is available at step 7');
    if (!this.answers.confirm) throw new SetupValidationError('Installation must be confirmed');
    if (this.installing) throw new CoreError(409, 'setup_busy', 'Setup is already running.');
    this.installing = true;
    this.stagingEstimate = undefined;
    try {
      await this.prepareSetup();
      await this.phase('prepare', () => this.prepareDestination());
      await this.phase('close-legacy', () => this.closeLegacy());
      await this.phase('copy', () => this.copyLegacy());
      await this.phase('migrate', () => this.migrateDestination());
      await this.phase('configure', async () => {
        if (!this.checkpointProof.configurationApplied) {
          await this.configureDestination();
          if (this.result.unwritten.length) throw new CoreError(409, 'setup_incomplete', 'Some selected M1ND files were not written.');
          this.checkpointProof.configurationApplied = true;
          this.checkpointProof.outcome = { ...this.result, checkpoint: null };
          await this.destinationProof();
        }
        if (this.serviceSetup) {
          const service = await this.configureService({ configureOnly: true });
          if (service.status === 'failed') throw safeServiceFailure(service, this.answers.language, 'configure');
          await this.saveServiceProof();
        }
      });
      this.result = this.result ?? this.completionResult([], []);
      if (this.checkpointProof.outcome) this.result = { ...this.checkpointProof.outcome, ...this.completionResult(
        this.checkpointProof.outcome.files, this.checkpointProof.outcome.warnings, this.checkpointProof.outcome) };
      await this.phase('start', async () => {
        if (!this.serviceSetup) return;
        const service = await this.configureService();
        this.result.service = service;
        if (service.status === 'failed') throw safeServiceFailure(service, this.answers.language, 'start');
        this.result.viewerUrl = service.viewerUrl ?? null;
      });
      // A process-local viewer credential is reacquired, never checkpointed.
      if (this.serviceSetup && !this.result.service && this.checkpoint.completed.includes('start')) {
        this.serviceState = null;
        const service = await this.configureService();
        if (service.status === 'failed') throw new CoreError(503, 'service_unavailable', 'The running service could not be verified.');
        this.result.service = service;
        this.result.viewerUrl = service.viewerUrl ?? null;
      }
      await this.phase('open', async () => {
        if (this.openViewer && this.result.viewerUrl && !this.viewerOpened) {
          await this.openViewer(this.result.viewerUrl);
          this.viewerOpened = true;
        }
      });
      await this.phase('ready', async () => {
        const record = this.buildMachineRecord('done');
        await this.writeSetupMachineRecord(record);
        await this.persistDraft(8);
      });
      this.currentStep = 8;
      this.result.completed = true;
      this.result.checkpoint = { ...this.checkpoint, completed: [...this.checkpoint.completed] };
      return this.result;
    } catch (error) {
      if (!this.checkpoint) throw error;
      // A denied file or folder is the person's to fix, so its message names it instead of a bare phase.
      const denied = ['EPERM', 'EACCES'].includes(error?.code);
      const code = denied ? 'permission_denied' : ['port_in_use', 'legacy_closure_required', 'legacy_changed', 'checkpoint_changed', 'invalid_path', 'unsafe_path', 'destination_exists', 'setup_incomplete'].includes(error.code)
        ? error.code : 'setup_failed';
      const spanish = this.answers.language === 'es', target = typeof error?.path === 'string' ? error.path : null;
      const deniedMessage = spanish
        ? `No se pudo completar la fase ${this.checkpoint.phase} de la instalación: se denegó el acceso a ${target ?? 'un archivo o una carpeta del destino'}. Revisar los permisos de esa carpeta.`
        : `Setup could not complete the ${this.checkpoint.phase} phase: access to ${target ?? 'a file or folder in the destination'} was denied. Check the permissions of that folder.`;
      // Known migration stops say what stopped them in the person's language; nothing was copied or closed.
      const open = (this.checkpointProof.sessions ?? []).filter(session => session.binding?.machine === this.hostname && session.status !== 'closed');
      const causeMessage = typeof error?.legacyPath === 'string' ? (spanish
        ? `La migración se detuvo: la M1ND anterior tiene un enlace o un elemento que no es un archivo en ${error.legacyPath}, y la migración no sigue enlaces. Quitarlo o moverlo fuera de la M1ND y reintentar. No se copió nada.`
        : `Migration stopped: the previous M1ND has a link or an entry that is not a file at ${error.legacyPath}, and migration does not follow links. Remove it or move it out of the M1ND, then retry. Nothing was copied.`)
        : error?.code === 'legacy_closure_required' ? (spanish
          ? `La migración se detuvo: no se pudieron cerrar las sesiones de HIVEM1ND 2.x de esta máquina (${open.length}). No se cerró ninguna y no se copió nada.`
          : `Migration stopped: the HIVEM1ND 2.x sessions on this machine (${open.length}) could not be closed. None was closed and nothing was copied.`)
        : null;
      this.checkpoint.error = { code, message: error.safeSetupMessage ?? (denied ? deniedMessage : causeMessage ?? (spanish
        ? `No se pudo completar la fase ${this.checkpoint.phase} de la instalación.` : `Setup could not complete the ${this.checkpoint.phase} phase.`)) };
      await this.saveCheckpoint();
      this.currentStep = 7;
      await this.persistDraft(7);
      if (!['configure', 'start', 'open', 'ready'].includes(this.checkpoint.phase)) throw error;
      this.result = { ...(this.result ?? this.completionResult([], [])), completed: false, viewerUrl: null,
        service: { ...(this.result?.service ?? {}), status: 'failed', phase: this.checkpoint.phase,
          code, error: this.checkpoint.error.message }, checkpoint: { ...this.checkpoint, completed: [...this.checkpoint.completed] } };
      return this.result;
    } finally {
      this.installing = false;
    }
  }

  async configureDestination() {
    if (this.checkpoint?.mode === 'migrate') {
      const { record } = await readMachineRecord(this.mindPath, this.hostname);
      if (record?.machine === this.hostname) this.machineRecord = record;
    }
    const plan = await this.buildPlan();
    for (const conflict of plan.conflicts) {
      const choice = this.answers.conflicts[conflict.path];
      if (!(conflict.choices ?? ['keep', 'replace']).includes(choice)) {
        throw new SetupValidationError(`Conflict requires an explicit choice: ${conflict.path}`);
      }
    }

    await this.createMindLayout();
    const display = await this.writeDisplaySettings();
    const applied = await applyInstallPlan(plan, this.answers.conflicts);
    const folderIcon = await this.writeFolderIcon();
    const shortcuts = await this.writeShortcuts();
    // A migrated copy inherits the machine record of the previous M1ND; the files inside that M1ND are not this installation's.
    const inherited = { ...(this.machineRecord?.managedFiles ?? {}) };
    const legacySource = this.checkpoint?.mode === 'migrate' ? this.checkpoint.sourcePath ?? this.legacySourcePath : null;
    if (legacySource) for (const filePath of Object.keys(inherited)) if (isWithin(legacySource, filePath)) delete inherited[filePath];
    const managedFiles = { ...inherited, ...applied.managedFiles };
    // Setup wrote this file, so uninstall may remove it while its bytes are unchanged.
    if (display) managedFiles[display.file] = display.hash;
    // The folder icon file is recorded only when setup created it or already owned it; a desktop.ini the person had is merged, never claimed.
    if (folderIcon?.status === 'applied' && (folderIcon.created || Object.hasOwn(inherited, folderIcon.file))) managedFiles[folderIcon.file] = folderIcon.hash;
    // A shortcut is recorded when setup made it or already owned it, so uninstall removes it while it is unchanged;
    // one the person put there under the same name is left alone and never claimed; a removed one leaves the record.
    for (const shortcut of shortcuts) {
      if (shortcut.status === 'applied') managedFiles[shortcut.file] = shortcut.hash;
      else delete managedFiles[shortcut.file];
    }
    for (const filePath of plan.retired) delete managedFiles[filePath];
    for (const conflict of plan.conflicts) {
      if (this.answers.conflicts[conflict.path] === 'keep') delete managedFiles[conflict.path];
    }
    for (const item of applied.omitted) delete managedFiles[item.path];
    delete managedFiles[path.join(this.mindPath, 'user', 'machines', `${this.hostname}.md`)];
    // An asset that was neither written nor answered for leaves the setup at the install
    // step, so the next run finishes it instead of reporting an installation that is not there.
    const unwritten = this.unwrittenAssets(plan, applied);
    const record = this.buildMachineRecord(7);
    record.draft = { ...this.answers, mindPath: this.mindPath };
    record.managedFiles = managedFiles;
    await this.writeSetupMachineRecord(record);
    this.machineRecord = record;
    const reportPath = await writeInstallReport({
      mindPath: this.answers.attach ? this.localDirectory() : this.mindPath,
      hostname: this.hostname,
      language: this.answers.language,
      report: {
        action: this.answers.attach ? 'attach' : 'install',
        written: applied.files.length,
        omitted: applied.omitted,
        replacedLinks: applied.replacedLinks,
        removed: applied.removed,
        kept: [...applied.kept, ...plan.conflicts
          .filter((conflict) => this.answers.conflicts[conflict.path] === 'keep')
          .map((conflict) => ({ path: conflict.path, reason: conflict.reason }))],
        unwritten,
        warnings: plan.warnings,
      },
    });
    this.result = this.completionResult(applied.files, plan.warnings, {
      relay: [],
      omitted: applied.omitted,
      replacedLinks: applied.replacedLinks,
      removed: applied.removed,
      unwritten,
      reportPath,
    });
    this.result.completed = unwritten.length === 0;
    return this.result;
  }

  async retryService() {
    if (!this.serviceSetup || !this.result || this.result.completed) return this.result;
    return this.install();
  }

  async resumeInstalledService() {
    this.currentStep = 7;
    this.answers.confirm = true;
    return this.install();
  }

  async configureRelay() {
    return { relay: [], failure: null };
  }

  async saveServiceProof() {
    this.checkpointProof.service = (await legacyTreeInventory(this.localDirectory()))
      .filter(entry => entry.kind === 'file' && ['config.json', 'registration.json'].includes(entry.path));
    await this.saveCheckpoint();
  }

  async configureService({ configureOnly = false } = {}) {
    let service;
    try {
      service = await configureOwnedService({
        env: this.env,
        homeDir: this.homeDir,
        cosmicPath: this.cosmicPath ?? path.dirname(defaultMind({ platform: process.platform, env: this.env, home: this.homeDir })),
        mindPath: this.mindPath,
        hostname: this.hostname,
        kitPath: this.kitPath,
        originKind: this.answers.originKind || 'folder',
        originPath: this.answers.originPath || null,
        requireOrigin: false,
        dryRun: this.serviceDryRun !== false,
        run: this.serviceRunner,
        start: this.serviceStart,
        query: this.serviceQuery,
        aclRunner: this.aclRunner,
        sid: this.sid,
        protect: this.serviceProtect !== false,
        state: this.serviceState,
        current: this.serviceCurrent,
        legacyControl: this.legacyControl,
        configureOnly,
        resumeSetup: !this.serviceState && Boolean(this.checkpointProof.service?.length),
      });
    } catch (error) {
      service = { status: 'failed', phase: 'config', state: this.serviceState ?? {}, error: error.message, code: error.code ?? 'service_unavailable', viewerUrl: null };
    }
    this.serviceState = service.state;
    this.serviceCurrent = service.state?.installed ?? null;
    return service;
  }

  unwrittenAssets(plan, applied) {
    const answered = new Set([
      ...applied.omitted.map((item) => item.path),
      ...Object.entries(this.answers.conflicts)
        .filter(([, choice]) => choice === 'keep')
        .map(([conflictPath]) => conflictPath),
    ]);
    return plan.items
      .filter((item) => item.owned
        && item.action !== 'unchanged'
        && !applied.files.includes(item.path)
        && !answered.has(item.path))
      .map((item) => item.path);
  }

  async detectedAgents() {
    if (!this.discoveryCache) {
      this.discoveryCache = await discoverAgents({
        homeDir: this.homeDir,
        env: this.env,
        kitPath: this.kitPath,
        adapters: this.adapters,
      });
    }
    return this.discoveryCache;
  }

  async scanAgents() {
    const detected = await this.detectedAgents();
    const known = new Map((this.answers.agents ?? []).map((agent) => [agent.id, agent]));
    for (const agent of detected) {
      const existing = known.get(agent.id);
      known.set(agent.id, existing ? { ...existing, detected: true } : { id: agent.id, selected: true, attach: 'auto', detected: true });
    }
    this.answers.agents = [...known.values()];
    this.answers.agentsScanned = true;
    await this.persistDraft();
  }

  addManualAgent(adapterId) {
    const adapter = this.adapters.find((candidate) => candidate.id === adapterId);
    if (!adapter) throw new SetupValidationError(`Unknown adapter: ${adapterId}`);
    const known = this.answers.agents ?? [];
    if (known.some((agent) => agent.id === adapterId)) return;
    this.answers.agents = [...known, { id: adapterId, selected: true, attach: 'auto', detected: false }];
  }

  selectedAgentIds() {
    return (this.answers.agents ?? []).filter((agent) => agent.selected !== false).map((agent) => agent.id);
  }

  async availableContent() {
    if (!this.contentCache) this.contentCache = await discoverContent(this.kitPath);
    return this.contentCache;
  }

  async applySimpleDefaults() {
    await this.scanAgents();
    const content = await this.availableContent();
    this.answers.included = content.map((item) => item.id);
    const discovered = await discoverHomeProjects(this.homeDir);
    this.answers.projectRoots = [];
    this.answers.projects = assignProjectsToRoots(discovered, []).map(project => ({ ...project, included: false }));
    this.answers.projectsScanned = true;
    this.answers.projectsConfirmed = false;
    this.answers.updateCheck = 'daily';
  }

  async scanHomeProjects() {
    const discovered = await discoverHomeProjects(this.homeDir);
    this.answers.projectRoots = [this.homeDir];
    this.answers.projects = assignProjectsToRoots(discovered, [this.homeDir]);
    this.answers.projectsScanned = true;
    await this.persistDraft();
  }

  async addProjectRoot(rootValue) {
    const root = path.resolve(rootValue);
    if (normalizePath(root) === normalizePath(path.parse(root).root)) throw new SetupValidationError('A filesystem root cannot be scanned as a project folder');
    await requireDirectory(root, 'project folder');
    if (this.answers.projectRoots.some((existing) => normalizePath(existing) === normalizePath(root))) return;

    const previousIncluded = new Map(this.answers.projects.map((project) => [normalizePath(project.path), project.included !== false]));
    const discovered = await discoverProjects([root]);
    const combined = [
      ...this.answers.projects.map((project) => ({ path: project.path, resolvedEnvironment: project.environment })),
      ...discovered.filter((project) => !previousIncluded.has(normalizePath(project.path))),
    ];
    const roots = [...this.answers.projectRoots, root];
    this.answers.projectRoots = roots;
    this.answers.projects = assignProjectsToRoots(combined, roots).map((project) => ({
      ...project,
      included: previousIncluded.get(normalizePath(project.path)) ?? true,
    }));
    await this.persistDraft();
  }

  removeProject(indexValue) {
    const projects = this.answers.projects ?? [];
    const index = Number(indexValue);
    if (!Number.isInteger(index) || index < 0 || index >= projects.length) {
      throw new SetupValidationError('Invalid project index');
    }
    this.answers.projects = projects.map((project, current) => (
      current === index ? { ...project, included: false } : project
    ));
  }

  removeEnvironmentGroup(groupId) {
    const group = groupProjectsByFolder(this.answers.projects).find((candidate) => candidate.id === groupId);
    if (!group) throw new SetupValidationError(`Unknown environment group: ${groupId}`);
    const memberIndices = new Set(group.projects.map((project) => project.index));
    this.answers.projects = this.answers.projects.map((project, index) => (
      memberIndices.has(index) ? { ...project, included: false } : project
    ));
  }

  includedProjects() {
    return (this.answers.projects ?? []).filter((project) => project.included !== false);
  }

  async persistDraft(step = this.currentStep) {
    await this.writeLocal('setup-draft.json', { destinationPath: this.mindPath, step,
      answers: { ...this.answers, legacySourcePath: this.legacySourcePath, mindPath: this.mindPath } });
  }

  buildMachineRecord(setup) {
    return {
      machine: this.hostname,
      mind: this.mindPath,
      language: this.answers.language,
      updateCheck: this.answers.updateCheck,
      lastCheck: setup === 'done' && this.answers.updateCheck === 'daily' ? localDate() : this.machineRecord?.lastCheck ?? '',
      setup,
      agents: (this.answers.agents ?? [])
        .filter((agent) => agent.selected !== false)
        .map((agent) => ({ name: agent.id, mode: agent.attach === 'auto' ? 'auto' : 'on-demand' })),
      paths: [...new Map([...(this.machineRecord?.paths ?? []),
        ...buildMachinePaths(this.answers.projectRoots, this.includedProjects())].map(entry => [entry.name, entry])).values()],
      excluded: this.excludedItems(),
      keepExistingPreferences: this.answers.keepExistingPreferences,
      draft: {},
      managedFiles: { ...(this.machineRecord?.managedFiles ?? {}) },
    };
  }

  // The machine can be attached while the mind is already installed and this machine has no
  // finished record in it. A machine that finished its setup there is running it again.
  canAttach() {
    return Boolean(this.existingMind) && !/^2\./.test(this.existingMind.version);
  }

  async inspectMind(candidate) {
    if (!await detectExistingMind(candidate)) return null;
    const version = (await readTextIfPresent(path.join(candidate, 'user', 'VERSION')) ?? '').trim();
    return { path: path.resolve(candidate), version };
  }

  async findInstalledMind() {
    for (const preset of this.presets) {
      if (normalizePath(preset.path) === normalizePath(this.kitPath)) continue;
      const found = await this.inspectMind(preset.path);
      if (found) return found;
    }
    return null;
  }

  async selectMind(selected) {
    this.mindPath = selected;
    this.answers.mindPath = selected;
    const { record } = await readMachineRecord(selected, this.hostname);
    this.machineRecord = record?.machine === this.hostname ? record : null;
    this.existingMind = await this.inspectMind(selected);
    if (!this.existingMind) this.answers.attach = false;
  }

  async outdatedMind(kitVersion) {
    const mindVersion = this.existingMind?.version ?? '';
    if (!mindVersion || mindVersion === kitVersion) return null;
    return { mindVersion, kitVersion };
  }

  excludedItems() {
    const included = new Set(this.answers.included ?? []);
    return (this.contentCache ?? [])
      .filter((item) => !included.has(item.id))
      .map((item) => item.name);
  }

  async buildPlan() {
    const existingManaged = { ...(this.machineRecord?.managedFiles ?? {}) };
    const packageJson = JSON.parse(await readFile(path.join(this.kitPath, 'package.json'), 'utf8'));
    if (this.checkpoint?.mode === 'migrate') {
      for (const entry of this.checkpointProof.inventory ?? []) {
        // Outside user/ a 2.x M1ND holds only the old kit (its files, package.json and node_modules). In the copy that
        // is upgraded it is replaced without a question; the original M1ND keeps every byte.
        // A desktop.ini is the folder's own setting (its icon and view), never part of the old kit.
        if (entry.kind === 'file' && !entry.path.startsWith('user/') && !entry.path.startsWith('.migration/') && entry.path.toLowerCase() !== 'desktop.ini') existingManaged[path.join(this.mindPath, entry.path)] = entry.sha256;
      }
    }
    const peerHashes = await readPeerHashes(this.mindPath, this.hostname);
    // An attach writes what belongs to this machine. The kit copy, the preferences and the
    // recorded version belong to the mind and stay as the mind already has them.
    const attach = this.answers.attach === true || /^3\./.test(this.existingMind?.version ?? '');
    this.answers.attach = attach;
    const kitPlan = attach ? combinePlans() : await planKitCopy({
      kitPath: this.kitPath,
      mindPath: this.mindPath,
      managedFiles: existingManaged,
      excluded: this.excludedItems(),
      language: this.answers.language,
      peerHashes,
    });
    const versionPath = path.join(this.mindPath, 'user', 'VERSION');
    const preferencesPath = path.join(this.mindPath, 'user', 'preferences.md');
    const routesPath = path.join(this.mindPath, 'user', 'routes.md');
    const machinePath = path.join(this.mindPath, 'user', 'machines', `${this.hostname}.md`);

    const existingPreferences = await readTextIfPresent(preferencesPath);
    const preferences = mergePreferences(existingPreferences ?? '', preferenceLines(this.answers));
    const existingRoutes = await readTextIfPresent(routesPath);
    const otherMinds = await discoverOtherMinds(this.mindPath, { kitPath: this.kitPath });
    const routes = this.checkpoint?.mode === 'migrate' && existingRoutes !== null && this.includedProjects().length === 0
      ? existingRoutes : mergeRoutes(existingRoutes ?? '', this.includedProjects(), otherMinds);
    const finalRecord = this.buildMachineRecord('done');
    finalRecord.draft = {};

    if (attach) this.attachOutdated = await this.outdatedMind(packageJson.version);
    const mindPlans = attach ? [] : [
      planDataFile({ destination: versionPath, content: `${packageJson.version}\n`, root: this.mindPath, managedHash: existingManaged[versionPath], kind: 'version', allowExisting: true, language: this.answers.language }),
      planDataFile({ destination: preferencesPath, content: preferences, root: this.mindPath, managedHash: existingManaged[preferencesPath], kind: 'preferences', allowExisting: true, language: this.answers.language }),
    ];
    const dataPlans = await Promise.all(attach ? [] : [
      ...mindPlans,
      planDataFile({ destination: routesPath, content: routes, root: this.mindPath, managedHash: existingManaged[routesPath], kind: 'routes', allowExisting: true, language: this.answers.language }),
    ]);
    this.clientPlan = registerLinkConflicts(await prepareSetupAgentAssets({
      kitPath: this.kitPath,
      mindPath: this.mindPath,
      homeDir: this.homeDir,
      env: this.env,
      adapters: this.adapters,
      agents: finalRecord.agents,
      excluded: finalRecord.excluded,
      managedFiles: existingManaged,
      retiredSources: retiredKitSources(kitPlan, existingManaged, this.kitPath, this.mindPath),
      keepExistingPreferences: this.answers.keepExistingPreferences,
      language: this.answers.language,
    }), this.answers.language);
    this.clientPlan.requiresReview = true;
    const machinePlan = await planDataFile({
      destination: machinePath,
      content: serializeMachineRecord({ ...finalRecord, setup: 7, draft: { ...this.answers, mindPath: this.mindPath } }),
      root: this.mindPath,
      kind: 'machine',
      allowExisting: true,
      owned: false,
      language: this.answers.language,
    });
    return planManagedFileRemovals(registerLinkConflicts(
      combinePlans(attach ? null : kitPlan, ...dataPlans, machinePlan),
      this.answers.language,
    ), {
      managedFiles: Object.fromEntries(Object.entries(existingManaged).filter(([file]) => isWithin(this.mindPath, file))),
      mindPath: this.mindPath,
      retainedPaths: [path.join(this.mindPath, 'desktop.ini'), ...(attach ? Object.keys(existingManaged) : [])],
      skillsRoots: [],
      peerHashes,
    });
  }

  // The icon is cosmetic: when it cannot be set the installation goes on without it.
  async writeFolderIcon() {
    if (this.answers.attach || this.checkpoint?.mode === 'join') return null;
    return applyFolderIcon(this.mindPath, { platform: this.folderIconPlatform ?? process.platform, attrib: this.attribRunner ?? undefined, env: this.env })
      .catch(error => ({ status: 'failed', reason: error.code ?? error.message }));
  }

  // The wizard offers the desktop shortcut wherever setup makes shortcuts.
  offersDesktopShortcut() {
    return this.shortcuts === true && (this.folderIconPlatform ?? process.platform) === 'win32';
  }

  // The desktop and Start menu shortcuts start the app without a console. They are made only for a real Windows
  // installation, and only when the M1ND holds the launcher they run. Without the desktop shortcut, the one setup made
  // before and the person has not changed is removed.
  async writeShortcuts() {
    const platform = this.folderIconPlatform ?? process.platform;
    if (this.shortcuts !== true || this.serviceDryRun !== false || platform !== 'win32') return [];
    try {
      const mind = this.mindPath;
      for (const file of [['gui', 'launch.vbs'], ['cli', 'index.mjs']]) if (!await lstat(path.join(mind, ...file)).then(state => state.isFile(), () => false)) return [];
      const language = this.answers.language;
      const folders = this.shortcutFolders ?? await windowsShortcutFolders({ env: this.env, home: this.homeDir });
      const desktop = this.desktopShortcut !== false;
      const managed = this.machineRecord?.managedFiles ?? {};
      const plan = shortcutPlan({ platform, mindPath: mind, nodePath: this.nodePath ?? process.execPath, cosmicPath: this.cosmicPath ?? '',
        folders: desktop ? folders : { startMenu: folders.startMenu },
        message: text(language, 'launchFailed'), description: text(language, 'shortcutDescription'), env: this.env });
      const applied = await applyShortcuts(plan, { managed, run: this.shortcutRunner ?? undefined, env: this.env });
      return desktop ? applied : [...applied, ...await removeOwnedShortcuts([folders.desktop], { managed })];
    } catch {
      // A shortcut is a convenience: the installation goes on without it.
      return [];
    }
  }

  // A new or migrated M1ND without display settings opens in the language chosen in setup; a joined one is never written.
  async writeDisplaySettings() {
    if (this.answers.attach || this.checkpoint?.mode === 'join') return null;
    const file = path.join(this.mindPath, 'user', 'gui', 'settings.json');
    const content = `${canonicalJson({ format: 'hivem1nd-settings-v1', look: 'modern', language: normalizeLanguage(this.answers.language), sendToAgent: true })}\n`;
    // A resumed setup finds the file it wrote before and still records it; any other existing file is the person's.
    const existing = await readTextIfPresent(file);
    if (existing !== null) return existing === content ? { file, hash: hashContent(content) } : null;
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, content, { root: this.mindPath });
    return { file, hash: hashContent(content) };
  }

  async createMindLayout() {
    if (this.answers.attach) return;
    const directories = [
      'user/knowledge', 'user/state', 'user/inbox', 'user/tasks', 'user/log', 'user/machines',
    ];
    const included = this.includedProjects();
    for (const environment of new Set(included.map((project) => project.environment).filter(Boolean))) {
      for (const leaf of ['state', 'inbox', 'tasks', 'log']) directories.push(`user/envs/${environment}/${leaf}`);
    }
    for (const project of included) {
      for (const leaf of ['state', 'inbox', 'tasks', 'log']) directories.push(`user/projects/${project.name}/${leaf}`);
    }
    for (const relative of directories) await ensureSafeDirectory(this.mindPath, path.join(this.mindPath, relative));
  }

  completionResult(files, warnings, outcome = {}) {
    const prompt = text(this.answers.language, 'attachPrompt', { mind: this.mindPath, placeholder: '{{mind}}' });
    const attachAgents = (this.answers.agents ?? [])
      .filter((agent) => agent.selected !== false && agent.attach === 'auto')
      .filter((agent) => !this.adapters.find((candidate) => candidate.id === agent.id)?.rules)
      .map((agent) => agent.id);
    const language = this.answers.language;
    const notices = [];
    if (this.answers.attach) notices.push(text(language, 'attachedMachine', { mind: this.mindPath }));
    if (this.attachOutdated) {
      notices.push(text(language, 'attachOutdated', {
        mind: this.attachOutdated.mindVersion,
        kit: this.attachOutdated.kitVersion,
      }));
    }
    notices.push(...(outcome.relay ?? []).map((item) => relayLine(language, item)));
    return {
      message: text(language, 'step4Description', { machine: this.hostname }),
      firstCommand: '/executor <project>',
      mindPath: this.mindPath,
      attached: this.answers.attach === true,
      files,
      warnings: [...new Set(warnings)],
      notices,
      omitted: outcome.omitted ?? [],
      replacedLinks: outcome.replacedLinks ?? [],
      removed: outcome.removed ?? [],
      unwritten: outcome.unwritten ?? [],
      relay: outcome.relay ?? [],
      reportPath: outcome.reportPath ?? null,
      attachPrompts: attachAgents.map((agent) => ({ agent, text: prompt })),
      mode: this.checkpoint?.mode ?? (this.answers.attach ? 'join' : this.legacySourcePath ? 'migrate' : 'create'),
      legacySourcePath: this.legacySourcePath,
      checkpoint: this.checkpoint ? { ...this.checkpoint, completed: [...this.checkpoint.completed] } : null,
      clientChanges: this.clientPlan ? { ...publicPreview(this.clientPlan, language), requiresReview: true,
        action: SETUP_COPY[language].review } : { files: [], kept: [], warnings: [], conflicts: [], requiresReview: true, action: SETUP_COPY[language].review },
    };
  }
}

function safeServiceFailure(service, language, phase) {
  const match = /\bport[: ]+(\d{1,5})\b/i.exec(service.error ?? '');
  const port = Number.isInteger(service.port) ? service.port : match ? Number(match[1]) : null;
  const conflict = service.code === 'EADDRINUSE' && port > 0 && port <= 65535;
  const message = conflict ? (language === 'es' ? `El servicio no se inició: otro programa utiliza el puerto ${port}.`
    : `The service did not start: port ${port} is used by another program.`)
    : language === 'es' ? `No se pudo completar la fase ${phase} del servicio.` : `The service could not complete the ${phase} phase.`;
  const error = new CoreError(503, conflict ? 'port_in_use' : service.code ?? 'service_unavailable', message);
  error.safeSetupMessage = message;
  return error;
}

function compareSetupVersions(left, right) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
    if (!match) throw new SetupValidationError('Setup migrations require a valid version.');
    return { numbers: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? [] };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] - b.numbers[index];
  if (!a.prerelease.length || !b.prerelease.length) return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) - Number(y);
    if (/^\d+$/.test(x) !== /^\d+$/.test(y)) return /^\d+$/.test(x) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

async function runSetupMigrations(session) {
  const directory = path.join(session.kitPath, 'migrations');
  await assertNoLinks(directory);
  const names = await readdir(directory);
  const toVersion = JSON.parse(await readFile(path.join(session.kitPath, 'package.json'), 'utf8')).version;
  const selected = names.filter(name => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.mjs$/.test(name))
    .map(name => ({ name, version: name.slice(0, -4) }))
    .filter(entry => compareSetupVersions(entry.version, session.checkpointProof.sourceVersion) > 0 && compareSetupVersions(entry.version, toVersion) <= 0)
    .sort((a, b) => compareSetupVersions(a.version, b.version));
  session.checkpointProof.migrations ??= [];
  for (const entry of selected) {
    if (session.checkpointProof.migrations.includes(entry.version)) continue;
    await legacyTreeInventory(session.mindPath);
    const file = path.join(directory, entry.name);
    await assertNoLinks(file);
    const migration = await import(pathToFileURL(file).href);
    if (migration.idempotent !== true || typeof (migration.migrate ?? migration.default) !== 'function'
      || migration.version && migration.version !== entry.version) throw new SetupValidationError('A setup migration is not resumable or has an invalid version.');
    if (!session.checkpointProof.activeMigration) {
      session.checkpointProof.activeMigration = { version: entry.version, before: session.checkpointProof.destination };
      await session.saveCheckpoint();
    }
    if (entry.version === '2.0.0-experimental.4') await verifyInterruptedCoordinatorMigration(session);
    await (migration.migrate ?? migration.default)({ userPath: path.join(session.mindPath, 'user'),
      progressDirectory: path.join(session.mindPath, '.migration'), legacySourcePath: session.legacySourcePath,
      destinationPath: session.mindPath, fromVersion: session.checkpointProof.sourceVersion, toVersion,
      faultAfterMoves: session.migrationFaultAfterMoves,
      beforeCheckpoint: async ({ progress, sha256 }) => {
        const file = path.join(session.mindPath, '.migration', 'migration-3.0.0.json');
        await assertNoLinks(file);
        const previous = await readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        session.checkpointProof.pendingProgress = { sha256, previousSha256: previous ? hashContent(previous) : null,
          progress: JSON.parse(JSON.stringify(progress)) };
        await session.saveCheckpoint();
      },
      onCheckpoint: progress => {
        session.checkpointProof.pendingPersonMove = progress.pendingMove ? { ...progress.pendingMove } : null;
        delete session.checkpointProof.pendingProgress;
        return session.destinationProof();
      } });
    session.checkpointProof.migrations.push(entry.version);
    delete session.checkpointProof.activeMigration;
    await session.destinationProof();
  }
}

// The preceding migration has no callback. Its exact file/header transforms
// bound the states accepted on reopen; arbitrary edits are never blessed.
async function verifyInterruptedCoordinatorMigration(session) {
  const before = session.checkpointProof.activeMigration.before;
  const allowed = new Map();
  const moved = new Map();
  const add = (file, hash) => { if (!allowed.has(file)) allowed.set(file, new Set()); allowed.get(file).add(hash); };
  for (const entry of before) add(entry.path, entry.sha256);
  for (const entry of before) {
    let target = null;
    if (entry.path.startsWith('user/manager/')) target = entry.path.replace('user/manager/', 'user/overseer/');
    if (entry.path.startsWith('user/inbox/manager/')) target = entry.path.replace('user/inbox/manager/', 'user/inbox/overseer/');
    const state = /^user\/state\/manager(.*)\.md$/.exec(entry.path);
    if (state) target = `user/state/overseer${state[1]}.md`;
    if (target) { add(target, entry.sha256); moved.set(entry.path, { target, hashes: new Set([entry.sha256]) }); }
    const inbox = /^user\/inbox\/(?:manager|overseer)\/.+\.md$/.test(entry.path);
    const oldTarget = /^user\/state\/overseer.*\.md$/.test(entry.path);
    if (!state && !inbox && !oldTarget) continue;
    const file = path.join(session.checkpoint.sourcePath, entry.path);
    await assertNoLinks(file);
    const bytes = await readFile(file);
    if (hashContent(bytes) !== entry.sha256) throw new CoreError(409, 'legacy_changed', 'The legacy migration input changed.');
    const value = bytes.toString('utf8');
    if (state) {
      const transformed = value.replace(/^unit:[ \t]*manager(\S*)[ \t]*$/m, (_, suffix) => `unit: overseer${suffix}`);
      const hash = hashContent(transformed);
      add(target, hash);
      moved.set(entry.path, { target, hashes: new Set([hash]) });
    }
    if (inbox) {
      const transformed = value.replace(/^to:[ \t]*manager[ \t]*$/m, 'to: overseer');
      const hash = hashContent(transformed);
      add(target ?? entry.path, hash);
      if (target) moved.get(entry.path).hashes.add(hash);
    }
    if (oldTarget) {
      const header = key => value.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? '';
      const unit = header('unit') || path.basename(entry.path, '.md');
      const date = header('date').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
      const stamp = date ? `${date[1]}${date[2]}${date[3]}-${date[4]}${date[5]}` : '00000000-0000';
      const body = value.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim();
      const retired = `unit: ${unit}\ndate: ${header('date')}\n\nState retired when the Manager role became Overseer.\n\n${body}\n`;
      const log = `user/log/${stamp}-${unit}-retired.md`;
      if (log.split(/[\\/]/).includes('..') || path.isAbsolute(log)
        || !isWithin(path.join(session.mindPath, 'user', 'log'), path.resolve(session.mindPath, log))) {
        throw new CoreError(409, 'checkpoint_changed', 'The retired state path is invalid.');
      }
      add(log, hashContent(retired));
      moved.set(entry.path, { target: log, hashes: new Set([hashContent(retired)]) });
    }
  }
  const actual = (await legacyTreeInventory(session.mindPath)).filter(entry => entry.kind === 'file'
    && !entry.path.startsWith(`user/machines/${session.hostname}.`));
  const hashes = new Map(actual.map(entry => [entry.path, entry.sha256]));
  for (const entry of actual) {
    if (!allowed.get(entry.path)?.has(entry.sha256)) throw new CoreError(409, 'checkpoint_changed', 'An interrupted migration entry changed unexpectedly.');
  }
  for (const entry of before) {
    if (hashes.has(entry.path)) continue;
    const move = moved.get(entry.path);
    if (!move?.hashes.has(hashes.get(move.target))) throw new CoreError(409, 'checkpoint_changed', 'An interrupted migration entry is missing.');
  }
  session.checkpointProof.destination = actual;
}

export class SetupValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SetupValidationError';
  }
}

export function conflictChoiceKey(conflict, choice) {
  if (!conflict?.link) return choice;
  return choice === 'replace' ? 'replaceLink' : 'omitLink';
}

function field(id, type, label, required, options, help) {
  const descriptor = { id, type, label, required };
  if (options) descriptor.options = options;
  if (help) descriptor.help = help;
  return descriptor;
}

function displayAgent(id, adapters) {
  return adapters.find((adapter) => adapter.id === id)?.displayName ?? id;
}

function assignProjectsToRoots(discovered, roots) {
  const resolvedRoots = roots.map((root) => path.resolve(root));
  const used = new Map();
  return discovered.map((project) => {
    const matches = resolvedRoots.filter((root) => isWithin(root, project.path));
    const root = matches.sort((left, right) => right.length - left.length)[0];
    const base = validateLooseName(path.basename(project.path), 'project');
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const environment = project.resolvedEnvironment !== undefined
      ? project.resolvedEnvironment
      : defaultProjectEnvironment(project.path, project.environment, root);
    return {
      name: count === 1 ? base : `${base}-${count}`,
      path: project.path,
      environment,
      root,
      included: true,
    };
  });
}

function defaultProjectEnvironment(projectPath, guessedTech, root) {
  const folder = path.dirname(path.resolve(projectPath));
  if (root && normalizePath(folder) === normalizePath(root)) return guessedTech || '';
  return path.basename(folder) || '';
}

function groupProjectsByFolder(projects) {
  const groups = new Map();
  (projects ?? []).forEach((project, index) => {
    if (project.included === false) return;
    const folder = path.dirname(path.resolve(project.path));
    const isRootDirect = project.root !== undefined && normalizePath(folder) === normalizePath(project.root);
    const id = isRootDirect ? `project:${normalizePath(project.path)}` : `folder:${normalizePath(folder)}`;
    if (!groups.has(id)) groups.set(id, { id, folder, projects: [] });
    groups.get(id).projects.push({ ...project, index });
  });
  return [...groups.values()]
    .map((group) => {
      const environments = new Set(group.projects.map((project) => project.environment).filter(Boolean));
      return { id: group.id, folder: group.folder, environment: environments.size === 1 ? [...environments][0] : '', projects: group.projects };
    })
    .sort((left, right) => left.folder.localeCompare(right.folder) || left.id.localeCompare(right.id));
}

function buildMachinePaths(roots, projects) {
  const scanned = new Set(roots.map(normalizePath));
  const environments = new Map();
  for (const project of projects) {
    const folder = path.dirname(project.path);
    if (project.environment && !environments.has(project.environment) && !scanned.has(normalizePath(folder))) {
      environments.set(project.environment, folder);
    }
  }
  return [
    ...[...environments].map(([name, folder]) => ({ name, path: folder })),
    ...projects.map((project) => ({ name: project.name, path: project.path })),
  ];
}

function preferenceLines(answers) {
  if (answers.skipPreferences) return [];
  const date = localDate();
  const descriptions = {
    impersonal: 'address the user impersonally',
    formal: 'address the user formally',
    explanatory: 'explain unfamiliar work clearly',
    swarm: 'speak as one of the swarm using “we”',
  };
  const lines = [`- ${date}: ${descriptions[answers.addressStyle]}. Why: chosen at setup.`];
  if (answers.customPreference) lines.push(`- ${date}: ${answers.customPreference}. Why: chosen at setup.`);
  return lines;
}

function mergePreferences(existing, additions) {
  const normalized = existing.replace(/\r\n/g, '\n').trimEnd();
  const present = new Set(normalized.split('\n'));
  const missing = additions.filter((line) => !present.has(line));
  if (normalized === '') return missing.length ? `${missing.join('\n')}\n` : '';
  return missing.length ? `${normalized}\n${missing.join('\n')}\n` : `${normalized}\n`;
}

function mergeRoutes(existing, projects, minds) {
  let output = existing.replace(/\r\n/g, '\n').trimEnd();
  const grouped = new Map();
  for (const project of projects ?? []) {
    if (!project.environment) continue;
    if (!grouped.has(project.environment)) grouped.set(project.environment, []);
    grouped.get(project.environment).push(project.name);
  }

  output = ensureSection(output, 'Environments');
  for (const [environment, names] of grouped) output = mergeNamedList(output, 'Environments', environment, names);
  output = ensureSection(output, 'Projects');
  for (const project of projects ?? []) {
    const line = project.environment ? `${project.name} (${project.environment})` : project.name;
    output = appendUniqueListItem(output, 'Projects', line, (current) => current === line || current.startsWith(`${project.name} (`));
  }
  output = ensureSection(output, 'Minds');
  for (const mind of minds ?? []) output = appendUniqueListItem(output, 'Minds', mind, (current) => normalizePath(current) === normalizePath(mind));
  return `${output.trimEnd()}\n`;
}

function ensureSection(textValue, name) {
  if (new RegExp(`(?:^|\\n)## ${escapeRegExp(name)}(?:\\n|$)`).test(textValue)) return textValue;
  return `${textValue}${textValue ? '\n\n' : ''}## ${name}`;
}

function mergeNamedList(textValue, section, name, values) {
  const sectionRange = findSection(textValue, section);
  const sectionText = textValue.slice(sectionRange.start, sectionRange.end);
  const expression = new RegExp(`^- ${escapeRegExp(name)}:\\s*(.*)$`, 'm');
  const match = sectionText.match(expression);
  if (!match) return insertAt(textValue, sectionRange.end, `${sectionText.endsWith('\n') ? '' : '\n'}- ${name}: ${values.join(', ')}`);
  const current = match[1].split(',').map((item) => item.trim()).filter(Boolean);
  const merged = [...new Set([...current, ...values])];
  const replacement = `- ${name}: ${merged.join(', ')}`;
  const absoluteStart = sectionRange.start + match.index;
  return `${textValue.slice(0, absoluteStart)}${replacement}${textValue.slice(absoluteStart + match[0].length)}`;
}

function appendUniqueListItem(textValue, section, value, matches) {
  const range = findSection(textValue, section);
  const sectionText = textValue.slice(range.start, range.end);
  const items = [...sectionText.matchAll(/^-\s+(.+)$/gm)].map((match) => match[1].trim());
  if (items.some(matches)) return textValue;
  return insertAt(textValue, range.end, `${sectionText.endsWith('\n') ? '' : '\n'}- ${value}`);
}

function findSection(textValue, name) {
  const header = new RegExp(`(?:^|\\n)## ${escapeRegExp(name)}\\n?`);
  const match = header.exec(textValue);
  if (!match) throw new Error(`Missing route section: ${name}`);
  const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
  const next = textValue.indexOf('\n## ', start + 3);
  return { start, end: next === -1 ? textValue.length : next };
}

function insertAt(value, index, inserted) {
  return `${value.slice(0, index)}${inserted}${value.slice(index)}`;
}

async function computeMindPresets({ kitPath, homeDir, env }) {
  const presets = [
    { id: 'cosmic', label: 'Cosmic', path: cosmicMind(env, homeDir) },
    { id: 'installer', labelKey: 'installer', path: kitPath },
    { id: 'drive', labelKey: 'drive', path: path.join(driveRoot(env, homeDir), 'HIVEM1ND') },
    { id: 'user', labelKey: 'user', path: path.join(homeDir, 'HIVEM1ND') },
  ];
  const oneDrive = await detectOneDrive(env);
  if (oneDrive) presets.push({ id: 'oneDrive', labelKey: 'oneDrive', path: path.join(oneDrive, 'HIVEM1ND') });
  return presets;
}

function cosmicMind(env, homeDir) {
  return defaultMind({ platform: process.platform, env, home: homeDir });
}

function driveRoot(env, homeDir) {
  const systemDrive = envValue(env, 'SystemDrive');
  return systemDrive ? `${systemDrive}${path.sep}` : path.parse(homeDir).root;
}

async function detectOneDrive(env) {
  for (const variable of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const value = envValue(env, variable);
    if (!value) continue;
    const resolved = path.resolve(value);
    if (await isDirectoryPath(resolved)) return resolved;
  }
  return null;
}

async function isDirectoryPath(value) {
  try {
    return (await lstat(value)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function validateDestinationType(destination) {
  try {
    const state = await lstat(destination);
    if (state.isSymbolicLink()) throw new SetupValidationError('The M1ND path cannot be a symbolic link');
    if (!state.isDirectory()) throw new SetupValidationError('The M1ND path must be a directory');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function validateMindSelection(mindPath, kitPath) {
  const resolved = path.resolve(mindPath);
  if (normalizePath(resolved) === normalizePath(path.parse(resolved).root)) {
    throw new SetupValidationError('A filesystem root cannot be used as the M1ND');
  }
  const fixtures = path.join(path.resolve(kitPath), 'fixtures');
  if (isWithin(fixtures, resolved)) throw new SetupValidationError('The kit fixtures folder cannot be used as a M1ND');
}

async function requireDirectory(value, label) {
  try {
    const state = await lstat(value);
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error(`${label} must be a regular directory: ${value}`);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} does not exist: ${value}`);
    throw error;
  }
}

function validateLooseName(value, fallback) {
  const normalized = String(value ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

const RECENT_LEGACY_MS = 7 * 24 * 60 * 60 * 1000;

function recentLegacy(sessions, now) {
  return sessions.filter(session => !(Date.parse(session.registeredAt ?? '') < now - RECENT_LEGACY_MS));
}

function normalizeLanguage(value) {
  if (value === 'en' || value === 'es') return value;
  throw new SetupValidationError('language must be en or es');
}

function clampStep(value) {
  const number = Number(value);
  return [1, 2, 7, 8].includes(number) ? number : number >= 3 && number <= 6 ? 2 : 1;
}

function requireValue(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(`${label} is required`);
  return String(value);
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function localDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
