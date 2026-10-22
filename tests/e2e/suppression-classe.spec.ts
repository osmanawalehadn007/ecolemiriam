/**
 * Suppression d'une classe contenant des élèves — parcours RÉEL.
 * ============================================================
 *
 * Rien n'est simulé ici : le test pilote l'application telle qu'elle tourne
 * — mêmes server actions `deleteClasse`, même client Prisma avec l'extension
 * RLS (`SET LOCAL app.tenant_id`), mêmes policies PostgreSQL — et vérifie
 * l'état final EN BASE, pas seulement ce que l'écran affiche.
 *
 * Prérequis (base PostgreSQL jetable LOCALE — le test est destructif) :
 *   1. docker run -d --name <db> -e POSTGRES_PASSWORD=… -p 127.0.0.1:55436:5432 postgres:17-alpine
 *   2. npx prisma db push                → schéma
 *   3. psql < prisma/migration_rls_supabase.sql
 *      → policies + rôle `ecolemiam_app` (NOBYPASSRLS), comme en production
 *   4. npm run db:seed                   → tenant `lycee-demo-seed` : 1 classe, 10 élèves
 *   5. DATABASE_URL = rôle applicatif `ecolemiam_app`  (RLS appliquée)
 *      DIRECT_URL   = rôle owner `postgres`            (contourne RLS)
 *
 * Parcours couvert — exactement le périmètre de la PR #41 :
 *   a. « Réaffecter les élèves » → les 10 élèves changent de classe, puis la
 *      classe source est supprimée ;
 *   b. « Retirer les élèves de la classe » → `classeId = null`, puis la
 *      classe est supprimée ;
 *   c. une classe portant une note est REFUSÉE avec un message chiffré
 *      (FK `Restrict` sur `notes.classeId`) au lieu d'une erreur SQL opaque ;
 *   d. la même classe est supprimable une fois la note retirée — la
 *      condition porte bien sur les notes, pas sur la classe.
 */

import { PrismaClient } from "@prisma/client";
import { test, expect, type Page } from "./fixtures";

// ------------------------------------------------------------------
// Client d'assertion : l'owner (DIRECT_URL) contourne RLS, comme le
// diagnostic d'exploitation. Le client applicatif, lui, est filtré par les
// policies : sans contexte tenant il ne verrait aucune ligne — inutilisable
// pour vérifier l'état final.
// ------------------------------------------------------------------
const ownerUrl = process.env.DIRECT_URL ?? "";

if (!/(localhost|127\.0\.0\.1)/.test(ownerUrl)) {
  throw new Error(
    "suppression-classe.spec : DIRECT_URL doit viser une base LOCALE — " +
      "ce scénario supprime réellement une classe et déplace des élèves."
  );
}

const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

const TENANT_SLUG = "lycee-demo-seed";
const CLASSE_SOURCE = "Terminale A1"; // créée par prisma/seed.ts, 10 élèves
const CLASSE_CIBLE = "6ème IT Cible";
const CLASSE_NOTES = "6ème IT Notes";
const NIVEAU = "6ème";

let tenantId = "";

// ------------------------------------------------------------------
// Helpers — sélecteurs de l'écran Paramètres → Pédagogie → Classes
// ------------------------------------------------------------------

/** Ligne du tableau correspondant à une classe. */
function ligneClasse(page: Page, nom: string) {
  return page.locator("tbody tr", { hasText: nom });
}

