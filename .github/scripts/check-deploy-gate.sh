#!/usr/bin/env bash
# ============================================================
# Garde-fou : la porte de promotion en production est-elle intacte ?
# ============================================================
#
# Le plan GitHub du dépôt est gratuit : ni les règles de protection de branche,
# ni les rulesets, ni les reviewers requis sur un environnement ne sont
# disponibles sur un dépôt privé (403 « Upgrade to GitHub Pro »). La seule
# barrière empêchant un push sur main d'atteindre la production est donc une
# condition dans .github/workflows/deploy-gcp.yml.
#
# Ce script vérifie que cette condition tient toujours. Il tourne dans la CI
# (workflow guard.yml) et dans le hook pre-push, pour attraper le cas réel :
# un agent ou un contributeur qui « nettoie » le workflow sans savoir à quoi
# sert cette ligne. Il n'arrête pas une suppression délibérée — le même push
# peut retirer le garde-fou — mais ce n'est pas le risque courant.
#
# Usage : .github/scripts/check-deploy-gate.sh
# Sortie : 0 si la porte est intacte, 1 sinon.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import sys
import yaml

WORKFLOW = ".github/workflows/deploy-gcp.yml"
EXPECTED_IF = "github.event_name == 'workflow_dispatch' && inputs.promote"

erreurs = []

try:
    with open(WORKFLOW, encoding="utf-8") as f:
        wf = yaml.safe_load(f)
except FileNotFoundError:
    print("ERREUR: %s est introuvable." % WORKFLOW)
    sys.exit(1)

jobs = wf.get("jobs", {})

# 1. Le job approve doit rester conditionné au lancement manuel.
approve = jobs.get("approve")
if approve is None:
    erreurs.append("le job `approve` a disparu")
else:
    condition = str(approve.get("if", "")).strip()
    if condition != EXPECTED_IF:
        erreurs.append(
            "la condition du job `approve` a changé.\n"
            "         attendu : %s\n"
            "         trouvé  : %s" % (EXPECTED_IF, condition or "(aucune)")
        )

# 2. Le job promote doit rester derrière approve : c'est ce qui le rend
#    inatteignable depuis un push, approve étant alors skipped.
promote = jobs.get("promote")
if promote is None:
    erreurs.append("le job `promote` a disparu")
else:
    needs = promote.get("needs", [])
    if isinstance(needs, str):
        needs = [needs]
    if "approve" not in needs:
        erreurs.append(
            "le job `promote` ne dépend plus de `approve` (needs = %r)" % (needs,)
        )

if erreurs:
    print("La porte de promotion en production est compromise :\n")
    for e in erreurs:
        print("  - %s" % e)
    print("""
Sans cette porte, tout push sur main déploie directement en production.
Si le changement est volontaire, adapte aussi ce garde-fou et dis-le
explicitement dans le message de commit. Voir docs/DEPLOIEMENT.md.""")
    sys.exit(1)

print("Porte de promotion intacte : `promote` reste derrière `approve`,")
print("lui-même limité au lancement manuel avec l'entrée `promote` cochée.")
PY
