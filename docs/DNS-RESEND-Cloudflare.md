# Enregistrements DNS à ajouter sur Cloudflare — Délivrabilité email Resend

**Domaine :** `ecolemiriam.com`
**Dashboard :** https://dash.cloudflare.com → ecolemiriam.com → DNS → Records

> **Contexte :** Les emails envoyés via Resend (vérification de compte,
> réinitialisation de mot de passe, notifications) ne sont pas reçus par les
> utilisateurs. La cause principale est l'absence d'enregistrement SPF sur le
> domaine racine `ecolemiriam.com`, ce qui fait que Gmail/Outlook rejettent ou
> placent les emails en spam.

---

## État actuel (déjà configuré — NE PAS MODIFIER)

| Type | Nom | Valeur | Statut |
|------|-----|--------|--------|
| TXT | `resend._domainkey.ecolemiriam.com` | `p=MIGfMA0GCSqGSIb3DQEBA...` (clé DKIM) | ✅ Présent |
| TXT | `send.ecolemiriam.com` | `v=spf1 include:amazonses.com ~all` | ✅ Présent (sous-domaine) |
| MX | `send.ecolemiriam.com` | `10 feedback-smtp.eu-west-1.amazonses.com.` | ✅ Présent (sous-domaine) |

---

## Enregistrements À AJOUTER

### 1. SPF — CRITIQUE (le problème principal)

Sans SPF sur le domaine racine, les fournisseurs de messagerie ne peuvent pas
vérifier que Resend/AWS SES est autorisé à envoyer des emails pour
`ecolemiriam.com`. Gmail rejette silencieusement ces emails.

| Champ | Valeur |
|-------|--------|
| **Type** | `TXT` |
| **Name** | `@` (ou `ecolemiriam.com` — représente la racine du domaine) |
| **Content** | `v=spf1 include:amazonses.com ~all` |
| **TTL** | Auto |
| **Proxy status** | DNS only (nuage gris — PAS orange) |

> **Note :** `~all` signifie "soft fail" — les emails non autorisés sont marqués
> mais pas rejetés. Une fois la configuration validée, vous pourrez passer à
> `-all` (hard fail) pour un rejet strict.

---

### 2. DMARC — IMPORTANT (politique de monitoring)

DMARC indique aux fournisseurs quoi faire quand SPF ou DKIM échoue. On commence
en mode `p=none` (monitoring) pour recevoir des rapports sans rejeter d'emails.

| Champ | Valeur |
|-------|--------|
| **Type** | `TXT` |
| **Name** | `_dmarc` (ou `_dmarc.ecolemiriam.com`) |
| **Content** | `v=DMARC1; p=none; rua=mailto:dmarc@ecolemiriam.com; pct=100; adkim=s; aspf=s` |
| **TTL** | Auto |
| **Proxy status** | DNS only (nuage gris) |

> **Explication des paramètres :**
> - `p=none` : mode monitoring (aucun rejet, juste des rapports)
> - `rua=mailto:dmarc@ecolemiriam.com` : adresse où recevoir les rapports
>   (vous devez pouvoir lire cette boîte, ou la rediriger)
> - `pct=100` : 100% des emails sont soumis à la politique
> - `adkim=s` : alignement DKIM strict
> - `aspf=s` : alignement SPF strict
>
> **Évolution recommandée après validation (2-4 semaines) :**
> 1. `p=none` → recevoir les rapports, vérifier que tout passe
> 2. `p=quarantine` → les emails non conformes vont en spam
> 3. `p=reject` → les emails non conformes sont rejetés

---

### 3. MX feedback AWS SES — OPTIONNEL (recommandé)

Permet à AWS SES de renvoyer les notifications de bounce/feedback au domaine.
Utile si vous voulez recevoir les notifications de bounce directement par email.

| Champ | Valeur |
|-------|--------|
| **Type** | `MX` |
| **Name** | `@` (ou `ecolemiriam.com`) |
| **Mail server** | `feedback-smtp.eu-west-1.amazonses.com` |
| **Priority** | `10` |
| **TTL** | Auto |
| **Proxy status** | DNS only (nuage gris) |

> **ATTENTION :** Ajouter un MX sur le domaine racine signifie qu'il peut
> recevoir des emails. Si vous ne voulez pas cela (ex: vous n'avez pas de
> serveur de messagerie pour ecolemiriam.com), **n'ajoutez PAS cet
> enregistrement**. Le SPF + DMARC suffisent pour la délivrabilité.
>
> Si `dmarc@ecolemiriam.com` doit recevoir les rapports DMARC, il faut soit :
> - un MX pointant vers un serveur de messagerie qui gère cette adresse, OU
> - un alias/redirection vers une adresse existante (Gmail, etc.)

---

## Récapitulatif rapide (à copier dans Cloudflare)

```
Type  Nom                               Valeur                                                    Priorité
TXT   @                                 v=spf1 include:amazonses.com ~all                         -
TXT   _dmarc                            v=DMARC1; p=none; rua=mailto:dmarc@ecolemiriam.com; pct=100; adkim=s; aspf=s  -
MX    @                                 feedback-smtp.eu-west-1.amazonses.com                     10 (optionnel)
```

---

## Vérification après ajout

Après avoir ajouté les enregistrements, attendez 1-5 minutes (propagation DNS
Cloudflare est rapide), puis vérifiez avec :

```bash
# SPF
dig TXT ecolemiriam.com +short
# Doit retourner : "v=spf1 include:amazonses.com ~all"

# DMARC
dig TXT _dmarc.ecolemiriam.com +short
# Doit retourner : "v=DMARC1; p=none; rua=mailto:dmarc@ecolemiriam.com; pct=100; adkim=s; aspf=s"

# DKIM (déjà présent, vérifier qu'il est toujours là)
dig TXT resend._domainkey.ecolemiriam.com +short
# Doit retourner : "p=MIGfMA0GCSqGSIb3DQEBA..."
```

Vous pouvez aussi utiliser https://mxtoolbox.com/spf.aspx pour valider le SPF
et https://dmarcian.com/dmarc-inspector/ pour valider le DMARC.

---

## Actions complémentaires (hors DNS)

1. **Webhook Resend** : configurer sur https://resend.com/webhooks
   - URL : `https://ecolemiriam.com/api/webhooks/resend`
   - Événements : tous (delivered, bounced, failed, complained, opened, delivery_delayed)
   - Récupérer le secret `whsec_...` et l'ajouter dans `.env.production` :
     `RESEND_WEBHOOK_SECRET=whsec_...`
   - Redémarrer : `docker restart ecolemiriam-app-green`

2. **Bug code corrigé** : le fichier `src/lib/notifications/email.ts` a été
   corrigé pour capturer correctement les `resendEmailId` (l'API batch Resend
   retourne `{data: [...]}` et non un tableau direct). Ce fix sera déployé
   lors du prochain déploiement.
