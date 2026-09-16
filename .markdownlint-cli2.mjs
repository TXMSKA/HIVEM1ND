import relativeLinks from "markdownlint-rule-relative-links";

const noEmDash = {
  names: ["no-em-dash"],
  description: "Em dash (U+2014) is not allowed",
  tags: ["style"],
  parser: "none",
  function: (params, onError) => {
    // markdownlint accepts body line numbers only, so front matter hits are reported on the first body line
    params.frontMatterLines.forEach((line, index) => {
      if (line.includes("\u2014")) {
        onError({ lineNumber: 1, detail: `front matter line ${index + 1}` });
      }
    });
    params.lines.forEach((line, index) => {
      for (const match of line.matchAll(/\u2014/g)) {
        onError({ lineNumber: index + 1, range: [match.index + 1, 1] });
      }
    });
  },
};

export default {
  config: {
    default: false,
    "heading-increment": true,
    "no-trailing-spaces": { br_spaces: 0, code_blocks: true },
    "no-em-dash": true,
    "relative-links": true,
  },
  globs: ["**/*.md"],
  ignores: ["node_modules/**", "user/**", "dist/**"],
  customRules: [noEmDash, relativeLinks],
};
