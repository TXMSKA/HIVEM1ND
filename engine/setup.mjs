import { lstat, readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  detectExistingMind,
  discoverAgents,
  discoverContent,
  discoverHomeProjects,
  discoverOtherMinds,
  discoverPreferenceFiles,
  discoverProjects,
  envValue,
  loadAdapters,
} from './discovery.mjs';
import {
  applyInstallPlan,
  combinePlans,
  planAgentAssets,
  planDataFile,
  planKitCopy,
  publicPreview,
  registerLinkConflicts,
  writeInstallReport,
} from './install.mjs';
import {
  ensureSafeDirectory,
  parseMachineRecord,
  readMachineRecord,
  readTextIfPresent,
  serializeMachineRecord,
  writeMachineRecord,
} from './records.mjs';
import { detectLanguage, LANGUAGES, option, text } from './texts.mjs';

const ADDRESS_STYLES = new Set(['impersonal', 'formal', 'explanatory', 'swarm']);

const CATEGORY_ORDER = [
  { id: 'planning', labelKey: 'categoryPlanning' },
  { id: 'quality', labelKey: 'categoryQuality' },
  { id: 'continuity', labelKey: 'categoryContinuity' },
];

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
    : path.join(homeDir, 'HIVEM1ND');
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
  });
  await session.initialize();
  return session;
}

