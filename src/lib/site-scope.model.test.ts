import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { SITE_PATHS, siteFilterForModel, siteForNewMember, type SitePath } from "@/lib/site-scope";

/**
 * Vérifie la table `SITE_PATHS` contre le schéma Prisma réel (DMMF).
 *
 * Objectif : rendre impossible la réapparition du défaut suivant — filtrer sur
 * `siteId` un modèle qui n'a pas cette colonne. Cela passait inaperçu tant que
 * le filtrage était fail-open (fragment vide), et se transformait en erreur
 * Prisma « Unknown argument » dès que les utilisateurs avaient un périmètre réel.
 *
 * Si vous ajoutez un modèle au schéma, ce test échouera jusqu'à ce que son
 * chemin d'accès au site soit déclaré.
 */

type Field = { name: string; kind: string; type: string; isList: boolean };
const models = new Map<string, Field[]>();
for (const m of Prisma.dmmf.datamodel.models) {
  models.set(m.name, m.fields as unknown as Field[]);
}

/** nom de délégué Prisma (camelCase) → nom de modèle */
function modelNameFor(delegate: string): string | undefined {
  for (const name of models.keys()) {
    if (name[0].toLowerCase() + name.slice(1) === delegate) return name;
  }
  return undefined;
}

function hasSiteIdColumn(modelName: string): boolean {
  return (models.get(modelName) ?? []).some((f) => f.name === "siteId");
}

function relation(modelName: string, field: string): Field | undefined {
  return (models.get(modelName) ?? []).find((f) => f.name === field && f.kind === "object");
}

