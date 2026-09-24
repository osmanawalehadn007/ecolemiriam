#!/usr/bin/env python3
"""
============================================================
 École Miriam — Programme de sauvegarde PC (Windows/Linux)
============================================================

Ce programme :
  1. Se lance UNE SEULE FOIS par le tenant admin
  2. Installe rclone automatiquement
  3. Configure la connexion Cloudflare R2
  4. Télécharge les backups SQL depuis R2
  5. Télécharge l'export organisé (ZIP par classe/type/thème)
  6. Se met en tâche planifiée (toutes les 2 heures)
  7. Tourne ensuite tout seul, sans intervention

Source de vérité : la base de production sur le VPS.
Ce PC n'est qu'un consommateur en lecture seule.

Usage :
  python ecolemiriam-backup.py --setup --url https://ecolemiriam.com --token <JWT>
  python ecolemiriam-backup.py --run          # exécuté par le scheduler
  python ecolemiriam-backup.py --status       # voir l'état
  python ecolemiriam-backup.py --uninstall    # retirer le scheduler

Prérequis : Python 3.8+ (installé par défaut sur la plupart des PC)
"""

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# ============================================================
# Configuration
# ============================================================

APP_NAME = "EcoleMiriamBackup"
CONFIG_FILE = Path.home() / "EcoleMiriam" / "config.json"

# APP_DIR est choisi par l'utilisateur lors du --setup.
# Par défaut (avant setup), on utilise ~/EcoleMiriam/Backups.
# Après setup, la vraie valeur est lue depuis config.json.
_DEFAULT_APP_DIR = Path.home() / "EcoleMiriam" / "Backups"

def get_app_dir() -> Path:
    """Retourne le dossier de sauvegarde choisi par l'utilisateur."""
    if CONFIG_FILE.exists():
        try:
            config = json.loads(CONFIG_FILE.read_text())
            custom = config.get("backup_dir")
            if custom:
                return Path(custom)
        except Exception:
            pass
    return _DEFAULT_APP_DIR

# Alias pour compatibilité (utilisé par les fonctions avant setup)
APP_DIR = _DEFAULT_APP_DIR

# R2 (clés publiques, pas de secret — le bucket est en lecture seule pour les backups)
R2_ACCOUNT_ID = "590eea6d542a6006561c19103108cdbd"
R2_ACCESS_KEY = "d8690865dbfbf2537dd16db290a7cc8c"
R2_SECRET_KEY = "af810f7bd41ed406f006ea9eceef40de47261ac8b08f6ba1a3c577b5d90703a8"
R2_BUCKET = "ecolemiriam"
R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

SYNC_INTERVAL_HOURS = 2
MAX_BACKUPS_TO_KEEP = 20  # Garder ~40h de backups (20 × 2h)

# ============================================================
# Utilitaires
# ============================================================

def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")

def is_windows():
    return platform.system() == "Windows"

def is_linux():
    return platform.system() == "Linux"

def is_macos():
    return platform.system() == "Darwin"

# ============================================================
# Installation rclone
# ============================================================

def install_rclone():
    """Installe rclone si non présent."""
    if shutil.which("rclone"):
        log("rclone déjà installé")
        return

    log("Installation de rclone...")

    if is_windows():
        # Windows : télécharger rclone.zip
        rclone_dir = Path.home() / "EcoleMiriam" / "rclone"
        rclone_dir.mkdir(parents=True, exist_ok=True)
        url = "https://downloads.rclone.org/rclone-current-windows-amd64.zip"

        zip_path = rclone_dir / "rclone.zip"
        try:
            urllib.request.urlretrieve(url, zip_path)
            import zipfile
            with zipfile.ZipFile(zip_path, "r") as z:
                z.extractall(rclone_dir)
            zip_path.unlink()

            # Trouver rclone.exe
            for exe in rclone_dir.rglob("rclone.exe"):
                os.environ["PATH"] = f"{exe.parent};{os.environ.get('PATH', '')}"
                log(f"rclone installé : {exe}")
                return
        except Exception as e:
            log(f"ERREUR installation rclone : {e}")
            log("Téléchargez manuellement : https://rclone.org/downloads/")
            sys.exit(1)

    elif is_linux():
        # Linux : script officiel
        try:
            subprocess.run(
                "curl https://rclone.org/install.sh | bash",
                shell=True, check=True, capture_output=True
            )
            log("rclone installé via script officiel")
        except subprocess.CalledProcessError as e:
            log(f"ERREUR installation rclone : {e}")
            log("Essayez : sudo apt install rclone  ou  sudo pacman -S rclone")
            sys.exit(1)

    else:
        log(f"Système non supporté : {platform.system()}")
        sys.exit(1)


