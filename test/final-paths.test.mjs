import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMind, localCosmic, MIND_DIRECTORY_NAME } from '../engine/service/paths.mjs';

test('the default M1ND shares the Cosmic root on Windows and Linux', () => {
  assert.equal(MIND_DIRECTORY_NAME, '.m1nd');
  const win = { platform: 'win32', env: { LOCALAPPDATA: 'C:\\fixture\\local' }, home: 'C:\\fixture\\home' };
  assert.equal(localCosmic(win), 'C:\\fixture\\local\\Cosmic');
  assert.equal(defaultMind(win), 'C:\\fixture\\local\\Cosmic\\.m1nd');
  assert.equal(defaultMind({ platform: 'win32', env: {}, home: 'C:\\fixture\\home' }), 'C:\\fixture\\home\\AppData\\Local\\Cosmic\\.m1nd');
  const linux = { platform: 'linux', env: { XDG_DATA_HOME: '/fixture/override' }, home: '/fixture/home' };
  assert.equal(localCosmic(linux), '/fixture/home/.local/share/Cosmic');
  assert.equal(defaultMind(linux), '/fixture/home/.local/share/Cosmic/.m1nd');
});
