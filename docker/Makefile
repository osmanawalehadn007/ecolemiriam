# ============================================================
# École Miriam — Makefile (point d'entrée unique des opérations)
# ============================================================
#
# Usage :
#   make setup          — Durcir l'OS + installer Docker
#   make secrets        — Générer les secrets (SOPS + age)
#   make secrets-edit   — Éditer les secrets chiffrés
#   make secrets-rotate — Roter tous les secrets
#   make build          — Builder toutes les images (local, fallback)
#   make up             — Démarrer la stack complète
#   make down           — Arrêter la stack
#   make restart        — Redémarrer la stack
#
# --- Blue-Green Deployment ---
#   make deploy         — Déploiement blue-green complet (staging + promotion)
#   make staging        — Déployer en staging seulement (slot inactif + smoke tests)
#   make promote        — Promouvoir le staging en production (bascule Caddy)
#   make rollback       — Revenir au slot précédent (rollback instantané)
#   make status         — Voir quel slot est actif (blue/green)
#   make smoke          — Exécuter les smoke tests sur le slot actif
#   make deploy-build   — Build local + déployer (fallback lent, sans GHCR)
#
# --- Backup & Security ---
#   make backup         — Backup manuel pgBackRest
#   make restore-test   — Test de restauration + Telegram
#   make audit          — Audit sécurité scoré
#   make migrate        — Migrer depuis Supabase
#
# --- Operations ---
#   make logs           — Voir les logs de l'app active
#   make logs-staging   — Voir les logs de l'app staging
#   make logs-db        — Voir les logs de Postgres
#   make ps             — Lister les conteneurs
#   make health         — Vérifier la santé de l'app active
#   make shell          — Shell dans le conteneur app actif
#   make shell-db       — Shell psql dans Postgres
#   make clean          — Nettoyer images et volumes orphelins
# ============================================================

DOCKER_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
PROJECT_DIR := $(abspath $(DOCKER_DIR)/..)
COMPOSE := docker compose -f $(DOCKER_DIR)/docker-compose.yml
ACTIVE_COLOR := $(shell cat $(DOCKER_DIR)/.active-color 2>/dev/null || echo blue)
ACTIVE_CTR := ecolemiriam-app-$(ACTIVE_COLOR)

.PHONY: setup secrets secrets-edit secrets-rotate build up down restart deploy staging promote rollback status smoke deploy-build backup restore-test audit migrate logs logs-staging logs-db ps health shell shell-db clean cf-setup

# --- Setup ---

setup:
	sudo bash $(DOCKER_DIR)/scripts/harden-os.sh

cf-setup:
	bash $(DOCKER_DIR)/scripts/cloudflare-setup.sh

secrets:
	bash $(DOCKER_DIR)/scripts/secrets-init.sh

secrets-edit:
	bash $(DOCKER_DIR)/scripts/secrets-edit.sh

secrets-rotate:
	bash $(DOCKER_DIR)/scripts/secrets-rotate.sh

# --- Build & Deploy (Blue-Green) ---

build:
	DOCKER_BUILDKIT=1 docker build -t ghcr.io/wilsan007/ecolemiriam-app:latest $(PROJECT_DIR) -f $(DOCKER_DIR)/app/Dockerfile

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

# Déploiement blue-green complet : staging + smoke tests + promotion
deploy:
	bash $(DOCKER_DIR)/scripts/blue-green-deploy.sh --full

# Déployer en staging seulement (slot inactif + smoke tests, sans toucher la prod)
staging:
	bash $(DOCKER_DIR)/scripts/blue-green-deploy.sh --staging-only

# Promouvoir le staging en production (bascule Caddy, zero downtime)
promote:
	bash $(DOCKER_DIR)/scripts/blue-green-deploy.sh --promote

# Rollback instantané : bascule vers l'ancien slot
rollback:
	bash $(DOCKER_DIR)/scripts/blue-green-deploy.sh --rollback

# Afficher le statut blue-green (quel slot est actif)
status:
	bash $(DOCKER_DIR)/scripts/blue-green-deploy.sh --status

# Smoke tests sur le slot actif
smoke:
	bash $(DOCKER_DIR)/scripts/smoke-test.sh $(ACTIVE_CTR)

# Build local + déploiement (fallback si GHCR indisponible)
deploy-build:
	bash $(DOCKER_DIR)/scripts/blue-green-deploy.sh --build

# --- Backup & Restore ---

backup:
	docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam --type=full backup

restore-test:
	bash $(DOCKER_DIR)/scripts/restore-test.sh

# --- Security ---

audit:
	sudo bash $(DOCKER_DIR)/scripts/security-audit.sh

# --- Migration ---

migrate:
	bash $(DOCKER_DIR)/scripts/migrate-from-supabase.sh

# --- Operations ---

logs:
	docker logs $(ACTIVE_CTR) --tail 50 -f

logs-staging:
	docker logs ecolemiriam-app-$$(([ "$(ACTIVE_COLOR)" = "blue" ] && echo green) || echo blue) --tail 50 -f

logs-db:
	docker logs ecolemiriam-postgres --tail 50 -f

ps:
	$(COMPOSE) ps

health:
	docker exec $(ACTIVE_CTR) curl -sf http://localhost:3000/api/health && echo "OK" || echo "FAIL"

shell:
	docker exec -it $(ACTIVE_CTR) sh

shell-db:
	docker exec -it ecolemiriam-postgres psql -U ecolemiriam_owner -d ecolemiriam

clean:
	docker image prune -f
	docker volume prune -f --filter "label!=com.docker.compose.project=ecolemiriam"
