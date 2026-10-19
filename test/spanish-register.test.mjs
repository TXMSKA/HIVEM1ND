import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { helpText, runCli } from '../cli/index.mjs';
import { text } from '../engine/texts.mjs';
import { DICTIONARIES } from '../gui/app/i18n.mjs';

const ROOT = new URL('../', import.meta.url);

// The one list of forms of address that Spanish copy must not contain. Spanish text a person reads is neutral and
// impersonal: infinitives for actions, `se` or the third person for descriptions. A form is listed only when it is
// second person in every use. `usa`, `abre`, `elige` and `ingresa` stay out because the third person
// ("Usa la configuración detectada") is correct and reads the same as the tuteo imperative.
const FORBIDDEN = {
  pronouns: [
    'vos', 'tú', 'tu', 'tus', 'ti', 'te', 'contigo',
    'vosotros', 'vosotras', 'vuestro', 'vuestra', 'vuestros', 'vuestras',
  ],
  voseoImperative: [
    'usá', 'ingresá', 'separá', 'actualizá', 'ejecutá', 'seleccioná', 'confirmá', 'cancelá', 'instalá', 'reiniciá',
    'revisá', 'verificá', 'agregá', 'quitá', 'eliminá', 'borrá', 'creá', 'completá', 'continuá', 'guardá', 'cargá',
    'buscá', 'esperá', 'aceptá', 'probá', 'mirá', 'pasá', 'sacá', 'dejá', 'copiá', 'pegá', 'cerrá', 'reemplazá',
    'conservá', 'configurá', 'conectá', 'activá', 'desactivá', 'indicá', 'especificá', 'descargá', 'intentá',
    'cambiá', 'renombrá', 'tomá', 'pensá', 'asegurate', 'fijate', 'acordate', 'quedate', 'andate', 'ponete',
    'hacé', 'traé', 'volvé', 'poné', 'tené', 'leé', 'resolvé', 'respondé', 'corré', 'conocé',
    'elegí', 'escribí', 'abrí', 'decí', 'vení', 'salí', 'omití', 'definí', 'compartí', 'corregí', 'seguí', 'permití',
  ],
  voseoPresent: [
    'podés', 'tenés', 'querés', 'sabés', 'hacés', 'decís', 'venís', 'sos', 'elegís', 'ingresás', 'usás', 'abrís',
    'escribís', 'necesitás', 'preferís', 'ponés', 'tocás', 'hablás',
  ],
  tuteoPresent: [
    'puedes', 'tienes', 'quieres', 'sabes', 'haces', 'debes', 'necesitas', 'prefieres', 'eres', 'estás', 'vienes',
    'dices', 'pones', 'vas', 'ves',
    'eliges', 'ingresas', 'usas', 'abres', 'escribes', 'ejecutas', 'seleccionas', 'confirmas', 'cancelas',
    'instalas', 'reinicias', 'revisas', 'verificas', 'agregas', 'quitas', 'eliminas', 'borras', 'creas', 'buscas',
    'aceptas', 'miras', 'dejas', 'cierras', 'reemplazas', 'configuras', 'conectas', 'indicas', 'especificas',
    'intentas', 'cruzas', 'cambias', 'encuentras',
  ],
  tuteoSubjunctiveAndImperative: [
    'puedas', 'tengas', 'quieras', 'sepas', 'hagas', 'uses', 'elijas', 'ingreses', 'ejecutes', 'borres', 'cierres',
    'enciendas', 'abras', 'escribas', 'confirmes', 'dejes', 'olvides', 'necesites',
    'haz', 'ten', 'pon', 'fíjate', 'asegúrate', 'acuérdate', 'quédate', 'ponte', 'vete', 'siéntate',
  ],
  regional: ['acá'],
};

const KIND_BY_WORD = new Map(
  Object.entries(FORBIDDEN).flatMap(([kind, words]) => words.map((word) => [word, kind])),
);
const FORMS = new RegExp(`(?<![\\p{L}\\p{N}_])(${[...KIND_BY_WORD.keys()].join('|')})(?![\\p{L}\\p{N}_])`, 'giu');

function forbiddenForms(value) {
  return [...value.matchAll(FORMS)].map((match) => match[1]);
}

// Only product templates enter this check. Mounted callers remove record data by
// element identity; no replacement is applied to a document, command or path.
export function assertVisibleCopy(language, entries) {
  const failures = [];
  for (const [where, value] of entries) {
    const productWords = [...String(value).matchAll(/(?<![\p{L}\p{N}_./\\-])(mind|mente)(?![\p{L}\p{N}_./\\-])/giu)];
    for (const match of productWords) failures.push(`${where}: forbidden product word "${match[1]}"`);
    if (language === 'es') {
      for (const word of forbiddenForms(String(value))) failures.push(`${where}: "${word}" (${KIND_BY_WORD.get(word.toLowerCase())})`);
    }
  }
  assert.equal(failures.length, 0, `Visible ${language} copy:\n${failures.join('\n')}`);
}