/** Ouvre l'onglet Classes de l'écran Paramètres. */
async function ouvrirOngletClasses(page: Page) {
  await page.goto("/parametres");
  await page.getByRole("button", { name: "Pédagogie" }).click();
  await page.getByRole("button", { name: "Classes", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible({ timeout: 60_000 });
}

/** Crée une classe par le formulaire de l'application (pas par la base). */
async function creerClasseViaUi(page: Page, nom: string) {
  await page.getByRole("button", { name: "Ajouter une classe" }).click();
  await page.locator("#nom").fill(nom);
  await page.locator("#niveau").selectOption(NIVEAU);
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByText("Classe créée").first()).toBeVisible({ timeout: 60_000 });
  await expect(ligneClasse(page, nom)).toBeVisible({ timeout: 60_000 });
}

/**
 * Ouvre le dialogue de suppression d'une classe, applique la stratégie
 * demandée, puis valide. Renvoie le dialogue (pour asserter le message
 * d'erreur éventuel).
 *
 * `strategy: "none"` correspond au cas d'une classe SANS élève : le dialogue
 * n'affiche alors aucune option de réaffectation (il n'y a rien à déplacer) et
 * l'on supprime directement.
 */
async function supprimerClasseViaUi(
  page: Page,
  nom: string,
  options: { strategy: "reassign" | "unassign" | "none"; targetClasseId?: string }
) {
  await ligneClasse(page, nom).locator("button.text-destructive").click();

  const dialogue = page.getByRole("dialog");
  // Le titre exact : `getByText` matchait aussi la description (« … de
  // supprimer la classe « X » … ») et déclenchait une violation de mode strict.
  await expect(dialogue.getByRole("heading", { name: "Supprimer la classe" })).toBeVisible({
    timeout: 30_000,
  });

  if (options.strategy === "reassign") {
    await dialogue.getByRole("button", { name: /Réaffecter les élèves/ }).click();
    // La classe cible est choisie par son identifiant : c'est la valeur que
    // le formulaire envoie au serveur.
    await dialogue.locator("select").selectOption(options.targetClasseId!);
  } else if (options.strategy === "unassign") {
    await dialogue.getByRole("button", { name: /Retirer les élèves de la classe/ }).click();
  }

  await dialogue.getByRole("button", { name: "Supprimer", exact: true }).click();
  return dialogue;
}


test.describe("Suppression d'une classe avec élèves — parcours réel", () => {
  test.beforeAll(async () => {
    const tenant = await db.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) {
      throw new Error(
        `Seed absente : tenant « ${TENANT_SLUG} » introuvable. Lancez « npm run db:seed ».`
      );
    }
    tenantId = tenant.id;
  });

  test.afterAll(async () => {
    await db.$disconnect();
  });

  test("réaffecte les élèves, les retire, puis refuse une classe notée", async ({
    authedPage: page,
  }) => {
    test.setTimeout(300_000);

    const classeSource = await db.classe.findFirst({
      where: { tenantId, nom: CLASSE_SOURCE },
      include: { _count: { select: { eleves: { where: { deletedAt: null } } } } },
    });
    expect(classeSource, `classe « ${CLASSE_SOURCE} » issue de la seed`).not.toBeNull();
    expect(classeSource!._count.eleves).toBe(10);

    // ── Le compte de départ est celui de la base, et l'app le voit ────────
    await ouvrirOngletClasses(page);
    const ligne = ligneClasse(page, CLASSE_SOURCE);
    await expect(ligne).toBeVisible({ timeout: 30_000 });
    // Colonne 5 = effectif (ELEVE_NON_ARCHIVE) : c'est ce compteur qui décide
    // si le dialogue exige une stratégie de réaffectation.
    await expect(ligne.locator("td").nth(4)).toHaveText("10", { timeout: 30_000 });
    await page.screenshot({ path: "test-results/preuve-1-avant.png", fullPage: true });

    // ── (a) Réaffectation vers une nouvelle classe ───────────────────────
    await creerClasseViaUi(page, CLASSE_CIBLE);
    const classeCible = await db.classe.findFirst({
      where: { tenantId, nom: CLASSE_CIBLE },
    });
    expect(classeCible, `classe cible « ${CLASSE_CIBLE} » créée par l'UI`).not.toBeNull();

    await supprimerClasseViaUi(page, CLASSE_SOURCE, {
      strategy: "reassign",
      targetClasseId: classeCible!.id,
    });
    await expect(page.getByText("Classe supprimée").first()).toBeVisible({ timeout: 60_000 });

    // Base : la classe source a disparu, les 10 élèves sont dans la cible.
    await expect
      .poll(async () => db.classe.findUnique({ where: { id: classeSource!.id } }), {
        timeout: 30_000,
      })
      .toBeNull();
    await expect
      .poll(async () => db.eleve.count({ where: { tenantId, classeId: classeCible!.id } }), {
        timeout: 30_000,
      })
      .toBe(10);
    // Aucun élève ne doit rester accroché à la classe supprimée.
    expect(await db.eleve.count({ where: { tenantId, classeId: classeSource!.id } })).toBe(0);

    // Écran : la ligne a disparu, la cible affiche 10 élèves.
    await expect(ligneClasse(page, CLASSE_SOURCE)).toHaveCount(0, { timeout: 60_000 });
    await expect(ligneClasse(page, CLASSE_CIBLE).locator("td").nth(4)).toHaveText("10", {
      timeout: 30_000,
    });
    await page.screenshot({ path: "test-results/preuve-2-reaffectation.png", fullPage: true });

    // ── (b) Retrait des élèves (classeId = null) ─────────────────────────
    await supprimerClasseViaUi(page, CLASSE_CIBLE, { strategy: "unassign" });
    await expect(page.getByText("Classe supprimée").first()).toBeVisible({ timeout: 60_000 });

    await expect
      .poll(async () => db.classe.findUnique({ where: { id: classeCible!.id } }), {
        timeout: 30_000,
      })
      .toBeNull();
    await expect
      .poll(async () => db.eleve.count({ where: { tenantId, classeId: null } }), {
        timeout: 30_000,
      })
      .toBe(10);
    await page.screenshot({ path: "test-results/preuve-3-retrait.png", fullPage: true });

    // ── (c) Une classe portant une note est refusée explicitement ────────
    await creerClasseViaUi(page, CLASSE_NOTES);
    const classeNotes = await db.classe.findFirst({
      where: { tenantId, nom: CLASSE_NOTES },
    });
    const matiere = await db.matiere.findFirst({ where: { tenantId } });
    const eleve = await db.eleve.findFirst({ where: { tenantId } });
    expect(classeNotes && matiere && eleve).toBeTruthy();

    const note = await db.note.create({
      data: {
        tenantId,
        eleveId: eleve!.id,
        classeId: classeNotes!.id,
        matiereId: matiere!.id,
        valeur: 14,
        date: new Date(),
      },
    });

    // La classe de test n'a aucun élève : le dialogue ne propose donc aucune
    // stratégie de réaffectation, c'est le garde-fou « notes » qui doit parler.
    await supprimerClasseViaUi(page, CLASSE_NOTES, { strategy: "none" });
    // Le toast est rendu à la racine de l'application, pas dans le dialogue.
    await expect(page.getByText(/Impossible de supprimer cette classe/).first()).toBeVisible({
      timeout: 60_000,
    });
    // Le message est chiffré : 0 évaluation et 1 note sur cette classe de test.
    await expect(page.getByText(/0 évaluation\(s\) et 1 note\(s\)/).first()).toBeVisible();

    // La classe est TOUJOURS là : le refus n'a rien supprimé.
    expect(await db.classe.findUnique({ where: { id: classeNotes!.id } })).not.toBeNull();
    await page.screenshot({ path: "test-results/preuve-4-refus-notes.png", fullPage: true });

    // ── (d) La note retirée, la même classe devient supprimable ──────────
    await db.note.delete({ where: { id: note.id } });
    // Le dialogue du refus est encore ouvert : on l'annule avant de rejouer.
    await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
    await supprimerClasseViaUi(page, CLASSE_NOTES, { strategy: "none" });
    await expect(page.getByText("Classe supprimée").first()).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => db.classe.findUnique({ where: { id: classeNotes!.id } }), {
        timeout: 30_000,
      })
      .toBeNull();
    await page.screenshot({ path: "test-results/preuve-5-suppression-finale.png", fullPage: true });
  });
});