def configure_rclone():
    """Configure le remote R2 pour rclone."""
    rclone_dir = Path.home() / ".config" / "rclone"
    rclone_dir.mkdir(parents=True, exist_ok=True)

    conf_path = rclone_dir / "rclone.conf"
    conf_content = f"""[ecolemiriam-backup]
type = s3
provider = Cloudflare
access_key_id = {R2_ACCESS_KEY}
secret_access_key = {R2_SECRET_KEY}
endpoint = {R2_ENDPOINT}
acl = private
no_check_bucket = true
"""

    conf_path.write_text(conf_content)
    os.chmod(conf_path, 0o600)
    log(f"Configuration rclone écrite : {conf_path}")


def test_rclone():
    """Teste la connexion R2."""
    try:
        result = subprocess.run(
            ["rclone", "ls", f"ecolemiriam-backup:{R2_BUCKET}/"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            files = [l for l in result.stdout.strip().split("\n") if l]
            log(f"Connexion R2 OK — {len(files)} fichier(s) sur le bucket")
            return True
        else:
            log(f"ERREUR R2 : {result.stderr}")
            return False
    except Exception as e:
        log(f"ERREUR test R2 : {e}")
        return False

# ============================================================
# Téléchargement des backups
# ============================================================

def sync_r2_backups():
    """Télécharge les backups SQL depuis R2 vers le PC."""
    sql_dir = get_app_dir() / "sql"
    sql_dir.mkdir(parents=True, exist_ok=True)

    log("Téléchargement des backups SQL depuis R2...")

    try:
        subprocess.run(
            ["rclone", "copy", f"ecolemiriam-backup:{R2_BUCKET}/",
             str(sql_dir), "--include", "ecolemiriam_*.sql.gz",
             "--no-traverse", "--transfers", "2", "--retries", "3"],
            check=True, capture_output=True, text=True, timeout=120
        )

        backups = sorted(sql_dir.glob("ecolemiriam_*.sql.gz"))
        log(f"{len(backups)} backup(s) SQL disponible(s) localement")

        # Nettoyage : garder seulement les MAX_BACKUPS_TO_KEEP plus récents
        if len(backups) > MAX_BACKUPS_TO_KEEP:
            for old in backups[:-MAX_BACKUPS_TO_KEEP]:
                old.unlink()
                log(f"  Ancien backup supprimé : {old.name}")

        return len(backups) > 0

    except subprocess.CalledProcessError as e:
        log(f"ERREUR sync R2 : {e.stderr}")
        return False
    except Exception as e:
        log(f"ERREUR sync R2 : {e}")
        return False


def download_export(config: dict):
    """Télécharge l'export organisé (ZIP) depuis l'API."""
    if not config.get("url") or not config.get("token"):
        log("Pas d'URL/token configuré — export ignoré")
        return False

    export_dir = get_app_dir() / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)

    url = config["url"].rstrip("/") + "/api/export/full"
    token = config["token"]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = export_dir / f"ecolemiriam_export_{timestamp}.zip"

    log(f"Téléchargement de l'export organisé depuis {url}...")

    try:
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Cookie", f"__Secure-authjs.session-token={token}")

        with urllib.request.urlopen(req, timeout=120) as resp:
            if resp.status == 200:
                filepath.write_bytes(resp.read())
                size_kb = filepath.stat().st_size / 1024
                log(f"Export téléchargé : {filepath.name} ({size_kb:.0f} KB)")

                # Nettoyage : garder 10 exports max
                exports = sorted(export_dir.glob("ecolemiriam_export_*.zip"))
                if len(exports) > 10:
                    for old in exports[:-10]:
                        old.unlink()
                        log(f"  Ancien export supprimé : {old.name}")

                return True
            else:
                log(f"ERREUR export : HTTP {resp.status}")
                return False

    except urllib.error.HTTPError as e:
        if e.code == 401:
            log("ERREUR export : Token expiré. Reconnectez-vous et relancez --setup")
        else:
            log(f"ERREUR export : HTTP {e.code} — {e.reason}")
        return False
    except Exception as e:
        log(f"ERREUR export : {e}")
        return False

# ============================================================
# Scheduler (tâche planifiée)
# ============================================================

def get_script_path() -> Path:
    return Path(__file__).resolve()


def install_scheduler():
    """Installe la tâche planifiée (Windows Task Scheduler ou Linux cron)."""
    script = get_script_path()
    python = sys.executable

    if is_windows():
        # Windows : schtasks
        cmd = (
            f'schtasks /create /tn "{APP_NAME}" /tr '
            f'"\\"{python}\\" \\"{script}\\" --run" '
            f'/sc HOURLY /mo {SYNC_INTERVAL_HOURS} /f'
        )
        try:
            subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)
            log(f"Tâche planifiée Windows créée (toutes les {SYNC_INTERVAL_HOURS}h)")
        except subprocess.CalledProcessError as e:
            log(f"ERREUR schtasks : {e.stderr}")
            log("Créez la tâche manuellement avec : --run")

    elif is_linux():
        # Linux : crontab
        cron_line = f"0 */{SYNC_INTERVAL_HOURS} * * * {python} {script} --run >> {get_app_dir()}/sync.log 2>&1"

        # Lire le crontab actuel
        try:
            result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
            current = result.stdout if result.returncode == 0 else ""
        except Exception:
            current = ""

        # Retirer l'ancienne ligne si présente
        lines = [l for l in current.split("\n") if APP_NAME not in l and "ecolemiriam-backup" not in l]
        lines.append(f"# {APP_NAME}")
        lines.append(cron_line)

        new_crontab = "\n".join(lines) + "\n"
        proc = subprocess.run(["crontab", "-"], input=new_crontab, capture_output=True, text=True)
        if proc.returncode == 0:
            log(f"Tâche cron Linux créée (toutes les {SYNC_INTERVAL_HOURS}h)")
        else:
            log(f"ERREUR crontab : {proc.stderr}")

    elif is_macos():
        # macOS : launchd (LaunchAgent)
        plist_dir = Path.home() / "Library" / "LaunchAgents"
        plist_dir.mkdir(parents=True, exist_ok=True)
        plist_path = plist_dir / f"com.{APP_NAME.lower()}.plist"

        seconds = SYNC_INTERVAL_HOURS * 3600
        plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.{APP_NAME.lower()}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{python}</string>
        <string>{script}</string>
        <string>--run</string>
    </array>
    <key>StartInterval</key>
    <integer>{seconds}</integer>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>{get_app_dir()}/sync.log</string>
    <key>StandardErrorPath</key>
    <string>{get_app_dir()}/sync.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
