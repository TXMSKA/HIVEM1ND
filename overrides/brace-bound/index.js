'use strict';

const MAX_LENGTH = 1024;
const MAX_DEPTH = 8;
const MAX_PARTS = 64;

function braces(input, options = {}) {
  const patterns = Array.isArray(input) ? input : [input];
  const output = [];
  for (const pattern of patterns) {
    const text = String(pattern ?? '');
    if (options.expand === true) output.push(...expand(text));
    else output.push(text);
  }
  return options.nodupes === true ? [...new Set(output)] : output;
}

function expand(text) {
  if (text.length > MAX_LENGTH || depth(text) > MAX_DEPTH) return [text];
  let current = [text];
  for (let pass = 0; pass < MAX_DEPTH; pass += 1) {
    let grew = false;
    const next = [];
    for (const pattern of current) {
      const parts = splitTop(pattern);
      if (!parts) {
        next.push(pattern);
        continue;
      }
      grew = true;
      for (const part of parts) {
        next.push(part);
        if (next.length > MAX_PARTS) return [text];
      }
    }
    current = next;
    if (!grew) break;
  }
  return current;
}

function depth(text) {
  let current = 0;
  let max = 0;
  for (const char of text) {
    if (char === '{') max = Math.max(max, ++current);
    else if (char === '}') current = Math.max(0, current - 1);
  }
  return max;
}

function splitTop(text) {
  const open = text.indexOf('{');
  if (open < 0) return null;
  let nested = 0;
  let close = -1;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') nested += 1;
    else if (text[index] === '}') {
      nested -= 1;
      if (nested === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) return null;
  const body = text.slice(open + 1, close);
  if (body.includes('{') || body.includes('}')) return null;
  const choices = body.split(',');
  if (choices.length < 2) return null;
  const prefix = text.slice(0, open);
  const suffix = text.slice(close + 1);
  return choices.map((choice) => `${prefix}${choice}${suffix}`);
}

module.exports = braces;
