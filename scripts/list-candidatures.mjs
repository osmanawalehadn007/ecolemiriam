import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

async function main() {
  const candidatures = await prisma.candidature.findMany({
    select: {
      id: true,
      prenom: true,
      nom: true,
      statut: true,
      siteId: true,
      createdAt: true,
      tenantId: true,
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`Total candidatures: ${candidatures.length}`);
  for (const c of candidatures) {
    console.log(JSON.stringify(c, null, 2));
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
