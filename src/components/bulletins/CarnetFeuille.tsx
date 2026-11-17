"use client";

import { Fragment } from "react";
import "./carnet-feuille.css";
import {
  CHIFFRES_ROMAINS,
  COULEUR_MOYENNE,
  TEINTES,
  TEINTES_REPLI,
} from "@/lib/carnet-primaire/html";
import {
  MODULES,
  baremeTotal,
  type CarnetDef,
  type Domaine,
  type Module,
  type NiveauCarnet,
} from "@/lib/carnet-primaire/referentiel";
import {
  cleCompetence,
  degreMaitrise,
  moyenneAnnuelle,
  noteModule,
  type Evaluation,
  type SaisieCarnet,
} from "@/lib/carnet-primaire/notation";

const EVALUATIONS: Evaluation[] = ["A", "EVA", "NA"];

interface Props {
  niveau: NiveauCarnet;
  definition: CarnetDef;
  /** Saisie manuelle de l'enseignant. */
  saisie: SaisieCarnet;
  /** Valeurs déduites des évaluations et devoirs (remplacées par la saisie manuelle). */
  auto: SaisieCarnet;
  /** Saisie fusionnée avec les valeurs automatiques. */
  effectif: SaisieCarnet;
  onEvaluation: (module: Module, cle: string, valeur: Evaluation) => void;
  onPoints: (module: Module, code: string, texte: string) => void;
  onNote: (module: Module, texte: string) => void;
}

function formaterNote(note: number | null): string {
  if (note === null) return "";
  return note.toFixed(2).replace(/\.?0+$/, "");
}

function teinte(niveau: NiveauCarnet, domaine: Domaine, index: number) {
  return TEINTES[niveau][domaine.code] ?? TEINTES_REPLI[index % TEINTES_REPLI.length];
}

function titreCompetences(niveau: NiveauCarnet, domaine: Domaine): string {
  return domaine.titre ?? domaine.libelle.toUpperCase();
}

function titrePoints(niveau: NiveauCarnet, domaine: Domaine, index: number): string {
  const numero = CHIFFRES_ROMAINS[index] ?? String(index + 1);
  const corps = domaine.titre ?? domaine.libelle.toUpperCase();
  return `${numero}–${corps}${domaine.bareme ? ` / ${domaine.bareme}` : ""}`;
}

/** Met en gras le début « CB1/Lecture: » d'une ligne, comme dans le modèle imprimé. */
function LignePoints({ texte }: { texte: string }) {
  const m = texte.match(/^(.{1,48}?[:/][^:]{0,30}?:|CB[^/]{0,6}\/)([\s\S]*)$/);
  if (!m) return <>{texte}</>;
  return (
    <>
      <b>{m[1]}</b>
      {m[2]}
    </>
  );
}

function EnTeteModules({ fond }: { fond: string }) {
  return (
    <>
      <tr className="cf-modules">
        <td className="cf-vide" />
        {MODULES.map((m) => (
          <th key={m} colSpan={3}>
            Module {m}
          </th>
        ))}
      </tr>
      <tr className="cf-evals">
        <td className="cf-fond-lignes" style={{ background: fond }} />
        {MODULES.map((m) => (
          <Fragment key={m}>
            {EVALUATIONS.map((ev) => (
              <th key={ev}>{ev}</th>
            ))}
          </Fragment>
        ))}
      </tr>
    </>
  );
}

