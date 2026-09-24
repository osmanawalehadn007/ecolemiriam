import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import prismaBase from "@/lib/prisma-base";
import { revalidatePath, revalidateTag } from "next/cache";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { checkPermission } from "@/lib/rbac";
import { generateSecurePassword } from "@/lib/security/password";
import { sendVerificationEmail } from "@/lib/security/email-verification";
import { mergeFilters, siteFilterForModel } from "@/lib/site-scope";
import {
  parsePersonnelWorkbook,
  analyzePersonnelImport,
  resolveRole,
  type PersonnelAction,
  type PersonnelLignePlan,
} from "@/lib/import-personnel";

/**
 * POST /api/import/personnel — seconde étape : appliquer le plan.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:write");
    if (denied) return denied;

    const tenantId = session.user.tenantId;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });

    const hashAttendu = formData.get("hash") as string | null;
    if (!hashAttendu) {
      return NextResponse.json(
        { error: "Import non prévisualisé. Analysez le fichier avant de confirmer." },
        { status: 400 },
      );
    }

    // Charger les sites
     
    const sites = await prisma.site.findMany({
      where: { tenantId },
      select: { id: true, nom: true },
    });

    const buffer = await file.arrayBuffer();
    const { rows, erreurs, hash } = await parsePersonnelWorkbook(buffer, sites.map((s) => s.nom));

    if (hash !== hashAttendu) {
      return NextResponse.json(
        { error: "Le fichier a changé depuis l'analyse. Relancez la prévisualisation." },
        { status: 409 },
      );
    }

    // Vérifier les emails existants
    const emailsAVerifier = rows.map((r) => r.email);
    const existants = await prismaBase.user.findMany({
      where: { email: { in: emailsAVerifier, mode: "insensitive" } },
      select: { email: true },
    });
    const emailsDejaPris = new Set(existants.map((u) => u.email.toLowerCase()));

    // Décisions de l'utilisateur
    let decisions: Record<string, PersonnelAction> = {};
    const decisionsRaw = formData.get("decisions") as string | null;
    if (decisionsRaw) {
      try {
        decisions = JSON.parse(decisionsRaw);
      } catch {
        return NextResponse.json({ error: "Décisions illisibles" }, { status: 400 });
      }
    }

    const plan = analyzePersonnelImport(rows, erreurs, emailsDejaPris, sites, hash);

    const actionDe = (l: PersonnelLignePlan): PersonnelAction => {
      if (l.verdict === "ERREUR") return "IGNORER";
      const choisie = decisions[String(l.ligne)];
      if (choisie === "CREER" || choisie === "IGNORER") return choisie;
      return l.action;
    };

    const aCreer = plan.lignes.filter((l) => actionDe(l) === "CREER" && l.siteId && l.resolvedRole);

    if (aCreer.length === 0) {
      return NextResponse.json({
        success: true,
        summary: {
          totalRows: plan.lignes.length,
          created: 0,
          skipped: plan.lignes.length,
        },
      });
    }

    const importBatchId = randomUUID();
    let created = 0;
    const erreursCreation: string[] = [];

    for (const l of aCreer) {
      try {
        const password = generateSecurePassword();
        const hashed = await bcrypt.hash(password, 12);

        const newUser = await prisma.user.create({
          data: {
            tenantId,
            siteId: l.siteId!,
            name: l.nom,
            email: l.email,
            role: l.resolvedRole as any,
            phone: l.telephone || null,
            password: hashed,
            isActive: true,
            userTenants: {
              create: {
                tenantId,
                role: l.resolvedRole as any,
                isActive: true,
                isDefault: true,
              },
            },
          },
        });

        // Envoyer l'email de vérification (non bloquant)
        try {
          const verifyResult = await sendVerificationEmail(
            l.email,
            l.nom,
            undefined,
            true,
            password,
          );
          if (!verifyResult.success) {
            console.warn(`[import/personnel] Échec envoi email à ${l.email}:`, verifyResult.error);
          }
        } catch (err) {
          console.warn(`[import/personnel] Erreur envoi email à ${l.email}:`, err);
        }

        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        erreursCreation.push(`Ligne ${l.ligne} (${l.nom}) : ${msg}`);
      }
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id,
        action: "personnel.import",
        verdict: "ALLOWED",
        resource: "user",
        reason: `Import personnel de ${file.name}`,
        metadata: {
          hash: plan.hash,
          fichier: file.name,
          importBatchId,
          created,
        },
      },
    });

    revalidatePath("/parametres");
    revalidateTag("users-list", "max");

    return NextResponse.json({
      success: true,
      summary: {
        totalRows: plan.lignes.length,
        created,
        skipped: plan.lignes.length - created,
        warnings: erreursCreation.length > 0 ? erreursCreation.slice(0, 20) : undefined,
        importBatchId: created > 0 ? importBatchId : undefined,
      },
    });
  } catch (error) {
    console.error("[API/import/personnel] POST", error);
    return NextResponse.json({ error: "Erreur lors de l'import" }, { status: 500 });
  }
}
