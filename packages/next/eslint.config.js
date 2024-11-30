import baseConfig from "@sinkr/eslint-config/base";
import nextConfig from "@sinkr/eslint-config/next";
import reactConfig from "@sinkr/eslint-config/react";

/** @type {import('typescript-eslint').Config} */
export default [
  {
    ignores: ["dist/**"],
  },
  ...baseConfig,
  ...reactConfig,
  ...nextConfig,
];
