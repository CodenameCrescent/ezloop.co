import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Server code stays on the server: the browser reaches it only through /api.
  {
    files: ["src/components/**", "src/views/**", "src/api/**", "src/lib/api-helpers/**", "src/app/providers.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/api/functions", "@/lib/api/functions/*", "@/app/api/*", "@workspace/db"],
              message: "Server-only. Call the API through @/lib/api-helpers/client instead.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
