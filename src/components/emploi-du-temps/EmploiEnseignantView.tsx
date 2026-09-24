"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Download, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Enseignant {
  id: string;
  user: { name: string };
}

interface EmploiCreneau {
  id: string;
  jour: string;
  heureDebut: string;
  heureFin: string;
  salle: string | null;
  matiere: { nom: string; code: string; couleur: string | null };
  classe: { nom: string };
}

const JOURS = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];
const JOUR_LABELS: Record<string, string> = {
  DIMANCHE: "Dim", LUNDI: "Lun", MARDI: "Mar", MERCREDI: "Mer",
  JEUDI: "Jeu", VENDREDI: "Ven", SAMEDI: "Sam",
};

// Créneaux horaires standards
const CRENEAUX = [
  "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00",
  "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00",
  "15:30", "16:00", "16:30", "17:00", "17:30", "18:00",
];

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function EmploiEnseignantView({ enseignants }: { enseignants: Enseignant[] }) {
  const [selectedEnseignant, setSelectedEnseignant] = useState<string>(enseignants[0]?.id ?? "");
  const [emplois, setEmplois] = useState<EmploiCreneau[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedEnseignant) return;
    setLoading(true);
    fetch(`/api/emploi-du-temps?enseignantId=${selectedEnseignant}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Erreur");
        return r.json();
      })
      .then(setEmplois)
      .catch(() => toast.error("Erreur lors du chargement"))
      .finally(() => setLoading(false));
  }, [selectedEnseignant]);

  // Grouper par jour
  const parJour = useMemo(() => {
    const map: Record<string, EmploiCreneau[]> = {};
    for (const j of JOURS) map[j] = [];
    for (const e of emplois) {
      if (map[e.jour]) map[e.jour].push(e);
    }
    for (const j of JOURS) map[j].sort((a, b) => timeToMin(a.heureDebut) - timeToMin(b.heureDebut));
    return map;
  }, [emplois]);

  function handleExport() {
    if (!selectedEnseignant) return;
    window.open(`/api/emploi-du-temps/export?enseignantId=${selectedEnseignant}`, "_blank");
  }

  const enseignantNom = enseignants.find((e) => e.id === selectedEnseignant)?.user.name ?? "—";

  return (
    <div className="space-y-4">
      {/* Barre de contrôle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary" />
          <select
            value={selectedEnseignant}
            onChange={(e) => setSelectedEnseignant(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {enseignants.map((e) => (
              <option key={e.id} value={e.id}>{e.user.name}</option>
            ))}
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!selectedEnseignant || emplois.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Export Excel
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : emplois.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Aucun créneau assigné à {enseignantNom}</p>
        </div>
      ) : (
        <>
          {/* Grille hebdomadaire */}
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 gap-2 min-w-[800px]">
              {JOURS.map((jour) => (
                <div key={jour} className="space-y-1">
                  <div className="text-center text-xs font-semibold text-muted-foreground py-2 bg-muted rounded">
                    {JOUR_LABELS[jour]}
                  </div>
                  {parJour[jour].length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground/40 py-4">—</div>
                  ) : (
                    parJour[jour].map((c) => {
                      const couleur = c.matiere.couleur ?? "#6366f1";
                      return (
                        <div
                          key={c.id}
                          className="rounded-lg p-2 text-xs border-l-4"
                          style={{
                            borderLeftColor: couleur,
                            backgroundColor: `${couleur}15`,
                          }}
                        >
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {c.heureDebut} - {c.heureFin}
                          </div>
                          <div className="text-muted-foreground mt-0.5">{c.matiere.nom}</div>
                          <div className="text-muted-foreground/70 mt-0.5">
                            {c.classe.nom}
                            {c.salle && ` · ${c.salle}`}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Liste détaillée */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Jour</th>
                    <th className="text-left px-4 py-2 font-medium">Horaire</th>
                    <th className="text-left px-4 py-2 font-medium">Matière</th>
                    <th className="text-left px-4 py-2 font-medium">Classe</th>
                    <th className="text-left px-4 py-2 font-medium">Salle</th>
                  </tr>
                </thead>
                <tbody>
                  {emplois.map((c) => (
                    <tr key={c.id} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">{JOUR_LABELS[c.jour]}</td>
                      <td className="px-4 py-2">{c.heureDebut} - {c.heureFin}</td>
                      <td className="px-4 py-2">
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs"
                          style={{ backgroundColor: `${c.matiere.couleur ?? "#6366f1"}20` }}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.matiere.couleur ?? "#6366f1" }} />
                          {c.matiere.nom}
                        </span>
                      </td>
                      <td className="px-4 py-2">{c.classe.nom}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.salle ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary">{emplois.length}</p>
              <p className="text-xs text-muted-foreground">Créneaux / semaine</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary">
                {Math.round(emplois.reduce((sum, e) => sum + (timeToMin(e.heureFin) - timeToMin(e.heureDebut)), 0) / 60)}h
              </p>
              <p className="text-xs text-muted-foreground">Heures / semaine</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary">
                {new Set(emplois.map((e) => e.classe.nom)).size}
              </p>
              <p className="text-xs text-muted-foreground">Classes</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
