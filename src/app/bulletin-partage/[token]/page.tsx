import { runWithTenant } from "@/lib/prisma";
import { getBulletinData } from "@/lib/pdf/bulletin-generator";
import { BulletinPreview } from "@/components/bulletins/BulletinPreview";
import { PrintBulletinButton } from "@/components/bulletins/PrintBulletinButton";
import { verifierLienBulletin } from "@/lib/bulletins/partage";

export const metadata = { title: "Bulletin de notes", robots: { index: false, follow: false } };

/**
 * Page publique d'un bulletin, ouverte par le lien signé envoyé par e-mail ou
 * WhatsApp. Lecture seule, sans compte : le jeton limite l'accès à ce bulletin.
 */
export default async function BulletinPartagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lien = verifierLienBulletin(token);
  const data = lien
    ? await runWithTenant(lien.tenantId, null, () => getBulletinData(lien.eleveId, lien.periodeId, lien.tenantId))
    : null;

  if (!data || !data.isPublie) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "Arial, sans-serif", textAlign: "center" }}>
        Ce lien est invalide ou a expiré. Demandez un nouvel envoi à l&apos;établissement.
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "16px 0" }} className="print:!bg-white print:!p-0">
      <style dangerouslySetInnerHTML={{ __html: "@page { size: A4; margin: 5mm; }" }} />
      <div className="print:hidden" style={{ maxWidth: "200mm", margin: "0 auto 12px", display: "flex", justifyContent: "flex-end", padding: "0 12px" }}>
        <PrintBulletinButton />
      </div>
      <div style={{ overflowX: "auto" }}>
        <BulletinPreview data={data} />
      </div>
    </div>
  );
}
