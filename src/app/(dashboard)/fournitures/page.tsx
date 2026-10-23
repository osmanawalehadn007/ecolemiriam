import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import { FournituresView } from "@/components/fournitures/FournituresView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { runWithTenant, rlsBatch } from "@/lib/prisma";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { niveauToLabel } from "@/lib/niveau";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

export const metadata = { title: "Fournitures scolaires | École Miriam" };

// Cache des données fournitures — sans ce cache, chaque navigation
// ré-exécute 6 requêtes prisma (tenant, enseignant, affectations,
// enseignant_matieres, matiere, classe). Avec cache: hit ~1s.
const getFournituresData = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    userId: string,
    role: Role,
    siteIdsHash: string,
    tenantHasSites: boolean,
  ) => {
    const sessionUser = {
      tenantId,
      siteId,
      role,
      id: userId,
      siteIds: siteIdsHash ? (JSON.parse(siteIdsHash) as string[]) : [],
      tenantHasSites,
    } as SessionSiteClaims;

    const isTeacher = role === "TEACHER" || role === "CLASS_TEACHER";

    return runWithTenant(tenantId, siteId, async () => {
      // Année courante : table `annees_scolaires` (source de vérité), avec repli
      // sur le champ dénormalisé `Tenant.currentYear` (déprécié). L'ancien repli
      // était la constante « 2025-2026 », qui devenait fausse à chaque rentrée.
      // Le repli sur Tenant n'est lu que si aucune année n'est enregistrée
      // (cas normal : 0 requête, l'année vient du cache).
      let currentYear = await getAnneeCouranteLibelle(tenantId);
      if (!currentYear) {
        const [tenant] = await rlsBatch((db) => [
          db.tenant.findUnique({ where: { id: tenantId }, select: { currentYear: true } }),
        ]);
        currentYear =
          tenant?.currentYear ??
          `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
      }

      // Récupérer les matières et niveaux
      const siteFilter = siteFilterForModel("matiere", sessionUser);
      const classeSiteFilter = siteFilterForModel("classe", sessionUser);

      let matieres: { id: string; nom: string; code: string }[];
      let niveauxRaw: string[];

      if (isTeacher) {
        // ── Enseignant : ne voir QUE ses classes et SES matières ──────
        const enseignantSiteFilter = siteFilterForModel("enseignant", sessionUser);
        const [enseignant] = await rlsBatch((db) => [
          db.enseignant.findFirst({
            where: { userId, tenantId, ...enseignantSiteFilter },
            select: { id: true },
          }),
        ]);

        if (enseignant) {
          // 1. Récupérer les affectations avec classe + matière
          // Affectations et enseignant_matieres (primaire : pas de matière
          // dans les affectations) lues dans la même transaction.
          const [affectations, ensMatieres] = await rlsBatch((db) => [
            db.enseignantAffectation.findMany({
              where: { enseignantId: enseignant.id, tenantId },
              select: {
                classe: { select: { niveau: true } },
                matiere: { select: { id: true, nom: true, code: true } },
              },
            }),
            db.enseignantMatiere.findMany({
              where: { enseignantId: enseignant.id, tenantId },
              select: { matiere: { select: { id: true, nom: true, code: true } } },
            }),
          ]);

          // 2. Niveaux distincts des classes affectées
          const niveauSet = new Set<string>();
          for (const aff of affectations) {
            if (aff.classe) niveauSet.add(aff.classe.niveau);
          }
          niveauxRaw = [...niveauSet].sort((a, b) =>
            a.localeCompare(b, "fr", { numeric: true })
          );

          // 3. Matières distinctes depuis les affectations
          //    (+ enseignant_matieres au cas où)
          const matiereSet = new Map<string, { id: string; nom: string; code: string }>();
          for (const aff of affectations) {
            if (aff.matiere) {
              matiereSet.set(aff.matiere.id, aff.matiere);
            }
          }
          // Compléter avec enseignant_matieres (primaire : pas de matière dans affectations)
          for (const em of ensMatieres) {
            matiereSet.set(em.matiere.id, em.matiere);
          }
          matieres = [...matiereSet.values()].sort((a, b) => a.nom.localeCompare(b.nom));
        } else {
          // Enseignant sans affectations : rien
          matieres = [];
          niveauxRaw = [];
        }
      } else {
        // ── Admin/Secrétariat/Parent/Élève : toutes les matières et niveaux ──
        const [matieresRows, classes] = await rlsBatch((db) => [
          db.matiere.findMany({
            where: { tenantId, ...siteFilter },
            select: { id: true, nom: true, code: true },
            orderBy: { nom: "asc" },
          }),
          db.classe.findMany({
            where: { tenantId, annee: currentYear, ...classeSiteFilter },
            select: { niveau: true },
            distinct: ["niveau"],
            orderBy: { niveau: "asc" },
          }),
        ]);
        matieres = matieresRows;
        niveauxRaw = classes.map((c) => c.niveau);
      }

      return { matieres, niveauxRaw, currentYear };
    });
  },
  ["fournitures-data"],
  { revalidate: 30, tags: ["fournitures-data"] }
);

export default async function FournituresPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("fournitures"),
  ]);
  const { tenantId, role } = guardPage(session, "fournitures:read");

  const siteIdsHash = JSON.stringify(session!.user.siteIds ?? []);
  const { matieres, niveauxRaw, currentYear } = await getFournituresData(
    tenantId,
    session!.user.siteId ?? null,
    session!.user.id,
    role,
    siteIdsHash,
    session!.user.tenantHasSites ?? true,
  );

  // Les niveaux sont passés en valeurs brutes (ex: "6", "10") à FournituresView.
  // Le composant utilise niveauToLabel() pour l'affichage uniquement.
  // Le filtre envoie la valeur brute à l'API.

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session!.user.name}
        userAvatar={session!.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <FournituresView
          role={role}
          tenantId={tenantId}
          currentYear={currentYear}
          matieres={matieres}
          niveaux={niveauxRaw}
        />
      </div>
    </div>
  );
}