const read = async (file) => (await readFile(new URL(file, ROOT), 'utf8')).replaceAll('\r\n', '\n');
const literals = (source) => [...source.matchAll(/"(?:[^"\\\n]|\\.)*"/g)].map((match) => JSON.parse(match[0]));
const plain = (value) => value.replace(/<\/?[a-z][^>]*>/gi, '');

async function installerCopy() {
  const source = await read('engine/texts.mjs');
  const block = source.match(/\n  es: \{\n([\s\S]*?)\n  \},\n\};/)?.[1] ?? '';
  const keys = [...block.matchAll(/^    (\w+): /gm)].map((match) => match[1]);
  const englishBlock = source.match(/\n  en: \{\n([\s\S]*?)\n  \},\n  es: \{/)?.[1] ?? '';
  const englishKeys = [...englishBlock.matchAll(/^    (\w+): /gm)].map((match) => match[1]);
  assert.deepEqual(keys, englishKeys, 'engine/texts.mjs: the es and en blocks must hold the same keys');
  return keys.map((key) => [`engine/texts.mjs es.${key}`, text('es', key)]);
}

async function terminalCopy() {
  const source = await read('cli/index.mjs');
  const block = source.match(/const terminalCopy = \{[\s\S]*?\n  es: \{\n([\s\S]*?)\n  \},\n\};/)?.[1] ?? '';
  const entries = [...block.matchAll(/^    (\w+): ("(?:[^"\\\n]|\\.)*"),$/gm)].map(
    (match) => [`cli/index.mjs terminalCopy.es.${match[1]}`, JSON.parse(match[2])],
  );
  const inline = [...source.matchAll(/language === "es" \? (\{[^}]*\}|"(?:[^"\\\n]|\\.)*")/g)].flatMap(
    (match, index) => literals(match[1]).map((value) => [`cli/index.mjs inline Spanish ${index + 1}`, value]),
  );
  return [...entries, ...inline];
}

async function copyTable(file, name) {
  const source = await read(file);
  const block = source.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`))?.[1];
  assert.ok(block, `${file}: ${name} was not extracted`);
  return runInNewContext(`(${block})`, Object.create(null), { timeout: 1000 });
}

async function guiSourceCopy(language) {
  const opening = await copyTable('gui/app/main.mjs', 'OPENING_COPY');
  return [
    ...Object.entries(DICTIONARIES[language]).map(([key, value]) => [`gui/app/i18n.mjs COPY.${language}.${key}`, value]),
    ...Object.entries(opening).map(([key, values]) => [`gui/app/main.mjs OPENING_COPY.${language}.${key}`, values[language === 'es' ? 1 : 0]]),
  ];
}

async function safeCoreCopy() {
  const entries = [];
  for (const file of ['engine/service/identity.mjs', 'engine/service/paths.mjs', 'engine/service/projection.mjs', 'engine/service/service.mjs', 'engine/service/http.mjs']) {
    const source = await read(file);
    const errors = [...source.matchAll(/new CoreError\([^,\n]+,\s*'([^']+)',\s*(['"`])((?:\\.|(?!\2)[^\\])*?)\2/g)];
    assert.ok(errors.length > 5, `${file}: safe error messages were not extracted`);
    for (const match of errors) {
      const line = source.slice(0, match.index).split('\n').length;
      entries.push([`${file}:${line} ${match[1]}`, match[3].replace(/\$\{[^}]*\}/g, '')]);
    }
  }
  return entries;
}

async function htmlFiles(directory) {
  const names = await readdir(new URL(directory, ROOT), { recursive: true });
  return names.filter((name) => name.endsWith('.html')).map((name) => `${directory}${name.replaceAll('\\', '/')}`);
}

async function htmlCopy() {
  const copy = [];
  for (const file of [...await htmlFiles('features/'), ...await htmlFiles('gui/')]) {
    const pages = (await read(file)).match(/^const PAGES=(\[.*\]);$/m)?.[1];
    if (!pages) continue;
    for (const page of JSON.parse(pages)) copy.push([`${file} ${page.k}.es`, plain(page.es)]);
  }
  return copy;
}

async function voidDocumentCopy() {
  const source = await read('features/void/void.md');
  return [...source.matchAll(/"es": ("(?:[^"\\\n]|\\.)*")/g)].map(
    (match) => ['features/void/void.md sample es', plain(JSON.parse(match[1]))],
  );
}

async function boardCopy() {
  const source = await read('docs/flows/archive/boards/void.mjs');
  const lantern = source.match(/\n  es: \{\n([\s\S]*?)\n  \},\n\};/)?.[1] ?? '';
  const table = [...source.matchAll(/^\s+\["ui\.[\w.]+", "[^"]*", ("(?:[^"\\\n]|\\.)*")\],$/gm)].map((match) => JSON.parse(match[1]));
  return [...literals(lantern), ...table].map((value, index) => [`docs/flows/archive/boards/void.mjs Spanish ${index + 1}`, value]);
}

