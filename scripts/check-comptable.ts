import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({
    where: { role: "ACCOUNTANT", isActive: true },
    select: { id: true, name: true, email: true, role: true, tenantId: true },
    take: 5,
  });
  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}
main();
