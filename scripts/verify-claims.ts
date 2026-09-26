import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const emails = ["ilyasadendjama@gmail.com", "mohamed.abdi.pk12@gmail.com", "ahdimounomar@gmail.com", "admin@ecolemiriam.com"];
  for (const email of emails) {
    const u = await p.user.findUnique({
      where: { email },
      select: { email: true, userTenants: { select: { tenant: { select: { slug: true, name: true } }, role: true, isActive: true, isDefault: true } }, userSites: { select: { site: { select: { nom: true } }, role: true } } },
    });
    console.log(`${email} -> tenant=${u?.userTenants.map(t=>`${t.tenant.slug}/${t.role}${t.isDefault?"(defaut)":""}`).join(",") || "AUCUN"} | sites=${u?.userSites.map(s=>s.site.nom).join(", ") || "aucun"}`);
  }
  await p.$disconnect();
})();
