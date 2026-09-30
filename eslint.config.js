import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/** APIs whose results differ between JS engines or over time: banned inside the deterministic sim. */
const NON_DETERMINISTIC = [
  "random",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "pow",
  "exp",
  "log",
  "log2",
  "log10",
  "cbrt",
  "hypot",
  "sinh",
  "cosh",
  "tanh",
  "expm1",
  "log1p",
].map((property) => ({
  object: "Math",
  property,
  message: "Non-deterministic across engines: use packages/shared/src/sim/fixed-math.ts.",
}));

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/.friendsdk/**", "vendor/**", "docs/**", "**/*.generated.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["packages/shared/src/sim/**/*.ts", "packages/shared/src/venues/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-properties": ["error", ...NON_DETERMINISTIC],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "The sim has no wall clock: use ticks." },
        { name: "performance", message: "The sim has no wall clock: use ticks." },
      ],
    },
  },
);
