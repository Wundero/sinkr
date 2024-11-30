import baseConfig from "@sinkr/eslint-config/base";

/** @type {import('typescript-eslint').Config} */
export default [
  {
    ignores: [".wrangler/**"],
  },
  ...baseConfig,
];
