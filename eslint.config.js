import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Patterns are recursive (**/) because the agent worktrees under .claude/ are
  // nested INSIDE the repo: the root-anchored "dist/**" did not match
  // .claude/worktrees/*/dist/, so eslint was linting a minified production
  // bundle and reporting ~1900 phantom errors from it.
  {
    ignores: [
      ".claude/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/web/public/sw.js",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  // Build-time scripts and config are plain Node modules run outside the app:
  // `process` and friends are theirs by right, and printing is the point.
  {
    files: ["scripts/**/*.{js,mjs}", "*.config.{js,ts,mjs}"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly" },
    },
    rules: { "no-console": "off" },
  },
);
