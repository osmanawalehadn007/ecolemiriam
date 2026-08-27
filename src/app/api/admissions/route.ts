import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, siteIdForCreate } from "@/lib/site-scope";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";

const CandidatureSchema = z.object({
  nom: z.string().min(1),
  prenom: z.string().min(1),
  dateNaissance: z.string(),
  lieuNaissance: z.string().optional(),
  sexe: z.enum(["M", "F"]).default("M"),
  nationalite: z.string().optional(),
  classeVoulue: z.string().min(1),
  annee: z.string().min(1),
  parentNom: z.string().min(1),
  parentPrenom: z.string().min(1),
  parentEmail: z.string().email().optional().or(z.literal("")),
  parentPhone: z.string().min(1),
  parentLien: z.enum(["PERE", "MERE", "TUTEUR", "AUTRE"]).default("PERE"),
  commentaire: z.string().optional(),
  documents: z.array(z.object({ nom: z.string(), url: z.string() })).optional(),
});

// GET — liste des candidatures (admin seulement)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "admissions:read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const statut = searchParams.get("statut");
  const annee = searchParams.get("annee");


  const siteFilter = siteFilterForModel("candidature", session.user);
  const candidatures = await prisma.candidature.findMany({
    where: {
      tenantId: session.user.tenantId,
      ...siteFilter,
      ...(statut ? { statut: statut as never } : {}),
      ...(annee ? { annee } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ candidatures });
}

// POST — soumettre une candidature (public, pas d'auth requise)
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIP(req);
    const rl = rateLimit({ max: 5, windowSec: 300, key: `admission:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de candidatures soumises. Réessayez plus tard." },
        { status: 429, headers: { "Retry-After": "300" } }
      );
    }

    // Identifier le tenant via le subdomain ou header
    const host = req.headers.get("host") ?? "";
    const slug = host.split(".")[0];

    let tenantId: string | null = null;
    // Site à rattacher à la candidature. Renseigné uniquement lorsqu'un membre
    // du dashboard (session active) est rattaché à un site unique. Sans cela la
    // candidature naît avec `siteId: null` et devient invisible aux comptes
    // site-scopés (le filtre de site exclut `null` pour ce modèle) — d'où le
    // « Candidature introuvable » au clic sur « Dossier complet ».
    let siteId: string | null = null;

    // Si appelé depuis le dashboard (session active)
    const session = await auth();
    if (session?.user?.tenantId) {
      tenantId = session.user.tenantId;
      siteId = siteIdForCreate(session.user);
    } else {
      // Appel public : résoudre le tenant via le slug
      const tenant = await prisma.tenant.findUnique({ where: { slug } });
      if (!tenant) {
        return NextResponse.json({ error: "École introuvable" }, { status: 404 });
      }
      tenantId = tenant.id;
    }

    const body = await req.json();
    const data = CandidatureSchema.parse(body);

    // Année par défaut si non précisée
    const annee = data.annee || new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);

    const candidature = await prisma.candidature.create({
      data: {
        tenantId,
        siteId,
        nom: data.nom,
        prenom: data.prenom,
        dateNaissance: new Date(data.dateNaissance),
        lieuNaissance: data.lieuNaissance,
        sexe: data.sexe,
        nationalite: data.nationalite ?? "SN",
        classeVoulue: data.classeVoulue,
        annee,
        parentNom: data.parentNom,
        parentPrenom: data.parentPrenom,
        parentEmail: data.parentEmail || null,
        parentPhone: data.parentPhone,
        parentLien: data.parentLien,
        commentaire: data.commentaire,
        documents: data.documents ?? [],
      },
    });

    return NextResponse.json({ candidature }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Données invalides", details: err.errors }, { status: 400 });
    }
    console.error("[POST /api/admissions]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
