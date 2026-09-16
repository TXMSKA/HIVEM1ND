function folderIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`;
}

function searchIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>`;
}

function chevronIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
}

function closeIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
}

function iconElement(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template.content.firstElementChild;
}

const elements = {
  navigation: document.querySelector(".nav-panel"),
  progress: document.querySelector("#progress"),
  language: document.querySelector("#language-panel"),
  form: document.querySelector("#step-form"),
  fields: document.querySelector("#fields"),
  preview: document.querySelector("#preview"),
  title: document.querySelector("#step-title"),
  description: document.querySelector("#step-description"),
  error: document.querySelector("#status-message"),
  live: document.querySelector("#live-status"),
  back: document.querySelector("#back-button"),
  continue: document.querySelector("#continue-button"),
  dialog: document.querySelector("#mode-dialog"),
  dialogTitle: document.querySelector("#mode-dialog-title"),
  dialogCopy: document.querySelector("#mode-dialog-copy"),
  dialogClose: document.querySelector("#mode-dialog-close"),
};

const fragment = new URLSearchParams(location.hash.slice(1));
const tokenFromHash = fragment.get("session");
if (tokenFromHash) sessionStorage.setItem("hivem1nd.session", tokenFromHash);
const sessionToken = tokenFromHash ?? sessionStorage.getItem("hivem1nd.session");
history.replaceState({}, "", "/");

let currentStep;
let currentPreview;
let language = "en";
let busy = false;
let onDemandNoticeShown = false;
const groupExpansion = new Map();

function isGroupExpanded(groupId, totalGroups) {
  if (!groupExpansion.has(groupId)) groupExpansion.set(groupId, totalGroups <= 3);
  return groupExpansion.get(groupId);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ui() {
  return currentStep?.ui ?? {};
}

function formatCount(template, count) {
  return (template ?? "").replace("{count}", String(count));
}

function format(template, variables) {
  return Object.entries(variables).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), template ?? "");
}

function progressLabel(index) {
  return ui()[`step${index}Title`] ?? "";
}

function lastPathSegment(value) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

function fieldLabel(field) {
  if (!field) return "";
  return field.label?.trim() === currentStep?.title?.trim() ? "" : (field.label ?? "");
}

function hasBrowseBridge() {
  return typeof window.hivem1nd?.browseFolder === "function";
}

function groupFilesByOwner(files) {
  const groups = new Map();
  for (const file of files) {
    const key = file.owner?.id ?? "";
    if (!groups.has(key)) groups.set(key, { label: file.owner?.label ?? key, files: [] });
    groups.get(key).files.push(file);
  }
  return groups;
}

function setError(message) {
  elements.error.hidden = !message;
  elements.error.textContent = message ?? "";
}

function setBusy(value, message = "") {
  busy = value;
  for (const control of document.querySelectorAll("button, input, select, textarea")) control.disabled = value;
  elements.live.textContent = message;
}

