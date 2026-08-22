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
#   make deploy         — Pull depuis GHCR + déployer (avec rollback auto)
#   make deploy-build   — Build local + déployer (fallback lent, sans GHCR)
#   make rollback       — Revenir à la version précédente
#   make backup         — Backup manuel pgBackRest
#   make restore-test   — Test de restauration + Telegram
#   make audit          — Audit sécurité scoré
#   make migrate        — Migrer depuis Supabase
#   make logs           — Voir les logs de l'app
#   make logs-db        — Voir les logs de Postgres
#   make ps             — Lister les conteneurs
#   make health         — Vérifier la santé de l'app
#   make shell          — Shell dans le conteneur app
#   make shell-db       — Shell psql dans Postgres
#   make clean          — Nettoyer images et volumes orphelins
# ============================================================

DOCKER_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
PROJECT_DIR := $(abspath $(DOCKER_DIR)/..)
COMPOSE := docker compose -f $(DOCKER_DIR)/docker-compose.yml

.PHONY: setup secrets secrets-edit secrets-rotate build up down restart deploy deploy-build rollback backup restore-test audit migrate logs logs-db ps health shell shell-db clean cf-setup

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

# --- Build & Deploy ---

build:
	DOCKER_BUILDKIT=1 docker build -t ghcr.io/wilsan007/ecolemiriam-app:latest $(PROJECT_DIR) -f $(DOCKER_DIR)/app/Dockerfile

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

deploy:
	bash $(DOCKER_DIR)/scripts/deploy.sh

deploy-build:
	bash $(DOCKER_DIR)/scripts/deploy.sh --build

rollback:
	bash $(DOCKER_DIR)/scripts/deploy.sh --rollback

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
	docker logs ecolemiriam-app --tail 50 -f

logs-db:
	docker logs ecolemiriam-postgres --tail 50 -f

ps:
	$(COMPOSE) ps

health:
	docker exec ecolemiriam-app curl -sf http://localhost:3000/api/health && echo "OK" || echo "FAIL"

shell:
	docker exec -it ecolemiriam-app sh

shell-db:
	docker exec -it ecolemiriam-postgres psql -U ecolemiriam_owner -d ecolemiriam

clean:
	docker image prune -f
	docker volume prune -f --filter "label!=com.docker.compose.project=ecolemiriam"
