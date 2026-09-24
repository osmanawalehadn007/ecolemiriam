"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, HardDrive, Loader2, Info } from "lucide-react";

/**
 * Onglet Sauvegardes & Exports — accessible uniquement aux
 * TENANT_ADMIN et SUPER_ADMIN (filtrage dans ParametresTabs).
 *
 * Deux fonctions :
 *  1. Export ZIP complet (CSV organisé par classe/matière/thème)
 *  2. Téléchargement du programme Python de sauvegarde PC
 */
export function SauvegardesTab() {
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState<string>("");

  const handleDownloadExport = async () => {
    setDownloading(true);
    setStatus("Génération de l'export en cours...");
    try {
      const resp = await fetch("/api/export/full", { method: "GET" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setStatus(`Erreur: ${data.error || resp.statusText}`);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ecolemiriam_export_${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("Export téléchargé avec succès ✓");
    } catch (err) {
      setStatus(`Erreur: ${err}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadPCProgram = async () => {
    setStatus("Téléchargement du programme PC...");
    try {
      const resp = await fetch("/api/export/pc-program", { method: "GET" });
      if (!resp.ok) {
        setStatus(`Erreur: ${resp.statusText}`);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ecolemiriam-backup.py";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("Programme PC téléchargé ✓");
    } catch (err) {
      setStatus(`Erreur: ${err}`);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Export ZIP organisé */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export des données (ZIP organisé)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Télécharge toutes les données de l&apos;établissement dans un ZIP structuré
            par classe, type et thème. Format CSV (compatible Excel, UTF-8 BOM).
          </p>
          <div className="text-xs text-muted-foreground space-y-0.5 bg-muted/50 rounded-lg p-3">
            <div>📁 01_Eleves/ — par classe et par niveau</div>
            <div>📁 02_Notes/ — par classe et par matière</div>
            <div>📁 03_Absences/ — par classe et par mois</div>
            <div>📁 04_Factures/ — par statut</div>
            <div>📁 05_Bulletins/ — par classe</div>
            <div>📁 06_Emploi_du_temps/ — par classe</div>
            <div>📁 07_Professeurs/ — par matière</div>
            <div>📁 08_Inventaire/ — matériel</div>
            <div>📁 09_Comptabilite/ — dépenses, recettes, budget</div>
            <div>📁 10_Communication/ — messages</div>
            <div>📁 11_Vie_scolaire/ — incidents, sanctions, exclusions</div>
            <div>📁 12_Ressources_humaines/ — fiches RH, congés</div>
            <div>📁 13_Cours/ — par classe</div>
            <div>📁 14_Cahier_de_texte/ — par classe</div>
          </div>
          <Button onClick={handleDownloadExport} disabled={downloading} className="gap-2">
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? "Génération en cours..." : "Télécharger l'export (ZIP)"}
          </Button>
        </CardContent>
      </Card>

      {/* Programme PC */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Programme de sauvegarde PC
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Télécharge un programme Python à exécuter sur un PC (Windows ou Linux).
            Il synchronisera automatiquement les backups toutes les 2 heures, sans intervention.
          </p>
          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p className="font-semibold">Installation sur le PC :</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Téléchargez le programme ci-dessous</li>
              <li>Connectez-vous à École Miriam sur le PC (gardez l&apos;onglet ouvert)</li>
              <li>Ouvrez un terminal et exécutez :
                <code className="block bg-muted rounded mt-1 px-2 py-1 text-xs font-mono">
                  python ecolemiriam-backup.py --setup --url https://ecolemiriam.com --token VOTRE_TOKEN
                </code>
              </li>
              <li>Le programme s&apos;installe et tourne ensuite tout seul</li>
            </ol>
          </div>
          <Button onClick={handleDownloadPCProgram} variant="outline" className="gap-2">
            <HardDrive className="h-4 w-4" />
            Télécharger le programme PC (.py)
          </Button>
        </CardContent>
      </Card>

      {/* Statut */}
      {status && (
        <div className="rounded-lg border bg-primary/5 p-4 text-sm text-primary">
          {status}
        </div>
      )}

      {/* Info source de vérité */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-semibold">
          <Info className="h-4 w-4" />
          Source de vérité unique
        </p>
        <p className="mt-1">
          La base de données de production sur le VPS est la seule source de vérité.
          Les backups et exports sont des copies en lecture seule qui vont dans une seule direction :
          VPS → Cloudflare R2 → PC. Ne modifiez jamais les fichiers téléchargés.
        </p>
      </div>
    </div>
  );
}
