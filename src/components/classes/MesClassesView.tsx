"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SiteTabs } from "@/components/sites/SiteTabs";
import { Users, BookOpen, GraduationCap, Calendar, School } from "lucide-react";
import type { SiteColor } from "@/lib/site-colors";

interface ClassItem {
  id: string;
  nom: string;
  niveau?: string | null;
  siteId?: string | null;
  site?: { nom: string } | null;
  _count?: { eleves?: number };
}

interface Props {
  classes: ClassItem[];
  siteColors: Record<string, SiteColor>;
  matieresByClasse: Record<string, string[]>;
  activeSite: string;
  sites: { id: string; nom: string }[];
}

export function MesClassesView({
  classes,
  siteColors,
  matieresByClasse,
  activeSite,
  sites,
}: Props) {
  return (
    <div className="space-y-6">
      <SiteTabs
        sites={sites}
        siteColors={siteColors}
        activeSiteId={activeSite}
        className="mb-2"
      />
      {classes.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <School className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Aucune classe ne correspond à votre périmètre.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {classes.map((c) => (
            <Card
              key={c.id}
              className="border shadow-sm hover:shadow-md transition-shadow"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{c.nom}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {c.niveau ? `${c.niveau} — ` : ""}
                      {c.site?.nom ?? "Site non défini"}
                    </p>
                  </div>
                  <Badge variant="secondary" className="gap-1 shrink-0">
                    <Users className="w-3 h-3" /> {c._count?.eleves ?? 0}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-1">
                  {(matieresByClasse[c.id] ?? []).map((m) => (
                    <Badge key={m} variant="outline" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <Link href={`/eleves?classeId=${c.id}`}>
                      <Users className="w-3.5 h-3.5" /> Élèves
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <Link href={`/cahier-de-texte?classeId=${c.id}`}>
                      <BookOpen className="w-3.5 h-3.5" /> Cahier
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <Link href={`/notes?classeId=${c.id}`}>
                      <GraduationCap className="w-3.5 h-3.5" /> Notes
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <Link href={`/absences/appel?classeId=${c.id}`}>
                      <Calendar className="w-3.5 h-3.5" /> Appel
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
