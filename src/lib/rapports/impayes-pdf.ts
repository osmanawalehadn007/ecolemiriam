/**
 * Rendu PDF du rapport des mensualités impayées (un document par site).
 *
 * pdf-lib plutôt que pdfkit : pdfkit lit ses polices AFM sur le disque, que le
 * build Next « standalone » n'embarque pas. pdf-lib est du JS pur.
 * Les polices standard n'encodent que le Latin-1 : les caractères hors jeu
 * (ex. nom écrit en arabe) sont remplacés par « ? » plutôt que de faire
 * échouer tout le rapport.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { RapportSite } from "./impayes";

export const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const A4 = { w: 595.28, h: 841.89 };
const MARGE = 40;
const HAUTEUR_LIGNE = 16;
const BAS = 50;

const COL_NUM = MARGE;
const COL_NOM = MARGE + 24;
const COL_MOIS_DROITE = A4.w - MARGE - 130;
const COL_ANNEE_DROITE = A4.w - MARGE;

/** « 1 250 000 » — espaces simples (l'espace insécable fine d'Intl n'est pas encodable). */
export function formaterMontant(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

const gris = rgb(0.4, 0.4, 0.4);
const noir = rgb(0.1, 0.1, 0.1);
const bleu = rgb(0.12, 0.25, 0.69);
const rouge = rgb(0.75, 0.13, 0.13);
const fond = rgb(0.93, 0.95, 0.99);

export async function genererPdfImpayes(opts: {
  ecole: string;
  rapport: RapportSite;
  annee: number;
  mois: number;
  genereLe: Date;
}): Promise<Uint8Array> {
  const { ecole, rapport, annee, mois, genereLe } = opts;
  const pdf = await PDFDocument.create();
  const police = await pdf.embedFont(StandardFonts.Helvetica);
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  const jeu = new Set(police.getCharacterSet());

  const propre = (t: string) => Array.from(t.normalize("NFC")).map((c) => (jeu.has(c.codePointAt(0)!) ? c : "?")).join("");
  const largeur = (t: string, f: PDFFont, taille: number) => f.widthOfTextAtSize(propre(t), taille);
  const tronque = (t: string, f: PDFFont, taille: number, max: number) => {
    let s = propre(t);
    while (s.length > 1 && f.widthOfTextAtSize(s, taille) > max) s = s.slice(0, -1);
    return s;
  };

  const moisNom = MOIS_NOMS[mois - 1];
  let page: PDFPage;
  let y = 0;

  const ecrire = (t: string, x: number, taille: number, f: PDFFont = police, couleur = noir) =>
    page.drawText(propre(t), { x, y, size: taille, font: f, color: couleur });
  const droite = (t: string, xDroite: number, taille: number, f: PDFFont = police, couleur = noir) =>
    page.drawText(propre(t), { x: xDroite - largeur(t, f, taille), y, size: taille, font: f, color: couleur });

  const enteteColonnes = () => {
    ecrire("N°", COL_NUM, 8, gras, gris);
    ecrire("Élève (matricule)", COL_NOM, 8, gras, gris);
    droite(`Impayé ${moisNom}`, COL_MOIS_DROITE, 8, gras, gris);
    droite("Total impayé année", COL_ANNEE_DROITE, 8, gras, gris);
    y -= 4;
    page.drawLine({ start: { x: MARGE, y }, end: { x: A4.w - MARGE, y }, thickness: 0.5, color: gris });
    y -= HAUTEUR_LIGNE - 4;
  };

  const nouvellePage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - MARGE;
    ecrire(ecole, MARGE, 14, gras, bleu);
    y -= 17;
    ecrire(`${rapport.siteNom} — Mensualités impayées, ${moisNom} ${annee}`, MARGE, 10.5, gras);
    y -= 13;
    ecrire(`Édité le ${genereLe.toLocaleDateString("fr-FR", { timeZone: "Africa/Djibouti" })} · montants en DJF · année scolaire jusqu'à ${moisNom} ${annee} inclus`, MARGE, 8, police, gris);
    y -= 22;
  };

  const assurerPlace = (hauteur: number) => {
    if (y - hauteur < BAS) nouvellePage();
  };

  nouvellePage();

  // Synthèse du site
  page!.drawRectangle({ x: MARGE, y: y - 38, width: A4.w - 2 * MARGE, height: 46, color: fond });
  y -= 8;
  ecrire(`${rapport.nbEleves} élève${rapport.nbEleves > 1 ? "s" : ""} avec un solde de mensualités à régler`, MARGE + 8, 9.5, gras);
  y -= 15;
  ecrire(`Impayé ${moisNom} : ${formaterMontant(rapport.totalMois)}`, MARGE + 8, 9.5, police);
  ecrire(`Total impayé sur l'année : ${formaterMontant(rapport.totalAnnee)}`, MARGE + 230, 9.5, gras, rouge);
  y -= 34;

  if (rapport.nbEleves === 0) {
    ecrire("Aucun élève n'a de mensualité impayée sur ce site.", MARGE, 10);
  }

  for (const structure of rapport.structures) {
    assurerPlace(60);
    page!.drawRectangle({ x: MARGE, y: y - 5, width: A4.w - 2 * MARGE, height: 18, color: bleu });
    ecrire(structure.nom.toUpperCase(), MARGE + 6, 10, gras, rgb(1, 1, 1));
    droite(formaterMontant(structure.totalMois), COL_MOIS_DROITE, 9, gras, rgb(1, 1, 1));
    droite(formaterMontant(structure.totalAnnee), COL_ANNEE_DROITE - 4, 9, gras, rgb(1, 1, 1));
    y -= 26;

    for (const classe of structure.classes) {
      assurerPlace(HAUTEUR_LIGNE * 4);
      ecrire(`${classe.nom} — ${classe.eleves.length} élève${classe.eleves.length > 1 ? "s" : ""}`, MARGE, 10, gras);
      y -= 14;
      enteteColonnes();

      classe.eleves.forEach((e, i) => {
        if (y - HAUTEUR_LIGNE < BAS) {
          nouvellePage();
          ecrire(`${classe.nom} (suite)`, MARGE, 10, gras);
          y -= 14;
          enteteColonnes();
        }
        ecrire(String(i + 1), COL_NUM, 9, police, gris);
        ecrire(tronque(`${e.nom.toUpperCase()} ${e.prenom}  (${e.matricule})`, police, 9, COL_MOIS_DROITE - COL_NOM - 90), COL_NOM, 9);
        if (e.resteMois > 0) droite(formaterMontant(e.resteMois), COL_MOIS_DROITE, 9);
        else droite("—", COL_MOIS_DROITE, 9, police, gris);
        droite(formaterMontant(e.resteAnnee), COL_ANNEE_DROITE, 9, gras, rouge);
        y -= HAUTEUR_LIGNE;
      });

      page!.drawLine({ start: { x: MARGE, y: y + 11 }, end: { x: A4.w - MARGE, y: y + 11 }, thickness: 0.3, color: gris });
      ecrire(`Sous-total ${classe.nom}`, COL_NOM, 8.5, gras, gris);
      droite(formaterMontant(classe.totalMois), COL_MOIS_DROITE, 9, gras);
      droite(formaterMontant(classe.totalAnnee), COL_ANNEE_DROITE, 9, gras);
      y -= HAUTEUR_LIGNE + 10;
    }
    y -= 4;
  }

  if (rapport.nbEleves > 0) {
    assurerPlace(40);
    page!.drawLine({ start: { x: MARGE, y: y + 8 }, end: { x: A4.w - MARGE, y: y + 8 }, thickness: 1, color: noir });
    ecrire(`TOTAL ${rapport.siteNom.toUpperCase()}`, MARGE, 10, gras);
    droite(formaterMontant(rapport.totalMois), COL_MOIS_DROITE, 10, gras);
    droite(formaterMontant(rapport.totalAnnee), COL_ANNEE_DROITE, 10, gras, rouge);
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = `Page ${i + 1}/${pages.length}`;
    p.drawText(t, { x: A4.w - MARGE - police.widthOfTextAtSize(t, 8), y: 26, size: 8, font: police, color: gris });
  });

  return pdf.save();
}
