"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { openPrintWindow } from "@/lib/print-window";
import { fusionnerSaisie } from "@/lib/carnet-primaire/calcul-auto";
import { CarnetFeuille } from "./CarnetFeuille";
import { ajusterCarnetUnePage } from "@/lib/carnet-primaire/ajuster-page";
import {
  CARNETS,
  MODULES,
  baremeTotal,
  type CarnetDef,
  type Module,
  type NiveauCarnet,
} from "@/lib/carnet-primaire/referentiel";
import {
  type Evaluation,
  type SaisieCarnet,
  type SaisieModule,
} from "@/lib/carnet-primaire/notation";

interface EleveClasse {
  id: string;
  nom: string;
  prenom: string;
  matricule: string;
}

interface Props {
  classeNom: string;
  niveau: NiveauCarnet;
  /** Année scolaire au format 2026-2027 ; null si le libellé de la période est inexploitable. */
  annee: string | null;
  eleves: EleveClasse[];
}

const DECISIONS = ["Passe en classe supérieure", "Redouble", "Passe sous réserve"];

export function CarnetEditor({ classeNom, niveau, annee, eleves }: Props) {
  // Modèle par défaut le temps du chargement ; remplacé par la définition du tenant (personnalisée ou non).
  const [definition, setDefinition] = useState<CarnetDef>(CARNETS[niveau]);
  const [eleveId, setEleveId] = useState(eleves[0]?.id ?? "");
  // `saisie` : ce que l'enseignant a saisi à la main. `auto` : valeurs déduites des
  // évaluations et devoirs du module Notes ; la saisie manuelle les remplace.
  const [saisie, setSaisie] = useState<SaisieCarnet>({});
  const [auto, setAuto] = useState<SaisieCarnet>({});
  const [appreciations, setAppreciations] = useState("");
  const [decision, setDecision] = useState("");
  const [chargement, setChargement] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [modifie, setModifie] = useState(false);

  // Un changement de classe remplace la liste d'élèves : on se repositionne sur le premier.
  useEffect(() => {
    setEleveId(eleves[0]?.id ?? "");
  }, [eleves]);

  const charger = useCallback(async () => {
    if (!eleveId || !annee) return;
    setChargement(true);
    try {
      const res = await fetch(`/api/carnets-primaires?eleveId=${eleveId}&annee=${annee}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur de chargement");
      if (data.definition) setDefinition(data.definition);
      setSaisie(data.saisie ?? {});
      setAuto(data.auto ?? {});
      setAppreciations(data.appreciations ?? "");
      setDecision(data.decision ?? "");
      setModifie(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setChargement(false);
    }
  }, [eleveId, annee]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const effectif = useMemo(() => fusionnerSaisie(auto, saisie), [auto, saisie]);
  const aSaisieManuelle = (m: Module) => {
    const s: SaisieModule = saisie[`${m}`] ?? {};
    return (
      Object.keys(s.competences ?? {}).length > 0 ||
      Object.keys(s.domaines ?? {}).length > 0 ||
      typeof s.note === "number"
    );
  };
  const aValeursAuto = (m: Module) => {
    const a: SaisieModule = auto[`${m}`] ?? {};
    return (
      Object.keys(a.competences ?? {}).length > 0 ||
      Object.keys(a.domaines ?? {}).length > 0 ||
      typeof a.note === "number"
    );
  };
  const modulesAuto = MODULES.filter(aValeursAuto);
  const modulesARecalculer = MODULES.filter((m) => aSaisieManuelle(m) && aValeursAuto(m));

  function majModule(m: Module, maj: (courant: SaisieModule) => SaisieModule) {
    setSaisie((prev) => ({ ...prev, [`${m}`]: maj(prev[`${m}`] ?? {}) }));
    setModifie(true);
  }

  function choisirEvaluation(m: Module, cle: string, valeur: Evaluation) {
    majModule(m, (courant) => {
      const competences = { ...(courant.competences ?? {}) };
      if (competences[cle] === valeur) delete competences[cle];
      else competences[cle] = valeur;
      return { ...courant, competences };
    });
  }

  function saisirPoints(m: Module, code: string, texte: string) {
    majModule(m, (courant) => {
      const domaines = { ...(courant.domaines ?? {}) };
      if (texte === "") delete domaines[code];
      else domaines[code] = Number(texte.replace(",", "."));
      return { ...courant, domaines };
    });
  }

  function saisirNote(m: Module, texte: string) {
    majModule(m, (courant) => ({ ...courant, note: texte === "" ? null : Number(texte.replace(",", ".")) }));
  }

  function revenirAuCalcul(m: Module) {
    setSaisie((prev) => {
      const suivant = { ...prev };
      delete suivant[`${m}`];
      return suivant;
    });
    setModifie(true);
  }

  async function enregistrer(): Promise<boolean> {
    if (!eleveId || !annee) return false;
    setEnregistrement(true);
    try {
      const res = await fetch("/api/carnets-primaires", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eleveId, annee, saisie, appreciations, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur d'enregistrement");
      setModifie(false);
      toast.success("Carnet enregistré");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement");
      return false;
    } finally {
      setEnregistrement(false);
    }
  }

  async function imprimer() {
    if (!eleveId || !annee) return;
    if (modifie && !(await enregistrer())) return;
    try {
      const res = await fetch(`/api/carnets-primaires?eleveId=${eleveId}&annee=${annee}&format=html`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur d'impression");
      if (!openPrintWindow(data.html, ajusterCarnetUnePage)) toast.error("La fenêtre d'impression a été bloquée par le navigateur");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'impression");
    }
  }

  if (!annee) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Impossible de déterminer l&apos;année scolaire : le libellé de la période ne contient pas deux années (ex. 2026-2027).
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">
              Carnet {niveau} année — {classeNom}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Année scolaire {annee} ·{" "}
              {definition.format === "competences"
                ? "Évaluation A / EVA / NA par compétence"
                : `Notes par domaine, total des barèmes /${baremeTotal(definition)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={imprimer} disabled={!eleveId || chargement}>
              <Printer className="h-4 w-4" />
              Imprimer
            </Button>
            <Button className="gap-2" onClick={() => void enregistrer()} disabled={!eleveId || enregistrement || !modifie}>
              {enregistrement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </Button>
          </div>
        </div>

        {eleves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève actif dans cette classe.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={eleveId}
                onChange={(e) => setEleveId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Élève"
              >
                {eleves.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.prenom} {e.nom} ({e.matricule})
                  </option>
                ))}
              </select>
              {chargement && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            <CarnetFeuille
              niveau={niveau}
              definition={definition}
              saisie={saisie}
              auto={auto}
              effectif={effectif}
              onEvaluation={choisirEvaluation}
              onPoints={saisirPoints}
              onNote={saisirNote}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>
                {modulesAuto.length > 0
                  ? "Valeurs proposées d'après les évaluations et devoirs saisis dans Notes (traits pointillés) ; modifiez-les pour les remplacer."
                  : "Aucune évaluation n'alimente ce carnet : saisissez les valeurs, ou rattachez des évaluations aux modules dans Évaluations."}
              </p>
              <div className="flex flex-wrap gap-1">
                {modulesARecalculer.map((m) => (
                  <Button key={m} variant="ghost" size="sm" onClick={() => revenirAuCalcul(m)}>
                    Module {m} : revenir au calcul automatique
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Appréciations générales</span>
                <textarea
                  value={appreciations}
                  onChange={(e) => {
                    setAppreciations(e.target.value);
                    setModifie(true);
                  }}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Décision de fin d&apos;année</span>
                <input
                  list="decisions-carnet"
                  value={decision}
                  onChange={(e) => {
                    setDecision(e.target.value);
                    setModifie(true);
                  }}
                  maxLength={200}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <datalist id="decisions-carnet">
                  {DECISIONS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </label>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
