import { FlatCompat } from "@eslint/eslintrc";

// Padrao documentado pelo Next.js para flat config do ESLint 9.
// NAO validado rodando `npm run lint` neste ambiente (sem internet
// para instalar eslint-config-next e resolver os plugins) -
// ver docs/DECISIONS.md.
const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [...compat.extends("next/core-web-vitals", "next/typescript")];

export default eslintConfig;
