import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    pool: "threads", // Évite le crash undici/jsdom sur Node 22+ (markAsUncloneable)
    // Fiabilité en CI : le moteur de requêtes Prisma peut s'arrêter brutalement
    // (« fatal runtime error: failed to initiate panic », core dumped) quand
    // trop de workers l'instancient en parallèle sur un runner 2 vCPU, et les
    // tests les plus lourds (facture/paiement, bcrypt) dépassent le délai par
    // défaut de 5 s sur un runner chargé. C'est ce qui a fait échouer le CI Gate
    // de la promotion du 28/09/2026 alors que le même commit passait quelques
    // minutes plus tôt (relance : succès, aucune modification de code).
    // On borne donc le parallélisme, on élargit le délai et on retente en CI ;
    // en local, on veut voir la flakiness telle quelle.
    // `fileParallelism: false` : les fichiers de test s'exécutent UN PAR UN. Le
    // crash observé (28/09/2026, 4 fois dans la journée) vient de plusieurs
    // workers instanciant le moteur en même temps ; un processus qui s'abandonne
    // échappe aux `retries` de vitest, d'où la sérialisation — le job retente en
    // plus l'étape entière (cf. ci.yml et deploy-gcp.yml).
    ...(process.env.CI
      ? { retries: 2, maxWorkers: 2, testTimeout: 15_000, fileParallelism: false }
      : {}),
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"],
      include: [
        "src/lib/actions/facture.ts",
        "src/app/api/rh/absences/route.ts",
        "src/app/api/rh/absences/[id]/route.ts",
        "src/app/api/rh/conges/route.ts",
        "src/app/api/rh/conges/[id]/route.ts",
        "src/components/rh/PersonnelAbsencesConges.tsx",
        "src/components/facturation/FactureDetail.tsx",
        "src/components/facturation/FacturesTable.tsx",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
