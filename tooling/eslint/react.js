import a11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import compilerPlugin from "eslint-plugin-react-compiler";
import hooksPlugin from "eslint-plugin-react-hooks";

/** @type {Awaited<import('typescript-eslint').Config>} */
export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      react: reactPlugin,
      "react-hooks": hooksPlugin,
      "react-compiler": compilerPlugin,
      "jsx-a11y": a11yPlugin,
    },
    rules: {
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...hooksPlugin.configs.recommended.rules,
      ...a11yPlugin.flatConfigs.recommended.rules,
      "react-compiler/react-compiler": "error",
    },
    languageOptions: {
      globals: {
        React: "writable",
      },
    },
  },
];
