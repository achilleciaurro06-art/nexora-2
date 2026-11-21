import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...coreWebVitals,
  ...typescript,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }] } },
  {
    // Il client service-role è consentito solo ai moduli che ne hanno bisogno.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/supabase/admin.ts",
      "src/modules/auth/**",
      "src/modules/amministrazione/**",
      "src/modules/organizzazioni/**",
      "src/server/ai/**",
      "src/modules/email/**",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/supabase/admin"], message: "Il client service-role è vietato fuori dai moduli autorizzati." }] }],
    },
  },
];
export default config;
