/**
 * Sert le programme Python de sauvegarde PC.
 * Accessible aux TENANT_ADMIN et SUPER_ADMIN.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import { readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const denied = checkPermission(session.user.role, "export:full");
  if (denied) return denied;

  try {
    const filePath = join(process.cwd(), "scripts", "pc-backup", "ecolemiriam-backup.py");
    const content = await readFile(filePath, "utf-8");

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/x-python; charset=utf-8",
        "Content-Disposition": 'attachment; filename="ecolemiriam-backup.py"',
      },
    });
  } catch {
    return NextResponse.json({ error: "Programme non trouvé" }, { status: 500 });
  }
}
