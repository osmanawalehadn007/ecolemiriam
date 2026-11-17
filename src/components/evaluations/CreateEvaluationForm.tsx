"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { hasPermission } from "@/lib/client-permissions";
import { MODULES, estNiveauCarnet, type CarnetDef, type NiveauCarnet } from "@/lib/carnet-primaire/referentiel";
import { domaineDeMatiere } from "@/lib/carnet-primaire/correspondance";

interface Props {
  classes: { id: string; nom: string; niveau?: string }[];
  matieres: { id: string; nom: string }[];
  periodes: { id: string; nom: string }[];
  /** Modèle du carnet de chaque niveau du primaire, pour proposer module et compétence. */
  carnets?: Record<NiveauCarnet, CarnetDef>;
  userRole?: string;
}

export function CreateEvaluationForm({ classes, matieres, periodes, carnets, userRole }: Props) {
  const t = useTranslations("evaluations");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [classeId, setClasseId] = useState("");
  const [matiereId, setMatiereId] = useState("");
  const [moduleCarnet, setModuleCarnet] = useState("");
  const [ligneCarnet, setLigneCarnet] = useState("all");
  const router = useRouter();
  const canWrite = hasPermission(userRole, "evaluations:write");
  if (!canWrite) return null;

  // Classe du primaire : l'évaluation peut alimenter le carnet (module + compétence visée).
  const niveauClasse = classes.find((c) => c.id === classeId)?.niveau ?? "";
  const definition = carnets && estNiveauCarnet(niveauClasse) ? carnets[niveauClasse] : null;
  const matiere = matieres.find((m) => m.id === matiereId);
  const codeDomaine = definition && matiere ? domaineDeMatiere(definition, matiere) : null;
  const domaine = definition?.domaines.find((d) => d.code === codeDomaine);
  const surLigne = definition?.format === "competences" && !!domaine && moduleCarnet !== "" && moduleCarnet !== "none";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    startTransition(async () => {
      try {
        const res = await fetch("/api/evaluations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titre: data.titre,
            type: data.type,
            classeId: data.classeId,
            matiereId: data.matiereId,
            periodeId: data.periodeId,
            date: data.date,
            duree: Number(data.duree),
            coefficient: Number(data.coefficient),
            description: data.description,
            moduleCarnet: definition && moduleCarnet !== "" && moduleCarnet !== "none" ? Number(moduleCarnet) : null,
            ligneCarnet: surLigne && ligneCarnet !== "all" ? Number(ligneCarnet) : null,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || t("createError"));
        }

        toast.success(t("createSuccess"));
        setOpen(false);
        setModuleCarnet("");
        setLigneCarnet("all");
        router.refresh();
      } catch (error: any) {
        toast.error(error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-md">
          <PlusCircle className="h-5 w-5" />
          {t("addExam")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl bg-background border-none shadow-2xl rounded-xl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="bg-muted -mx-6 -mt-6 p-6 border-b rounded-t-xl mb-4">
          <DialogTitle className="text-xl text-foreground font-bold flex items-center gap-2">
            <PlusCircle className="h-6 w-6 text-blue-600" />
            {t("addExam")}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{t("addExamDesc")}</p>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="bg-blue-50/50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-100 dark:border-blue-900">
            <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-400 mb-4">{t("examInfo")}</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="titre" className="text-red-500 font-medium">{t("examTitle")}</Label>
                <Input id="titre" name="titre" required placeholder={t("examTitlePlaceholder")} className="bg-background" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type" className="text-red-500 font-medium">{t("examType")}</Label>
                <Select name="type" required defaultValue="CONTROLE">
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONTROLE">{t("typeControle")}</SelectItem>
                    <SelectItem value="DEVOIR">{t("typeDevoir")}</SelectItem>
                    <SelectItem value="EXAMEN">{t("typeExamen")}</SelectItem>
                    <SelectItem value="TP">{t("typeTP")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="classeId" className="text-red-500 font-medium">{t("class")}</Label>
                <Select name="classeId" required onValueChange={(v) => { setClasseId(v); setModuleCarnet(""); setLigneCarnet("all"); }}>
                  <SelectTrigger className="bg-background"><SelectValue placeholder={t("selectClass")} /></SelectTrigger>
                  <SelectContent>
                    {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="matiereId" className="text-red-500 font-medium">{t("subject")}</Label>
                <Select name="matiereId" required onValueChange={(v) => { setMatiereId(v); setLigneCarnet("all"); }}>
                  <SelectTrigger className="bg-background"><SelectValue placeholder={t("selectSubject")} /></SelectTrigger>
                  <SelectContent>
                    {matieres.map(m => <SelectItem key={m.id} value={m.id}>{m.nom}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="periodeId" className="text-red-500 font-medium">{t("period")}</Label>
                <Select name="periodeId" required>
                  <SelectTrigger className="bg-background"><SelectValue placeholder={t("selectPeriod")} /></SelectTrigger>
                  <SelectContent>
                    {periodes.map(p => <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="date" className="text-red-500 font-medium">{t("dateTime")}</Label>
                <Input type="datetime-local" id="date" name="date" required className="bg-background" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="duree" className="text-red-500 font-medium">{t("duration")}</Label>
                <Input type="number" id="duree" name="duree" defaultValue={60} required className="bg-background" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="coefficient" className="text-red-500 font-medium">{t("coefficient")}</Label>
                <Input type="number" step="0.1" id="coefficient" name="coefficient" defaultValue={1} required className="bg-background" />
              </div>
            </div>
          </div>

          {definition && (
            <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-4 rounded-lg border border-emerald-200 dark:border-emerald-900 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-400">Carnet du primaire</h3>
                <p className="text-xs text-muted-foreground">
                  Les notes de cette évaluation (contrôle, devoir, examen…) alimentent automatiquement le carnet de l&apos;élève.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="moduleCarnet" className="text-red-500 font-medium">Module du carnet</Label>
                  <select
                    id="moduleCarnet"
                    required
                    value={moduleCarnet}
                    onChange={(e) => setModuleCarnet(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="" disabled>Choisir…</option>
                    {MODULES.map((m) => <option key={m} value={m}>Module {m}</option>)}
                    <option value="none">Ne pas utiliser dans le carnet</option>
                  </select>
                </div>
                {surLigne && domaine && (
                  <div className="space-y-2">
                    <Label htmlFor="ligneCarnet">Compétence visée</Label>
                    <select
                      id="ligneCarnet"
                      value={ligneCarnet}
                      onChange={(e) => setLigneCarnet(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="all">Tout le domaine « {domaine.libelle} »</option>
                      {domaine.lignes.map((ligne, i) => (
                        <option key={i} value={i}>C{i + 1} — {ligne.length > 60 ? `${ligne.slice(0, 60)}…` : ligne}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {matiere && !domaine && moduleCarnet !== "none" && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  La matière « {matiere.nom} » n&apos;est reliée à aucun domaine du carnet : ses notes n&apos;y apparaîtront pas.
                  Reliez-la dans Paramètres › Pédagogie › Carnets du primaire.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">{t("description")}</Label>
            <Textarea id="description" name="description" placeholder={t("descriptionPlaceholder")} className="bg-muted" />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button type="submit" disabled={isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
              {isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
