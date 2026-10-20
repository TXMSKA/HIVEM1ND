import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { PickerUnavailableError, pickerAttempts, pickFolder } from '../gui/folder-picker.mjs';

test('each system opens its own folder dialog without starting PowerShell', () => {
  const [windows] = pickerAttempts('win32', { title: 'Pick', env: { SystemRoot: 'C:/Windows' }, output: 'out.txt' });
  assert.match(windows.file, /cscript\.exe$/);
  assert.deepEqual(windows.args.slice(0, 1).concat(windows.args.slice(2)), ['//nologo', 'Pick', 'out.txt']);
  assert.match(windows.args[1], /folder-picker\.vbs$/);
  const [mac] = pickerAttempts('darwin', { title: 'Pick "one"' });
  assert.equal(mac.file, 'osascript');
  assert.match(mac.args[1], /choose folder with prompt "Pick \\"one\\""/);
  assert.deepEqual(pickerAttempts('linux', { title: 'Pick' }).map((attempt) => attempt.file), ['zenity', 'kdialog']);
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const attempt of pickerAttempts(platform, { title: 'Pick', output: 'out.txt' })) assert.doesNotMatch(attempt.file, /powershell|pwsh/i);
  }
});

test('the Windows script writes the chosen folder to a Unicode file and quits with 1 on cancel', async () => {
  const script = await readFile(new URL('../gui/folder-picker.vbs', import.meta.url), 'utf8');
  assert.match(script, /Shell\.Application/);
  assert.match(script, /BrowseForFolder\(0, WScript\.Arguments\(0\), &H41/);
  assert.match(script, /If folder Is Nothing Then WScript\.Quit 1/);
  assert.match(script, /CreateTextFile\(WScript\.Arguments\(1\), True, True\)/);
});

test('a chosen folder is read back, a cancel is no folder, and a missing program tries the next one', async () => {
  const calls = [];
  const windows = await pickFolder({ title: 'Pick', platform: 'win32', env: { SystemRoot: 'C:/Windows' }, run: async (file, args) => {
    calls.push(file);
    await writeFile(args[3], Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('C:\\Users\\Tomás\\M1ND\\', 'utf16le')]));
    return { code: 0, stdout: '' };
  } });
  assert.equal(windows, 'C:\\Users\\Tomás\\M1ND');
  assert.equal(await pickFolder({ title: 'Pick', platform: 'win32', run: async () => ({ code: 1, stdout: '' }) }), null);
  assert.equal(await pickFolder({ title: 'Pick', platform: 'win32', run: async () => ({ code: 0, stdout: '' }) }), null);
  const tried = [];
  const linux = await pickFolder({ title: 'Pick', platform: 'linux', run: async (file) => {
    tried.push(file);
    if (file === 'zenity') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { code: 0, stdout: '/home/tom/mind\n' };
  } });
  assert.deepEqual(tried, ['zenity', 'kdialog']);
  assert.equal(linux, '/home/tom/mind');
  assert.equal(await pickFolder({ title: 'Pick', platform: 'darwin', run: async () => ({ code: 0, stdout: '/Users/tom/mind/\n' }) }), '/Users/tom/mind');
  await assert.rejects(pickFolder({ title: 'Pick', platform: 'linux', run: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }),
    (error) => error instanceof PickerUnavailableError && error.code === 'browse_unavailable');
});
