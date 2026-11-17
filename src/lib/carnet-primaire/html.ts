import { MODULES, baremeTotal, type CarnetDef, type Domaine, type NiveauCarnet } from "./referentiel";
import {
  cleCompetence,
  degreMaitrise,
  moyenneAnnuelle,
  noteModule,
  type SaisieCarnet,
} from "./notation";

export interface DonneesCarnetImpression {
  ecole: string;
  /** Nom du site de l'élève (« Ecole privée MIRIAM : Site … »). */
  site?: string | null;
  annee: string;
  niveau: NiveauCarnet;
  /** Définition du carnet de ce niveau, personnalisée par la direction le cas échéant. */
  definition: CarnetDef;
  eleve: {
    nom: string;
    prenom: string;
    matricule: string;
    dateNaissance?: Date | string | null;
    lieuNaissance?: string | null;
  };
  /** Nom de la classe de l'élève (« 1ère A »), dont on tire le suffixe imprimé après « ANNEE/ ». */
  classe?: string | null;
  /** Enseignant(e) de la classe. */
  enseignant?: string | null;
  /** Image du cachet de la direction, imprimée dans l'encadré prévu. */
  cachetUrl?: string | null;
  saisie: SaisieCarnet;
  appreciations?: string | null;
  decision?: string | null;
  /** Nom de la directrice ou du directeur (Paramètres > Établissement), imprimé sur la carte d'identité. */
  directrice?: string | null;
}

/**
 * Carnet de l'enseignement fondamental — reproduction des modèles Word
 * « CARNET DE LA … ANNEE » de l'établissement : livret A4 paysage de feuilles
 * à deux volets (dos | couverture, puis carte d'identité, puis pages de
 * compétences). Mise en page, couleurs par domaine et textes fixes suivent
 * les modèles ; les images de couverture sont celles des modèles (public/carnet).
 */

const SLUG_NIVEAU: Record<NiveauCarnet, string> = {
  "1ère": "1ere",
  "2ème": "2eme",
  "3ème": "3eme",
  "4ème": "4eme",
  "5ème": "5eme",
};

/** Couleur de la carte d'identité (page 2 du livret) selon le niveau. */
const COULEUR_CARTE: Record<NiveauCarnet, string> = {
  "1ère": "#92CDDC",
  "2ème": "#C2D69B",
  "3ème": "#FABF8F",
  "4ème": "#95B3D7",
  "5ème": "#675977",
};

/** Couleur de l'en-tête du tableau Période / Observations. */
const COULEUR_PERIODE: Record<NiveauCarnet, string> = {
  "1ère": "#FABF8F",
  "2ème": "#FABF8F",
  "3ème": "#FBD4B4",
  "4ème": "#FBD4B4",
  "5ème": "#FABF8F",
};

/** Couleur de la ligne « Moyenne générale par module ». */
export const COULEUR_MOYENNE: Record<NiveauCarnet, string> = {
  "1ère": "#B8CCE4",
  "2ème": "#D6E3BC",
  "3ème": "#73BDB3",
  "4ème": "#73BDB3",
  "5ème": "#73BDB3",
};

interface Teinte {
  entete: string;
  lignes: string;
}

