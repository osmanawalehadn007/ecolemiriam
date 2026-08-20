# ============================================================
# École Miriam — Image Caddy custom (xcaddy + rate limit plugin)
# ============================================================
# Caddy compilé avec le plugin rate-limit via xcaddy.
# Rate limiting au niveau du reverse proxy (avant l'app).
# ============================================================

FROM caddy:2.9.1-builder-alpine AS builder

# Compiler Caddy avec le plugin rate-limit
RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:2.9.1-alpine

# Copier le binaire Caddy custom
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
