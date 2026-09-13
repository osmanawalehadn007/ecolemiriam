// @ts-check
const { FlatCompat } = require("@eslint/eslintrc");
const path = require("path");
const ecolemiriamPlugin = require("./eslint-rules");

const compat = new FlatCompat({
  baseDir: path.resolve(__dirname),
});

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
  // Charger next/core-web-vitals via la couche de compatibilité
  ...compat.extends("next/core-web-vitals"),
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
