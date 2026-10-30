/**
 * Enregistre le bulletin affiché en PDF, depuis le navigateur.
 *
 * Le serveur n'a pas de moteur de rendu : la page est photographiée
 * (html2canvas) puis placée sur une page A4 (pdf-lib). Les deux bibliothèques
 * ne sont chargées qu'au clic, hors du premier chargement de la page.
 */

const A4 = { largeur: 595.28, hauteur: 841.89 }; // points
const MARGE = 14;

export function nomFichierBulletin(parties: (string | null | undefined)[]): string {
  const base = parties
    .filter((p): p is string => !!p && p.trim() !== "")
    .join("_")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || "Bulletin"}.pdf`;
}

/** Dimensions de l'image à placer sur la page : tient dans la zone utile, ratio conservé. */
export function dimensionsSurPage(largeurPx: number, hauteurPx: number) {
  const zoneL = A4.largeur - 2 * MARGE;
  const zoneH = A4.hauteur - 2 * MARGE;
  const ratio = Math.min(zoneL / largeurPx, zoneH / hauteurPx);
  const largeur = largeurPx * ratio;
  const hauteur = hauteurPx * ratio;
  return { largeur, hauteur, x: (A4.largeur - largeur) / 2, y: A4.hauteur - MARGE - hauteur };
}

export async function telechargerBulletinPdf(element: HTMLElement, nomFichier: string): Promise<void> {
  const [{ default: html2canvas }, { PDFDocument }] = await Promise.all([
    import("html2canvas"),
    import("pdf-lib"),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });
  const jpeg = canvas.toDataURL("image/jpeg", 0.92);
  const octets = Uint8Array.from(atob(jpeg.split(",")[1]), (c) => c.charCodeAt(0));

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.largeur, A4.hauteur]);
  const image = await pdf.embedJpg(octets);
  const { largeur, hauteur, x, y } = dimensionsSurPage(canvas.width, canvas.height);
  page.drawImage(image, { x, y, width: largeur, height: hauteur });
  pdf.setTitle(nomFichier.replace(/\.pdf$/, ""));

  const blob = new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
