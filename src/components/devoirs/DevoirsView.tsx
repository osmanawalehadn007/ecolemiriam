"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, BookOpen, FileText } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface Devoir {
  id: string;
  description: string;
  type: string;
  dateRemise: Date;
  statut: string;
  classe: { nom: string; niveau?: string | null };
  matiere: { nom: string; code?: string | null };
  seance: { date: Date; contenu?: string };
  donnePar: { name: string | null } | null;
}

interface Props {
  devoirs: Devoir[];
}

const STATUT_COLORS: Record<string, string> = {
  DONNE: "bg-blue-100 text-blue-700",
  RENDU: "bg-green-100 text-green-700",
  NON_RENDU: "bg-red-100 text-red-700",
  CORRIGE: "bg-purple-100 text-purple-700",
};

export function DevoirsView({ devoirs }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button asChild size="sm" className="gap-1">
          <Link href="/cahier-de-texte">
            <Plus className="w-4 h-4" /> Nouveau devoir
          </Link>
        </Button>
      </div>

      {devoirs.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Aucun devoir pour le moment.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {devoirs.map((d) => (
            <Card key={d.id} className="border shadow-sm">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{d.matiere.nom}</Badge>
                      <span className="text-sm font-medium">
                        {d.classe.nom}
                      </span>
                      <Badge
                        className={
                          STATUT_COLORS[d.statut] ??
                          "bg-gray-100 text-gray-700"
                        }
                      >
                        {d.statut}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground line-clamp-2">
                      {d.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        À rendre le{" "}
                        {format(new Date(d.dateRemise), "dd MMM yyyy", {
                          locale: fr,
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-3 h-3" />
                        Séance du{" "}
                        {format(new Date(d.seance.date), "dd MMM yyyy", {
                          locale: fr,
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    Donné par {d.donnePar?.name ?? "—"}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
