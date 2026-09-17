import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const require = createRequire(import.meta.url);

// eslint-config-next ships `settings.react.version = "detect"`, which makes
// eslint-plugin-react auto-detect React by calling `context.getFilename()` —
// removed in ESLint 10, so linting aborts before any rule runs. Reading the
// installed version ourselves gives the same result without entering that code
// path, and keeps every react/* rule on. Delete once eslint-plugin-react ships
// an ESLint-10-compatible release (see eslint-plugin-react#4022).
const reactVersion = require("react/package.json").version;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { name: "sundaystage-web/react-version", settings: { react: { version: reactVersion } } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated deploy artifacts — never lint these.
    ".open-next/**",
    ".wrangler/**",
    // Hand-rolled service worker (service-worker globals, not an app module).
    "public/sw.js",
  ]),
]);

export default eslintConfig;