async function genesisCopy() {
  const source = await read('roles/genesis.md');
  return [...source.matchAll(/" \/ "([^"]+)"/g)].map((match) => [`roles/genesis.md "${match[1].slice(0, 30)}"`, match[1]]);
}

test('the register check tells second person from third person', () => {
  for (const value of [
    'Ingresá un número entero.',
    'separá las rutas con ;',
    'Corré npm install en el kit y actualizá de nuevo.',
    'Si lo cruzas despacio. Cada uno que enciendas.',
    'Vos podés elegir. Tu carpeta, tus archivos.',
    'Fijate acá.',
  ]) {
    assert.ok(forbiddenForms(value).length > 0, `not detected: ${value}`);
  }
  assert.deepEqual(forbiddenForms('Ingresá un número entero. Corré npm install.'), ['Ingresá', 'Corré']);
  assert.deepEqual(forbiddenForms('TÚ puedes, y tienes tu carpeta.'), ['TÚ', 'puedes', 'tienes', 'tu']);
  for (const value of [
    'Ingresar un número entero.',
    'Usa la configuración detectada, acepta cada opción e instala de inmediato.',
    'Abre cada ajuste de instalación antes de escribir archivos.',
    'Quitar el enlace conserva la carpeta a la que apunta.',
    'Estilo de trato. El té y la cantidad de tutores. Atención, actualización, estadística.',
    'Elegir una acción. Volver a intentarlo. Se omitió un symlink en el kit: {path}',
  ]) {
    assert.deepEqual(forbiddenForms(value), [], value);
  }
});

test('every Spanish source is read and holds no voseo and no tuteo', async () => {
  const sources = {
    'the installer texts': [await installerCopy(), 100],
    'the terminal setup': [await terminalCopy(), 25],
    'the GUI source templates': [await guiSourceCopy('es'), 400],
    'the Void pages': [await htmlCopy(), 4],
    'the Void document sample': [await voidDocumentCopy(), 1],
    'the Void board sample': [await boardCopy(), 8],
    'the Genesis role': [await genesisCopy(), 8],
  };
  const failures = [];
  for (const [name, [copy, minimum]] of Object.entries(sources)) {
    assert.ok(copy.length >= minimum, `${name}: found ${copy.length} Spanish texts, expected at least ${minimum}`);
    for (const [where, value] of copy) {
      for (const word of forbiddenForms(value)) failures.push(`${where}: "${word}" (${KIND_BY_WORD.get(word.toLowerCase())}) in "${value}"`);
    }
  }
  assert.equal(failures.length, 0, `Spanish copy must be neutral and impersonal, with no voseo and no tuteo:\n${failures.join('\n')}`);
});

test('the finite product inventory uses M1ND before interpolation in both languages', async () => {
  for (const language of ['en', 'es']) {
    assertVisibleCopy(language, await guiSourceCopy(language));
    const setup = await copyTable('engine/setup.mjs', 'SETUP_COPY');
    assertVisibleCopy(language, Object.entries(setup[language]).map(([key, value]) => [`engine/setup.mjs SETUP_COPY.${language}.${key}`, value]));
    const terminal = await copyTable('cli/index.mjs', 'terminalCopy');
    assertVisibleCopy(language, Object.entries(terminal[language]).map(([key, value]) => [`cli/index.mjs terminalCopy.${language}.${key}`, value]));
  }
  assertVisibleCopy('en', await safeCoreCopy());
  const help = helpText();
  assertVisibleCopy('en', help.split('\n').map((line, index) => [`cli/index.mjs helpText line ${index + 1}`, line]));
  for (const spelling of ['--mind-path', '--remove-mind']) assert.ok(help.includes(spelling), spelling);
  assert.ok(help.includes('The M1ND folder .m1nd'));

  let output = '';
  const location = 'C:/fixtures/mind/mente';
  const result = { action: 'status', machine: 'FIXTURE', machineRecord: false, mind: { count: 1, largest: { path: location, bytes: 42 } } };
  assert.equal(await runCli(['check', '--mind-path', location], {
    env: {}, stdout: { write(value) { output += value; } }, stderr: { write() { assert.fail('CLI copy fixture failed'); } },
    lifecycle: { async check(options) { assert.ok(options.mindPath.endsWith('mind\\mente') || options.mindPath.endsWith('mind/mente')); return result; } },
  }), 0);
  assert.ok(output.includes(location));
  assert.ok(output.includes('M1ND: 1 item'));
  assertVisibleCopy('en', [['cli/index.mjs check findings', output.replace(location, '')]]);
});

test('copy failures identify the element or key without reporting record values', () => {
  assert.throws(() => assertVisibleCopy('en', [['COPY.en.example', 'The mind is unavailable.']]), /COPY.en.example: forbidden product word "mind"/);
  assert.throws(() => assertVisibleCopy('es', [['button[data-action=retry]', 'Revisá tu carpeta.']]), /button\[data-action=retry\]: "Revisá"/);
  assertVisibleCopy('es', [['COPY.es.example', 'Revisar la carpeta del M1ND.']]);
});
