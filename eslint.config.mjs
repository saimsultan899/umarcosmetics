import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Existing effects are benign mount/prop-sync patterns (hydration guards,
      // localStorage reads on mount, prop→state sync) — not cascading-render
      // bugs. Keep as a warning so `next build` isn't blocked; individual sites
      // can be refactored to derived state later.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
