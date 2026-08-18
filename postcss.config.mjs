/**
 * Tailwind CSS v4 usa configuracao CSS-first (diretiva @theme dentro do
 * proprio CSS, sem tailwind.config.js). Este arquivo so registra o plugin
 * do PostCSS. NAO validado por build real neste ambiente (sem internet) -
 * ver docs/DECISIONS.md e a lista de itens nao validados.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
