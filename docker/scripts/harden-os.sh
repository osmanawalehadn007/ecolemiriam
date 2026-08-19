#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# EcolPro — Durcissement OS du VPS (à exécuter une fois)
# ============================================================
#
# Actions :
#   1. Mises à jour + auto-upgrades de sécurité
#   2. SSH : clé uniquement, pas de root, port 22022
#   3. UFW : deny all, allow SSH + Docker interne
#   4. fail2ban : bannir les IPs qui brute-forcent SSH
#   5. sysctl : durcissement noyau (network, memory)
#   6. Docker : installation + durcissement
#   7. AIDE : intrusion detection
#
# Usage :
#   sudo ./docker/scripts/harden-os.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date -u +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

[ "$(id -u)" -eq 0 ] || err "Ce script doit être exécuté en root (sudo)"

# --- 1. Mises à jour ---
log "1/7 — mises à jour système..."
apt-get update -qq
apt-get upgrade -y
apt-get install -y unattended-upgrades apt-listbugs

cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

log "  → unattended-upgrades configuré"

# --- 2. SSH ---
log "2/7 — durcissement SSH..."

SSH_PORT="${SSH_PORT:-22022}"
SSHD_CONFIG="/etc/ssh/sshd_config"

cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%s)"

sed -i "s/^#\?Port .*/Port ${SSH_PORT}/" "$SSHD_CONFIG"
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' "$SSHD_CONFIG"
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#\?PubkeyAuthentication .*/PubkeyAuthentication yes/' "$SSHD_CONFIG"
sed -i 's/^#\?MaxAuthTries .*/MaxAuthTries 3/' "$SSHD_CONFIG"
sed -i 's/^#\?LoginGraceTime .*/LoginGraceTime 30/' "$SSHD_CONFIG"
sed -i 's/^#\?AllowAgentForwarding .*/AllowAgentForwarding no/' "$SSHD_CONFIG"
sed -i 's/^#\?AllowTcpForwarding .*/AllowTcpForwarding no/' "$SSHD_CONFIG"
sed -i 's/^#\?X11Forwarding .*/X11Forwarding no/' "$SSHD_CONFIG"
sed -i 's/^#\?ClientAliveInterval .*/ClientAliveInterval 300/' "$SSHD_CONFIG"
sed -i 's/^#\?ClientAliveCountMax .*/ClientAliveCountMax 2/' "$SSHD_CONFIG"

cat > /etc/issue.net <<'EOF'
*** ACCÈS NON AUTORISÉ INTERDIT ***
Ce système est réservé à un usage autorisé. Toute activité est
surveillée et enregistrée. Les accès non autorisés seront poursuivis.
EOF
sed -i 's/^#\?Banner .*/Banner \/etc\/issue.net/' "$SSHD_CONFIG"

systemctl restart sshd
log "  → SSH : port ${SSH_PORT}, clé uniquement, pas de root"

# --- 3. UFW ---
log "3/7 — configuration UFW..."
apt-get install -y ufw

ufw default deny incoming
ufw default allow outgoing
ufw allow ${SSH_PORT}/tcp comment 'SSH (durci)'
ufw --force enable
ufw status verbose
log "  → UFW : deny all, allow ${SSH_PORT}/tcp"

# --- 4. fail2ban ---
log "4/7 — installation fail2ban..."
apt-get install -y fail2ban

cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
banaction = ufw

[sshd]
enabled = true
port = ${SSH_PORT}
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200
EOF

systemctl enable fail2ban
systemctl restart fail2ban
log "  → fail2ban : SSH banni après 3 tentatives (2h)"

# --- 5. sysctl ---
log "5/7 — durcissement noyau (sysctl)..."

cat > /etc/sysctl.d/99-ecolpro-hardening.conf <<'EOF'
# IP spoofing
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Pas de ICMP redirect
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0

# Pas de source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0

# SYN flood protection
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2

# Logging des paquets étranges
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# Memory protection
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1

# Coredumps désactivés
fs.suid_dumpable = 0

# Docker : forwarding
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1

# Conntrack
net.netfilter.nf_conntrack_max = 65536
EOF

sysctl --system >/dev/null
log "  → sysctl : 18 paramètres durcis"

# --- 6. Docker ---
log "6/7 — installation Docker..."

if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "icc": false,
  "userland-proxy": false,
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": 5
  },
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Hard": 1024, "Soft": 1024 }
  },
  "userns-remap": "default"
}
EOF

systemctl enable docker
systemctl restart docker
log "  → Docker installé et durci (userns-remap, no-new-privileges)"

# --- 7. AIDE ---
log "7/7 — installation AIDE (intrusion detection)..."
apt-get install -y aide
aideinit 2>/dev/null || warn "  → AIDE init : warnings (normal au 1er run)"

log "=== Durcissement OS terminé ✓ ==="
log ""
log "RÉCAPITULATIF :"
log "  • SSH : port ${SSH_PORT}, clé uniquement, pas de root"
log "  • UFW : deny all, allow ${SSH_PORT}/tcp"
log "  • fail2ban : 3 tentatives → ban 2h"
log "  • sysctl : 18 paramètres durcis"
log "  • Docker : userns-remap, no-new-privileges"
log "  • AIDE : base de référence créée"
log ""
log "PROCHAINES ÉTAPES :"
log "  1. Tester SSH : ssh -p ${SSH_PORT} user@vps-ip"
log "  2. NE PAS fermer la session actuelle avant d'avoir testé"
log "  3. Déployer : cd /opt/ecolpro/docker && docker compose up -d"
warn ""
warn "⚠  NE PAS FERMER CETTE SESSION avant d'avoir testé SSH sur le port ${SSH_PORT}"