function DomaineCompetences({
  niveau,
  domaine,
  index,
  saisie,
  auto,
  effectif,
  onEvaluation,
}: Pick<Props, "niveau" | "saisie" | "auto" | "effectif" | "onEvaluation"> & { domaine: Domaine; index: number }) {
  const t = teinte(niveau, domaine, index);
  const gras = ["ARABE", "EMCI", "EMT_TICE", "SCIENCES"].includes(domaine.code);
  return (
    <table className="cf-domaine">
      <colgroup>
        <col className="cf-c-lib" />
        {MODULES.flatMap((m) => EVALUATIONS.map((ev) => <col key={`${m}${ev}`} className="cf-c-ev" />))}
      </colgroup>
      <thead>
        <tr>
          <th className="cf-titre" colSpan={13} style={{ background: t.entete }}>
            <span className="cf-pastille" />
            {titreCompetences(niveau, domaine)}
          </th>
        </tr>
        <EnTeteModules fond={t.lignes} />
      </thead>
      <tbody>
        {domaine.lignes.map((ligne, i) => {
          const cle = cleCompetence(domaine, i);
          return (
            <tr key={cle}>
              <td className={`cf-lib${gras ? " cf-gras" : ""}`} style={{ background: t.lignes }}>
                <span className="cf-puce">●</span> C{i + 1}/ {ligne}
              </td>
              {MODULES.map((m) => {
                const manuelle = saisie[`${m}`]?.competences?.[cle];
                const valeur = effectif[`${m}`]?.competences?.[cle];
                const calculee = auto[`${m}`]?.competences?.[cle];
                return EVALUATIONS.map((ev, k) => {
                  const coche = valeur === ev;
                  return (
                    <td key={`${m}${ev}`} className={`cf-ev${k === 0 ? " cf-debut" : ""}`}>
                      <button
                        type="button"
                        className="cf-case"
                        aria-pressed={coche}
                        aria-label={`${ev}, module ${m}, compétence ${i + 1} — ${domaine.libelle}`}
                        data-valeur={coche ? ev : undefined}
                        data-auto={coche && manuelle === undefined && calculee === ev ? "true" : undefined}
                        title={coche && manuelle === undefined && calculee === ev ? "Calculé d'après les évaluations et devoirs" : undefined}
                        onClick={() => onEvaluation(m, cle, ev)}
                      >
                        {coche ? "✓" : ""}
                      </button>
                    </td>
                  );
                });
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DomainesPoints({
  niveau,
  definition,
  saisie,
  auto,
  onPoints,
}: Pick<Props, "niveau" | "definition" | "saisie" | "auto" | "onPoints">) {
  return (
    <table className="cf-domaine cf-points">
      <colgroup>
        <col />
        {MODULES.map((m) => (
          <col key={m} className="cf-p-pts" />
        ))}
      </colgroup>
      <thead>
        <tr className="cf-modules-points">
          <td className="cf-vide" />
          {MODULES.map((m) => (
            <th key={m}>Module{m}</th>
          ))}
        </tr>
      </thead>
      {definition.domaines.map((domaine, index) => {
        const t = teinte(niveau, domaine, index);
        return (
          <tbody key={domaine.code}>
            <tr>
              <td className="cf-titre" colSpan={5} style={{ background: t.entete }}>
                <span className="cf-pastille" />
                {titrePoints(niveau, domaine, index)}
              </td>
            </tr>
            {domaine.lignes.map((ligne, i) => (
              <tr key={i}>
                <td className="cf-lib" style={{ background: t.lignes }}>
                  <LignePoints texte={ligne} />
                </td>
                {i === 0 &&
                  MODULES.map((m) => {
                    const manuelle = saisie[`${m}`]?.domaines?.[domaine.code];
                    const calculee = auto[`${m}`]?.domaines?.[domaine.code];
                    return (
                      <td key={m} className="cf-pts" rowSpan={domaine.lignes.length}>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={domaine.bareme}
                          step="0.25"
                          value={manuelle ?? ""}
                          placeholder={calculee === undefined ? "" : String(calculee)}
                          data-auto={manuelle === undefined && calculee !== undefined ? "true" : undefined}
                          title={
                            manuelle === undefined && calculee !== undefined
                              ? "Calculé d'après les évaluations et devoirs ; saisissez une valeur pour la remplacer"
                              : undefined
                          }
                          aria-label={`Module ${m} — ${domaine.libelle}`}
                          onChange={(e) => onPoints(m, domaine.code, e.target.value)}
                        />
                        {domaine.bareme ? <small>/ {domaine.bareme}</small> : null}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        );
      })}
    </table>
  );
}

function Synthese({
  niveau,
  definition,
  saisie,
  auto,
  effectif,
  onNote,
}: Pick<Props, "niveau" | "definition" | "saisie" | "auto" | "effectif" | "onNote">) {
  const moyenne = moyenneAnnuelle(definition, effectif);
  const saisieNote = definition.format === "competences";
  return (
    <div className="cf-synthese">
      <table className="cf-moyennes" style={{ ["--fond" as string]: COULEUR_MOYENNE[niveau] }}>
        <thead>
          <tr>
            <th className="cf-titre-moyenne">MOYENNE GÉNÉRALE PAR MODULE</th>
            {MODULES.map((m) => (
              <th key={m}>Module{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="cf-note-sur">NOTE SUR 10</td>
            {MODULES.map((m) => {
              const note = noteModule(definition, effectif[`${m}`]);
              const degre = note === null ? "" : degreMaitrise(note);
              const manuelle = saisie[`${m}`]?.note;
              const calculee = auto[`${m}`]?.note;
              return (
                <td key={m} className="cf-note">
                  {saisieNote ? (
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={10}
                      step="0.25"
                      value={typeof manuelle === "number" ? manuelle : ""}
                      placeholder={typeof calculee === "number" ? String(calculee) : note === null ? "" : formaterNote(note)}
                      aria-label={`Note du module ${m} sur 10`}
                      onChange={(e) => onNote(m, e.target.value)}
                    />
                  ) : (
                    formaterNote(note)
                  )}
                  {degre ? <small>{degre}</small> : null}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      {definition.format === "points" && <p className="cf-total-bareme">Total des barèmes : /{baremeTotal(definition)}</p>}
      <table className="cf-maitrise" style={{ ["--fond" as string]: niveau === "2ème" ? "#FFFF00" : "#FBD4B4" }}>
        <thead>
          <tr>
            <th colSpan={4} className="cf-bandeau-maitrise">
              DEGRE DE MAITRISE DE LA COMPETENCE DE BASE
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td rowSpan={2} className="cf-correspondantes">
              Notes correspondantes
            </td>
            <td className="cf-jaune">Acquis</td>
            <td className="cf-jaune">En voie d’acquisition</td>
            <td className="cf-jaune">Non acquis</td>
          </tr>
          <tr>
            <td className="cf-bar">7 à 10</td>
            <td className="cf-bar">4 à 6</td>
            <td className="cf-bar">0 à 3</td>
          </tr>
          <tr>
            <td colSpan={4} className="cf-espace" />
          </tr>
          <tr>
            <td className="cf-annuelle">
              <span>MOYENNE GÉNÉRALE ANNUELLE</span>
            </td>
            <td colSpan={3} className="cf-valeur">
              {formaterNote(moyenne)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Carnet à l'écran : les quatre modules côte à côte, comme sur le carnet imprimé. */
export function CarnetFeuille(props: Props) {
  const { niveau, definition, saisie, auto, effectif, onEvaluation, onPoints, onNote } = props;
  return (
    <div className="carnet-ecran">
      <div className="cf-defilement">
        {definition.format === "points" ? (
          <div className="cf-colonne-unique">
            <DomainesPoints niveau={niveau} definition={definition} saisie={saisie} auto={auto} onPoints={onPoints} />
          </div>
        ) : (
          <div className="cf-colonnes">
            {definition.domaines.map((domaine, index) => (
              <DomaineCompetences
                key={domaine.code}
                niveau={niveau}
                domaine={domaine}
                index={index}
                saisie={saisie}
                auto={auto}
                effectif={effectif}
                onEvaluation={onEvaluation}
              />
            ))}
          </div>
        )}
      </div>
      <Synthese niveau={niveau} definition={definition} saisie={saisie} auto={auto} effectif={effectif} onNote={onNote} />
    </div>
  );
}
