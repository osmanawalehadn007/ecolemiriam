import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// Mocks : on isole la logique d'autorisation, sans toucher à la base.
// ------------------------------------------------------------------
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), auditFire: vi.fn() }));

// Client Prisma « neutre » : toute méthode existe et résout `null`.
// Les cas testés s'arrêtent avant toute lecture/écriture en base.
const { prismaMock } = vi.hoisted(() => {
  const prismaMock = new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => vi.fn().mockResolvedValue(null) }) }
  );
  return { prismaMock };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { auth } from "@/lib/auth";

const mockAuth = auth as ReturnType<typeof vi.fn>;

function sessionFor(role: string, tenantId: string | null = "tenant-1") {
  return {
    user: {
      id: "user-1",
      email: "user@test.ecolpro",
      name: "Utilisateur Test",
      role,
      tenantId,
      siteId: null,
      siteIds: [],
    },
  };
}

function createMockReq(url: string, method: string, body?: unknown) {
  return {
    method,
    url,
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

const BASE = "http://localhost";

// Import après les mocks (convention des tests de routes existants).
const { POST: genererComptes } = await import(
  "@/app/api/eleves/generer-comptes/route"
);
const { POST: changerClasse } = await import(
  "@/app/api/eleves/changer-classe/route"
);
const { POST: creerDispense, DELETE: supprimerDispense } = await import(
  "@/app/api/eleves/dispenses/route"
);
const { PUT: majSignatureCachet } = await import(
  "@/app/api/parametres/signature-cachet/route"
);
const { POST: uploadSignature } = await import(
  "@/app/api/parametres/upload-signature/route"
);
const { PUT: majPeriode } = await import(
  "@/app/api/parametres/periodes-cloture/route"
);
const {
  POST: creerRegle,
  PUT: majRegle,
  DELETE: supprimerRegle,
} = await import("@/app/api/parametres/regles-appreciation/route");
const { POST: creerConvocation } = await import(
  "@/app/api/vie-scolaire/convocations/route"
);
const { GET: setupLinks } = await import("@/app/api/test/setup-links/route");
const { GET: bulletinsMatrice } = await import(
  "@/app/api/bulletins/matrice/route"
);
const { GET: feuillePresence } = await import(
  "@/app/api/absences/feuille-presence/route"
);
const { GET: cartesScolaires } = await import(
  "@/app/api/eleves/cartes-scolaires/route"
);
const { POST: attestation } = await import(
  "@/app/api/eleves/attestation/route"
);
const { GET: facturePdf } = await import("@/app/api/factures/[id]/pdf/route");
const { GET: paiementRecu } = await import("@/app/api/paiements/[id]/recu/route");
const { POST: stripeCheckout } = await import("@/app/api/stripe/checkout/route");
const { POST: uploadElevePhoto } = await import(
  "@/app/api/eleves/upload-photo/route"
);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Tests de non-régression des correctifs P0 (`docs/AUDIT_RBAC_ROLES.md` § 5.1).
 *
 * Avant correctif, ces routes ne portaient aucune garde : tout compte
 * authentifié (dont PARENT / STUDENT) pouvait les déclencher. Chaque test
 * vérifie qu'un rôle non autorisé reçoit 403, et — quand c'est possible sans
 * base de données — qu'un rôle autorisé franchit la garde.
 */
describe("P0 — mutations d'élèves (eleves:write)", () => {
  it.each(["STUDENT", "PARENT", "TEACHER", "NURSE"])(
    "generer-comptes refuse %s",
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await genererComptes(
        createMockReq(`${BASE}/api/eleves/generer-comptes`, "POST", {}) as never
      );
      expect(res.status).toBe(403);
    }
  );

  it("changer-classe refuse un parent, autorise le secrétariat", async () => {
    mockAuth.mockResolvedValue(sessionFor("PARENT"));
    const refuse = await changerClasse(
      createMockReq(`${BASE}/api/eleves/changer-classe`, "POST", {}) as never
    );
    expect(refuse.status).toBe(403);

    // Secrétariat autorisé : la requête vide échoue en 400, preuve que la
    // garde de permission est franchie.
    mockAuth.mockResolvedValue(sessionFor("SECRETARY"));
    const passe = await changerClasse(
      createMockReq(`${BASE}/api/eleves/changer-classe`, "POST", {}) as never
    );
    expect(passe.status).toBe(400);
  });

  it("dispenses refuse les rôles non administratifs (POST et DELETE)", async () => {
    mockAuth.mockResolvedValue(sessionFor("STUDENT"));
    const postRefuse = await creerDispense(
      createMockReq(`${BASE}/api/eleves/dispenses`, "POST", {}) as never
    );
    expect(postRefuse.status).toBe(403);

    mockAuth.mockResolvedValue(sessionFor("PARENT"));
    const deleteRefuse = await supprimerDispense(
      createMockReq(`${BASE}/api/eleves/dispenses?id=d1`, "DELETE") as never
    );
    expect(deleteRefuse.status).toBe(403);

    // Le secrétariat franchit la garde : sans `id`, la route renvoie 400.
    mockAuth.mockResolvedValue(sessionFor("SECRETARY"));
    const deleteSansId = await supprimerDispense(
      createMockReq(`${BASE}/api/eleves/dispenses`, "DELETE") as never
    );
    expect(deleteSansId.status).toBe(400);
  });
});

describe("P0 — paramètres officiels et notes", () => {
  it("signature-cachet est réservé à la direction", async () => {
    for (const role of [
      "TEACHER",
      "PRINCIPAL",
      "SECRETARY",
      "ACCOUNTANT",
      "PARENT",
    ]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await majSignatureCachet(
        createMockReq(`${BASE}/api/parametres/signature-cachet`, "PUT", {
          chefEtablissement: "X",
        }) as never
      );
      expect(res.status).toBe(403);
    }

    mockAuth.mockResolvedValue(sessionFor("TENANT_ADMIN"));
    const ok = await majSignatureCachet(
      createMockReq(`${BASE}/api/parametres/signature-cachet`, "PUT", {
        chefEtablissement: "X",
      }) as never
    );
    expect(ok.status).toBe(200);
  });

  it("periodes-cloture exige notes:manage (pas notes:write)", async () => {
    for (const role of [
      "SECRETARY",
      "NURSE",
      "ACCOUNTANT",
      "PARENT",
      "TEACHER",
      "CLASS_TEACHER",
    ]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await majPeriode(
        createMockReq(`${BASE}/api/parametres/periodes-cloture`, "PUT", {
          periodeId: "p1",
          statut: "OUVERTE",
        }) as never
      );
      expect(res.status).toBe(403);
    }

    mockAuth.mockResolvedValue(sessionFor("PRINCIPAL"));
    const ok = await majPeriode(
      createMockReq(`${BASE}/api/parametres/periodes-cloture`, "PUT", {
        periodeId: "p1",
        statut: "OUVERTE",
      }) as never
    );
    expect(ok.status).toBe(200);
  });

  it("regles-appreciation exige notes:manage sur POST/PUT/DELETE", async () => {
    mockAuth.mockResolvedValue(sessionFor("PARENT"));
    const postRefuse = await creerRegle(
      createMockReq(
        `${BASE}/api/parametres/regles-appreciation`,
        "POST",
        {}
      ) as never
    );
    expect(postRefuse.status).toBe(403);

    // Un enseignant saisit des notes, il ne définit pas les règles : il est
    // désormais refusé (il l'était accepté tant que la garde était `notes:write`).
    for (const role of ["TEACHER", "CLASS_TEACHER"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await creerRegle(
        createMockReq(
          `${BASE}/api/parametres/regles-appreciation`,
          "POST",
          {}
        ) as never
      );
      expect(res.status).toBe(403);
    }

    mockAuth.mockResolvedValue(sessionFor("PARENT"));

    const putRefuse = await majRegle(
      createMockReq(`${BASE}/api/parametres/regles-appreciation`, "PUT", {
        id: "r1",
      }) as never
    );
    expect(putRefuse.status).toBe(403);

    const deleteRefuse = await supprimerRegle(
      createMockReq(
        `${BASE}/api/parametres/regles-appreciation?id=r1`,
        "DELETE"
      ) as never
    );
    expect(deleteRefuse.status).toBe(403);

    mockAuth.mockResolvedValue(sessionFor("PRINCIPAL"));
    const ok = await creerRegle(
      createMockReq(`${BASE}/api/parametres/regles-appreciation`, "POST", {
        contexte: "GENERAL",
        libelle: "Bien",
        seuilMin: 10,
        seuilMax: 20,
      }) as never
    );
    expect(ok.status).toBe(200);
  });

  it("upload-signature exige etablissement:write", async () => {
    for (const role of [
      "TEACHER",
      "CLASS_TEACHER",
      "PRINCIPAL",
      "SECRETARY",
      "ACCOUNTANT",
      "PARENT",
    ]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await uploadSignature(
        createMockReq(`${BASE}/api/parametres/upload-signature`, "POST") as never
      );
      expect(res.status).toBe(403);
    }

    mockAuth.mockResolvedValue(null);
    const anonymous = await uploadSignature(
      createMockReq(`${BASE}/api/parametres/upload-signature`, "POST") as never
    );
    expect(anonymous.status).toBe(401);
  });
});

describe("P0 — vie scolaire et route de développement", () => {
  it.each(["PARENT", "STUDENT", "TEACHER", "NURSE"])(
    "convocations refuse %s",
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await creerConvocation(
        createMockReq(`${BASE}/api/vie-scolaire/convocations`, "POST", {
          eleveId: "e1",
        }) as never
      );
      expect(res.status).toBe(403);
    }
  );

  it("test/setup-links est réservée au super-admin", async () => {
    for (const role of ["TENANT_ADMIN", "PRINCIPAL", "SECRETARY", "PARENT"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await setupLinks();
      expect(res.status).toBe(403);
    }

    mockAuth.mockResolvedValue(null);
    const anonymous = await setupLinks();
    expect(anonymous.status).toBe(401);
  });
});

describe("P1 — lectures nominatives et documents (RBAC)", () => {
  const params = { params: Promise.resolve({ id: "x1" }) };

  it("bulletins/matrice exige bulletins:read et refuse les périmètres personnels", async () => {
    // NURSE / ACCOUNTANT n'ont pas `bulletins:read`.
    for (const role of ["NURSE", "ACCOUNTANT", "PARENT", "STUDENT"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await bulletinsMatrice(
        createMockReq(
          `${BASE}/api/bulletins/matrice?classeId=c1&periodeId=p1`,
          "GET"
        ) as never
      );
      expect(res.status).toBe(403);
    }
  });

  it("absences/feuille-presence exige absences:read et refuse les périmètres personnels", async () => {
    // ACCOUNTANT n'a pas `absences:read` ; PARENT / STUDENT l'ont mais n'ont
    // rien à faire sur une liste nominative de classe.
    for (const role of ["ACCOUNTANT", "PARENT", "STUDENT"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await feuillePresence(
        createMockReq(
          `${BASE}/api/absences/feuille-presence?classeId=c1`,
          "GET"
        ) as never
      );
      expect(res.status).toBe(403);
    }
  });

  it("eleves/cartes-scolaires et eleves/attestation exigent eleves:read", async () => {
    for (const role of ["PARENT", "STUDENT"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const cartes = await cartesScolaires(
        createMockReq(
          `${BASE}/api/eleves/cartes-scolaires?classeId=c1`,
          "GET"
        ) as never
      );
      expect(cartes.status).toBe(403);

      const att = await attestation(
        createMockReq(`${BASE}/api/eleves/attestation`, "POST", {
          eleveId: "e1",
        }) as never
      );
      expect(att.status).toBe(403);
    }
  });

  it("les documents financiers refusent le personnel non finance, pas les familles", async () => {
    // Personnel sans `finance:read` : refus net.
    for (const role of ["TEACHER", "NURSE", "SECRETARY", "COUNSELOR"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const pdf = await facturePdf(
        createMockReq(`${BASE}/api/factures/f1/pdf`, "GET") as never,
        params as never
      );
      expect(pdf.status).toBe(403);

      const recu = await paiementRecu(
        createMockReq(`${BASE}/api/paiements/p1/recu`, "GET") as never,
        params as never
      );
      expect(recu.status).toBe(403);
    }

    // Familles : accès borné à LEURS enfants — la ressource demandée est hors
    // périmètre, donc 404 (ni 403, ni les données d'un autre élève).
    for (const role of ["PARENT", "STUDENT"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const pdf = await facturePdf(
        createMockReq(`${BASE}/api/factures/f1/pdf`, "GET") as never,
        params as never
      );
      expect(pdf.status).toBe(404);

      const recu = await paiementRecu(
        createMockReq(`${BASE}/api/paiements/p1/recu`, "GET") as never,
        params as never
      );
      expect(recu.status).toBe(404);
    }
  });

  it("stripe/checkout exige finance:write (pas seulement finance:read)", async () => {
    for (const role of ["PARENT", "TEACHER", "PRINCIPAL"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await stripeCheckout(
        createMockReq(`${BASE}/api/stripe/checkout`, "POST", {
          factureId: "f1",
        }) as never
      );
      expect(res.status).toBe(403);
    }
  });

  it("eleves/upload-photo exige eleves:write", async () => {
    for (const role of ["PARENT", "STUDENT", "TEACHER", "NURSE"]) {
      mockAuth.mockResolvedValue(sessionFor(role));
      const res = await uploadElevePhoto(
        createMockReq(`${BASE}/api/eleves/upload-photo`, "POST") as never
      );
      expect(res.status).toBe(403);
    }
  });
});