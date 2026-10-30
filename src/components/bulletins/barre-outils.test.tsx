import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrintButton } from "@/components/bulletins/PrintButton";
import { PrintBulletinButton } from "@/components/bulletins/PrintBulletinButton";
import { EnvoyerBulletin } from "@/components/bulletins/EnvoyerBulletin";
import { TelechargerBulletin } from "@/components/bulletins/TelechargerBulletin";

afterEach(() => vi.restoreAllMocks());

describe("barre d'outils du bulletin (icônes)", () => {
  it("l'icône Imprimer ouvre la boîte d'impression (page du personnel)", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintButton />);
    fireEvent.click(screen.getByRole("button", { name: "printPdf" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("l'icône Imprimer ouvre la boîte d'impression (lien partagé)", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintBulletinButton />);
    fireEvent.click(screen.getByRole("button", { name: /Imprimer/ }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("chaque bouton est une icône seule, nommée pour l'info-bulle et le lecteur d'écran", () => {
    render(
      <>
        <TelechargerBulletin nomFichier="Bulletin.pdf" />
        <EnvoyerBulletin eleveId="e1" periodeId="p1" />
        <PrintBulletinButton />
      </>
    );
    for (const nom of [/Enregistrer \/ Télécharger/, /WhatsApp/, /e-mail/, /Imprimer/]) {
      const bouton = screen.getByRole("button", { name: nom });
      expect(bouton.getAttribute("title")).toMatch(nom);
      expect(bouton.querySelector("svg")).not.toBeNull();
      expect(bouton.textContent?.trim()).toBe(""); // aucune légende : icône seule
    }
  });
});
