# Migrations RLS obsolètes — NE PAS EXÉCUTER

Ces fichiers sont conservés pour l'historique uniquement. Les rejouer
**réintroduit une faille d'isolation multi-tenant**.

## Ce qu'ils contiennent de dangereux

`migration_rls_activate.sql`, `migration_rls_hardening.sql` et
`rls_setup.sql` définissent :

```sql
CREATE POLICY <table>_site_isolation ON <table>
  USING (is_site_admin() OR site_matches("siteId"));
```

Cette policy est **PERMISSIVE** et ne contient **aucun contrôle de tenant**.
`is_site_admin()` renvoie `TRUE` dès que `app.site_id` est vide ou absent —
c'est-à-dire pour tout utilisateur non restreint à un site. PostgreSQL
combinant les policies permissives en `OR`, elle rendait à elle seule toutes
les lignes de tous les tenants visibles, quelles que soient les autres
policies en place.

`migration_rls_fix_policies.sql` corrigeait le problème, mais
`migration_rls_activate.sql` (postérieur, rejoué à chaque déploiement par
`apply-rls.sh`) le réintroduisait systématiquement.

## Source de vérité actuelle

- `prisma/migration_rls_secure.sql` — les policies
- `prisma/verify_rls.sql` — la preuve qu'elles fonctionnent
- `docker/scripts/apply-rls.sh` — applique puis vérifie, et échoue sinon
