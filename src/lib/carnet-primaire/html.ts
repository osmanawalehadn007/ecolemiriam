import { MODULES, baremeTotal, type CarnetDef, type NiveauCarnet } from "./referentiel";
import {
  cleCompetence,
  degreMaitrise,
  moyenneAnnuelle,
  noteModule,
  type SaisieCarnet,
} from "./notation";

export interface DonneesCarnetImpression {
  ecole: string;
  annee: string;
  niveau: NiveauCarnet;
  /** Définition du carnet de ce niveau, personnalisée par la direction le cas échéant. */
  definition: CarnetDef;
  eleve: { nom: string; prenom: string; matricule: string };
  saisie: SaisieCarnet;
  appreciations?: string | null;
  decision?: string | null;
}

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formaterNote(note: number | null): string {
  if (note === null) return "—";
  return note.toFixed(2).replace(/\.?0+$/, "");
}

function cellulesEvaluation(valeur: string | undefined): string {
  return (["A", "EVA", "NA"] as const)
    .map((lettre) => `<td class="ev">${valeur === lettre ? "✓" : ""}</td>`)
    .join("");
}

function blocCompetences(donnees: DonneesCarnetImpression): string {
  const { definition, saisie } = donnees;
  const enTetes = MODULES.map((m) => `<th colspan="3">Module ${m}</th>`).join("");
  const sousEnTetes = MODULES.map(() => "<th>A</th><th>EVA</th><th>NA</th>").join("");

  const lignes = definition.domaines
    .map((domaine) =>
      domaine.lignes
        .map((ligne, index) => {
          const cle = cleCompetence(domaine, index);
          const cellules = MODULES.map((m) =>
            cellulesEvaluation(saisie[`${m}`]?.competences?.[cle])
          ).join("");
          const libelle = index === 0 ? `<strong>${echapper(domaine.libelle)}</strong><br>` : "";
          return `<tr><td class="lib">${libelle}${echapper(ligne)}</td>${cellules}</tr>`;
        })
        .join("")
    )
    .join("");

  return `<table class="grille"><thead><tr><th rowspan="2">Compétences</th>${enTetes}</tr><tr>${sousEnTetes}</tr></thead><tbody>${lignes}</tbody></table>`;
}

function blocPoints(donnees: DonneesCarnetImpression): string {
  const { definition, saisie } = donnees;
  const enTetes = MODULES.map((m) => `<th>Module ${m}</th>`).join("");
  const lignes = definition.domaines
    .map((domaine) => {
      const cellules = MODULES.map((m) => {
        const points = saisie[`${m}`]?.domaines?.[domaine.code];
        return `<td class="num">${points === undefined ? "" : formaterNote(points)}</td>`;
      }).join("");
      return `<tr><td class="lib"><strong>${echapper(domaine.libelle)}</strong><br>${domaine.lignes
        .map(echapper)
        .join("<br>")}</td><td class="num">/${domaine.bareme}</td>${cellules}</tr>`;
    })
    .join("");
  return `<table class="grille"><thead><tr><th>Domaine</th><th>Barème</th>${enTetes}</tr></thead><tbody>${lignes}</tbody></table>
<p class="total">Total des barèmes : /${baremeTotal(definition)}</p>`;
}

function blocNotesModules(donnees: DonneesCarnetImpression): string {
  const { definition, saisie } = donnees;
  const cellules = MODULES.map((m) => {
    const note = noteModule(definition, saisie[`${m}`]);
    const degre = note === null ? "" : degreMaitrise(note);
    return `<td class="num">${formaterNote(note)}</td><td class="degre">${degre}</td>`;
  }).join("");
  const entetes = MODULES.map((m) => `<th colspan="2">Module ${m}</th>`).join("");
  const moyenne = moyenneAnnuelle(definition, saisie);
  return `<table class="grille notes"><thead><tr><th>Moyenne générale par module</th>${entetes}<th>Moyenne annuelle</th></tr></thead>
<tbody><tr><td>Note sur 10</td>${cellules}<td class="num strong">${formaterNote(moyenne)}</td></tr></tbody></table>
<p class="legende">Degré de maîtrise : Acquis 7 à 10 · En voie d'acquisition 4 à 6 · Non acquis 0 à 3</p>`;
}

/** HTML imprimable d'un carnet de 1ère à 5ème année, prêt pour openPrintWindow. */
export function genererCarnetHtml(donnees: DonneesCarnetImpression): string {
  const { eleve, niveau, annee, ecole } = donnees;
  const bloc = donnees.definition.format === "competences" ? blocCompetences(donnees) : blocPoints(donnees);

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Carnet ${echapper(niveau)} année — ${echapper(eleve.nom)} ${echapper(eleve.prenom)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #111; }
  h1 { font-size: 16px; text-align: center; margin: 4px 0; }
  .entete { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .identite td { padding: 2px 6px; }
  table.grille { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.grille th, table.grille td { border: 1px solid #555; padding: 2px 4px; }
  table.grille th { background: #eee; }
  td.lib { width: 55%; }
  td.ev, td.num { text-align: center; width: 36px; }
  td.degre { font-size: 9px; text-align: center; }
  .strong { font-weight: 700; }
  .total, .legende { margin: 4px 0; font-size: 9px; }
  .bloc { margin-top: 10px; }
  .zone { border: 1px solid #555; min-height: 40px; padding: 4px; margin-top: 4px; }
</style>
</head>
<body>
  <div class="entete"><div>${echapper(ecole)}</div><div>Année scolaire ${echapper(annee)}</div></div>
  <h1>CARNET DE LA ${echapper(niveau)} ANNÉE</h1>
  <table class="identite">
    <tr><td>Nom de l'élève :</td><td><strong>${echapper(eleve.nom)} ${echapper(eleve.prenom)}</strong></td>
        <td>Matricule :</td><td>${echapper(eleve.matricule)}</td></tr>
    <tr><td>Classe :</td><td>${echapper(niveau)} année</td><td></td><td></td></tr>
  </table>
  <div class="bloc">${bloc}</div>
  <div class="bloc">${blocNotesModules(donnees)}</div>
  <div class="bloc"><strong>Appréciations générales</strong><div class="zone">${echapper(donnees.appreciations ?? "")}</div></div>
  <div class="bloc"><strong>Décision de fin d'année</strong><div class="zone">${echapper(donnees.decision ?? "")}</div></div>
</body>
</html>`;
}
