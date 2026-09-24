// @ts-check
const nextCoreWebVitals = require("eslint-config-next/core-web-vitals");
const ecolemiriamPlugin = require("./eslint-rules");

const config = [
  // Ignorer les mêmes fichiers que l'ancien .eslintignore
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "public/**",
      "scripts/**",
      "prisma/migrations/**",
      "mobile-app/**",
      "*.config.js",
      "*.config.ts",
      "next-env.d.ts",
      "postcss.config.js",
      "tailwind.config.ts",
      "vitest.config.ts",
      "eslint-rules/**",
    ],
  },
  // eslint-config-next@16 exporte directement un flat config (array)
  ...nextCoreWebVitals,
  // React 19.3 introduit react-hooks/set-state-in-effect (nouvelle règle).
  // 37 occurrences préexistantes dans le code — à corriger progressivement.
  // Désactivée temporairement pour la migration Next 16.
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/static-components": "off",
    },
  },
  // Plugin personnalisé ecolemiriam (règles d'isolation tenant/site/année)
  {
    plugins: { ecolemiriam: ecolemiriamPlugin },
    rules: {
      "ecolemiriam/require-tenant-id": "off",
      "ecolemiriam/require-site-filter": "off",
      "ecolemiriam/require-annee-filter": "off",
    },
  },
  // Activer les règles d'isolation sur les fichiers métier
  {
    files: [
      "src/lib/**/*.{ts,tsx}",
      "src/app/api/**/*.{ts,tsx}",
      "src/app/(dashboard)/**/*.{ts,tsx}",
    ],
    rules: {
      "ecolemiriam/require-tenant-id": "error",
      "ecolemiriam/require-site-filter": "error",
      "ecolemiriam/require-annee-filter": "error",
    },
  },
];

module.exports = config;
