import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";

/**
 * Page de changement de mot de passe (hors du layout dashboard, pour pouvoir y
 * rediriger un compte dont `mustChangePassword` est vrai sans boucle).
 */
export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-slate-950 dark:to-slate-900 p-4 py-8">
      <div className="w-full max-w-md">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