describe("SITE_PATHS — cohérence avec le schéma Prisma", () => {
  it("ne déclare que des modèles existants", () => {
    const unknown = Object.keys(SITE_PATHS).filter((d) => !modelNameFor(d));
    expect(unknown, `délégués inconnus du schéma : ${unknown.join(", ")}`).toEqual([]);
  });

  it("couvre TOUS les modèles du schéma", () => {
    const declared = new Set(Object.keys(SITE_PATHS));
    const missing = [...models.keys()]
      .map((n) => n[0].toLowerCase() + n.slice(1))
      .filter((d) => !declared.has(d));
    expect(
      missing,
      `modèles sans chemin de site déclaré : ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("déclare `column` exactement pour les modèles portant siteId", () => {
    const wrong: string[] = [];
    for (const [delegate, path] of Object.entries(SITE_PATHS)) {
      const name = modelNameFor(delegate);
      if (!name) continue;
      const hasColumn = hasSiteIdColumn(name);
      if (hasColumn && path !== "column") {
        wrong.push(`${name} porte siteId mais est déclaré ${JSON.stringify(path)}`);
      }
      if (!hasColumn && path === "column") {
        wrong.push(`${name} ne porte PAS siteId mais est déclaré "column"`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("n'emprunte que des relations réellement présentes, et du bon type", () => {
    const wrong: string[] = [];
    for (const [delegate, path] of Object.entries(SITE_PATHS)) {
      const name = modelNameFor(delegate);
      if (!name || typeof path === "string") continue;

      const field = "one" in path ? path.one : path.many;
      const rel = relation(name, field);

      if (!rel) {
        wrong.push(`${name}.${field} n'existe pas (ou n'est pas une relation)`);
        continue;
      }
      if ("one" in path && rel.isList) {
        wrong.push(`${name}.${field} est une liste : utiliser { many } et non { one }`);
      }
      if ("many" in path && !rel.isList) {
        wrong.push(`${name}.${field} n'est pas une liste : utiliser { one } et non { many }`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("aboutit toujours à un modèle portant siteId", () => {
    const wrong: string[] = [];
    for (const [delegate, path] of Object.entries(SITE_PATHS)) {
      const name = modelNameFor(delegate);
      if (!name || typeof path === "string") continue;

      const field = "one" in path ? path.one : path.many;
      const rel = relation(name, field);
      if (!rel) continue; // déjà signalé par le test précédent

      // Le modèle cible doit soit porter siteId, soit être lui-même rattaché.
      if (!hasSiteIdColumn(rel.type)) {
        const targetDelegate = rel.type[0].toLowerCase() + rel.type.slice(1);
        const targetPath: SitePath | undefined = SITE_PATHS[targetDelegate];
        const chained =
          targetPath && targetPath !== "tenant" && targetPath !== "column";
        if (!chained) {
          wrong.push(
            `${name}.${field} → ${rel.type} qui ne porte pas siteId et n'est pas rattaché`
          );
        }
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });
});

describe("siteFilterForModel", () => {
  const scoped = { role: "TEACHER", siteId: null, siteIds: ["s1"] };

  // Pour un modèle métier, `siteId: null` signifie « non assigné », et non
  // « partagé » : ces enregistrements ne doivent PAS remonter à un compte
  // site-scopé. Seuls les modèles de référence listés dans
  // `SHARED_NULL_MODELS` (matière, structure, tarif…) font exception — voir
  // le test « filtre les matières par site » plus bas.
  it("filtre sur la colonne sans laisser passer les enregistrements non assignés", () => {
    expect(siteFilterForModel("eleve", scoped)).toEqual({
      AND: [{ siteId: { in: ["s1"] } }],
    });
  });

  // Régression : la page RH plantait (« Unknown argument `siteId` ») car
  // Enseignant n'a pas de colonne siteId, seulement la relation `sites`.
  it("suit la chaîne de relations jusqu'à EnseignantSite", () => {
    const viaSites = { enseignant: { sites: { some: { siteId: { in: ["s1"] } } } } };
    expect(siteFilterForModel("absencePersonnel", scoped)).toEqual({ AND: [viaSites] });
    expect(siteFilterForModel("congePersonnel", scoped)).toEqual({ AND: [viaSites] });
    expect(siteFilterForModel("bulletinPaie", scoped)).toEqual({
      AND: [{ ficheRH: viaSites }],
    });
  });

  // Régression directe : c'est ici que la 500 se produisait.
  it("filtre via la relation pour un modèle sans colonne siteId", () => {
    expect(siteFilterForModel("incident", scoped)).toEqual({
      AND: [{ eleve: { siteId: { in: ["s1"] } } }],
    });
    expect(siteFilterForModel("note", scoped)).toEqual({
      AND: [{ eleve: { siteId: { in: ["s1"] } } }],
    });
    expect(siteFilterForModel("paiement", scoped)).toEqual({
      AND: [{ facture: { siteId: { in: ["s1"] } } }],
    });
  });

  // Une conversation sans site est un échange personnel, pas une donnée
  // orpheline : elle doit rester visible d'un compte site-scopé.
  it("laisse passer les conversations hors site", () => {
    expect(siteFilterForModel("conversation", scoped)).toEqual({
      AND: [{ OR: [{ siteId: { in: ["s1"] } }, { siteId: null }] }],
    });
    expect(siteFilterForModel("message", scoped)).toEqual({
      AND: [{ conversation: { siteId: { in: ["s1"] } } }],
    });
  });

  it("ne filtre pas les données de référence partagées", () => {
    expect(siteFilterForModel("periode", scoped)).toEqual({});
    expect(siteFilterForModel("anneesScolaires", scoped)).toEqual({});
  });

  it("filtre les matières par site (elles portent siteId)", () => {
    expect(siteFilterForModel("matiere", scoped)).toEqual({
      AND: [{ OR: [{ siteId: { in: ["s1"] } }, { siteId: null }] }],
    });
  });

  it("gère une relation vers-plusieurs (rattachement obligatoire)", () => {
    expect(siteFilterForModel("enseignant", scoped)).toEqual({
      AND: [{ sites: { some: { siteId: { in: ["s1"] } } } }],
    });
  });

  it("montre tous les enseignants à la direction en vue « tous les sites »", () => {
    expect(siteFilterForModel("enseignant", { role: "TENANT_ADMIN", siteId: null, siteIds: [] })).toEqual({});
  });

  it("ne montre que les enseignants du site choisi par la direction", () => {
    expect(siteFilterForModel("enseignant", { role: "TENANT_ADMIN", siteId: "s2", siteIds: [] })).toEqual({
      AND: [{ sites: { some: { siteId: { in: ["s2"] } } } }],
    });
  });

  it("rattache le personnel au site courant et refuse « tous les sites »", () => {
    const direction = { role: "TENANT_ADMIN", siteIds: [], tenantHasSites: true };
    expect(siteForNewMember({ ...direction, siteId: "s2" }, "SECRETARY")).toEqual({ siteId: "s2" });
    expect(siteForNewMember({ ...direction, siteId: "s2" }, "TEACHER")).toEqual({ siteId: "s2" });
    expect(siteForNewMember({ ...direction, siteId: null }, "TEACHER")).toHaveProperty("error");
    expect(siteForNewMember({ ...direction, siteId: null }, "ACCOUNTANT")).toHaveProperty("error");
    // Dispensés : direction générale et familles.
    expect(siteForNewMember({ ...direction, siteId: null }, "TENANT_ADMIN")).toEqual({ siteId: null });
    expect(siteForNewMember({ ...direction, siteId: null }, "PARENT")).toEqual({ siteId: null });
    // Établissement mono-site : pas de rattachement exigé.
    expect(siteForNewMember({ ...direction, siteId: null, tenantHasSites: false }, "TEACHER")).toEqual({ siteId: null });
  });

  it("reste fail-closed pour un modèle inconnu", () => {
    expect(siteFilterForModel("modeleInexistant", scoped)).toHaveProperty("AND");
  });

  it("ne filtre rien pour un accès tenant complet", () => {
    expect(siteFilterForModel("note", { role: "TENANT_ADMIN", siteId: null, siteIds: [] })).toEqual({});
  });
});
