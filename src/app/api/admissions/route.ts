import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, siteIdForCreate, mergeFilters } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";

const CandidatureSchema = z.object({
  nom: z.string().min(1),
  prenom: z.string().min(1),
  dateNaissance: z.string(),
  lieuNaissance: z.string().optional(),
  sexe: z.enum(["M", "F"]).default("M"),
  nationalite: z.string().optional(),
  // Depuis le dashboard : identifiant de la classe choisie (lié au site). Le
  // serveur en déduit le nom (classeVoulue) et le site de la candidature.
  classeId: z.string().optional(),
  // Nom de la classe. Obligatoire seulement en soumission publique (texte libre)
  // où aucun classeId n'est fourni ; sinon dérivé du classeId.
  classeVoulue: z.string().optional(),
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
  // Année : celle demandée explicitement, sinon l'année courante. Sans ce
  // défaut, l'API renvoyait les candidatures de toutes les années confondues.
  const anneeVisee = annee ?? (await getAnneeCouranteLibelle(session.user.tenantId));
  const candidatures = await prisma.candidature.findMany({
    where: mergeFilters(
      {
        tenantId: session.user.tenantId,
        ...(statut ? { statut: statut as never } : {}),
      },
      siteFilter,
      anneeFilterForModel("candidature", anneeVisee),
    ),
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

    // Année scolaire de la candidature. Depuis le dashboard, elle est
    // IMPOSÉE par l'année courante du tenant : accepter la valeur du client
    // permettait de créer une candidature 2026-2027 rattachée à une classe
    // 2025-2026 (structure d'une année révolue).
    const anneeCourante = await getAnneeCouranteLibelle(tenantId);
    const annee =
      (session?.user?.tenantId ? anneeCourante : null) ??
      (data.annee ||
        `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`);

    // Résolution de la classe choisie (dashboard). Le NOM et le SITE de la
    // candidature proviennent de la classe elle-même : c'est l'unique garant
    // que la structure existe bien dans le site où l'élève sera inscrit. On
    // borne la recherche au périmètre de site de l'utilisateur pour empêcher
    // de rattacher une classe d'un site non autorisé.
    let classeVoulue = data.classeVoulue?.trim() || "";
    if (data.classeId && session?.user?.tenantId) {
       
      const classe = await prisma.classe.findFirst({
        where: {
          id: data.classeId,
          tenantId,
          // L'ANNÉE est une borne au même titre que le site : une classe
          // d'une année révolue n'est plus une structure d'accueil, même
          // sur le bon site.
          annee,
          ...siteFilterForModel("classe", session.user),
        },
        select: { nom: true, siteId: true },
      });
      if (!classe) {
        return NextResponse.json(
          {
            error: `Classe introuvable, hors de votre périmètre de site, ou n'appartenant pas à l'année ${annee}. Sélectionnez une classe de votre site pour l'année en cours.`,
          },
          { status: 400 }
        );
      }
      classeVoulue = classe.nom;
      // Le site de la candidature suit la classe (source de vérité du site).
      siteId = classe.siteId;
    }

    if (!classeVoulue) {
      return NextResponse.json(
        { error: "La classe souhaitée est obligatoire." },
        { status: 400 }
      );
    }

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
        classeVoulue,
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
