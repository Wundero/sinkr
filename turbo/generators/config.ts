import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PlopTypes } from "@turbo/gen";

type Export = string | Record<string, string>;

interface PackageJson {
  name: string;
  exports: Record<string, Export>;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("init", {
    description: "Generate a new package for the sinkr Monorepo",
    prompts: [
      {
        type: "input",
        name: "name",
        message:
          "What is the name of the package? (You can skip the `@sinkr/` prefix)",
      },
      {
        type: "input",
        name: "deps",
        message:
          "Enter a space separated list of dependencies you would like to install",
      },
      {
        type: "input",
        name: "devDeps",
        message:
          "Enter a space separated list of devDependencies you would like to install",
      },
    ],
    actions: [
      (answers) => {
        if ("name" in answers && typeof answers.name === "string") {
          if (answers.name.startsWith("@sinkr/")) {
            answers.name = answers.name.replace("@sinkr/", "");
          }
        }
        return "Config sanitized";
      },
      {
        type: "add",
        path: "packages/{{ name }}/eslint.config.js",
        templateFile: "templates/eslint.config.js.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/package.json",
        templateFile: "templates/package.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/tsconfig.json",
        templateFile: "templates/tsconfig.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/src/index.ts",
        template: "export const name = '{{ name }}';",
      },
      {
        type: "modify",
        path: "packages/{{ name }}/package.json",
        async transform(content, answers) {
          if ("deps" in answers && typeof answers.deps === "string") {
            const pkg = JSON.parse(content) as PackageJson;
            for (const dep of answers.deps.split(" ").filter(Boolean)) {
              if (dep.startsWith("@sinkr/")) {
                const packagesParentPath = path.join(
                  __dirname,
                  "../../packages",
                );
                const toolingParentPath = path.join(__dirname, "../../tooling");
                const immediatePackageChildren = fs.readdirSync(
                  packagesParentPath,
                  { withFileTypes: true, recursive: false },
                );
                const immediateToolingChildren = fs.readdirSync(
                  toolingParentPath,
                  { withFileTypes: true, recursive: false },
                );
                const allChildren = [
                  ...immediatePackageChildren,
                  ...immediateToolingChildren,
                ];
                const depName = dep.replace("@sinkr/", "");
                const exists = allChildren.some((child) => {
                  return child.name === depName && child.isDirectory();
                });
                if (!exists) {
                  continue;
                }
                if (!pkg.dependencies) pkg.dependencies = {};
                pkg.dependencies[dep] = `workspace:*`;
                continue;
              }
              try {
                const version = await fetch(
                  `https://registry.npmjs.org/-/package/${dep}/dist-tags`,
                )
                  .then((res) => res.json())
                  .then((json) => json.latest);
                if (!pkg.dependencies) pkg.dependencies = {};
                pkg.dependencies[dep] = `^${version}`;
              } catch (e) {
                // Ignore failed package installs
                continue;
              }
            }
            return JSON.stringify(pkg, null, 2);
          }
          return content;
        },
      },
      {
        type: "modify",
        path: "packages/{{ name }}/package.json",
        async transform(content, answers) {
          if ("devDeps" in answers && typeof answers.devDeps === "string") {
            const pkg = JSON.parse(content) as PackageJson;
            for (const dep of answers.devDeps.split(" ").filter(Boolean)) {
              if (dep.startsWith("@sinkr/")) {
                const packagesParentPath = path.join(
                  __dirname,
                  "../../packages",
                );
                const toolingParentPath = path.join(__dirname, "../../tooling");
                const immediatePackageChildren = fs.readdirSync(
                  packagesParentPath,
                  { withFileTypes: true, recursive: false },
                );
                const immediateToolingChildren = fs.readdirSync(
                  toolingParentPath,
                  { withFileTypes: true, recursive: false },
                );
                const allChildren = [
                  ...immediatePackageChildren,
                  ...immediateToolingChildren,
                ];
                const depName = dep.replace("@sinkr/", "");
                const exists = allChildren.some((child) => {
                  return child.name === depName && child.isDirectory();
                });
                if (!exists) {
                  continue;
                }
                if (!pkg.devDependencies) pkg.devDependencies = {};
                pkg.devDependencies[dep] = `workspace:*`;
                continue;
              }
              try {
                const version = await fetch(
                  `https://registry.npmjs.org/-/package/${dep}/dist-tags`,
                )
                  .then((res) => res.json())
                  .then((json) => json.latest);
                if (!pkg.devDependencies) pkg.devDependencies = {};
                pkg.devDependencies[dep] = `^${version}`;
              } catch (e) {
                // Ignore failed package installs
                continue;
              }
            }
            return JSON.stringify(pkg, null, 2);
          }
          return content;
        },
      },
      async (answers) => {
        /**
         * Install deps and format everything
         */
        if ("name" in answers && typeof answers.name === "string") {
          const cwd = path.join(__dirname, "../..");
          execSync("pnpm i", { stdio: "inherit", cwd });
          execSync(
            `pnpm prettier --write packages/${answers.name}/** --list-different`,
            { cwd },
          );
          return "Package scaffolded";
        }
        return "Package not scaffolded";
      },
    ],
  });
}
