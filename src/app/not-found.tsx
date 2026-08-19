import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-8 text-center">
      <FileQuestion className="h-16 w-16 text-muted-foreground mb-4" />
      <h1 className="text-2xl font-bold mb-2">404 — Page introuvable</h1>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        La page que vous recherchez n'existe pas ou a été déplacée.
      </p>
      <Link href="/dashboard">
        <Button>Retour au tableau de bord</Button>
      </Link>
    </div>
  );
}