/** Couleurs relevées dans les modèles, par niveau puis par code de domaine. */
export const TEINTES: Record<NiveauCarnet, Record<string, Teinte>> = {
  "1ère": {
    ARABE: { entete: "#C4BC96", lignes: "#C6D9F1" },
    EMCI: { entete: "#FBD4B4", lignes: "#E5B8B7" },
    MATHS: { entete: "#D99594", lignes: "#EAF1DD" },
    FRANCAIS: { entete: "#92D050", lignes: "#FBD4B4" },
    EMT_TICE: { entete: "#9FC9EB", lignes: "#CCC0D9" },
  },
  "2ème": {
    SCIENCES: { entete: "#C4BC96", lignes: "#E5B8B7" },
    EMCI: { entete: "#FBD4B4", lignes: "#95B3D7" },
    ARABE: { entete: "#FF6161", lignes: "#FABF8F" },
    FRANCAIS: { entete: "#92D050", lignes: "#B8CCE4" },
    MATHS: { entete: "#D99594", lignes: "#D6E3BC" },
    EMT_TICE: { entete: "#9FC9EB", lignes: "#FBD4B4" },
  },
  "3ème": {
    FRANCAIS: { entete: "#DDD9C3", lignes: "#E5B8B7" },
    ARABE: { entete: "#92D050", lignes: "#B6DDE8" },
    ANGLAIS: { entete: "#D6E3BC", lignes: "#CCC0D9" },
    MATHS: { entete: "#FFC000", lignes: "#FBD4B4" },
    HISTOIRE: { entete: "#E5B8B7", lignes: "#D6E3BC" },
    GEOGRAPHIE: { entete: "#99CCFF", lignes: "#FF99CC" },
    SCIENCES: { entete: "#B686DA", lignes: "#C2D69B" },
    EMCI: { entete: "#00B0F0", lignes: "#92CDDC" },
    EMT: { entete: "#00B050", lignes: "#E9F793" },
    TICE: { entete: "#99CCFF", lignes: "#CCC0D9" },
  },
  "4ème": {
    FRANCAIS: { entete: "#DDD9C3", lignes: "#95B3D7" },
    ARABE: { entete: "#D6E3BC", lignes: "#FABF8F" },
    ANGLAIS: { entete: "#CCC0D9", lignes: "#D6E3BC" },
    MATHS: { entete: "#FABF8F", lignes: "#CCC0D9" },
    HISTOIRE: { entete: "#FFC000", lignes: "#D99594" },
    GEOGRAPHIE: { entete: "#99CCFF", lignes: "#C2D69B" },
    SCIENCES: { entete: "#E5B8B7", lignes: "#B6DDE8" },
    EMCI: { entete: "#FF0000", lignes: "#CCC0D9" },
    EMT: { entete: "#FFC000", lignes: "#C2D69B" },
    TICE: { entete: "#99CCFF", lignes: "#92D050" },
  },
  "5ème": {
    FRANCAIS: { entete: "#FABF8F", lignes: "#D6E3BC" },
    ARABE: { entete: "#C4BC96", lignes: "#FABF8F" },
    ANGLAIS: { entete: "#E5B8B7", lignes: "#8DB3E2" },
    MATHS: { entete: "#C2D69B", lignes: "#C4BC96" },
    HISTOIRE: { entete: "#FBD4B4", lignes: "#C2D69B" },
    GEOGRAPHIE: { entete: "#99CCFF", lignes: "#E5B8B7" },
    SCIENCES: { entete: "#FF5050", lignes: "#CCC0D9" },
    EMCI: { entete: "#E36C0A", lignes: "#F8A2EC" },
    EMT: { entete: "#99CCFF", lignes: "#F6F8A2" },
    TICE: { entete: "#92D050", lignes: "#EFABAB" },
  },
};

/** Teintes de repli pour un domaine ajouté par la direction (hors modèles). */
export const TEINTES_REPLI: Teinte[] = [
  { entete: "#C4BC96", lignes: "#C6D9F1" },
  { entete: "#D99594", lignes: "#EAF1DD" },
  { entete: "#92D050", lignes: "#FBD4B4" },
  { entete: "#9FC9EB", lignes: "#CCC0D9" },
  { entete: "#FABF8F", lignes: "#D6E3BC" },
];

export const CHIFFRES_ROMAINS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formaterNote(note: number | null): string {
  if (note === null) return "";
  return note.toFixed(2).replace(/\.?0+$/, "");
}

/** « 1ère » → « 1<sup>ère</sup> » : l'exposant du modèle. */
function niveauAvecExposant(niveau: NiveauCarnet): string {
  const m = niveau.match(/^(\d+)(.*)$/);
  return m ? `${m[1]}<sup>${echapper(m[2])}</sup>` : echapper(niveau);
}

