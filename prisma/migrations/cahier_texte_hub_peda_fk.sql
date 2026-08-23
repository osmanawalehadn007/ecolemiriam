-- Foreign keys (PostgreSQL ne supporte pas ADD CONSTRAINT IF NOT EXISTS)
DO $$ BEGIN
  ALTER TABLE "cahier_textes" ADD CONSTRAINT "cahier_textes_emploiTempsId_fkey"
    FOREIGN KEY ("emploiTempsId") REFERENCES "emplois_temps"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "devoirs" ADD CONSTRAINT "devoirs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "devoirs" ADD CONSTRAINT "devoirs_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "devoirs" ADD CONSTRAINT "devoirs_seanceId_fkey"
    FOREIGN KEY ("seanceId") REFERENCES "cahier_textes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "devoirs" ADD CONSTRAINT "devoirs_classeId_fkey"
    FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "devoirs" ADD CONSTRAINT "devoirs_matiereId_fkey"
    FOREIGN KEY ("matiereId") REFERENCES "matieres"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "devoirs" ADD CONSTRAINT "devoirs_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "devoirs" ADD CONSTRAINT "devoirs_donneParId_fkey"
    FOREIGN KEY ("donneParId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chapitres" ADD CONSTRAINT "chapitres_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chapitres" ADD CONSTRAINT "chapitres_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chapitres" ADD CONSTRAINT "chapitres_matiereId_fkey"
    FOREIGN KEY ("matiereId") REFERENCES "matieres"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chapitres" ADD CONSTRAINT "chapitres_classeId_fkey"
    FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chapitres" ADD CONSTRAINT "chapitres_periodeId_fkey"
    FOREIGN KEY ("periodeId") REFERENCES "periodes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cahier_textes" ADD CONSTRAINT "cahier_textes_chapitreId_fkey"
    FOREIGN KEY ("chapitreId") REFERENCES "chapitres"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
