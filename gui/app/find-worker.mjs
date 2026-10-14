import { findTextMatches } from "./void.mjs";

self.onmessage = ({ data: { id, text, query, options } }) => {
  try {
    const matches = findTextMatches(text, query, options).map((match) => ({ ...match,
      captures: match.captures.map((capture) => capture ?? '') }));
    self.postMessage({ id, matches });
  } catch (error) {
    self.postMessage({ id, error: { code: error instanceof RangeError ? 'too_many_matches' : 'invalid_pattern', message: error.message } });
  }
};