"""
        plist_path.write_text(plist_content)
        subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True)
        subprocess.run(["launchctl", "load", str(plist_path)], check=True)
        log(f"LaunchAgent macOS créé (toutes les {SYNC_INTERVAL_HOURS}h) : {plist_path}")

    else:
        log(f"Système non supporté pour le scheduler : {platform.system()}")
        log(f"Exécutez manuellement : {python} {script} --run")


def uninstall_scheduler():
    """Retire la tâche planifiée."""
    if is_windows():
        subprocess.run(f'schtasks /delete /tn "{APP_NAME}" /f', shell=True)
        log("Tâche Windows supprimée")
    elif is_linux():
        try:
            result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
            current = result.stdout if result.returncode == 0 else ""
            lines = [l for l in current.split("\n") if APP_NAME not in l and "ecolemiriam-backup" not in l]
            subprocess.run(["crontab", "-"], input="\n".join(lines) + "\n", capture_output=True, text=True)
            log("Tâche cron supprimée")
        except Exception:
            pass
    elif is_macos():
        plist_path = Path.home() / "Library" / "LaunchAgents" / f"com.{APP_NAME.lower()}.plist"
        if plist_path.exists():
            subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True)
            plist_path.unlink()
            log("LaunchAgent macOS supprimé")
        else:
            log("Aucun LaunchAgent à supprimer")

# ============================================================
# Setup (exécuté une seule fois)
# ============================================================

def do_setup(url: str, token: str, backup_dir: str = ""):
    """Setup complet : installe rclone, configure R2, télécharge, planifie."""
    global APP_DIR

    log("=" * 60)
    log("  École Miriam — Installation du programme de sauvegarde")
    log("=" * 60)
    log(f"Système : {platform.system()} {platform.machine()}")
    log("")

    # 1. Demander à l'utilisateur où sauvegarder les données
    default_dir = str(_DEFAULT_APP_DIR)
    if backup_dir:
        # Dossier passé en argument --dir
        chosen_dir = backup_dir
    else:
        print()
        print("  Où voulez-vous enregistrer les sauvegardes ?")
        print(f"  (Appuyez sur Entrée pour le défaut : {default_dir})")
        print()
        chosen_dir = input("  Dossier > ").strip() or default_dir

    APP_DIR = Path(chosen_dir).expanduser().resolve()
    log(f"Dossier de sauvegarde : {APP_DIR}")

    # 2. Créer les dossiers
    APP_DIR.mkdir(parents=True, exist_ok=True)
    (APP_DIR / "sql").mkdir(parents=True, exist_ok=True)
    (APP_DIR / "exports").mkdir(parents=True, exist_ok=True)
    (Path.home() / "EcoleMiriam").mkdir(parents=True, exist_ok=True)

    # 3. Sauvegarder la config
    config = {
        "url": url,
        "token": token,
        "backup_dir": str(APP_DIR),
        "installed_at": datetime.now().isoformat(),
        "interval_hours": SYNC_INTERVAL_HOURS,
    }
    CONFIG_FILE.write_text(json.dumps(config, indent=2))
    os.chmod(CONFIG_FILE, 0o600)
    log(f"Configuration sauvegardée : {CONFIG_FILE}")

    # 4. Installer rclone
    install_rclone()

    # 5. Configurer R2
    configure_rclone()

    # 6. Tester R2
    if not test_rclone():
        log("ERREUR : Impossible de se connecter à R2. Vérifiez votre connexion internet.")
        sys.exit(1)

    # 7. Premier téléchargement
    log("")
    log("Premier téléchargement des backups...")
    sync_r2_backups()
    download_export(config)

    # 7. Installer le scheduler
    log("")
    install_scheduler()

    # 8. Terminé
    log("")
    log("=" * 60)
    log("  INSTALLATION TERMINÉE ✓")
    log("=" * 60)
    log(f"  Les backups seront synchronisés toutes les {SYNC_INTERVAL_HOURS} heures.")
    log(f"  Dossier local : {APP_DIR}")
    log(f"  sql/     → backups SQL (restauration base)")
    log(f"  exports/ → exports organisés (CSV par classe/type)")
    log("")
    log(f"  Pour voir l'état   : python {Path(__file__).name} --status")
    log(f"  Pour synchroniser  : python {Path(__file__).name} --run")
    log(f"  Pour désinstaller  : python {Path(__file__).name} --uninstall")
    log("=" * 60)

# ============================================================
# Run (exécuté par le scheduler)
# ============================================================

def do_run():
    """Exécute un cycle de synchronisation."""
    config = {}
    if CONFIG_FILE.exists():
        config = json.loads(CONFIG_FILE.read_text())

    log(f"--- Synchronisation {datetime.now().strftime('%Y-%m-%d %H:%M')} ---")

    sql_ok = sync_r2_backups()
    export_ok = download_export(config)

    # Écrire un fichier de statut
    app_dir = get_app_dir()
    status = {
        "last_sync": datetime.now().isoformat(),
        "sql_backups": len(list((app_dir / "sql").glob("ecolemiriam_*.sql.gz"))) if (app_dir / "sql").exists() else 0,
        "exports": len(list((app_dir / "exports").glob("ecolemiriam_export_*.zip"))) if (app_dir / "exports").exists() else 0,
        "sql_ok": sql_ok,
        "export_ok": export_ok,
    }
    status_file = app_dir / "status.json"
    status_file.write_text(json.dumps(status, indent=2))

    log(f"Terminé — SQL: {'OK' if sql_ok else 'ECHEC'}, Export: {'OK' if export_ok else 'ECHEC'}")

# ============================================================
# Status
# ============================================================

def do_status():
    """Affiche l'état actuel."""
    log("=" * 50)
    log("  École Miriam — État des sauvegardes")
    log("=" * 50)

    if not CONFIG_FILE.exists():
        log("Programme non installé. Lancez : --setup --url <URL> --token <TOKEN>")
        return

    config = json.loads(CONFIG_FILE.read_text())
    log(f"URL : {config.get('url', 'N/A')}")
    log(f"Installé le : {config.get('installed_at', 'N/A')}")
    log(f"Intervalle : toutes les {config.get('interval_hours', 2)}h")
    log(f"Dossier : {config.get('backup_dir', 'N/A')}")
    log("")

    app_dir = get_app_dir()
    sql_dir = app_dir / "sql"
    export_dir = app_dir / "exports"

    if sql_dir.exists():
        backups = sorted(sql_dir.glob("ecolemiriam_*.sql.gz"), reverse=True)
        log(f"Backups SQL : {len(backups)}")
        for b in backups[:5]:
            size_kb = b.stat().st_size / 1024
            log(f"  {b.name}  ({size_kb:.0f} KB)")
        if len(backups) > 5:
            log(f"  ... et {len(backups) - 5} autre(s)")
    else:
        log("Backups SQL : aucun dossier")

    log("")

    if export_dir.exists():
        exports = sorted(export_dir.glob("ecolemiriam_export_*.zip"), reverse=True)
        log(f"Exports organisés : {len(exports)}")
        for e in exports[:3]:
            size_kb = e.stat().st_size / 1024
            log(f"  {e.name}  ({size_kb:.0f} KB)")
    else:
        log("Exports organisés : aucun dossier")

    log("")

    status_file = app_dir / "status.json"
    if status_file.exists():
        status = json.loads(status_file.read_text())
        log(f"Dernière sync : {status.get('last_sync', 'N/A')}")
        log(f"  SQL : {'OK' if status.get('sql_ok') else 'ECHEC'}")
        log(f"  Export : {'OK' if status.get('export_ok') else 'ECHEC'}")

    log("")
    log(f"Dossier local : {app_dir}")

# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="École Miriam — Sauvegarde PC")
    parser.add_argument("--setup", action="store_true", help="Installation (une seule fois)")
    parser.add_argument("--url", type=str, help="URL de l'application (ex: https://ecolemiriam.com)")
    parser.add_argument("--token", type=str, help="Token de session (JWT)")
    parser.add_argument("--dir", type=str, default="", help="Dossier de sauvegarde (ex: D:\\EcoleMiriam ou /home/user/backups). Si omis, le programme demande à l'utilisateur.")
    parser.add_argument("--run", action="store_true", help="Synchroniser maintenant")
    parser.add_argument("--status", action="store_true", help="Afficher l'état")
    parser.add_argument("--uninstall", action="store_true", help="Désinstaller le scheduler")

    args = parser.parse_args()

    if args.setup:
        if not args.url or not args.token:
            parser.error("--setup nécessite --url et --token")
        do_setup(args.url, args.token, args.dir)
    elif args.run:
        do_run()
    elif args.status:
        do_status()
    elif args.uninstall:
        uninstall_scheduler()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
