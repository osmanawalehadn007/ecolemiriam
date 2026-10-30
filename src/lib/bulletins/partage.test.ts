import { describe, it, expect, beforeAll } from "vitest";
import { signerLienBulletin, verifierLienBulletin } from "@/lib/bulletins/partage";

const p = { eleveId: "e1", periodeId: "p1", tenantId: "t1" };

beforeAll(() => {
  process.env.AUTH_SECRET = "secret-de-test";
});

describe("lien de partage de bulletin", () => {
  it("accepte un jeton valide", () => {
    expect(verifierLienBulletin(signerLienBulletin(p))).toEqual(p);
  });

  it("refuse un jeton expiré", () => {
    const token = signerLienBulletin(p, 1, Date.now() - 2 * 86400_000);
    expect(verifierLienBulletin(token)).toBeNull();
  });

  it("refuse un jeton dont le contenu a été modifié", () => {
    const [, sig] = signerLienBulletin(p).split(".");
    const autre = Buffer.from(JSON.stringify({ e: "e2", p: "p1", t: "t1", x: 9999999999 })).toString("base64url");
    expect(verifierLienBulletin(`${autre}.${sig}`)).toBeNull();
  });

  it("refuse un jeton mal formé", () => {
    expect(verifierLienBulletin("n-importe-quoi")).toBeNull();
    expect(verifierLienBulletin("a.b")).toBeNull();
  });
});
