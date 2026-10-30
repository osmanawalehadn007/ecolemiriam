"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";

type Canal = "email" | "whatsapp";

type Resultat = Record<Canal, { envoyes: number; destinataires: number; erreur: string | null }>;

export function EnvoyerBulletin({ eleveId, periodeId }: { eleveId: string; periodeId: string }) {
  const [encours, setEncours] = useState<Canal | null>(null);

  async function envoyer(canal: Canal) {
    setEncours(canal);
    try {
      const res = await fetch("/api/bulletins/envoyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eleveId, periodeId, canaux: [canal] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Échec de l'envoi");
      const r = (data as { email: Resultat["email"]; whatsapp: Resultat["whatsapp"] })[canal];
      const nom = canal === "email" ? "e-mail" : "WhatsApp";
      if (r.destinataires === 0) {
        toast.error(canal === "email" ? "Aucun parent n'a d'adresse e-mail." : "Aucun parent n'a de numéro de téléphone.");
      } else if (r.erreur) {
        toast.error(`${nom} : ${r.erreur}`);
      } else {
        toast.success(`Bulletin envoyé par ${nom} (${r.envoyes}/${r.destinataires}).`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'envoi");
    } finally {
      setEncours(null);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-2" disabled={encours !== null} onClick={() => envoyer("email")}>
        <Mail className="h-4 w-4" />
        {encours === "email" ? "Envoi…" : "Envoyer par e-mail"}
      </Button>
      <Button size="sm" variant="outline" className="gap-2" disabled={encours !== null} onClick={() => envoyer("whatsapp")}>
        <MessageCircle className="h-4 w-4" />
        {encours === "whatsapp" ? "Envoi…" : "Envoyer par WhatsApp"}
      </Button>
    </>
  );
}
