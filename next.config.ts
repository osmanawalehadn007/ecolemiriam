import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const isProd = process.env.NODE_ENV === "production";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Désactiver le cache webpack en dev pour éviter la corruption récurrente
  // du fichier .pack.gz qui provoque des erreurs 500 sur /api/auth/csrf
  // après plusieurs compilations à la volée.
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
        // L'apex doit être listé explicitement : le joker `*.ecolemiriam.com`
        // ne couvre QUE les sous-domaines, jamais le domaine nu.
        "ecolemiriam.com",
        "www.ecolemiriam.com",
        "app.ecolemiriam.com",
        "*.ecolemiriam.com",
        ...(isProd ? [] : ["localhost:3000", "localhost:3001"]),
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
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          // 'unsafe-eval' est requis en développement par Next.js (React
          // Refresh / HMR évalue du code à la volée). En production, il est
          // retiré pour empêcher l'exécution de code arbitraire.
          // 'unsafe-inline' conservé temporairement (Next.js en a besoin pour
          // les styles inline et certains scripts d'hydration). Migration
          // vers des nonces CSP prévue.
          isProd
            ? "script-src 'self' 'unsafe-inline'"
            : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https: blob:",
          "font-src 'self' data:",
          "connect-src 'self' https://ecolemiriam.com https://*.ecolemiriam.com https://api.africastalking.com https://api.sandbox.africastalking.com https://api.resend.com https://graph.facebook.com https://api.telegram.org https://api.stripe.com",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          "frame-src 'none'",
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
