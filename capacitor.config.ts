import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Configuration Capacitor — École Miriam Mobile
 * ============================================================
 * L'application École Miriam est full-stack (server components + API + auth),
 * elle ne peut pas être exportée en statique. La coque native charge donc
 * l'application HÉBERGÉE via `server.url` et y ajoute les capacités natives
 * (notifications push, caméra, biométrie, statut réseau).
 *
 * Définir l'URL de production via la variable d'environnement CAP_SERVER_URL
 * avant `npx cap sync` :
 *   CAP_SERVER_URL=https://ecolemiriam.com npx cap sync
 */
// Défaut aligné sur le domaine canonique. L'ancienne valeur pointait vers
// `app.ecolemiriam.app` — un TLD `.app` qui n'a jamais été servi : la coque
// mobile buildée sans CAP_SERVER_URL chargeait donc un hôte inexistant.
const SERVER_URL = process.env.CAP_SERVER_URL ?? "https://ecolemiriam.com";

const config: CapacitorConfig = {
  appId: "app.ecolemiriam.mobile",
  appName: "École Miriam",
  // Dossier web de repli (page hors-ligne) embarqué dans le binaire.
  webDir: "mobile/www",
  server: {
    url: SERVER_URL,
    androidScheme: "https",
    // En prod, jamais de cleartext : on force HTTPS.
    cleartext: false,
    // Domaines autorisés à rester dans la webview (sinon ouverts dans le navigateur système).
    allowNavigation: [
      "*.ecolemiriam.app",
      "ecolemiriam.app",
    ],
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#ffffff",
  },
  android: {
    backgroundColor: "#ffffff",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#4f46e5",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
