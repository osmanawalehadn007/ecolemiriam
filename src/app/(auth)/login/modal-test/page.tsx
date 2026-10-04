"use client";

// PAGE DE TEST TEMPORAIRE (dev uniquement) — reproduction de la modale
// "nouvelle entrée" du cahier de texte pour diagnostic visuel.
// Supprimer après diagnostic.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const CLASSES = [
  { id: "c1", nom: "CP-A" }, { id: "c2", nom: "CE1-B" }, { id: "c3", nom: "CM2-A" },
  { id: "c4", nom: "6ème-A" }, { id: "c5", nom: "5ème-B" },
];
const MATIERES = [
  { id: "m1", nom: "Lecture" }, { id: "m2", nom: "Arabe" }, { id: "m3", nom: "Mathématiques" },
];
const ENSEIGNANTS = [
  { id: "e1", nom: "M. Ahmed Hassan" }, { id: "e2", nom: "Mme Fatouma Ali" },
];

export default function ModalTestPage() {
  const [open, setOpen] = useState(true);
  const [classeId, setClasseId] = useState("");
  const [matiereId, setMatiereId] = useState("");
  const [enseignantId, setEnseignantId] = useState("");

  return (
    <div className="p-8 bg-slate-50 min-h-screen">
      <h1 className="text-xl font-bold mb-4">Test modale cahier de texte</h1>

      {/* Fond chargé qui imite la liste des entrées derrière la modale */}
      <div className="space-y-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs px-2 py-1 bg-slate-100 rounded">lun. 22 sept.</span>
              <span className="text-xs px-2 py-1 bg-violet-100 text-violet-700 rounded">6ème-A</span>
              <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">Lecture</span>
            </div>
            <p className="text-sm text-slate-700">
              Ligne de fond {i + 1} — contenu de séance fictif pour vérifier la transparence.
            </p>
            <p className="text-sm text-slate-700 mt-2">
              Autre ligne {i + 1} — devoirs donnés, prochain cours, etc.
            </p>
          </div>
        ))}
      </div>

      {/* Réplique exacte de la modale de création CahierTextView */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouvelle entrée</DialogTitle>
          </DialogHeader>
          <form className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Classe *</label>
                <Select value={classeId} onValueChange={setClasseId}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner une classe" /></SelectTrigger>
                  <SelectContent>
                    {CLASSES.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Matière *</label>
                <Select value={matiereId} onValueChange={setMatiereId}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner une matière" /></SelectTrigger>
                  <SelectContent>
                    {MATIERES.map((m) => <SelectItem key={m.id} value={m.id}>{m.nom}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Enseignant</label>
              <Select value={enseignantId} onValueChange={setEnseignantId}>
                <SelectTrigger><SelectValue placeholder="Sélectionner un enseignant" /></SelectTrigger>
                <SelectContent>
                  {ENSEIGNANTS.map((e) => <SelectItem key={e.id} value={e.id}>{e.nom}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Date *</label>
                <Input type="date" defaultValue="2026-09-22" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Heure début</label>
                <Input type="time" defaultValue="08:00" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Heure fin</label>
                <Input type="time" defaultValue="09:00" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Contenu *</label>
              <Textarea rows={3} defaultValue="Chapitre 3 : les fractions — exercices page 12." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="button">Créer</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
