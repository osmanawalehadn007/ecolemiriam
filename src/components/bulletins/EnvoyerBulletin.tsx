"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { BoutonIcone } from "@/components/bulletins/BoutonIcone";
import { WhatsAppIcon } from "@/components/bulletins/WhatsAppIcon";
import { toast } from "sonner";

type Canal = "email" | "whatsapp";

type Resultat = Record<Canal, { envoyes: number; destinataires: number; erreur: string | null; simule: boolean }>;

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
      } else if (r.simule) {
        toast.warning(`${nom} : envoi SIMULÉ, les clés du service ne sont pas configurées (${r.envoyes}/${r.destinataires}).`);
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
      <BoutonIcone titre={encours === "whatsapp" ? "Envoi WhatsApp…" : "Envoyer par WhatsApp"} couleur="whatsapp" disabled={encours !== null} onClick={() => envoyer("whatsapp")}>
        {encours === "whatsapp" ? <Loader2 size={20} className="animate-spin" /> : <WhatsAppIcon size={22} />}
      </BoutonIcone>
      <BoutonIcone titre={encours === "email" ? "Envoi e-mail…" : "Envoyer par e-mail"} disabled={encours !== null} onClick={() => envoyer("email")}>
        {encours === "email" ? <Loader2 size={20} className="animate-spin" /> : <Mail size={20} />}
      </BoutonIcone>
    </>
  );
}
