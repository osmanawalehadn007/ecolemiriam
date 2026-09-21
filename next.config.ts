import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const isProd = process.env.NODE_ENV === "production";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Autorise 127.0.0.1 en dev pour le browser preview (Devin Desktop) qui
  // proxifie via 127.0.0.1 au lieu de localhost. Sans cela, Next.js bloque
  // les requêtes cross-origin HMR et Auth.js rejette le CSRF token.
  ...(isProd ? {} : {
    allowedDevOrigins: ["127.0.0.1", "localhost"],
  }),
  // Next.js 16 : `eslint.ignoreDuringBuilds` supprimé, `next lint` supprimé.
  // Le linting se fait via `eslint src/` (ESLint 9 flat config) en CI.
  // Désactiver le cache webpack en dev pour éviter la corruption récurrente
  // du fichier .pack.gz qui provoque des erreurs 500 sur /api/auth/csrf
  // après plusieurs compilations à la volée.
  // Next.js 16 utilise Turbopack par défaut — cette config webpack ne s'applique
  // qu'avec `next dev --webpack` / `next build --webpack` (opt-out Turbopack).
  ...(isProd ? {} : {
    webpack: (config: any) => {
      config.cache = false;
      return config;
    },
  }),
  experimental: {
    serverActions: {
      // VPS uniquement : plus de netlify.app / vercel.app / pages.dev.
      // Une origine autorisée en trop est une surface CSRF ouverte.
      allowedOrigins: [
        // L'apex est le seul domaine de production servi : `app.` et `www.`
        // ne renvoient qu'un 301 (voir docker/caddy/Caddyfile). Les lister —
        // a fortiori via le joker `*.ecolemiriam.com`, qui couvrait aussi
        // `status.` — n'autorisait que des origines dont aucune requête
        // légitime ne part, au prix d'une surface CSRF élargie.
        "ecolemiriam.com",
        ...(isProd ? [] : ["localhost:3000", "localhost:3001", "127.0.0.1:3000", "127.0.0.1:59371"]),
      ],
    },
  },
  images: {
    remotePatterns: [
      // Idem : `**.ecolemiriam.com` ne matche pas le domaine nu.
      { protocol: "https", hostname: "ecolemiriam.com" },
      { protocol: "https", hostname: "**.ecolemiriam.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      ...(isProd
        ? [
            {
              key: "Strict-Transport-Security",
              value: "max-age=31536000; includeSubDomains; preload",
            },
          ]
        : []),
      // CSP : désormais générée dynamiquement par requête dans le middleware
      // (src/lib/security/headers.ts → buildCSP) avec un nonce remplaçant
      // 'unsafe-inline' dans script-src. La CSP statique ci-dessous ne couvre
      // que les chemins exclusés du middleware (assets statiques) et n'a pas
      // de nonce — elle garde 'unsafe-inline' pour ne pas casser les chunks
      // Next.js servis directement.
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          isProd
            ? "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com"
            : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https: blob:",
          "font-src 'self' data:",
          "connect-src 'self' https://challenges.cloudflare.com https://ecolemiriam.com https://*.ecolemiriam.com https://api.africastalking.com https://api.sandbox.africastalking.com https://api.resend.com https://graph.facebook.com https://api.telegram.org https://api.stripe.com",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          "frame-src 'self' https://challenges.cloudflare.com",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
          ...(isProd ? ["upgrade-insecure-requests", "block-all-mixed-content"] : []),
        ].join("; "),
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
      },
    ];

    return [
      // --- En-têtes de sécurité globaux ---
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // --- CORS pour API mobile : restreindre aux domaines connus ---
      // L'API mobile utilise Bearer JWT (pas de cookies), donc CORS n'est
      // pas une surface CSRF. Mais on évite quand même * pour réduire
      // l'exposition.
      {
        source: "/api/mobile/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: isProd ? "https://ecolemiriam.com" : "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
      {
        source: "/api/auth/mobile",
        headers: [
          { key: "Access-Control-Allow-Origin", value: isProd ? "https://ecolemiriam.com" : "*" },
          { key: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
      // --- Stripe webhook : autoriser la signature Stripe ---
      {
        source: "/api/stripe/webhook",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://*.stripe.com" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, stripe-signature" },
          { key: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
