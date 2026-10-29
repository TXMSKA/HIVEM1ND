import path from 'node:path';

export function appPathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function sameAppPath(left, right) {
  return appPathKey(left) === appPathKey(right);
}

export function insideAppPath(root, file) {
  return appPathKey(file).startsWith(`${appPathKey(root)}${path.sep}`);
}
