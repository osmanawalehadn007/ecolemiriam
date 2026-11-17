/**
 * École Miriam — Ouverture d'une fenêtre d'impression fiable
 * ==========================================================
 *
 * Les documents (attestations, convocations, cartes scolaires, factures) sont
 * générés en HTML, écrits dans une fenêtre secondaire via `document.write`,
 * puis imprimés. Le logo de l'établissement est désormais servi depuis R2
 * (URL distante) et non plus en base64 inline : il faut donc attendre que le
 * navigateur ait chargé toutes les images de la fenêtre avant d'appeler
 * `print()`, sinon la boîte de dialogue s'ouvre sur une page sans logo.
 *
 * `setTimeout(500)` était suffisant avec du base64 inline (instantané) mais
 * ne l'est plus avec une URL distante, même cachée par le CDN : un cold start
 * ou un réseau lent peut dépasser 500 ms.
 */

/**
 * Ouvre une fenêtre, y écrit du HTML, attend que toutes les images soient
 * chargées (ou en erreur), puis appelle `print()`.
 *
 * @param html Le HTML complet du document à imprimer.
 * @param ajuster Mise en page à refaire une fois le document affiché, puis juste
 *   avant l'impression (images chargées) : sert à faire tenir un document sur une
 *   page. Elle s'exécute avec le code de l'application, pas dans le HTML écrit :
 *   la CSP de la fenêtre n'autorise pas un script en ligne sans nonce.
 * @returns `true` si la fenêtre a pu être ouverte, `false` sinon (popup bloquée).
 */
export function openPrintWindow(html: string, ajuster?: (doc: Document) => void): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;

  w.document.write(html);
  w.document.close();
  w.focus();
  ajuster?.(w.document);

  // Attend le chargement de toutes les images avant d'imprimer.
  // `document.close()` déclenche le parsing ; les <img> commencent à se
  // charger immédiatement après. On collecte leurs promesses et on imprime
  // quand elles sont toutes résolues (succès ou erreur — une image cassée
  // ne doit pas bloquer l'impression indéfiniment).
  const images = Array.from(w.document.images);

  if (images.length === 0) {
    w.print();
    return true;
  }
  const imprimer = () => {
    ajuster?.(w.document);
    w.print();
  };

  const settled = images.map(
    (img) =>
      new Promise<void>((resolve) => {
        if (img.complete) {
          resolve();
        } else {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }
      })
  );

  // Filet de sécurité : si une image ne déclenche ni `load` ni `error`
  // (par exemple à cause d'une CSP restrictive dans la fenêtre secondaire),
  // on imprime quand même après 3 s plutôt que de bloquer l'utilisateur.
  const fallback = new Promise<void>((resolve) => setTimeout(resolve, 3000));

  Promise.race([Promise.all(settled), fallback]).then(imprimer);

  return true;
}
