-- Migration: Idempotence ATOMIQUE de la facturation mensuelle
-- ============================================================
-- Une seule facture par élève, par TYPE et par MOIS (« 2026-10 »), garanti par
-- la base elle-même et non par une vérification applicative :
--   * deux exécutions du cron en parallèle ne peuvent plus créer de doublon ;
--   * une facture déjà émise — payée, en attente ou en retard — bloque toute
--     nouvelle création pour le même mois (cas du parent qui règle des mois
--     d'avance) ;
--   * une facture ANNULÉE est exclue de l'index : le mois peut être réémis.
--
-- Index PARTIEL `mois IS NOT NULL` : les factures ponctuelles (LIBRE, frais
-- d'inscription, cantine…) ne portent pas de mois et ne sont donc pas
-- contraintes — elles gardent la possibilité d'être créées plusieurs fois.

CREATE UNIQUE INDEX IF NOT EXISTS factures_unicite_mensuelle
  ON public.factures ("tenantId", "eleveId", type, mois)
  WHERE mois IS NOT NULL AND statut <> 'ANNULEE';

-- Vue de contrôle à consulter AVANT toute remise en service de la génération :
-- elle doit rester vide (aucun doublon actif).
CREATE OR REPLACE VIEW public.factures_mensualite_doublons AS
SELECT "tenantId", "eleveId", type, mois, count(*) AS nb
FROM public.factures
WHERE mois IS NOT NULL AND statut <> 'ANNULEE'
GROUP BY "tenantId", "eleveId", type, mois
HAVING count(*) > 1;

