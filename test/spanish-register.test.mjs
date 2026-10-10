import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { text } from '../engine/texts.mjs';

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
  const source = await read('docs/flows/boards/void.mjs');
  const lantern = source.match(/\n  es: \{\n([\s\S]*?)\n  \},\n\};/)?.[1] ?? '';
  const table = [...source.matchAll(/^\s+\["ui\.[\w.]+", "[^"]*", ("(?:[^"\\\n]|\\.)*")\],$/gm)].map((match) => JSON.parse(match[1]));
  return [...literals(lantern), ...table].map((value, index) => [`docs/flows/boards/void.mjs Spanish ${index + 1}`, value]);
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
