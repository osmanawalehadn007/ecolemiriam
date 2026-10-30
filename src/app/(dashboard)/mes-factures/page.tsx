import Link from "next/link";
import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { isRelationScopedRole } from "@/lib/site-scope";
import { getFacturesForTenant } from "@/lib/actions/facture";

/**
 * Espace famille — « Factures de mon enfant »
 * ============================================================
 * Pour PARENT/STUDENT : liste des factures de leurs propres enfants
 * (`getFacturesForTenant` applique `personalScopeFilter`, donc un parent ne
 * voit JAMAIS la facture d'un autre élève). Les liens pointent vers les
 * routes PDF/reçu déjà sécurisées et bornées au même périmètre.
 *
 * Les rôles finance (`finance:read`) y voient la même liste que dans
 * `/facturation` (l'entrée de menu est leur raccourci) ; les autres rôles du
 * personnel sont redirigés — cet écran est réservé aux familles et à la
 * finance, pas un doublon de l'écran de gestion.
 */
export default async function MesFacturesPage() {
  const session = await auth();
  // familles (rôles à périmètre personnel) ou rôles finance
  guardPage(session, isRelationScopedRole(session?.user?.role) ? undefined : "finance:read");

  const factures = await getFacturesForTenant();

  const fmt = (montant: number, devise: string) =>
    `${montant.toLocaleString("fr-FR")} ${devise}`;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Factures de mon enfant</h1>
        <p className="text-sm text-slate-500 mt-1">
          Consultez les factures et téléchargez les reçus de paiement.
        </p>
      </div>

      {factures.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Aucune facture pour le moment.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Numéro</th>
                <th className="px-4 py-3">Élève</th>
                <th className="px-4 py-3">Classe</th>
                <th className="px-4 py-3">Libellé</th>
                <th className="px-4 py-3">Montant</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Échéance</th>
                <th className="px-4 py-3">Documents</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {factures.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{f.numero}</td>
                  <td className="px-4 py-3">
                    {f.eleve ? `${f.eleve.prenom} ${f.eleve.nom}` : "—"}
                  </td>
                  <td className="px-4 py-3">{f.eleve?.classe?.nom ?? "—"}</td>
                  <td className="px-4 py-3">{f.libelle}</td>
                  <td className="px-4 py-3 font-medium">{fmt(f.montant, f.devise)}</td>
                  <td className="px-4 py-3">{f.statut}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {f.echeance ? new Date(f.echeance).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/api/factures/${f.id}/pdf`}
                      target="_blank"
                      className="text-indigo-600 hover:underline"
                    >
                      Facture PDF
                    </Link>
                    {f.paiements?.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {f.paiements.map((p) => (
                          <li key={p.id}>
                            <Link
                              href={`/api/paiements/${p.id}/recu`}
                              target="_blank"
                              className="text-emerald-600 hover:underline text-xs"
                            >
                              Reçu — {fmt(p.montant, f.devise)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}