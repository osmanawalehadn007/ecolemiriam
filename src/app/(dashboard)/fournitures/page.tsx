import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import { FournituresView } from "@/components/fournitures/FournituresView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { niveauToLabel } from "@/lib/niveau";

export const metadata = { title: "Fournitures scolaires | École Miriam" };

export default async function FournituresPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("fournitures"),
  ]);
  const { tenantId, role } = guardPage(session, "fournitures:read");

  // Récupérer l'année courante du tenant
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { currentYear: true },
  });
  const currentYear = tenant?.currentYear ?? "2025-2026";

  // Récupérer les matières et niveaux
  const siteFilter = siteFilterForModel("matiere", session!.user);
  const classeSiteFilter = siteFilterForModel("classe", session!.user);

  const isTeacher = role === "TEACHER" || role === "CLASS_TEACHER";

  let matieres: { id: string; nom: string; code: string }[];
  let niveauxRaw: string[];

  if (isTeacher) {
    // ── Enseignant : ne voir QUE ses classes et SES matières ──────
    const enseignantSiteFilter = siteFilterForModel("enseignant", session!.user);
    const enseignant = await prisma.enseignant.findFirst({
      where: { userId: session!.user.id, tenantId, ...enseignantSiteFilter },
      select: { id: true },
    });

    if (enseignant) {
      // 1. Récupérer les affectations avec classe + matière
      const affectations = await prisma.enseignantAffectation.findMany({
        where: { enseignantId: enseignant.id, tenantId },
        select: {
          classe: { select: { niveau: true } },
          matiere: { select: { id: true, nom: true, code: true } },
        },
      });

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
      const ensMatieres = await prisma.enseignantMatiere.findMany({
        where: { enseignantId: enseignant.id, tenantId },
        select: { matiere: { select: { id: true, nom: true, code: true } } },
      });
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
    matieres = await prisma.matiere.findMany({
      where: { tenantId, ...siteFilter },
      select: { id: true, nom: true, code: true },
      orderBy: { nom: "asc" },
    });

    const classes = await prisma.classe.findMany({
      where: { tenantId, annee: currentYear, ...classeSiteFilter },
      select: { niveau: true },
      distinct: ["niveau"],
      orderBy: { niveau: "asc" },
    });
    niveauxRaw = classes.map((c) => c.niveau);
  }

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