/** Date de naissance au format jj/mm/aaaa. Valeur « date seule » : lue en UTC pour ne pas reculer d'un jour. */
export function formaterDateNaissance(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/**
 * Ce qui suit « ANNEE/ » sur la carte : la classe moins le niveau en tête
 * (« 1ère A » → « A »). `commenceParNiveau` vaut false quand le nom de la classe
 * ne débute pas par le niveau : il est alors imprimé tel quel.
 */
export function suffixeClasse(
  niveau: NiveauCarnet,
  classe: string | null | undefined
): { commenceParNiveau: boolean; suffixe: string } {
  const nom = (classe ?? "").trim();
  const numero = niveau.match(/^\d+/)?.[0];
  const motif = new RegExp(`^${numero}(?!\\d)\\s*(?:[eè]re|[eè]me|er|e)?\\s*(?:ann[ée]e)?\\s*[-/]?\\s*`, "i");
  if (!nom || !motif.test(nom)) return { commenceParNiveau: false, suffixe: "" };
  return { commenceParNiveau: true, suffixe: nom.replace(motif, "").trim() };
}

function teinteDomaine(niveau: NiveauCarnet, domaine: Domaine, index: number): Teinte {
  return TEINTES[niveau][domaine.code] ?? TEINTES_REPLI[index % TEINTES_REPLI.length];
}

function titreCompetences(niveau: NiveauCarnet, domaine: Domaine): string {
  return echapper(domaine.titre ?? domaine.libelle.toUpperCase());
}

function titrePoints(niveau: NiveauCarnet, domaine: Domaine, index: number): string {
  const numero = CHIFFRES_ROMAINS[index] ?? String(index + 1);
  const corps = domaine.titre ?? domaine.libelle.toUpperCase();
  return echapper(`${numero}–${corps} / ${domaine.bareme ?? ""}`.replace(/ \/ $/, ""));
}

/** Met en gras le début « CB1/Lecture: » d'une ligne, comme dans le modèle. */
function texteLignePoints(ligne: string): string {
  const m = ligne.match(/^(.{1,48}?[:/][^:]{0,30}?:|CB[^/]{0,6}\/)([\s\S]*)$/);
  if (!m) return echapper(ligne);
  return `<b>${echapper(m[1])}</b>${echapper(m[2])}`;
}

/* ───────────────────────── Feuille 1 : dos et couverture ───────────────────────── */

function ruban(niveau: NiveauCarnet): string {
  return `<div class="ruban">
  <svg viewBox="0 0 252 62" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M1 14 H251 L219 32 L251 50 H1 L33 32 Z" fill="#fff" stroke="#4F81BD" stroke-width="2"/>
    <path d="M70 44 H100 V58 Q85 62 70 58 Z M152 44 H182 V58 Q167 62 152 58 Z" fill="#BFBFBF" stroke="#4F81BD" stroke-width="1.5"/>
    <rect x="68" y="2" width="116" height="48" rx="7" fill="#fff" stroke="#4F81BD" stroke-width="2.5"/>
  </svg>
  <div class="ruban-texte">CARNET DE LA ${niveauAvecExposant(niveau)} ANNEE</div>
</div>`;
}

function tableauObservations(niveau: NiveauCarnet): string {
  const lignes = MODULES.map(
    (m) => `<tr><td class="module-nom">Module${m}</td><td></td><td></td><td></td></tr>`
  ).join("");
  return `<table class="periode" style="--fond:${COULEUR_PERIODE[niveau]}">
  <thead><tr><th class="p">PÉRIODE</th><th class="o">Observations</th><th>Signature de la directrice</th><th>Signatures des parents</th></tr></thead>
  <tbody>${lignes}</tbody>
</table>`;
}

function tableauDecision(decision: string, cachetUrl?: string | null): string {
  const cachet = cachetUrl ? `<img class="cachet" src="${echapper(cachetUrl)}" alt="Cachet">` : "";
  return `<table class="decision">
  <thead><tr><th>DECISION DE FIN D’ANNEE</th><th>CACHET DE LA DIRECTRICE</th></tr></thead>
  <tbody><tr><td class="rempli">${echapper(decision)}</td><td class="zone-cachet">${cachet}</td></tr></tbody>
</table>`;
}

function volantDos(donnees: DonneesCarnetImpression): string {
  const { niveau } = donnees;
  return `<section class="volet dos">
  ${ruban(niveau)}
  <div class="bandeau-appreciations"><span class="oeillet"></span>APPRÉCIATIONS GÉNÉRALES<span class="oeillet"></span></div>
  <div class="zone-appreciations">${echapper(donnees.appreciations ?? "")}</div>
  ${tableauObservations(niveau)}
  ${tableauDecision(donnees.decision ?? "", donnees.cachetUrl)}
</section>`;
}

function volantCouverture(niveau: NiveauCarnet): string {
  const slug = SLUG_NIVEAU[niveau];
  const cadre = niveau === "1ère" || niveau === "2ème" ? "" : " cadre";
  const entete =
    niveau === "1ère" || niveau === "2ème"
      ? `<div class="republique">
    <img class="embleme" src="/carnet/emblem-ministere.png" alt="">
    <p class="rep-1">RÉPUBLIQUE DE DJIBOUTI</p>
    <p class="rep-2">UNITÉ-ÉGALITÉ-PAIX</p>
    <p class="rep-3">MINISTÈRE DE L’ÉDUCATION NATIONALE<br>ET DE LA FORMATION PROFESSIONNELLE</p>
  </div>`
      : "";
  return `<section class="volet couverture">
  ${entete}
  <div class="vignette${cadre}"><img src="/carnet/couverture-${slug}.jpg" alt="Carnet d'évaluation — ${echapper(niveau)} année"></div>
</section>`;
}

/* ───────────────────── Feuille 2 : carte d'identité du livret ───────────────────── */

function carteIdentite(donnees: DonneesCarnetImpression): string {
  const { niveau, eleve } = donnees;
  const libelleMatricule = niveau === "1ère" || niveau === "2ème" ? "MATRICULE" : "IMATRICULE";
  const nomEleve = `${eleve.nom} ${eleve.prenom}`.trim();
  const rempli = (valeur: string, points: string) =>
    valeur ? `<span class="rempli">${echapper(valeur)}</span>` : points;
  const { commenceParNiveau, suffixe } = suffixeClasse(niveau, donnees.classe);
  const classeNom = donnees.classe?.trim() ?? "";
  // Niveau + suffixe quand le nom de la classe le permet ; sinon le nom tel quel ; sinon pointillés.
  const classe =
    commenceParNiveau || !classeNom
      ? `<span class="rouge">${niveauAvecExposant(niveau)} ANNEE</span><span class="grand">/${suffixe ? echapper(suffixe) : "……"}</span>`
      : `<span class="rouge">${echapper(classeNom)}</span>`;
  const ecole = donnees.ecole.trim() || "Ecole privée";
  return `<div class="carte carte-${SLUG_NIVEAU[niveau]}" style="--carte:${COULEUR_CARTE[niveau]}">
  <p class="carte-titre">${echapper(ecole)} : ${rempli(donnees.site?.trim() ?? "", "Site …")}</p>
  <p>Nom de l’élève&nbsp;: ${rempli(nomEleve, "……………………………………………………………")}</p>
  <p>${libelleMatricule}&nbsp;: ${rempli(eleve.matricule, "……………………………………………")}</p>
  <p>Né(e)&nbsp;le : ${rempli(formaterDateNaissance(eleve.dateNaissance), "…………………………………………")} à ${rempli(eleve.lieuNaissance?.trim() ?? "", "…………………………………………")}</p>
  <p class="carte-classe">Classe&nbsp;: ${classe}</p>
  <p>Nom de l’enseignant(e)&nbsp;: ${rempli(donnees.enseignant?.trim() ?? "", "……………………………………………..")}</p>
  <p>Nom de la directrice&nbsp;: ${rempli(donnees.directrice?.trim() ?? "", "……………………………………………..")}</p>
</div>`;
}

function bandeauEnseignement(annee: string): string {
  const [debut, fin] = annee.split("-");
  return `<div class="bandeau-enseignement">ENSEIGNEMENT FONDAMENTAL (ECOLE DE BASE) <span>Année Scolaire${echapper(debut ?? "")} /${echapper(fin ?? "")}</span></div>`;
}

/* ───────────────────────── Pages de compétences ───────────────────────── */

function enTeteModules(): string {
  return `<tr class="modules"><td class="vide"></td>${MODULES.map((m) => `<th colspan="3">Module ${m}</th>`).join("")}</tr>
<tr class="evals"><td class="fond-lignes"></td>${MODULES.map(() => "<th>A</th><th>EVA</th><th>NA</th>").join("")}</tr>`;
}

function blocDomaineCompetences(donnees: DonneesCarnetImpression, domaine: Domaine, index: number): string {
  const { niveau, saisie } = donnees;
  const teinte = teinteDomaine(niveau, domaine, index);
  const gras = ["ARABE", "EMCI", "EMT_TICE", "SCIENCES"].includes(domaine.code) ? " gras" : "";
  const lignes = domaine.lignes
    .map((ligne, i) => {
      const cle = cleCompetence(domaine, i);
      const cellules = MODULES.map((m) => {
        const valeur = saisie[`${m}`]?.competences?.[cle];
        return (["A", "EVA", "NA"] as const)
          .map((lettre, k) => `<td class="ev${k === 0 ? " debut" : ""}">${valeur === lettre ? "✓" : ""}</td>`)
          .join("");
      }).join("");
      return `<tr><td class="lib${gras}" style="background:${teinte.lignes}"><span class="puce">●</span> C${i + 1}/ ${echapper(ligne)}</td>${cellules}</tr>`;
    })
    .join("");
  return `<table class="domaine competences">
  <colgroup><col class="c-lib">${MODULES.map(() => '<col class="c-ev"><col class="c-ev"><col class="c-ev">').join("")}</colgroup>
  <thead>
    <tr><th class="titre" colspan="13" style="background:${teinte.entete}"><span class="pastille"></span>${titreCompetences(niveau, domaine)}</th></tr>
    ${enTeteModules().replace('<td class="fond-lignes">', `<td class="fond-lignes" style="background:${teinte.lignes}">`)}
  </thead>
  <tbody>${lignes}</tbody>
</table>`;
}

function blocDomainesPoints(donnees: DonneesCarnetImpression): string {
  const { niveau, saisie, definition } = donnees;
  const corps = definition.domaines
    .map((domaine, index) => {
      const teinte = teinteDomaine(niveau, domaine, index);
      const enTete = `<tr><td class="titre" colspan="5" style="background:${teinte.entete}"><span class="pastille"></span>${titrePoints(niveau, domaine, index)}</td></tr>`;
      const lignes = domaine.lignes
        .map((ligne, i) => {
          const notes =
            i === 0
              ? MODULES.map((m) => {
                  const points = saisie[`${m}`]?.domaines?.[domaine.code];
                  return `<td class="pts" rowspan="${domaine.lignes.length}">${points === undefined ? "" : formaterNote(points)}</td>`;
                }).join("")
              : "";
          return `<tr><td class="lib" style="background:${teinte.lignes}">${texteLignePoints(ligne)}</td>${notes}</tr>`;
        })
        .join("");
      return `<tbody>${enTete}${lignes}</tbody>`;
    })
    .join("");
  const modules = MODULES.map((m) => `<th>Module${m}</th>`).join("");
  return `<table class="domaine points">
  <colgroup><col class="p-lib">${MODULES.map(() => '<col class="p-pts">').join("")}</colgroup>
  <thead><tr class="modules-points"><td class="vide"></td>${modules}</tr></thead>
  ${corps}
</table>`;
}

function blocsSynthese(donnees: DonneesCarnetImpression): string {
  const { niveau, definition, saisie } = donnees;
  const notes = MODULES.map((m) => noteModule(definition, saisie[`${m}`]));
  const moyenne = moyenneAnnuelle(definition, saisie);
  const cellulesNotes = notes
    .map((note) => {
      const degre = note === null ? "" : degreMaitrise(note);
      return `<td class="note">${formaterNote(note)}${degre ? `<small>${echapper(degre)}</small>` : ""}</td>`;
    })
    .join("");
  const barème =
    definition.format === "points" ? `<p class="total-bareme">Total des barèmes : /${baremeTotal(definition)}</p>` : "";
  return `<div class="synthese">
  <table class="moyennes" style="--fond:${COULEUR_MOYENNE[niveau]}">
    <thead><tr><th class="titre-moyenne">MOYENNE GÉNÉRALE PAR MODULE</th>${MODULES.map((m) => `<th>Module${m}</th>`).join("")}</tr></thead>
    <tbody><tr><td class="note-sur">NOTE SUR 10</td>${cellulesNotes}</tr></tbody>
  </table>
  ${barème}
  <table class="maitrise" style="--fond:${niveau === "2ème" ? "#FFFF00" : "#FBD4B4"}">
    <thead><tr><th colspan="4" class="bandeau-maitrise">DEGRE DE MAITRISE DE LA COMPETENCE DE BASE</th></tr></thead>
    <tbody>
      <tr><td rowspan="2" class="correspondantes">Notes correspondantes</td><td class="jaune">Acquis</td><td class="jaune">En voie d’acquisition</td><td class="jaune">Non acquis</td></tr>
      <tr><td class="bar">7 à 10</td><td class="bar">4 à 6</td><td class="bar">0 à 3</td></tr>
      <tr><td colspan="4" class="espace"></td></tr>
      <tr><td class="annuelle"><span>MOYENNE GÉNÉRALE ANNUELLE</span></td><td colspan="3" class="valeur">${formaterNote(moyenne)}</td></tr>
    </tbody>
  </table>
</div>`;
}

function pagesInterieures(donnees: DonneesCarnetImpression): string {
  const { definition } = donnees;
  if (definition.format === "points") {
    return `<main class="interieur"><div class="interieur-contenu points-page">${blocDomainesPoints(donnees)}${blocsSynthese(donnees)}</div></main>`;
  }
  const blocs = definition.domaines.map((d, i) => blocDomaineCompetences(donnees, d, i)).join("");
  return `<main class="interieur"><div class="interieur-contenu competences-page">${blocs}${blocsSynthese(donnees)}</div></main>`;
}

const STYLES = `
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Tahoma, "Trebuchet MS", Verdana, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media screen { body { background: #6b6b6b; padding: 8mm 0; } .feuille, .interieur { margin: 0 auto 8mm; box-shadow: 0 2px 10px rgba(0,0,0,.45); } }
  sup { font-size: .6em; line-height: 0; vertical-align: super; }

  .feuille { width: 297mm; height: 210mm; display: flex; background: #fff; position: relative; overflow: hidden; break-after: page; page-break-after: always; }
  .volet { width: 148.5mm; height: 210mm; position: relative; padding: 6mm 9mm 0 12mm; }

  /* Dos : ruban, appréciations, observations, décision */
  .ruban { position: relative; width: 126mm; height: 31mm; margin-left: -2mm; z-index: 2; }
  .ruban svg { width: 100%; height: 100%; display: block; }
  .ruban-texte { position: absolute; left: 34.5mm; top: 5mm; width: 57mm; height: 19.5mm; display: flex; align-items: center; justify-content: center; text-align: center;
    font: bold 11pt "Times New Roman", Times, serif; color: #FF0000; }
  .bandeau-appreciations { position: relative; margin: -9mm 0 0 7mm; width: 125mm; height: 16mm; background: #FFE383; color: #3333A0; display: flex; align-items: flex-end; justify-content: center;
    padding-bottom: 2mm; font: 15pt "Trebuchet MS", Tahoma, sans-serif; letter-spacing: .2px; z-index: 1; }
  .oeillet { position: absolute; bottom: 3mm; width: 4.2mm; height: 4.2mm; border-radius: 50%; background: #fff; }
  .oeillet:first-child { left: 3mm; } .oeillet:last-child { right: 3mm; }
  .zone-appreciations { margin: 2mm 0 0 7mm; width: 125mm; height: 40mm; padding: 2mm 3mm; font-size: 9pt; line-height: 1.4; white-space: pre-wrap; overflow: hidden; }

  table.periode { width: 116mm; margin: 4mm 0 0 7mm; border-collapse: collapse; table-layout: fixed; }
  table.periode th, table.periode td { border: 1px solid #000; }
  table.periode th { background: var(--fond); font: bold 8pt Tahoma, sans-serif; padding: 2mm 1mm; vertical-align: middle; }
  table.periode th.p { width: 19mm; text-align: left; } table.periode th.o { width: 56mm; font-size: 12pt; }
  table.periode td { height: 14mm; }
  table.periode td.module-nom { color: #FF0000; font: bold 8.5pt Tahoma, sans-serif; vertical-align: bottom; padding: 0 1mm 1.5mm; }

  table.decision { width: 116mm; margin: 4mm 0 0 7mm; border-collapse: collapse; table-layout: fixed; }
  table.decision th { background: #FFFF00; color: #FF0000; font: italic bold 9pt Arial, sans-serif; border: 1px solid #7F7F7F; padding: 2.4mm 1mm; }
  table.decision td { height: 22mm; border: 1px solid #7F7F7F; border-top: 0; padding: 2mm; font-size: 9pt; vertical-align: top; }
  table.decision td.zone-cachet { text-align: center; vertical-align: middle; padding: 1mm; }
  .cachet { max-width: 100%; max-height: 19mm; object-fit: contain; }

  /* Couverture */
  .couverture { padding: 6mm 12mm 0 9mm; }
  .republique { position: relative; text-align: center; padding: 6mm 0 0; height: 30mm; }
  .republique p { margin: 0; }
  .rep-1 { font: 10pt "Times New Roman", Times, serif; letter-spacing: .3px; }
  .rep-2 { font: 7pt "Times New Roman", Times, serif; margin-top: 1mm !important; }
  .rep-3 { font: bold 7.5pt Arial, Helvetica, sans-serif; margin-top: 4mm !important; line-height: 1.6; }
  .embleme { position: absolute; right: -2mm; top: 0; width: 23mm; height: 23mm; }
  .vignette { margin: 6mm auto 0; width: 128mm; }
  .vignette img { width: 100%; display: block; }
  .vignette.cadre { margin-top: 4mm; border: 1.4mm solid #F79646; border-radius: 12mm; padding: 5mm 4mm 4mm; width: 132mm; }

  /* Carte d'identité */
  .carte { position: absolute; right: 12mm; top: 7mm; width: 126mm; border-radius: 13mm; padding: 5mm 7mm 5mm; font: bold 11pt Calibri, Tahoma, sans-serif; color: #000;
    box-shadow: .8mm .8mm 2.2mm rgba(0,0,0,.25); }
  .carte-1ere, .carte-2eme { background: radial-gradient(ellipse at 50% 55%, color-mix(in srgb, var(--carte) 45%, #2F4F5F) 0%, var(--carte) 75%); }
  .carte-3eme, .carte-4eme { background: linear-gradient(135deg, color-mix(in srgb, var(--carte) 70%, #fff), var(--carte) 55%, color-mix(in srgb, var(--carte) 82%, #000)); }
  .carte-5eme { background: linear-gradient(135deg, #B39DCB, var(--carte) 62%, #655874); }
  .carte p { margin: 0 0 4.6mm; white-space: nowrap; overflow: hidden; }
  .carte-titre { text-align: center; font-size: 13pt; }
  .carte-classe { text-align: center; } .rouge { color: #FF0000; } .grand { font-size: 15pt; }
  .carte .rempli { font-weight: 700; }
  .bandeau-enseignement { position: absolute; left: 12mm; right: 12mm; top: 132mm; height: 15mm; border: .8mm solid #385D8A; border-radius: 3.5mm; background: transparent;
    display: flex; align-items: center; justify-content: center; font: italic bold 13pt "Times New Roman", Times, serif; color: #262626; }
  .bandeau-enseignement span { color: #7030A0; margin-left: 1.5mm; }

  /* Pages de compétences */
  /* Feuille 3 : exactement une page A4 paysage. Le contenu est réduit par ajusterCarnetUnePage()
     (ajuster-page.ts) quand il dépasse ; le débordement est masqué plutôt que reporté sur une 2e page. */
  .interieur { width: 297mm; height: 210mm; padding: 8mm 12mm; background: #fff; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
  .interieur-contenu { transform-origin: 0 0; }
  .competences-page { column-count: 2; column-gap: 12mm; }
  table.domaine { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 3mm; break-inside: avoid; page-break-inside: avoid; border: 1px solid #333; }
  table.domaine th, table.domaine td { border: 1px solid #333; }
  table.domaine .titre { text-align: left; font: bold 10.5pt Tahoma, sans-serif; padding: 1.2mm 1mm; color: #1F1F1F; border: 1px solid #333; }
  .pastille { display: inline-block; width: 3.4mm; height: 3.4mm; border-radius: 50%; background: #fff; margin-right: 1mm; vertical-align: -.5mm; }
  col.c-lib { width: 50mm; } col.c-ev { width: 6.2mm; }
  tr.modules .vide { background: #fff; border: 0; border-bottom: 1px solid #333; }
  tr.modules th { background: #00937D; color: #fff; font: bold 8pt Tahoma, sans-serif; padding: 1.4mm .5mm; border-left: 2px solid #C0C0C0; text-align: left; }
  tr.evals th { background: #FFFF00; font: bold 6pt Tahoma, sans-serif; padding: .6mm 0; text-align: center; line-height: 1.15; word-break: break-all; }
  tr.evals .fond-lignes { height: 6mm; }
  td.lib { font: 7.5pt Tahoma, sans-serif; padding: 1mm 1.5mm; vertical-align: middle; line-height: 1.3; height: 12mm; }
  td.lib.gras { font-weight: 700; }
  .puce { font-size: 5pt; vertical-align: 1pt; }
  td.ev { height: 12mm; text-align: center; font-size: 11pt; color: #000; padding: 0; }
  td.ev.debut { border-left: 2px solid #C0C0C0; }

  table.points col.p-lib { width: auto; } table.points col.p-pts { width: 13mm; }
  table.points { margin-top: 0; }
  table.points .modules-points .vide { border: 0; background: #fff; }
  table.points .modules-points th { background: #FFFF00; font: bold 6.5pt Tahoma, sans-serif; padding: 1mm 0; border: 1px solid #333; word-break: break-all; line-height: 1.1; }
  table.points thead { display: table-header-group; }
  table.points tbody { break-inside: avoid; page-break-inside: avoid; }
  table.points td.lib { font-size: 7pt; height: auto; padding: 1.4mm 1.5mm; line-height: 1.35; font-weight: 400; }
  table.points td.lib b { font-weight: 700; }
  table.points tr { break-inside: avoid; page-break-inside: avoid; }
  td.pts { text-align: center; font: bold 9.5pt Tahoma, sans-serif; padding: 0; vertical-align: middle; background: #fff; }

  .synthese { break-inside: avoid; page-break-inside: avoid; margin-top: 3mm; }
  table.moyennes { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #333; }
  table.moyennes th, table.moyennes td { border: 1px solid #333; }
  table.moyennes th.titre-moyenne { background: var(--fond); font: bold 8pt Tahoma, sans-serif; width: 40%; padding: 1.6mm; text-align: left; }
  table.moyennes th { background: #FFFF00; font: bold 7.5pt Tahoma, sans-serif; padding: 1.6mm 0; }
  td.note-sur { font: bold 10pt Tahoma, sans-serif; text-align: center; height: 15mm; }
  td.note { text-align: center; font: bold 10pt Tahoma, sans-serif; } td.note small { display: block; font: 5.5pt Tahoma, sans-serif; font-weight: 400; }
  .total-bareme { margin: 1mm 0 0; font-size: 7pt; }
  table.maitrise { width: 100%; margin-top: 3mm; border-collapse: collapse; table-layout: fixed; border: 1px solid #333; }
  table.maitrise td, table.maitrise th { border: 1px solid #333; }
  th.bandeau-maitrise { background: var(--fond); color: #FF0000; font: bold 10pt Tahoma, sans-serif; padding: 1.8mm; }
  td.correspondantes { width: 40%; font: bold 10pt Tahoma, sans-serif; text-align: center; padding: 0 1mm; }
  td.jaune { background: #FFFF00; font: bold 8.5pt Tahoma, sans-serif; text-align: center; padding: 1.4mm; }
  td.bar { text-align: center; font: bold 10.5pt Tahoma, sans-serif; padding: 1.6mm; }
  td.espace { height: 6mm; }
  td.annuelle { text-align: center; padding: 2mm; } td.annuelle span { display: inline-block; background: #FBD4B4; font: bold 9pt Tahoma, sans-serif; padding: 1.5mm 4mm; }
  td.valeur { text-align: center; font: bold 12pt Tahoma, sans-serif; }

  /* Format points : dix domaines et la synthèse tiennent sur une page ; on resserre les
     espacements verticaux (la mise en page des modèles suppose plusieurs pages) pour que
     la réduction à l'impression reste lisible. */
  .points-page { padding-left: 0; padding-right: 0; }
  .points-page table.domaine { margin-bottom: 1.2mm; }
  .points-page table.domaine .titre { font-size: 9pt; padding: .5mm 1mm; }
  .points-page table.points td.lib { padding: .6mm 1.5mm; line-height: 1.25; }
  .points-page .synthese { margin-top: 1.5mm; }
  .points-page td.note-sur { height: 9mm; }
  .points-page table.moyennes th { padding: .8mm 0; }
  .points-page table.moyennes th.titre-moyenne { padding: .8mm 1.6mm; }
  .points-page table.maitrise { margin-top: 1.5mm; }
  .points-page th.bandeau-maitrise { padding: .8mm; }
  .points-page td.jaune, .points-page td.bar { padding: .6mm; }
  .points-page td.espace { height: 2mm; }
  .points-page td.annuelle { padding: 1mm; }
`;

/** HTML imprimable d'un carnet de 1ère à 5ème année, prêt pour openPrintWindow. */
export function genererCarnetHtml(donnees: DonneesCarnetImpression): string {
  const { eleve, niveau, annee } = donnees;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Carnet ${echapper(niveau)} année — ${echapper(eleve.nom)} ${echapper(eleve.prenom)} — ${echapper(donnees.ecole)}</title>
<style>${STYLES}</style>
</head>
<body>
  <div class="feuille" aria-label="Dos et couverture">${volantDos(donnees)}${volantCouverture(niveau)}</div>
  <div class="feuille" aria-label="Carte d'identité"><section class="volet"></section><section class="volet">${carteIdentite(donnees)}</section>${bandeauEnseignement(annee)}</div>
  ${pagesInterieures(donnees)}
</body>
</html>`;
}
