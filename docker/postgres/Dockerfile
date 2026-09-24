# ============================================================
# École Miriam — Image PostgreSQL 17 custom (pgaudit + pgBackRest)
# ============================================================
# Image basée sur postgres:17-alpine avec :
# - pgaudit (audit des accès aux données sensibles)
# - pgBackRest (PITR, sauvegardes incrémentales)
# - pg_stat_statements (monitoring des requêtes)
# - Configuration durcie (scram-sha-256, TLS, RLS)
# ============================================================

FROM postgres:17-bookworm

# Installer pgaudit + pgBackRest depuis les dépôts Debian
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-17-pgaudit \
    pgbackrest \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copier la configuration durcie
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY pg_hba.conf /etc/postgresql/pg_hba.conf

# Les scripts init sont dans init/ (monté via volume)
# Pas besoin de les copier ici — docker-compose les monte

# Healthcheck amélioré : vérifie que Postgres accepte les connexions
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" || exit 1
