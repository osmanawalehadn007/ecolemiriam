"use client";

import type { CSSProperties, ReactNode } from "react";
import type { BulletinData } from "@/lib/pdf/bulletin-generator";
import { format } from "date-fns";
import { libelleRang } from "@/lib/bulletins/bareme";

/**
 * Bulletin de notes — reproduction du modèle Excel de l'établissement
 * (feuille « Bulletin trimestre »). Mise en page en styles inline : le rendu
 * à l'écran et à l'impression doit rester identique au modèle.
 */

interface Props {
  data: BulletinData;
}

const C = {
  jaune: "#FFFF00",
  bleu: "#D9E2F3",
  bleuFonce: "#B4C6E7",
  orange: "#FBE5D6",
  gris: "#F2F2F2",
  grisTitre: "#E7E6E6",
  ocre: "#FFF2CC",
  ciel: "#DDEBF7",
  rouge: "#FF0000",
};

const BORDER = "1.5px solid #000";

const cell = (bg?: string, extra: CSSProperties = {}): CSSProperties => ({
  border: BORDER,
  background: bg,
  padding: "1px 4px",
  textAlign: "center",
  verticalAlign: "middle",
  ...extra,
});

function formatDateFr(date?: Date | null) {
  if (!date) return "";
  return format(new Date(date), "dd/MM/yyyy");
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(Math.round(v * 100) / 100);
}

function libelleAnnee(data: BulletinData): string {
  const periode = /semestre/i.test(data.periodeNom)
    ? data.periodeNom
    : `Trimestre N°${data.periodeNumero}`;
  return `${periode} :${data.annee}`;
}

const NUMEROS_ROMAINS = ["I", "II", "III"];
const BULLETINS = ["1er BULLETIN", "2e BULLETIN", "3e BULLETIN"];

function Case({ coche }: { coche: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "5mm",
        height: "5mm",
        border: "1.5px solid #000",
        background: "#fff",
        lineHeight: "4mm",
        textAlign: "center",
        fontWeight: 700,
        fontSize: "11px",
      }}
    >
      {coche ? "✓" : ""}
    </span>
  );
}

function Cell({
  bg,
  style,
  colSpan,
  rowSpan,
  children,
}: {
  bg?: string;
  style?: CSSProperties;
  colSpan?: number;
  rowSpan?: number;
  children?: ReactNode;
}) {
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} style={cell(bg, style)}>
      {children}
    </td>
  );
}

