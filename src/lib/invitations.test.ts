import { describe, it, expect } from "vitest";
import {
  INVITATION_TTL_HOURS,
  buildInvitationUrl,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  isInvitationExpired,
  isInvitableRole,
  renderInvitationEmail,
  validatePasswordStrength,
} from "@/lib/invitations";

describe("invitations — helpers", () => {
  describe("generateInvitationToken", () => {
    it("produit un jeton aléatoire non stockable en clair + son empreinte SHA-256", () => {
      const { token, tokenHash } = generateInvitationToken();
      expect(token.length).toBeGreaterThanOrEqual(40);
      expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
      // Le jeton ne doit jamais apparaître dans l'empreinte stockée.
      expect(tokenHash).not.toContain(token);
      expect(hashInvitationToken(token)).toBe(tokenHash);
    });

    it("génère deux jetons distincts (pas de collision)", () => {
      const a = generateInvitationToken();
      const b = generateInvitationToken();
      expect(a.token).not.toBe(b.token);
      expect(a.tokenHash).not.toBe(b.tokenHash);
    });
  });

  describe("invitationExpiry / isInvitationExpired", () => {
    it("expire après la durée configurée", () => {
      const from = new Date("2026-01-01T00:00:00Z");
      const expiry = invitationExpiry(from);
      expect(expiry.getTime() - from.getTime()).toBe(INVITATION_TTL_HOURS * 3600 * 1000);
    });

    it("détecte l'expiration (bornes incluses)", () => {
      const now = new Date("2026-01-01T00:00:00Z");
      expect(isInvitationExpired(new Date(now.getTime() + 1000), now)).toBe(false);
      expect(isInvitationExpired(new Date(now.getTime()), now)).toBe(true);
      expect(isInvitationExpired(new Date(now.getTime() - 1000), now)).toBe(true);
    });
  });

  describe("buildInvitationUrl", () => {
    it("construit une URL absolue avec le jeton encodé", () => {
      const url = buildInvitationUrl("abc+/=", "https://ecolemiriam.com/");
      expect(url).toBe("https://ecolemiriam.com/accept-invitation?token=abc%2B%2F%3D");
    });

    it("retombe sur NEXT_PUBLIC_APP_URL par défaut", () => {
      const previous = process.env.NEXT_PUBLIC_APP_URL;
      process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
      try {
        expect(buildInvitationUrl("tok")).toBe(
          "http://localhost:3001/accept-invitation?token=tok"
        );
      } finally {
        process.env.NEXT_PUBLIC_APP_URL = previous;
      }
    });
  });

  describe("validatePasswordStrength", () => {
    it("accepte un mot de passe conforme", () => {
      expect(validatePasswordStrength("MotDePasse2026")).toBeNull();
    });

    it("refuse trop court / sans lettre / sans chiffre", () => {
      expect(validatePasswordStrength("Abc2026")).toMatch(/au moins 10/);
      expect(validatePasswordStrength("1234567890")).toMatch(/une lettre/);
      expect(validatePasswordStrength("abcdefghij")).toMatch(/un chiffre/);
    });
  });

  describe("isInvitableRole", () => {
    it("autorise les rôles invitable et refuse STUDENT", () => {
      expect(isInvitableRole("TEACHER")).toBe(true);
      expect(isInvitableRole("TENANT_ADMIN")).toBe(true);
      expect(isInvitableRole("STUDENT")).toBe(false);
      expect(isInvitableRole("HACKER")).toBe(false);
    });
  });

  describe("renderInvitationEmail", () => {
    it("contient le lien, l'établissement et échappe le HTML", () => {
      const html = renderInvitationEmail({
        tenantName: "Lycée <Test>",
        inviterName: "Awa",
        email: "prof@ecole.com",
        role: "TEACHER",
        inviteUrl: "https://app.test/accept-invitation?token=xyz",
        expiresAt: new Date("2026-02-01T00:00:00Z"),
      });
      expect(html).toContain("https://app.test/accept-invitation?token=xyz");
      expect(html).toContain("Lycée &lt;Test&gt;");
      expect(html).not.toContain("<Test>");
      expect(html).toContain("prof@ecole.com");
    });
  });
});
