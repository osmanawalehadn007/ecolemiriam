import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) { console.log("No tenant found"); return; }

  const existing = await prisma.user.findUnique({ where: { email: "comptable.test@ecolemiriam.com" } });
  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { role: "ACCOUNTANT", isActive: true, tenantId: tenant.id },
    });
    console.log("Updated:", JSON.stringify({ id: updated.id, email: updated.email, role: updated.role, tenantId: updated.tenantId }, null, 2));
  } else {
    const hashed = await bcrypt.hash("Ttestt@@", 10);
    const user = await prisma.user.create({
      data: {
        email: "comptable.test@ecolemiriam.com",
        name: "Agent Comptable Test",
        role: "ACCOUNTANT",
        password: hashed,
        isActive: true,
        tenantId: tenant.id,
      },
    });
    console.log("Created:", JSON.stringify({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId }, null, 2));
  }
  await prisma.$disconnect();
}
main();
