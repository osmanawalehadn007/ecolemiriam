"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldX, Loader2, RotateCcw } from "lucide-react";
import { approuverAnnulationPaiement, refuserAnnulationPaiement, getDemandesAnnulationEnAttente } from "@/lib/actions/facture";

interface DemandeAnnulation {
  id: string;
  montant: number;
  devise: string;
  methode: string;
  date: Date;
  motifAnnulation: string | null;
  demandeAnnulationLe: Date | null;
  facture: {
    id: string;
    numero: string;
    libelle: string;
    montant: number;
    eleve: { id: string; nom: string; prenom: string; matricule: string } | null;
  };
  demandeAnnulationPar: { id: string; name: string } | null;
}

export function DemandesAnnulationPanel() {
  const [demandes, setDemandes] = useState<DemandeAnnulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  async function fetchDemandes() {
    setLoading(true);
    try {
      const data = await getDemandesAnnulationEnAttente();
      setDemandes(data as DemandeAnnulation[]);
    } catch {
      setDemandes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDemandes();
  }, []);

  async function handleApprouver(paiementId: string) {
    if (!confirm("Approuver cette annulation ? Une contre-passation sera créée.")) return;
    setPending(paiementId);
    try {
      await approuverAnnulationPaiement(paiementId);
      toast.success("Annulation approuvée — contre-passation créée");
      await fetchDemandes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setPending(null);
    }
  }

  async function handleRefuser(paiementId: string) {
    if (!confirm("Refuser cette demande d'annulation ?")) return;
    setPending(paiementId);
    try {
      await refuserAnnulationPaiement(paiementId);
      toast.success("Demande d'annulation refusée");
      await fetchDemandes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return (
      <Card className="mb-6">
        <CardContent className="pt-6 flex items-center justify-center min-h-[100px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (demandes.length === 0) {
    return null; // Ne pas afficher s'il n'y a pas de demandes en attente
  }

  return (
    <Card className="mb-6 border-orange-200 bg-orange-50/50 dark:bg-orange-950/10">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2 text-orange-700 dark:text-orange-400">
          <RotateCcw className="h-4 w-4" />
          Demandes d&apos;annulation de paiement en attente ({demandes.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {demandes.map((d) => (
          <div
            key={d.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border bg-background"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-semibold">{d.facture.numero}</span>
                <Badge variant="warning" className="text-[10px]">
                  {d.montant.toLocaleString()} {d.devise}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {d.facture.eleve
                    ? `${d.facture.eleve.prenom} ${d.facture.eleve.nom}`
                    : d.facture.libelle}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Motif :</span> {d.motifAnnulation}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Demandé par {d.demandeAnnulationPar?.name ?? "—"} le{" "}
                {d.demandeAnnulationLe ? new Date(d.demandeAnnulationLe).toLocaleString("fr-FR") : "—"}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-green-600 border-green-200 hover:bg-green-50"
                onClick={() => handleApprouver(d.id)}
                disabled={pending === d.id}
              >
                {pending === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                Approuver
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => handleRefuser(d.id)}
                disabled={pending === d.id}
              >
                {pending === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldX className="h-3 w-3" />}
                Refuser
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
