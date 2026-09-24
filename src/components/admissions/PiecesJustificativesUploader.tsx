"use client";

import { useState, useTransition } from "react";
import { Upload, FileText, Image as ImageIcon, X, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  PIECES_JUSTIFICATIVES,
  piecesRequisesPresentes,
} from "@/lib/admissions/pieces-justificatives";

interface DocumentJoint {
  nom: string;
  url: string;
  type?: string;
}

interface PiecesJustificativesUploaderProps {
  documents: DocumentJoint[];
  onChange: (documents: DocumentJoint[]) => void;
  readOnly?: boolean;
}

export function PiecesJustificativesUploader({
  documents: initialDocs,
  onChange,
  readOnly = false,
}: PiecesJustificativesUploaderProps) {
  const [docs, setDocs] = useState<DocumentJoint[]>(initialDocs);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateDocs(newDocs: DocumentJoint[]) {
    setDocs(newDocs);
    onChange(newDocs);
  }

  function handleUpload(pieceId: string, accept: string[]) {
    if (readOnly) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      setUploadingId(pieceId);
      startTransition(async () => {
        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("pieceId", pieceId);
          const res = await fetch("/api/admissions/upload-document", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Erreur d'upload");

          // Remplacer si existe déjà, sinon ajouter
          const existing = docs.filter((d) => d.nom !== pieceId);
          updateDocs([...existing, { nom: pieceId, url: data.url, type: data.type }]);
          toast.success(`${data.label} téléversé avec succès`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Erreur d'upload");
        } finally {
          setUploadingId(null);
        }
      });
    };
    input.click();
  }

  function handleRemove(pieceId: string) {
    if (readOnly) return;
    updateDocs(docs.filter((d) => d.nom !== pieceId));
  }

  const { complet, manquantes } = piecesRequisesPresentes(docs);

  return (
    <div className="space-y-4">
      {/* Statut global */}
      <div className="flex items-center gap-2">
        {complet ? (
          <Badge className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Dossier complet
          </Badge>
        ) : (
          <Badge className="bg-amber-50 text-amber-700 border-amber-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            {manquantes.length} pièce(s) manquante(s)
          </Badge>
        )}
      </div>

      {/* Liste des pièces */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PIECES_JUSTIFICATIVES.map((piece) => {
          const doc = docs.find((d) => d.nom === piece.id);
          const isUploading = uploadingId === piece.id;
          const isImage = doc?.type?.startsWith("image/");

          return (
            <Card key={piece.id} className={`p-3 ${doc ? "border-green-200" : ""}`}>
              <CardContent className="p-0 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{piece.label}</span>
                      {piece.required && (
                        <span className="text-red-500 text-xs">*</span>
                      )}
                    </div>
                    {piece.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{piece.description}</p>
                    )}
                  </div>
                  {doc && !readOnly && (
                    <button
                      onClick={() => handleRemove(piece.id)}
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                      title="Supprimer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Aperçu ou bouton upload */}
                {doc ? (
                  <div className="flex items-center gap-2 mt-2">
                    {isImage ? (
                      <img
                        src={doc.url}
                        alt={piece.label}
                        className="w-12 h-12 object-cover rounded border"
                      />
                    ) : (
                      <div className="w-12 h-12 flex items-center justify-center bg-muted rounded border">
                        <FileText className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Téléversé</span>
                      </div>
                      {!readOnly && (
                        <button
                          onClick={() => handleUpload(piece.id, piece.accept)}
                          className="text-xs text-blue-600 hover:underline mt-0.5"
                        >
                          Remplacer
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  !readOnly && (
                    <button
                      onClick={() => handleUpload(piece.id, piece.accept)}
                      disabled={isUploading || isPending}
                      className="flex items-center justify-center gap-2 w-full mt-2 py-2 px-3 border border-dashed rounded-md text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      <span>{isUploading ? "Téléversement..." : "Téléverser"}</span>
                    </button>
                  )
                )}

                {/* Indication format */}
                {!doc && (
                  <p className="text-xs text-muted-foreground/70">
                    {piece.accept.includes("application/pdf") ? "Image ou PDF" : "Image uniquement"}
                    {` · max ${Math.round(piece.maxSize / (1024 * 1024))} Mo`}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Liste des pièces manquantes */}
      {!complet && !readOnly && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
          Pièces obligatoires manquantes : {manquantes.join(", ")}
        </div>
      )}
    </div>
  );
}