class SetupSession {
  constructor(options) {
    Object.assign(this, options);
    this.currentStep = 1;
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
    };
    this.machineRecord = null;
    this.result = null;
    this.discoveryCache = null;
    this.contentCache = null;
    this.preferenceFiles = [];
    this.existingMind = null;
    this.attachOutdated = null;
    this.alertedMind = null;
  }

  async initialize() {
    const { record } = await readMachineRecord(this.mindPath, this.hostname);
    this.machineRecord = record;
    this.existingMind = await this.inspectMind(this.mindPath);
    if (!record) return;
    if (record.machine && record.machine !== this.hostname) return;

    if (this.resume) {
      this.answers = { ...this.answers, language: record.language ?? this.answers.language, ...(record.draft ?? {}) };
      this.answers.mindPath = this.mindPath;
      this.answers.language = normalizeLanguage(this.answers.language);
      this.currentStep = record.setup === 'done' ? 8 : clampStep(record.setup);
      if (record.setup === 'done') this.result = this.completionResult([], []);
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
    const base = {
      number: this.currentStep,
      title: text(language, `step${this.currentStep}Title`),
      description: text(language, `step${this.currentStep}Description`),
      fields: [],
      values: {},
      done: this.currentStep === 8,
      result: this.currentStep === 8 ? this.result : null,
      language,
      languages: LANGUAGES.map((code) => option(language, code, code === 'es' ? 'spanish' : 'english')),
    };

    if (this.currentStep === 1) {
      base.fields = [field('installMode', 'select', text(language, 'step1Title'), true, [
        option(language, 'simple', 'simple', 'simpleCopy'),
        option(language, 'custom', 'custom', 'customCopy'),
      ])];
      base.values = { installMode: this.answers.installMode };
    }
    if (this.currentStep === 2) {
      base.fields = [
        field('mindPath', 'text', text(language, 'mindPath'), true, undefined, text(language, 'mindPathHelp')),
      ];
      base.values = { mindPath: this.mindPath };
      base.presets = this.presets.map((preset) => ({
        id: preset.id,
        label: text(language, preset.labelKey),
        path: preset.path,
      }));
      if (this.canAttach()) {
        base.existingMind = { ...this.existingMind };
        base.alert = text(language, 'existingMindFound', {
          path: this.existingMind.path,
          version: this.existingMind.version || text(language, 'unknownVersion'),
        });
        base.fields.push(field(
          'attach',
          'boolean',
          text(language, 'attachQuestion'),
          true,
          [option(language, true, 'yes'), option(language, false, 'no')],
          text(language, 'attachHelp'),
        ));
        base.values.attach = this.answers.attach ?? true;
        this.alertedMind = normalizePath(this.mindPath);
      }
    }
    if (this.currentStep === 3) {
      base.scanned = this.answers.agentsScanned === true;
      if (!base.scanned) {
        base.fields = [field('scan', 'boolean', text(language, 'scan'), true)];
        base.values = {};
      } else {
        const known = this.answers.agents ?? [];
        const agentsView = known.map((agent) => ({
          id: agent.id,
          name: displayAgent(agent.id, this.adapters),
          detected: agent.detected === true,
          selected: agent.selected !== false,
          attach: agent.attach === 'onDemand' ? 'onDemand' : 'auto',
        }));
        const addableAgents = this.adapters
          .filter((adapter) => !known.some((agent) => agent.id === adapter.id))
          .map((adapter) => ({ value: adapter.id, label: adapter.displayName }));
        base.agents = agentsView;
        base.addableAgents = addableAgents;
        base.onDemandNotice = { title: text(language, 'onDemandTitle'), body: text(language, 'onDemandCopy') };
        base.onDemandNoticeShown = this.answers.onDemandNoticeShown === true;
        if (agentsView.length === 0) base.description = text(language, 'noAgentsDetected');

        base.fields = [];
        if (agentsView.length > 0) {
          base.fields.push(field('agents', 'multiselect', text(language, 'agentsFound'), false, agentsView.map((agent) => ({
            value: agent.id,
            label: agent.detected ? `${agent.name} (${text(language, 'detected')})` : agent.name,
          }))));
          base.fields.push(field('attachModes', 'object', text(language, 'attachModes'), false, agentsView.map((agent) => ({
            value: agent.id,
            label: agent.name,
          }))));
        }
        if (addableAgents.length > 0) {
          base.fields.push(field('addAgent', 'select', text(language, 'manualSearch'), false, [
            option(language, '', 'no'),
            ...addableAgents,
          ]));
        }
        base.values = {
          agents: agentsView.filter((agent) => agent.selected).map((agent) => agent.id),
          attachModes: Object.fromEntries(agentsView.map((agent) => [agent.id, agent.attach === 'auto' ? 'auto' : 'on-demand'])),
          addAgent: '',
        };
      }
    }
    if (this.currentStep === 4) {
      const content = await this.availableContent();
      base.categories = buildContentCategories(content, language);
      base.fields = content.length === 0 ? [] : [field(
        'included',
        'multiselect',
        text(language, 'included'),
        false,
        content.map((item) => ({
          value: item.id,
          label: item.type === 'feature' ? `/${item.name}` : [item.name, ...packCommands(item)].join(' '),
        })),
      )];
      if (content.length === 0) base.description = text(language, 'nothingToInclude');
      base.values = { included: this.answers.included ?? content.map((item) => item.id) };
    }
    if (this.currentStep === 5) {
      if (!this.answers.projectsScanned) await this.scanHomeProjects();
      const groups = groupProjectsByFolder(this.answers.projects);
      base.groups = groups.map((group) => ({
        id: group.id,
        folder: group.folder,
        environment: group.environment,
        projects: group.projects.map((project) => ({
          index: project.index,
          name: project.name,
          path: project.path,
        })),
      }));
      base.fields = [field('addRoot', 'text', text(language, 'addRoot'), false)];
      for (const [index, group] of groups.entries()) {
        base.fields.push(field(`groupEnvironment.${index}`, 'text', text(language, 'environment'), false));
      }
      base.fields.push(field('removeProject', 'number', text(language, 'removeRepository'), false));
      base.fields.push(field('removeEnvironment', 'text', text(language, 'removeEnvironment'), false));
      base.fields.push(field(
        'projectsConfirmed',
        'boolean',
        text(language, 'projects'),
        true,
        [option(language, true, 'yes'), option(language, false, 'no')],
      ));
      base.values = { addRoot: '', projectsConfirmed: this.answers.projectsConfirmed };
      groups.forEach((group, index) => { base.values[`groupEnvironment.${index}`] = group.environment; });
    }
    if (this.currentStep === 6) {
      this.preferenceFiles = await discoverPreferenceFiles(this.selectedAgentIds(), {
        adapters: this.adapters,
        homeDir: this.homeDir,
        env: this.env,
      });
      base.fields = [
        field('skipPreferences', 'boolean', text(language, 'skipPreferences'), false, [
          option(language, true, 'yes'), option(language, false, 'no'),
        ]),
        field('addressStyle', 'select', text(language, 'addressUser'), false, [
          option(language, 'impersonal', 'impersonal'),
          option(language, 'formal', 'formal'),
          option(language, 'explanatory', 'explanatory'),
          option(language, 'swarm', 'swarm'),
        ]),
        field('customPreference', 'textarea', text(language, 'anythingElse'), false),
      ];
      if (this.preferenceFiles.length > 0) {
        base.fields.push(field(
          'keepExistingPreferences',
          'boolean',
          text(language, 'keepExistingPreferences'),
          false,
          [option(language, true, 'yes'), option(language, false, 'no')],
        ));
      }
      base.fields.push(field('autoUpdates', 'boolean', text(language, 'updates'), false, [
        option(language, true, 'yes'), option(language, false, 'no'),
      ]));
      base.values = {
        skipPreferences: this.answers.skipPreferences,
        addressStyle: this.answers.addressStyle,
        customPreference: this.answers.customPreference,
        keepExistingPreferences: this.answers.keepExistingPreferences,
        autoUpdates: this.answers.updateCheck === 'daily',
      };
    }
    if (this.currentStep === 7) {
      const preview = await this.preview();
      base.preview = preview;
      base.fields = preview.conflicts.map((conflict, index) => field(
        `conflict.${index}`,
        'select',
        conflict.path,
        true,
        conflict.choices.map((choice) => option(language, choice, conflictChoiceKey(conflict, choice))),
        conflict.reason,
      ));
      base.fields.push(field(
        'confirm',
        'boolean',
        text(language, 'confirmWrite'),
        true,
        [option(language, true, 'yes'), option(language, false, 'no')],
      ));
      base.values = { confirm: this.answers.confirm, conflicts: { ...this.answers.conflicts } };
      for (const [index, conflict] of preview.conflicts.entries()) {
        base.values[`conflict.${index}`] = this.answers.conflicts[conflict.path] ?? conflict.selection ?? null;
      }
    }
    return base;
  }

  async setLanguage(value) {
    this.answers.language = normalizeLanguage(value);
    await this.persistDraft();
    return this.getStep();
  }

  async answer(values = {}) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new SetupValidationError('Answers must be an object');
    if (this.currentStep === 8) return this.getStep();

    if (this.currentStep === 1) {
      const mode = values.installMode ?? this.answers.installMode;
      if (mode !== 'simple' && mode !== 'custom') throw new SetupValidationError('installMode must be simple or custom');
      this.answers.installMode = mode;
      if (mode === 'simple') {
        // A mind already on this machine is attached instead of installed over.
        const found = this.existingMind ?? await this.findInstalledMind();
        if (found) {
          await this.selectMind(found.path);
          this.answers.attach = this.canAttach();
        }
        await this.applySimpleDefaults();
        this.currentStep = 7;
      } else {
        this.currentStep = 2;
      }
    } else if (this.currentStep === 2) {
      const selected = path.resolve(requireValue(values.mindPath ?? this.mindPath, 'mindPath'));
      validateMindSelection(selected, this.kitPath);
      await validateDestinationType(selected);
      const previousMind = this.mindPath;
      await this.selectMind(selected);
      // A path that turns out to hold a mind goes back to this step with the alert, so the
      // attach question is answered about the folder the answer belongs to.
      if (this.canAttach() && this.alertedMind !== normalizePath(selected)) {
        await this.persistDraft();
        if (normalizePath(previousMind) !== normalizePath(selected)) await removeOwnedDraft(previousMind, this.hostname);
        return this.getStep();
      }
      this.answers.attach = this.canAttach() && values.attach !== false;
      this.currentStep = 3;
      await this.persistDraft();
      if (normalizePath(previousMind) !== normalizePath(selected)) await removeOwnedDraft(previousMind, this.hostname);
      return this.getStep();
    } else if (this.currentStep === 3) {
      if (this.answers.agentsScanned !== true) {
        await this.scanAgents();
        return this.getStep();
      }
      const addAgentId = values.addAgent;
      if (typeof addAgentId === 'string' && addAgentId !== '') {
        this.addManualAgent(addAgentId);
        await this.persistDraft();
        return this.getStep();
      }
      const known = this.answers.agents ?? [];
      const knownIds = new Set(known.map((agent) => agent.id));
      const selected = values.agents ?? known.filter((agent) => agent.selected !== false).map((agent) => agent.id);
      requireStringArray(selected, 'agents');
      if (selected.some((id) => !knownIds.has(id))) throw new SetupValidationError('agents contains an unknown agent');
      const attachValues = values.attachModes && typeof values.attachModes === 'object' ? values.attachModes : {};
      this.answers.agents = known.map((agent) => {
        const requested = attachValues[agent.id];
        const attach = requested === undefined ? agent.attach : normalizeAttach(requested);
        return { ...agent, selected: selected.includes(agent.id), attach };
      });
      if (this.answers.agents.some((agent) => agent.selected && agent.attach === 'onDemand')) {
        this.answers.onDemandNoticeShown = true;
      }
      this.currentStep = 4;
    } else if (this.currentStep === 4) {
      const available = await this.availableContent();
      const valid = new Set(available.map((item) => item.id));
      const included = values.included ?? this.answers.included ?? [...valid];
      requireStringArray(included, 'included');
      if (included.some((item) => !valid.has(item))) throw new SetupValidationError('included contains an unavailable item');
      this.answers.included = [...new Set(included)];
      this.currentStep = 5;
    } else if (this.currentStep === 5) {
      if (!this.answers.projectsScanned) await this.scanHomeProjects();
      const addRoot = values.addRoot;
      if (typeof addRoot === 'string' && addRoot.trim() !== '') {
        await this.addProjectRoot(addRoot.trim());
        return this.getStep();
      }
      if (typeof values.removeProject === 'number') {
        this.removeProject(values.removeProject);
        await this.persistDraft();
        return this.getStep();
      }
      if (typeof values.removeEnvironment === 'string' && values.removeEnvironment !== '') {
        this.removeEnvironmentGroup(values.removeEnvironment);
        await this.persistDraft();
        return this.getStep();
      }

      if (values.projectsConfirmed !== true) throw new SetupValidationError('projectsConfirmed must be true');
      const groups = groupProjectsByFolder(this.answers.projects);
      for (const [index, group] of groups.entries()) {
        const provided = values[`groupEnvironment.${index}`];
        if (provided === undefined) continue;
        const environment = provided ? validateRouteName(provided, 'environment name') : '';
        const memberIndices = new Set(group.projects.map((project) => project.index));
        this.answers.projects = this.answers.projects.map((project, projectIndex) => (
          memberIndices.has(projectIndex) ? { ...project, environment } : project
        ));
      }
      this.answers.projectsConfirmed = true;
      // Preferences belong to the mind, not to the machine: an attach leaves them as they are.
      this.currentStep = this.answers.attach ? 7 : 6;
    } else if (this.currentStep === 6) {
      this.answers.skipPreferences = values.skipPreferences === true;
      if (values.keepExistingPreferences !== undefined) {
        this.answers.keepExistingPreferences = values.keepExistingPreferences !== false;
      }
      if (!this.answers.skipPreferences) {
        const addressStyle = values.addressStyle ?? this.answers.addressStyle;
        if (!ADDRESS_STYLES.has(addressStyle)) throw new SetupValidationError('Invalid addressStyle');
        this.answers.addressStyle = addressStyle;
        this.answers.customPreference = normalizePreference(values.customPreference ?? this.answers.customPreference);
      } else {
        this.answers.customPreference = '';
      }
      const autoUpdates = values.autoUpdates ?? (this.answers.updateCheck === 'daily');
      this.answers.updateCheck = autoUpdates === false ? 'off' : 'daily';
      this.currentStep = 7;
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
      await this.persistDraft(7);
      return this.getStep();
    }

    await this.persistDraft();
    return this.getStep();
  }

  async back() {
    if (this.currentStep <= 1) return this.getStep();
    if (this.currentStep === 8) this.currentStep = 7;
    else if (this.currentStep === 7) {
      this.currentStep = this.answers.installMode === 'simple' ? 1 : (this.answers.attach ? 5 : 6);
    } else this.currentStep -= 1;
    this.answers.confirm = false;
    await this.persistDraft(this.currentStep);
    return this.getStep();
  }

  async preview() {
    if (this.currentStep < 7) throw new Error('Preview is available at step 7');
    const plan = await this.buildPlan();
    const preview = publicPreview(plan, this.answers.language);
    preview.conflicts = preview.conflicts.map((conflict) => ({
      ...conflict,
      selection: this.answers.conflicts[conflict.path] ?? conflict.selection ?? null,
    }));
    return preview;
  }

  async install() {
    if (this.currentStep !== 7) throw new Error('Install is available at step 7');
    if (!this.answers.confirm) throw new SetupValidationError('Installation must be confirmed');
    const plan = await this.buildPlan();
    for (const conflict of plan.conflicts) {
      const choice = this.answers.conflicts[conflict.path];
      if (!(conflict.choices ?? ['keep', 'replace']).includes(choice)) {
        throw new SetupValidationError(`Conflict requires an explicit choice: ${conflict.path}`);
      }
    }

    await this.createMindLayout();
    const applied = await applyInstallPlan(plan, this.answers.conflicts);
    const managedFiles = { ...(this.machineRecord?.managedFiles ?? {}), ...applied.managedFiles };
    for (const conflict of plan.conflicts) {
      if (this.answers.conflicts[conflict.path] === 'keep') delete managedFiles[conflict.path];
    }
    for (const item of applied.omitted) delete managedFiles[item.path];
    delete managedFiles[path.join(this.mindPath, 'user', 'machines', `${this.hostname}.md`)];
    // An asset that was neither written nor answered for leaves the setup at the install
    // step, so the next run finishes it instead of reporting an installation that is not there.
    const unwritten = this.unwrittenAssets(plan, applied);
    const record = this.buildMachineRecord(unwritten.length === 0 ? 'done' : 7);
    record.draft = unwritten.length === 0 ? {} : { ...this.answers, mindPath: this.mindPath };
    record.managedFiles = managedFiles;
    await writeMachineRecord(this.mindPath, this.hostname, record);
    this.machineRecord = record;
    const reportPath = await writeInstallReport({
      mindPath: this.mindPath,
      hostname: this.hostname,
      language: this.answers.language,
      report: {
        action: this.answers.attach ? 'attach' : 'install',
        written: applied.files.length,
        omitted: applied.omitted,
        replacedLinks: applied.replacedLinks,
        kept: plan.conflicts
          .filter((conflict) => this.answers.conflicts[conflict.path] === 'keep')
          .map((conflict) => ({ path: conflict.path, reason: conflict.reason })),
        unwritten,
        warnings: plan.warnings,
      },
    });
    this.currentStep = 8;
    this.result = this.completionResult(applied.files, plan.warnings, {
      omitted: applied.omitted,
      replacedLinks: applied.replacedLinks,
      unwritten,
      reportPath,
    });
    return this.result;
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
    this.answers.projects = assignProjectsToRoots(discovered, []);
    this.answers.projectsScanned = true;
    this.answers.projectsConfirmed = true;
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
    const record = this.buildMachineRecord(step);
    record.draft = { ...this.answers, mindPath: this.mindPath };
    record.managedFiles = { ...(this.machineRecord?.managedFiles ?? {}) };
    await writeMachineRecord(this.mindPath, this.hostname, record);
    this.machineRecord = record;
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
      paths: buildMachinePaths(this.answers.projectRoots, this.includedProjects()),
      excluded: this.excludedItems(),
      keepExistingPreferences: this.answers.keepExistingPreferences,
      draft: {},
      managedFiles: { ...(this.machineRecord?.managedFiles ?? {}) },
    };
  }

  // The machine can be attached while the mind is already installed and this machine has no
  // finished record in it. A machine that finished its setup there is running it again.
  canAttach() {
    return Boolean(this.existingMind) && this.machineRecord?.setup !== 'done';
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
    const existingManaged = this.machineRecord?.managedFiles ?? {};
    // An attach writes what belongs to this machine. The kit copy, the preferences and the
    // recorded version belong to the mind and stay as the mind already has them.
    const attach = this.answers.attach === true;
    const kitPlan = attach ? { items: [], conflicts: [], warnings: [] } : await planKitCopy({
      kitPath: this.kitPath,
      mindPath: this.mindPath,
      managedFiles: existingManaged,
      excluded: this.excludedItems(),
      language: this.answers.language,
    });
    const packageJson = JSON.parse(await readFile(path.join(this.kitPath, 'package.json'), 'utf8'));
    const versionPath = path.join(this.mindPath, 'user', 'VERSION');
    const preferencesPath = path.join(this.mindPath, 'user', 'preferences.md');
    const routesPath = path.join(this.mindPath, 'user', 'routes.md');
    const machinePath = path.join(this.mindPath, 'user', 'machines', `${this.hostname}.md`);

    const existingPreferences = await readTextIfPresent(preferencesPath);
    const preferences = mergePreferences(existingPreferences ?? '', preferenceLines(this.answers));
    const existingRoutes = await readTextIfPresent(routesPath);
    const otherMinds = await discoverOtherMinds(this.mindPath, { kitPath: this.kitPath });
    const routes = mergeRoutes(existingRoutes ?? '', this.includedProjects(), otherMinds);
    const finalRecord = this.buildMachineRecord('done');
    finalRecord.draft = {};

    if (attach) this.attachOutdated = await this.outdatedMind(packageJson.version);
    const mindPlans = attach ? [] : [
      planDataFile({ destination: versionPath, content: `${packageJson.version}\n`, root: this.mindPath, managedHash: existingManaged[versionPath], kind: 'version', allowExisting: true, language: this.answers.language }),
      planDataFile({ destination: preferencesPath, content: preferences, root: this.mindPath, managedHash: existingManaged[preferencesPath], kind: 'preferences', allowExisting: true, language: this.answers.language }),
    ];
    const dataPlans = await Promise.all([
      ...mindPlans,
      planDataFile({ destination: routesPath, content: routes, root: this.mindPath, managedHash: existingManaged[routesPath], kind: 'routes', allowExisting: true, language: this.answers.language }),
    ]);
    const agentPlan = await planAgentAssets({
      kitPath: this.kitPath,
      mindPath: this.mindPath,
      homeDir: this.homeDir,
      env: this.env,
      adapters: this.adapters,
      agents: finalRecord.agents,
      excluded: finalRecord.excluded,
      managedFiles: existingManaged,
      keepExistingPreferences: this.answers.keepExistingPreferences,
      language: this.answers.language,
    });
    const machinePlan = await planDataFile({
      destination: machinePath,
      content: serializeMachineRecord(finalRecord),
      root: this.mindPath,
      kind: 'machine',
      allowExisting: true,
      owned: false,
      language: this.answers.language,
    });
    return registerLinkConflicts(
      combinePlans(kitPlan, ...dataPlans, agentPlan, machinePlan),
      this.answers.language,
    );
  }

  async createMindLayout() {
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
    return {
      message: text(language, 'step8Description'),
      firstCommand: '/executor <project>',
      mindPath: this.mindPath,
      attached: this.answers.attach === true,
      files,
      warnings: [...new Set(warnings)],
      notices,
      omitted: outcome.omitted ?? [],
      replacedLinks: outcome.replacedLinks ?? [],
      unwritten: outcome.unwritten ?? [],
      reportPath: outcome.reportPath ?? null,
      attachPrompts: attachAgents.map((agent) => ({ agent, text: prompt })),
    };
  }
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