/**
 * Atomicité du couple « déplacer les élèves → supprimer la classe ».
 *
 * La PR #41 annonce : « Déplacement des élèves et suppression dans une même
 * transaction, pour ne plus laisser les élèves déplacés si la suppression
 * échoue. » Ce test le PROUVE en faisant échouer la suppression après le
 * déplacement : un trigger `BEFORE DELETE` de test (créé uniquement sur la
 * base jetable) refuse la suppression d'une classe nommée pour la circonstance.
 *
 * Attendu : l'action échoue, ET les élèves sont toujours dans leur classe
 * d'origine. Si le déplacement avait été validé hors transaction, ils
 * apparaîtraient dans la classe cible — c'est exactement le bug visé.
 */
test.describe("Atomicité de la suppression avec réaffectation", () => {
  const SRC = "6ème IT Rollback Src";
  const DST = "6ème IT Rollback Dst";

  test.beforeAll(async () => {
    const tenant = await db.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Seed absente : tenant « ${TENANT_SLUG} » introuvable.`);
    tenantId = tenant.id;
  });

  test.afterAll(async () => {
    await db.$disconnect();
  });

  test("la suppression qui échoue ne laisse pas les élèves déplacés", async ({
    authedPage: page,
  }) => {
    test.setTimeout(300_000);

    await ouvrirOngletClasses(page);
    await creerClasseViaUi(page, SRC);
    await creerClasseViaUi(page, DST);

    const src = await db.classe.findFirst({ where: { tenantId, nom: SRC } });
    const dst = await db.classe.findFirst({ where: { tenantId, nom: DST } });
    expect(src && dst).toBeTruthy();

    // 3 élèves (laissés sans classe par le scénario précédent) rejoignent la
    // classe source — donnée de départ, écrite comme le ferait une affectation.
    const eleves = await db.eleve.findMany({ where: { tenantId }, take: 3 });
    await db.eleve.updateMany({
      where: { id: { in: eleves.map((e) => e.id) } },
      data: { classeId: src!.id },
    });
    // Rechargement nécessaire : c'est le compteur d'élèves RENDU PAR LE SERVEUR
    // qui décide si le dialogue propose les options de réaffectation. Sans ce
    // rechargement, l'écran croit encore la classe vide et n'affiche pas les
    // options (le serveur refuserait alors la suppression, fail-safe).
    await ouvrirOngletClasses(page);

    // Blocage de test piloté par un DRAPEAU, et non par un DDL : après l'échec
    // de la suppression, une session de l'application peut encore tenir un
    // verrou sur `classes`. Un `DROP TRIGGER` attendrait ce verrou (un premier
    // essai a ainsi consommé les 300 s du test) ; le nettoyage se fait donc par
    // un simple DELETE sur une petite table, qui ne touche pas `classes`.
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS it_blocage (nom text primary key)`);
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION it_blocage_suppression() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM it_blocage WHERE nom = OLD.nom) THEN
          RAISE EXCEPTION 'IT: suppression refusée par un trigger de test';
        END IF;
        RETURN OLD;
      END $$ LANGUAGE plpgsql;
    `);
    // Une instruction par appel : Prisma refuse plusieurs commandes dans le
    // même `$executeRawUnsafe` (« cannot insert multiple commands into a
    // prepared statement »).
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS it_blocage_suppression ON classes`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER it_blocage_suppression BEFORE DELETE ON classes
       FOR EACH ROW EXECUTE FUNCTION it_blocage_suppression()`
    );
    await db.$executeRawUnsafe(`INSERT INTO it_blocage (nom) VALUES ('${SRC}') ON CONFLICT DO NOTHING`);

    try {
      await supprimerClasseViaUi(page, SRC, { strategy: "reassign", targetClasseId: dst!.id });
      await expect(page.getByText(/IT: suppression refusée par un trigger de test/).first())
        .toBeVisible({ timeout: 60_000 });

      // La classe existe toujours…
      expect(await db.classe.findUnique({ where: { id: src!.id } })).not.toBeNull();
      // …et les 3 élèves sont RESTÉS dans la classe source : le déplacement a
      // bien été annulé avec la suppression (transaction unique).
      await expect
        .poll(async () => db.eleve.count({ where: { tenantId, classeId: src!.id } }), {
          timeout: 30_000,
        })
        .toBe(3);
      expect(await db.eleve.count({ where: { tenantId, classeId: dst!.id } })).toBe(0);
      await page.screenshot({ path: "test-results/preuve-6-atomicite.png", fullPage: true });
    } finally {
      // Désactive le blocage : du DML sur une table dédiée, donc AUCUN verrou
      // sur `classes`. Best-effort : un nettoyage ne doit pas faire échouer le
      // scénario, dont les assertions ont déjà été vérifiées.
      try {
        await db.$executeRawUnsafe(`DELETE FROM it_blocage WHERE nom = '${SRC}'`);
      } catch (err) {
        console.warn("[atomicité] levée du blocage ignorée :", err);
      }
    }

    // On repart d'un onglet propre : quand la suppression échoue par une erreur
    // BRUTE remontée de la base (et non par une `Error` applicative comme le
    // refus « notes »), l'écran ne conserve pas l'état du dialogue — constaté au
    // premier essai, où cliquer « Annuler » attendait indéfiniment un dialogue
    // disparu. On recharge donc la page, comme le ferait un utilisateur.
    await ouvrirOngletClasses(page);

    // Contre-épreuve : le blocage levé, la même suppression aboutit et les
    // élèves sont bien dans la classe cible cette fois.
    await supprimerClasseViaUi(page, SRC, { strategy: "reassign", targetClasseId: dst!.id });
    await expect(page.getByText("Classe supprimée").first()).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => db.eleve.count({ where: { tenantId, classeId: dst!.id } }), {
        timeout: 30_000,
      })
      .toBe(3);
    expect(await db.classe.findUnique({ where: { id: src!.id } })).toBeNull();

    // On rend la base telle que la seed la laisse : plus aucune classe.
    await supprimerClasseViaUi(page, DST, { strategy: "unassign" });
    await expect(page.getByText("Classe supprimée").first()).toBeVisible({ timeout: 60_000 });
  });
});