export function BulletinPreview({ data }: Props) {
  const decision = data.decision ?? null;
  const t = (n: number) => data.trimestres.find((x) => x.numero === n);

  return (
    <div
      id="bulletin-document"
      style={{
        width: "200mm",
        margin: "0 auto",
        padding: "4mm 0",
        background: "#fff",
        color: "#000",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: "9.5px",
        boxSizing: "border-box",
        // Sans cela, les aplats de couleur du modèle ne sortent pas à l'impression.
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {/* En-tête de l'établissement : même bloc que l'attestation de scolarité */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: "3mm",
          borderBottom: "2px solid #1e40af",
          paddingBottom: "2mm",
        }}
      >
        {data.ecoleLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.ecoleLogo}
            alt="Logo"
            style={{ maxWidth: "100%", maxHeight: "40mm", objectFit: "contain" }}
          />
        ) : (
          <div style={{ height: "20mm" }} />
        )}
        <div style={{ textAlign: "center", lineHeight: 1.2, marginTop: "1mm" }}>
          <div style={{ fontWeight: 700, fontSize: "14px", color: "#1e40af" }}>{data.ecoleName}</div>
          {data.ecoleVille && (
            <div style={{ fontSize: "10px" }}>
              {data.ecoleVille}
              {data.ecolePays ? `, ${data.ecolePays}` : ""}
            </div>
          )}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: "1mm" }}>
        <colgroup>
          <col style={{ width: "26.4%" }} />
          <col style={{ width: "13.4%" }} />
          <col style={{ width: "12.9%" }} />
          <col style={{ width: "9.6%" }} />
          <col style={{ width: "17.5%" }} />
          <col style={{ width: "20.2%" }} />
        </colgroup>
        <tbody>
          {/* Identité de l'élève */}
          {[
            ["Matricule:", data.eleveMatricule, "Année Scolaire:", libelleAnnee(data)],
            ["Nom:", data.eleveNom, "Classe:", data.eleveClasse],
            ["Prénom(s):", data.elevePrenom, "Sexe:", data.eleveSexe],
            ["Date de Naissance", formatDateFr(data.eleveDateNaissance), "Lieu de Naissance:", data.eleveLieuNaissance ?? ""],
          ].map(([l1, v1, l2, v2], i) => (
            <tr key={l1} style={{ height: "6.5mm" }}>
              <Cell bg={C.jaune} style={{ textAlign: "left", paddingLeft: "6px" }}>{l1}</Cell>
              <Cell bg={C.bleu} colSpan={2}>{v1}</Cell>
              {i === 0 && (
                <Cell rowSpan={4} style={{ padding: 0 }}>
                  {data.elevePhotoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.elevePhotoUrl}
                      alt="Photo"
                      style={{ display: "block", width: "100%", height: "26mm", objectFit: "cover" }}
                    />
                  )}
                </Cell>
              )}
              <Cell bg={C.jaune} style={{ textAlign: "right", paddingRight: "6px" }}>{l2}</Cell>
              <Cell bg={C.bleu} style={{ textAlign: "left", paddingLeft: "6px" }}>{v2}</Cell>
            </tr>
          ))}

          {/* Bandeau */}
          <tr style={{ height: "9mm" }}>
            <Cell bg={C.orange} colSpan={6} style={{ fontWeight: 700, fontSize: "13px" }}>
              BULLETIN SCOLAIRE
            </Cell>
          </tr>

          {/* Matières */}
          <tr style={{ height: "8mm", fontWeight: 700 }}>
            <Cell>MATIERES</Cell>
            <Cell>MOYENNE GENERALE</Cell>
            <Cell>MIN</Cell>
            <Cell>MAX</Cell>
            <Cell>MOYENNE GENERALE</Cell>
            <Cell>APPRECIATIONS</Cell>
          </tr>
          {data.notes.map((n) => (
            <tr key={n.matiereCode} style={{ height: "8mm" }}>
              <Cell bg={C.orange}>
                {n.nomProfesseur ? <div>{n.nomProfesseur}</div> : null}
                <div>{n.matiereNom}</div>
              </Cell>
              <Cell bg={C.bleu}>{fmt(n.moyenne)}</Cell>
              <Cell bg={C.gris}>{fmt(n.moyenneMin)}</Cell>
              <Cell bg={C.gris}>{fmt(n.moyenneMax)}</Cell>
              <Cell bg={C.gris}>{fmt(n.moyenneClasse)}</Cell>
              <Cell bg={C.gris} style={{ textAlign: "left", paddingLeft: "6px" }}>{n.appreciation ?? ""}</Cell>
            </tr>
          ))}
          <tr style={{ height: "7.5mm" }}>
            <Cell bg={C.orange} style={{ fontWeight: 700, fontSize: "11px" }}>Moyenne generale</Cell>
            <Cell bg={C.bleu}>{fmt(data.moyenneGenerale)}</Cell>
            <Cell bg={C.gris} colSpan={2} />
            <Cell bg={C.gris} style={{ fontWeight: 700 }}>{fmt(data.moyenneClasse)}</Cell>
            <Cell bg={C.gris} />
          </tr>

          <tr style={{ height: "3mm" }}>
            <td colSpan={6} />
          </tr>

          {/* Rapport trimestriel */}
          <tr style={{ height: "7mm" }}>
            <Cell bg={C.bleu} colSpan={6} style={{ fontWeight: 700 }}>RAPPORT TRIMESTRIEL</Cell>
          </tr>
          <tr style={{ height: "7mm" }}>
            {NUMEROS_ROMAINS.map((r) => (
              <Cell key={r} bg={C.bleu} colSpan={2} style={{ fontWeight: 700 }}>TRIMESTRE {r}</Cell>
            ))}
          </tr>
          <tr style={{ height: "7mm" }}>
            {[1, 2, 3].map((n) => (
              <FragmentLigne key={n} label="moy élève" valeur={fmt(t(n)?.moyenne)} />
            ))}
          </tr>
          <tr style={{ height: "7mm" }}>
            {[1, 2, 3].map((n) => (
              <FragmentLigne key={n} label="rang" valeur={libelleRang(t(n)?.rang)} noir />
            ))}
          </tr>

          {/* Conseil de classe */}
          <tr style={{ height: "6mm" }}>
            <Cell colSpan={6} style={{ fontWeight: 700 }}>CONSEIL DE CLASSE</Cell>
          </tr>
          <tr style={{ height: "7mm" }}>
            <Cell bg={C.bleu} colSpan={2}>Absence</Cell>
            <Cell bg={C.jaune} style={{ fontWeight: 700 }}>{data.heuresAbsence ?? 0}H</Cell>
            <Cell bg={C.bleuFonce} colSpan={2}>Félicitation</Cell>
            <Cell><Case coche={decision === "FELICITATIONS"} /></Cell>
          </tr>
          <tr style={{ height: "7mm" }}>
            <Cell bg={C.bleu} colSpan={2}>Avertissement</Cell>
            <Cell bg={C.orange}><Case coche={decision === "AVERTISSEMENT"} /></Cell>
            <Cell bg={C.bleuFonce} colSpan={2}>Encouragements</Cell>
            <Cell><Case coche={decision === "ENCOURAGEMENTS"} /></Cell>
          </tr>
          <tr style={{ height: "7mm" }}>
            <Cell bg={C.bleu} colSpan={2}>Blâme</Cell>
            <Cell bg={C.orange}><Case coche={decision === "BLAME"} /></Cell>
            <Cell bg={C.bleuFonce} colSpan={2}>Insuffisants</Cell>
            <Cell><Case coche={decision === "INSUFFISANTS"} /></Cell>
          </tr>

          <tr style={{ height: "7mm" }}>
            <Cell bg={C.grisTitre} colSpan={6} style={{ fontWeight: 700 }}>APPRECIATION DU CONSEIL DE CLASSE</Cell>
          </tr>
          {BULLETINS.map((label, i) => (
            <tr key={label} style={{ height: "7mm" }}>
              <Cell bg={C.ocre} colSpan={3} style={{ fontWeight: 700 }}>{label}</Cell>
              <Cell bg={C.jaune} colSpan={3} style={{ fontWeight: 700 }}>{t(i + 1)?.appreciation ?? ""}</Cell>
            </tr>
          ))}

          <tr style={{ height: "3mm" }}>
            <td colSpan={6} />
          </tr>

          {/* Mention spéciale / cachet */}
          <tr style={{ height: "6.5mm" }}>
            <Cell bg={C.ciel} colSpan={4} style={{ fontWeight: 700 }}>MENTION SPECIALE</Cell>
            <Cell bg={C.ciel} colSpan={2} style={{ fontWeight: 700 }}>Cachet du principal</Cell>
          </tr>
          <tr style={{ height: "22mm" }}>
            <Cell colSpan={4} />
            <Cell colSpan={2} style={{ position: "relative", padding: 0 }}>
              {data.cachetUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.cachetUrl}
                  alt="Cachet"
                  style={{ position: "absolute", inset: 0, margin: "auto", maxHeight: "20mm", maxWidth: "90%", objectFit: "contain", opacity: 0.85 }}
                />
              )}
              {data.signatureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.signatureUrl}
                  alt="Signature"
                  style={{ position: "relative", maxHeight: "16mm", maxWidth: "90%", objectFit: "contain" }}
                />
              )}
            </Cell>
          </tr>

          <tr style={{ height: "9mm" }}>
            <Cell bg={C.grisTitre} style={{ fontWeight: 700, fontSize: "11px" }}>DECISION FINALE:</Cell>
            <Cell bg={C.grisTitre} colSpan={2} style={{ fontWeight: 700, fontSize: "12px" }}>
              {data.decisionPassage ?? ""}
            </Cell>
            <Cell bg={C.grisTitre} colSpan={3} style={{ fontWeight: 700, fontSize: "11px", textAlign: "left", paddingLeft: "6px" }}>
              Vie active:
            </Cell>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Une paire « libellé / valeur » du rapport trimestriel (2 colonnes). */
function FragmentLigne({ label, valeur, noir }: { label: string; valeur: string; noir?: boolean }) {
  return (
    <>
      <Cell bg={C.bleu} style={{ fontWeight: 700, textAlign: "left", paddingLeft: "6px" }}>{label}</Cell>
      <Cell bg={C.jaune} style={{ fontWeight: 700, color: noir ? "#000" : C.rouge }}>{valeur}</Cell>
    </>
  );
}
