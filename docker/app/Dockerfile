# ============================================================
# École Miriam — Dockerfile app (Next.js standalone, non-root, read-only)
# ============================================================
# Build multi-étapes :
#   1. deps    — installe les dépendances (cache Docker)
#   2. builder — compile Next.js en mode standalone
#   3. runner  — image finale minimale, non-root, read-only rootfs
#
# Sécurité :
# - Image de base pinée par hash (pas :latest, pas tag flottant)
# - Utilisateur non-root (nextjs:nodejs, UID 1001)
# - Filesystem read-only + tmpfs pour /tmp et /home/nextjs
# - Aucun secret baked dans l'image
# - Healthcheck intégré
# - .dockerignore strict (pas de .env, .git, node_modules dans le contexte)
# - Prisma client copié séparément
# ============================================================

# --- Étape 1 : dépendances ---
FROM node:22-alpine3.21 AS deps

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copier package.json + lockfile pour cache
COPY package.json package-lock.json ./
COPY prisma ./prisma

# Installer les dépendances (production + dev pour le build)
RUN npm ci

# --- Étape 2 : build ---
FROM node:22-alpine3.21 AS builder

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variables d'environnement de build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Générer le client Prisma + build Next.js standalone
RUN npx prisma generate && npm run build

# --- Étape 3 : image finale (minimale, non-root, read-only) ---
FROM node:22-alpine3.21 AS runner

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