function normalizeAttach(value) {
  if (value === 'auto') return 'auto';
  if (value === 'on-demand') return 'onDemand';
  throw new SetupValidationError(`Invalid attach mode: ${value}`);
}

function buildContentCategories(content, language) {
  const features = content.filter((item) => item.type === 'feature');
  const categories = [];
  for (const category of CATEGORY_ORDER) {
    const items = features.filter((item) => item.category === category.id);
    if (items.length === 0) continue;
    categories.push({ id: category.id, label: text(language, category.labelKey), items: items.map(contentItem) });
  }
  const ordered = new Set(CATEGORY_ORDER.map((category) => category.id));
  const remaining = features.filter((item) => !ordered.has(item.category));
  if (remaining.length > 0) {
    categories.push({ id: 'other', label: text(language, 'included'), items: remaining.map(contentItem) });
  }
  const packs = content.filter((item) => item.type === 'knowledge');
  if (packs.length > 0) {
    categories.push({ id: 'knowledge', label: text(language, 'categoryPacks'), items: packs.map(contentItem) });
  }
  return categories;
}

function contentItem(item) {
  if (item.type !== 'knowledge') return { id: item.id, name: item.name };
  return { id: item.id, name: item.name, commands: packCommands(item) };
}

function packCommands(item) {
  return (item.commands ?? []).map((command) => `/${command}`);
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

async function removeOwnedDraft(mindPath, hostname) {
  const { filePath, record } = await readMachineRecord(mindPath, hostname);
  if (!record || record.setup === 'done' || record.machine !== hostname) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function computeMindPresets({ kitPath, homeDir, env }) {
  const presets = [
    { id: 'installer', labelKey: 'installer', path: kitPath },
    { id: 'drive', labelKey: 'drive', path: path.join(driveRoot(env, homeDir), 'HIVEM1ND') },
    { id: 'user', labelKey: 'user', path: path.join(homeDir, 'HIVEM1ND') },
  ];
  const oneDrive = await detectOneDrive(env);
  if (oneDrive) presets.push({ id: 'oneDrive', labelKey: 'oneDrive', path: path.join(oneDrive, 'HIVEM1ND') });
  return presets;
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
    if (state.isSymbolicLink()) throw new SetupValidationError('The mind path cannot be a symbolic link');
    if (!state.isDirectory()) throw new SetupValidationError('The mind path must be a directory');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function validateMindSelection(mindPath, kitPath) {
  const resolved = path.resolve(mindPath);
  if (normalizePath(resolved) === normalizePath(path.parse(resolved).root)) {
    throw new SetupValidationError('A filesystem root cannot be used as the mind');
  }
  const fixtures = path.join(path.resolve(kitPath), 'fixtures');
  if (isWithin(fixtures, resolved)) throw new SetupValidationError('The kit fixtures folder cannot be used as a mind');
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

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new SetupValidationError(`${label} must be an array of strings`);
  }
}

function validateRouteName(value, label) {
  const name = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new SetupValidationError(`Invalid ${label}: ${value}`);
  return name;
}

function validateLooseName(value, fallback) {
  const normalized = String(value ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizePreference(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
}

function normalizeLanguage(value) {
  if (value === 'en' || value === 'es') return value;
  throw new SetupValidationError('language must be en or es');
}

function clampStep(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 8 ? number : 1;
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