async function api(path, { method = "GET", body } = {}) {
  if (!sessionToken) throw new Error(ui().sessionMissing ?? "The local session link is incomplete. Open the wizard again from the HIVEM1ND command.");
  const response = await fetch(`/api/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = format(ui().requestFailed ?? "The local wizard request failed (status {status}).", { status: response.status });
    throw new Error(payload?.error?.message ?? fallback);
  }
  return payload.data;
}

async function submitAnswer(values) {
  setBusy(true, ui().loading);
  setError();
  try {
    await api("answer", { method: "POST", body: { values } });
    await render(await api("step"));
  } catch (error) {
    setError(error.message);
  } finally {
    setBusy(false);
    elements.live.textContent = "";
  }
}

function renderProgress(number) {
  elements.progress.replaceChildren();
  for (let index = 1; index <= 8; index += 1) {
    const item = el("li");
    if (index < number) item.classList.add("complete");
    if (index === number) item.classList.add("current");
    if (index === number) item.setAttribute("aria-current", "step");
    item.append(el("span", "progress-number", String(index)), el("span", "progress-label", progressLabel(index)));
    elements.progress.append(item);
  }
  const percent = ((Math.min(Math.max(number, 1), 8) - 1) / 7) * 100;
  requestAnimationFrame(() => elements.progress.style.setProperty("--timeline-progress", `${percent}%`));
}

function renderLanguage(step) {
  const c = ui();
  elements.language.replaceChildren();
  const languages = step.languages ?? [];
  elements.language.append(el("span", "language-label", c.language));
  const optionsContainer = el("div", "language-options");
  let query = "";

  function renderOptions() {
    optionsContainer.replaceChildren();
    for (const option of languages) {
      if (query && !option.label.toLowerCase().includes(query)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "language-option";
      button.textContent = option.value.toUpperCase();
      button.setAttribute("aria-pressed", String(option.value === language));
      button.addEventListener("click", async () => {
        if (busy || option.value === language) return;
        setBusy(true, ui().loading);
        setError();
        try {
          await api("language", { method: "POST", body: { language: option.value } });
          await render(await api("step"));
        } catch (error) {
          setError(error.message);
        } finally {
          setBusy(false);
          elements.live.textContent = "";
        }
      });
      optionsContainer.append(button);
    }
  }

  if (languages.length > 5) {
    const search = document.createElement("input");
    search.type = "text";
    search.className = "language-search";
    search.placeholder = c.searchLanguages;
    search.setAttribute("aria-label", c.searchLanguages);
    search.addEventListener("input", () => {
      query = search.value.trim().toLowerCase();
      renderOptions();
    });
    elements.language.append(search);
  }
  elements.language.append(optionsContainer);
  renderOptions();
}

function showModeDialog(notice) {
  if (!notice) return;
  elements.dialogTitle.textContent = notice.title;
  elements.dialogCopy.textContent = notice.body;
  elements.dialogClose.textContent = ui().continue;
  elements.dialog.showModal();
}

function renderInstallMode(step) {
  const field = step.fields[0];
  const grid = el("div", "mode-grid");
  for (const option of field.options ?? []) {
    const label = el("label", "mode-card");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "installMode";
    input.value = option.value;
    input.checked = option.value === step.values.installMode;
    input.required = true;
    label.append(input, el("strong", "", option.label), el("span", "", option.hint ?? ""));
    grid.append(label);
  }
  return [grid];
}

function renderLocation(step) {
  const field = step.fields[0];
  const wrapper = el("div", "field");
  const label = el("label", "", fieldLabel(field) || field.label);
  label.htmlFor = "mind-path";
  wrapper.append(label);
  if (field.help) wrapper.append(el("p", "field-help", field.help));

  const control = el("div", "path-control");
  const input = document.createElement("input");
  input.type = "text";
  input.id = "mind-path";
  input.required = true;
  input.value = step.values.mindPath ?? "";
  control.append(input);

  if (hasBrowseBridge()) {
    const browse = el("button", "icon-button");
    browse.type = "button";
    browse.title = ui().browse;
    browse.setAttribute("aria-label", ui().browse);
    browse.append(iconElement(folderIcon()));
    browse.addEventListener("click", async () => {
      const chosen = await window.hivem1nd.browseFolder();
      if (chosen) input.value = chosen;
    });
    control.append(browse);
  }
  wrapper.append(control);

  const presets = el("div", "path-presets");
  for (const preset of step.presets ?? []) {
    const chip = el("button", "path-chip", preset.label);
    chip.type = "button";
    if (preset.path === input.value) chip.classList.add("selected");
    chip.addEventListener("click", () => {
      input.value = preset.path;
      presets.querySelectorAll(".path-chip").forEach((node) => node.classList.remove("selected"));
      chip.classList.add("selected");
    });
    presets.append(chip);
  }
  wrapper.append(presets);
  return [wrapper];
}

function renderAgents(step) {
  if (!step.scanned) {
    const field = step.fields[0];
    const button = el("button", "button primary scan-action", fieldLabel(field) || field.label);
    button.type = "button";
    button.addEventListener("click", () => elements.form.requestSubmit());
    return [button];
  }

  const nodes = [];
  const agentsField = step.fields.find((candidate) => candidate.id === "agents");
  const labelById = new Map((agentsField?.options ?? []).map((option) => [option.value, option.label]));
  const results = el("div", "agent-results");
  for (const agent of step.agents ?? []) {
    const row = el("div", "agent-result");
    const selectLabel = el("label", "agent-select");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.agentId = agent.id;
    checkbox.checked = agent.selected;
    selectLabel.append(checkbox, document.createTextNode(labelById.get(agent.id) ?? agent.name));
    row.append(selectLabel);

    const modes = el("div", "attach-modes");
    modes.setAttribute("role", "group");
    modes.dataset.agentId = agent.id;
    const autoButton = el("button", "attach-mode", ui().attachAuto);
    autoButton.type = "button";
    autoButton.dataset.agentMode = "auto";
    autoButton.setAttribute("aria-pressed", String(agent.attach === "auto"));
    const onDemandButton = el("button", "attach-mode", ui().attachOnDemand);
    onDemandButton.type = "button";
    onDemandButton.dataset.agentMode = "on-demand";
    onDemandButton.setAttribute("aria-pressed", String(agent.attach === "onDemand"));
    modes.append(autoButton, onDemandButton);
    row.append(modes);
    results.append(row);
  }
  nodes.push(results);

  const addAgentField = step.fields.find((candidate) => candidate.id === "addAgent");
  if (addAgentField && (step.addableAgents ?? []).length > 0) {
    const toggle = el("button", "manual-agent-action");
    toggle.type = "button";
    toggle.append(iconElement(searchIcon()), el("span", "", fieldLabel(addAgentField) || addAgentField.label));
    const searchRow = el("div", "manual-agent-search");
    searchRow.hidden = true;
    const select = document.createElement("select");
    for (const option of step.addableAgents) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      select.append(node);
    }
    const addButton = el("button", "button secondary", ui().add);
    addButton.type = "button";
    addButton.addEventListener("click", () => {
      if (select.value) submitAnswer({ addAgent: select.value });
    });
    searchRow.append(select, addButton);
    toggle.addEventListener("click", () => {
      searchRow.hidden = false;
      toggle.hidden = true;
    });
    nodes.push(toggle, searchRow);
  }

  return nodes;
}

function renderContent(step) {
  if (!(step.categories?.length > 0)) return [];
  const includedField = step.fields.find((candidate) => candidate.id === "included");
  const labelById = new Map((includedField?.options ?? []).map((option) => [option.value, option.label]));
  const included = new Set(step.values.included ?? []);
  const tree = el("div", "feature-tree");
  for (const category of step.categories) {
    const section = el("section", "feature-category");
    const heading = el("label", "category-heading");
    const headingCheckbox = document.createElement("input");
    headingCheckbox.type = "checkbox";
    headingCheckbox.dataset.category = category.id;
    headingCheckbox.checked = category.items.every((item) => included.has(item.id));
    heading.append(headingCheckbox, el("span", "", category.label));
    section.append(heading);

    const items = el("div", "feature-items");
    for (const item of category.items) {
      const label = el("label", "feature-item");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.feature = item.id;
      checkbox.checked = included.has(item.id);
      label.append(checkbox, document.createTextNode(labelById.get(item.id) ?? item.name));
      items.append(label);
    }
    section.append(items);
    tree.append(section);
  }
  return [tree];
}

function renderProjectsConfirm(step) {
  const nodes = [];
  const groups = step.groups ?? [];
  const removeProjectLabel = step.fields.find((candidate) => candidate.id === "removeProject")?.label ?? "";
  const removeEnvironmentLabel = step.fields.find((candidate) => candidate.id === "removeEnvironment")?.label ?? "";

  const addRootField = step.fields.find((candidate) => candidate.id === "addRoot");
  if (addRootField && hasBrowseBridge()) {
    const addButton = el("button", "add-folder-action");
    addButton.type = "button";
    const addRootLabel = fieldLabel(addRootField) || addRootField.label;
    addButton.title = addRootLabel;
    addButton.append(iconElement(folderIcon()), el("span", "", addRootLabel));
    addButton.addEventListener("click", async () => {
      const chosen = await window.hivem1nd.browseFolder();
      if (chosen) await submitAnswer({ addRoot: chosen });
    });
    nodes.push(addButton);
  }

  const list = el("div", "group-list");
  for (const [index, group] of groups.entries()) {
    const card = el("section", "group-card");
    const head = el("div", "group-head");

    const toggle = el("button", "group-toggle");
    toggle.type = "button";
    const expanded = isGroupExpanded(group.id, groups.length);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.title = group.folder;
    const groupNameSpan = el("span", "group-name", lastPathSegment(group.folder));
    toggle.append(iconElement(chevronIcon()), groupNameSpan);
    head.append(toggle);

    const envField = step.fields.find((candidate) => candidate.id === `groupEnvironment.${index}`);
    if (envField) {
      const envInput = document.createElement("input");
      envInput.type = "text";
      envInput.className = "group-environment-input";
      envInput.id = `group-environment-${index}`;
      envInput.dataset.groupIndex = String(index);
      envInput.value = group.environment ?? "";
      envInput.placeholder = ui().environmentPlaceholder;
      envInput.setAttribute("aria-label", envField.label);
      head.append(envInput);
    }

    const removeGroupButton = el("button", "icon-button small");
    removeGroupButton.type = "button";
    removeGroupButton.title = removeEnvironmentLabel;
    removeGroupButton.setAttribute("aria-label", removeEnvironmentLabel);
    removeGroupButton.append(iconElement(closeIcon()));
    removeGroupButton.addEventListener("click", () => submitAnswer({ removeEnvironment: group.id }));
    head.append(removeGroupButton);
    card.append(head);

    const repos = el("div", "repo-list");
    repos.hidden = !expanded;
    toggle.addEventListener("click", () => {
      const next = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(next));
      repos.hidden = !next;
      groupExpansion.set(group.id, next);
    });

    for (const project of group.projects) {
      const row = el("div", "repo-row");
      const nameSpan = el("span", "repo-name", project.name);
      const repoPathSpan = el("span", "repo-path", project.path);
      repoPathSpan.title = project.path;
      const removeButton = el("button", "icon-button small");
      removeButton.type = "button";
      const label = `${removeProjectLabel} ${project.name}`.trim();
      removeButton.title = label;
      removeButton.setAttribute("aria-label", label);
      removeButton.append(iconElement(closeIcon()));
      removeButton.addEventListener("click", () => submitAnswer({ removeProject: project.index }));
      row.append(nameSpan, repoPathSpan, removeButton);
      repos.append(row);
    }
    card.append(repos);
    list.append(card);
  }
  nodes.push(list);
  return nodes;
}

function renderConfirm(step) {
  const byId = new Map(step.fields.map((field) => [field.id, field]));
  const grid = el("div", "confirm-grid");

  const preferencesSection = el("section", "confirm-section");
  const skipField = byId.get("skipPreferences");
  const skipLabel = el("label", "check-option");
  const skipCheckbox = document.createElement("input");
  skipCheckbox.type = "checkbox";
  skipCheckbox.id = "skip-preferences";
  skipCheckbox.checked = step.values.skipPreferences === true;
  skipLabel.append(skipCheckbox, document.createTextNode(fieldLabel(skipField) || skipField.label));
  preferencesSection.append(skipLabel);

  const details = el("div", "preference-details");
  details.hidden = skipCheckbox.checked;

  const addressField = byId.get("addressStyle");
  const addressWrapper = el("div", "field");
  addressWrapper.append(el("label", "", addressField.label));
  const segments = el("div", "segments");
  for (const option of addressField.options ?? []) {
    const segment = el("label", "segment");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "addressStyle";
    radio.value = option.value;
    radio.checked = option.value === step.values.addressStyle;
    segment.append(radio, document.createTextNode(option.label));
    segments.append(segment);
  }
  addressWrapper.append(segments);
  details.append(addressWrapper);

  const customField = byId.get("customPreference");
  const customWrapper = el("div", "field");
  const customLabel = el("label", "", customField.label);
  customLabel.htmlFor = "custom-preference";
  const textarea = document.createElement("textarea");
  textarea.id = "custom-preference";
  textarea.value = step.values.customPreference ?? "";
  customWrapper.append(customLabel, textarea);
  details.append(customWrapper);

  const keepField = byId.get("keepExistingPreferences");
  if (keepField) {
    const keepLabel = el("label", "check-option");
    const keepCheckbox = document.createElement("input");
    keepCheckbox.type = "checkbox";
    keepCheckbox.id = "keep-existing-preferences";
    keepCheckbox.checked = step.values.keepExistingPreferences !== false;
    keepLabel.append(keepCheckbox, document.createTextNode(keepField.label));
    details.append(keepLabel);
  }
  preferencesSection.append(details);
  skipCheckbox.addEventListener("change", () => {
    details.hidden = skipCheckbox.checked;
  });

  const updatesSection = el("section", "confirm-section");
  const updatesField = byId.get("autoUpdates");
  const updatesLabel = el("label", "check-option");
  const updatesCheckbox = document.createElement("input");
  updatesCheckbox.type = "checkbox";
  updatesCheckbox.id = "auto-updates";
  updatesCheckbox.checked = step.values.autoUpdates !== false;
  updatesLabel.append(updatesCheckbox, document.createTextNode(updatesField.label));
  updatesSection.append(updatesLabel);

  grid.append(preferencesSection, updatesSection);
  return [grid];
}

function renderInstallPreview(step, preview) {
  elements.preview.replaceChildren();
  elements.preview.hidden = false;
  const c = ui();
  const files = preview.files ?? [];
  const fileCountText = files.length === 1 ? formatCount(c.filesCountOne, files.length) : formatCount(c.filesCountOther, files.length);
  elements.preview.append(el("p", "preview-meta", files.length === 0 ? c.noFiles : fileCountText));

  if (files.length > 0) {
    const actionLabels = { create: c.actionCreate, update: c.actionUpdate, unchanged: c.actionUnchanged, append: c.actionAppend, conflict: c.actionConflict };
    const scrollArea = el("div", "preview-files");
    const groupsWrap = el("div", "install-groups");
    for (const [, group] of groupFilesByOwner(files)) {
      const groupSection = el("section", "install-group");
      groupSection.append(el("h2", "", group.label));
      for (const file of group.files) {
        const row = el("div", "preview-file");
        row.append(el("span", "preview-action", actionLabels[file.action] ?? file.action), el("span", "preview-path", file.path));
        groupSection.append(row);
      }
      groupsWrap.append(groupSection);
    }
    scrollArea.append(groupsWrap);
    elements.preview.append(scrollArea);
  }

  for (const warning of preview.warnings ?? []) elements.preview.append(el("div", "warning", warning));

  for (const [index, conflict] of (preview.conflicts ?? []).entries()) {
    const conflictField = step.fields.find((candidate) => candidate.id === `conflict.${index}`);
    const card = el("fieldset", "conflict-card");
    card.dataset.conflictPath = conflict.path;
    card.append(el("h3", "", conflict.path), el("p", "", conflict.reason));
    for (const choice of conflict.choices ?? ["keep", "replace"]) {
      const optionLabel = conflictField?.options?.find((option) => option.value === choice)?.label ?? choice;
      const label = el("label", "radio-option");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `conflict-${index}`;
      input.value = choice;
      input.required = true;
      input.checked = conflict.selection === choice;
      label.append(input, document.createTextNode(optionLabel));
      card.append(label);
    }
    elements.preview.append(card);
  }
}

function renderDone(step) {
  const panel = el("div", "success-panel");
  const command = step.result?.firstCommand ?? "/executor <project>";
  panel.append(el("p", "result-label", ui().firstCommand), el("code", "", command));
  return [panel];
}

function continueLabel(step) {
  const c = ui();
  if (step.number === 7) return c.install;
  if (step.number === 1 && step.values.installMode === "simple") return c.install;
  return c.continue;
}

async function render(step) {
  currentStep = step;
  currentPreview = undefined;
  if (["en", "es"].includes(step.language)) language = step.language;
  onDemandNoticeShown = step.onDemandNoticeShown === true;

  document.documentElement.lang = language;
  document.title = ui().documentTitle;
  elements.navigation.setAttribute("aria-label", Array.from({ length: 8 }, (_, index) => progressLabel(index + 1)).join(", "));
  setError();
  elements.fields.replaceChildren();
  elements.preview.replaceChildren();
  elements.preview.hidden = true;
  elements.form.querySelector(".actions").hidden = step.done || step.number === 8;
  renderProgress(step.number ?? 1);
  renderLanguage(step);
  elements.title.textContent = step.title ?? "HIVEM1ND";
  elements.description.textContent = step.description ?? "";
  elements.back.hidden = (step.number ?? 1) <= 1 || step.done;
  elements.back.textContent = ui().back;
  elements.continue.textContent = continueLabel(step);

  if (step.done || step.number === 8) {
    elements.fields.append(...renderDone(step));
  } else if (step.number === 1) {
    elements.fields.append(...renderInstallMode(step));
  } else if (step.number === 2) {
    elements.fields.append(...renderLocation(step));
  } else if (step.number === 3) {
    elements.fields.append(...renderAgents(step));
  } else if (step.number === 4) {
    elements.fields.append(...renderContent(step));
  } else if (step.number === 5) {
    elements.fields.append(...renderProjectsConfirm(step));
  } else if (step.number === 6) {
    elements.fields.append(...renderConfirm(step));
  } else if (step.number === 7) {
    currentPreview = step.preview ?? await api("preview");
    renderInstallPreview(step, currentPreview);
  }

  elements.title.tabIndex = -1;
  elements.title.focus({ preventScroll: true });
}

function collectProjectsConfirmValues() {
  const values = { projectsConfirmed: true };
  for (const input of elements.fields.querySelectorAll("[data-group-index]")) values[`groupEnvironment.${input.dataset.groupIndex}`] = input.value.trim();
  return values;
}

function collectConfirmValues() {
  const values = {
    skipPreferences: document.getElementById("skip-preferences").checked,
    addressStyle: elements.fields.querySelector('input[name="addressStyle"]:checked')?.value ?? currentStep.values.addressStyle,
    customPreference: document.getElementById("custom-preference").value,
    autoUpdates: document.getElementById("auto-updates").checked,
  };
  const keepBox = document.getElementById("keep-existing-preferences");
  if (keepBox) values.keepExistingPreferences = keepBox.checked;
  return values;
}

function collectValues() {
  switch (currentStep.number) {
    case 1:
      return { installMode: document.querySelector('input[name="installMode"]:checked')?.value ?? currentStep.values.installMode };
    case 2:
      return { mindPath: document.getElementById("mind-path").value.trim() };
    case 3:
      if (!currentStep.scanned || !currentStep.agents?.length) return {};
      return {
        agents: [...elements.fields.querySelectorAll(".agent-select input[type=checkbox]")]
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.dataset.agentId),
        attachModes: Object.fromEntries([...elements.fields.querySelectorAll(".attach-modes")]
          .map((group) => [group.dataset.agentId, group.querySelector('[aria-pressed="true"]')?.dataset.agentMode ?? "on-demand"])),
      };
    case 4:
      return { included: [...elements.fields.querySelectorAll("[data-feature]:checked")].map((checkbox) => checkbox.dataset.feature) };
    case 5:
      return collectProjectsConfirmValues();
    case 6:
      return collectConfirmValues();
    default:
      return {};
  }
}

elements.fields.addEventListener("click", (event) => {
  const modeButton = event.target.closest("[data-agent-mode]");
  if (!modeButton) return;
  const group = modeButton.closest(".attach-modes");
  group.querySelectorAll("[data-agent-mode]").forEach((node) => node.setAttribute("aria-pressed", String(node === modeButton)));
  if (modeButton.dataset.agentMode === "on-demand" && !onDemandNoticeShown) {
    onDemandNoticeShown = true;
    showModeDialog(currentStep.onDemandNotice);
  }
});

elements.fields.addEventListener("change", (event) => {
  if (event.target.dataset.category !== undefined) {
    const section = event.target.closest(".feature-category");
    section.querySelectorAll("[data-feature]").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
    return;
  }
  if (event.target.dataset.feature !== undefined) {
    const section = event.target.closest(".feature-category");
    section.querySelector("[data-category]").checked = [...section.querySelectorAll("[data-feature]")].every((checkbox) => checkbox.checked);
  }
});

elements.form.addEventListener("change", (event) => {
  if (event.target.name === "installMode" && currentStep.number === 1) {
    elements.continue.textContent = event.target.value === "simple" ? ui().install : ui().continue;
  }
});

elements.dialogClose.addEventListener("click", () => elements.dialog.close());

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !elements.form.reportValidity()) return;
  setError();
  try {
    if (currentStep.number === 7) {
      setBusy(true, ui().installing);
      const conflicts = Object.fromEntries((currentPreview?.conflicts ?? []).map((conflict) => {
        const card = [...elements.preview.querySelectorAll("[data-conflict-path]")]
          .find((node) => node.dataset.conflictPath === conflict.path);
        return [conflict.path, card?.querySelector("input:checked")?.value];
      }));
      await api("install", { method: "POST", body: { confirm: true, conflicts } });
      await render(await api("step"));
    } else {
      setBusy(true, ui().loading);
      const values = collectValues();
      const wasSimple = currentStep.number === 1 && values.installMode === "simple";
      await api("answer", { method: "POST", body: { values } });
      const next = await api("step");
      if (wasSimple && next.number === 7) {
        const preview = next.preview ?? await api("preview");
        if ((preview.conflicts ?? []).length === 0) {
          await api("install", { method: "POST", body: { confirm: true, conflicts: {} } });
          await render(await api("step"));
        } else {
          await render(next);
        }
      } else {
        await render(next);
      }
    }
  } catch (error) {
    setError(error.message);
  } finally {
    setBusy(false);
    elements.live.textContent = "";
  }
});

elements.back.addEventListener("click", async () => {
  if (busy) return;
  setBusy(true, ui().loading);
  setError();
  try {
    await api("back", { method: "POST", body: {} });
    await render(await api("step"));
  } catch (error) {
    setError(error.message);
  } finally {
    setBusy(false);
    elements.live.textContent = "";
  }
});

async function loadStep() {
  setBusy(true, ui().loading);
  try {
    await render(await api("step"));
  } catch (error) {
    setError(error.message);
  } finally {
    setBusy(false);
    elements.live.textContent = "";
  }
}

await loadStep();
