import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";

const config = [
  ...next,
  ...ts,
  { files: ["src/features/youtrack/flow-engine/**/*.js"], rules: { "no-undef": "error" } },
  {
    ignores: [".next/**", "out/**", "next-env.d.ts", "src/shared/lib/api.generated.d.ts",
      "playwright-report/**", "test-results/**", "public/uiflow.js"],
  },
];
export default config;
