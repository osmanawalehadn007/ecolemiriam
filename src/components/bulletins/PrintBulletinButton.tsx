"use client";

export function PrintBulletinButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ background: "#1e40af", color: "#fff", border: 0, borderRadius: 6, padding: "8px 16px", fontSize: 14, cursor: "pointer" }}
    >
      Imprimer / Enregistrer en PDF
    </button>
  );
}
