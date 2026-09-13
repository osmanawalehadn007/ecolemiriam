# syntax=docker/dockerfile:1.7
# ============================================================
# École Miriam — Dockerfile app (Next.js standalone, non-root, read-only)
# ============================================================
# Build multi-étapes avec cache BuildKit :
#   1. deps    — installe les dépendances (cache npm persistant)
#   2. builder — compile Next.js en mode standalone (cache .next persistant)
#   3. runner  — image finale minimale, non-root, read-only rootfs
#
# Sécurité :
# - Image de base pinée par tag (pas :latest, pas tag flottant)
# - Utilisateur non-root (nextjs:nodejs, UID 1001)
# - Filesystem read-only + tmpfs pour /tmp et /home/nextjs
# - Aucun secret baked dans l'image
# - Healthcheck intégré
# - .dockerignore strict (pas de .env, .git, node_modules dans le contexte)
# - Prisma client copié séparément
#
# Optimisations performance :
# - npm ci (reproductible + plus rapide que npm install)
# - Cache BuildKit pour ~/.npm et .next/cache (persistant entre builds)
# - prisma generate exécuté une seule fois (inclus dans npm run build)
# ============================================================

# --- Étape 1 : dépendances ---
FROM node:24-alpine3.24 AS deps

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copier package.json + lockfile pour cache
COPY package.json package-lock.json ./
COPY prisma ./prisma

# Installer les dépendances (production + dev pour le build)
# npm ci = reproductible + plus rapide que npm install
# --mount=type=cache : cache npm persistant entre builds (BuildKit)
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps

# --- Étape 2 : build ---
FROM node:24-alpine3.24 AS builder

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variables d'environnement de build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# URL factice pour permettre à PrismaClient de se construire pendant next build
# (Prisma ne se connecte pas au build — l'URL réelle est injectée au runtime via env_file)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
# Turnstile site key (publique) — baked-in au build time car NEXT_PUBLIC_*
# Le secret (TURNSTILE_SECRET) est injecté au runtime via .env.production
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY

# Build Next.js standalone — prisma generate est déjà inclus dans "npm run build"
# (package.json: "build": "prisma generate && next build")
# --mount=type=cache : cache .next/cache persistant entre builds (BuildKit)
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# --- Étape 3 : image finale (minimale, non-root, read-only) ---
FROM node:24-alpine3.24 AS runner

# Sécurité : utilisateur non-root dédié
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Sécurité : installer uniquement curl pour le healthcheck + openssl pour Prisma
RUN apk add --no-cache curl openssl tini

WORKDIR /app

# Next.js standalone : ne copier que le strict nécessaire
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Basculer vers l'utilisateur non-root
USER nextjs

# Exposer le port (interne uniquement, jamais publié directement)
EXPOSE 3000

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Healthcheck : vérifie que l'app répond
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# tini comme init (récolte les zombies, signaux propres)
ENTRYPOINT ["/sbin/tini", "--"]

# Démarrer l'app (next start est intégré au standalone)
CMD ["node", "server.js"]
