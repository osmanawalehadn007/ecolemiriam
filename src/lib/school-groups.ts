export type SchoolGroup = "Primaire" | "Collège" | "Lycée" | "Autre";

export const SCHOOL_GROUP_ORDER: SchoolGroup[] = ["Primaire", "Collège", "Lycée", "Autre"];

export const SCHOOL_GROUP_ICONS: Record<SchoolGroup, string> = {
  Primaire: "🧒",
  Collège: "📘",
  Lycée: "🎓",
  Autre: "📋",
};

// Système djiboutien :
//   Primaire : 1ère année → 5ème année  (years 1-5)
//   Collège  : 6ème année → 9ème année  (years 6-9)
//   Lycée    : Seconde, Première, Terminale (years 10-12)
// Les identifiants stockés en base ("1ère", "2ème", …) correspondent
// directement au numéro d'année.  "1ère" = 1ère année (Primaire) et
// NON "Première" (Lycée) — ces deux chaînes sont distinctes.
const NIVEAU_TO_YEAR: Record<string, number> = {
  // Primaire (1ère à 5ème année)
  "1ère": 1, "1ere": 1, "1er": 1,
  "2ème": 2, "2eme": 2,
  "3ème": 3, "3eme": 3,
  "4ème": 4, "4eme": 4,
  "5ème": 5, "5eme": 5,
  // Collège (6ème à 9ème année)
  "6ème": 6, "6eme": 6, "6e": 6,
  "7ème": 7, "7eme": 7, "7e": 7,
  "8ème": 8, "8eme": 8, "8e": 8,
  "9ème": 9, "9eme": 9, "9e": 9,
  // Lycée
  seconde: 10, "2nde": 10, "2nd": 10,
  "première": 11, "premiere": 11,
  terminale: 12, term: 12, tle: 12,
  // Maternelle (hors numérotation)
  maternelle: 0, ps: 0, ms: 0, gs: 0,
  // Compatibilité anciens formats français (CP, CE1, CE2, CM1, CM2)
  ci: 1, cp: 1, ce1: 2, ce2: 3, cm1: 4, cm2: 5,
};

function yearToGroup(year: number): SchoolGroup {
  if (year === 0) return "Autre"; // Maternelle
  if (year >= 1 && year <= 5) return "Primaire";
  if (year >= 6 && year <= 9) return "Collège";
  if (year >= 10 && year <= 12) return "Lycée";
  return "Autre";
}

export function getSchoolGroup(niveau: string, nom?: string): SchoolGroup {
  const text = `${niveau} ${nom ?? ""}`.toLowerCase().trim();

  // Détecte "1ère année", "2ème année", "3e année", etc.
  // Inclut "ère"/"ere" pour matcher "1ère année" (système djiboutien)
  const yearWithAnnee = text.match(/(\d+)\s*(?:ème|eme|e|ère|ere)?\s*(?:année|an|year|ann[eé]e)/);
  if (yearWithAnnee) {
    const year = parseInt(yearWithAnnee[1]);
    return yearToGroup(year);
  }

  for (const [key, year] of Object.entries(NIVEAU_TO_YEAR)) {
    const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(text)) {
      return yearToGroup(year);
    }
  }

  const numMatch = text.match(/\b(\d+)\b/);
  if (numMatch) {
    return yearToGroup(parseInt(numMatch[1]));
  }

  return "Autre";
}

export interface GroupedClasses<T> {
  group: SchoolGroup;
  classes: { classe: string; items: T[] }[];
}

export function groupBySchoolLevel<T extends { classe?: { nom: string; niveau: string } | null }>(
  items: T[]
): GroupedClasses<T>[] {
  const groupMap = new Map<SchoolGroup, Map<string, T[]>>();

  for (const item of items) {
    const classeNom = item.classe?.nom ?? "Sans classe";
    const niveau = item.classe?.niveau ?? "";
    const group = item.classe ? getSchoolGroup(niveau, classeNom) : "Autre";

    if (!groupMap.has(group)) groupMap.set(group, new Map());
    const classMap = groupMap.get(group)!;
    if (!classMap.has(classeNom)) classMap.set(classeNom, []);
    classMap.get(classeNom)!.push(item);
  }

  return SCHOOL_GROUP_ORDER.map((group) => {
    const classMap = groupMap.get(group);
    if (!classMap) return { group, classes: [] };
    return {
      group,
      classes: Array.from(classMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([classe, items]) => ({ classe, items })),
    };
  }).filter((g) => g.classes.length > 0);
}
