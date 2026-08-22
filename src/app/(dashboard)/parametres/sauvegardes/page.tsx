"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

export default function SauvegardesPage() {
  const { data: session } = useSession();
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

  const isAdmin = session?.user?.role === "TENANT_ADMIN" || session?.user?.role === "SUPER_ADMIN";

  if (!isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Sauvegardes</h1>
        <p className="text-gray-600">Accès réservé aux administrateurs.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Sauvegardes & Exports</h1>

      <div className="space-y-6">
        {/* Export organisé */}
        <div className="border rounded-lg p-6 bg-white shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Export des données (ZIP organisé)</h2>
          <p className="text-gray-600 text-sm mb-4">
            Télécharge toutes les données de l'établissement dans un ZIP structuré par classe,
            type et thème. Format CSV (compatible Excel).
          </p>
          <div className="text-xs text-gray-500 mb-4 space-y-1">
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
          <button
            onClick={handleDownloadExport}
            disabled={downloading}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {downloading ? "Génération en cours..." : "Télécharger l'export (ZIP)"}
          </button>
        </div>

        {/* Programme PC */}
        <div className="border rounded-lg p-6 bg-white shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Programme de sauvegarde PC</h2>
          <p className="text-gray-600 text-sm mb-4">
            Télécharge un programme Python à exécuter sur un PC (Windows ou Linux).
            Il synchronisera automatiquement les backups toutes les 2 heures, sans intervention.
          </p>
          <div className="bg-gray-50 rounded p-4 text-sm text-gray-700 mb-4">
            <p className="font-semibold mb-2">Installation sur le PC :</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Téléchargez le programme ci-dessous</li>
              <li>Connectez-vous à École Miriam sur le PC (gardez l'onglet ouvert)</li>
              <li>Ouvrez un terminal et exécutez :
                <code className="block bg-gray-200 px-2 py-1 rounded mt-1 text-xs">
                  python ecolemiriam-backup.py --setup --url https://ecolemiriam.com --token VOTRE_TOKEN
                </code>
              </li>
              <li>Le programme s'installe et tourne ensuite tout seul</li>
            </ol>
          </div>
          <button
            onClick={handleDownloadPCProgram}
            className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition"
          >
            Télécharger le programme PC (.py)
          </button>
        </div>

        {/* Statut */}
        {status && (
          <div className="border rounded-lg p-4 bg-blue-50 text-blue-800 text-sm">
            {status}
          </div>
        )}

        {/* Info source de vérité */}
        <div className="border rounded-lg p-4 bg-amber-50 text-amber-900 text-sm">
          <p className="font-semibold">ℹ Source de vérité unique</p>
          <p className="mt-1">
            La base de données de production sur le VPS est la seule source de vérité.
            Les backups et exports sont des copies en lecture seule qui vont dans une seule direction :
            VPS → Cloudflare R2 → PC. Ne modifiez jamais les fichiers téléchargés.
          </p>
        </div>
      </div>
    </div>
  );
}
