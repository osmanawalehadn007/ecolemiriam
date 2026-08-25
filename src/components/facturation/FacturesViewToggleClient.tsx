"use client";

import { useState } from "react";
import { List, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { FacturesTable } from "./FacturesTable";
import { FacturesMonthlyView } from "./FacturesMonthlyView";

type FactureItem = Awaited<ReturnType<typeof import("@/lib/actions/facture").getFacturesForTenant>>[number];

export function FacturesViewToggleClient({ factures }: { factures: FactureItem[] }) {
  const t = useTranslations("facturation");
  const [view, setView] = useState<"list" | "monthly">("list");

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView("list")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all",
            view === "list"
              ? "border-primary bg-primary/10 text-primary"
              : "border-input bg-background hover:bg-muted/50"
          )}
        >
          <List className="h-4 w-4" />
          {t("viewList")}
        </button>
        <button
          onClick={() => setView("monthly")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all",
            view === "monthly"
              ? "border-primary bg-primary/10 text-primary"
              : "border-input bg-background hover:bg-muted/50"
          )}
        >
          <CalendarDays className="h-4 w-4" />
          {t("viewMonthly")}
        </button>
      </div>

      {/* Views */}
      {view === "list" ? (
        <FacturesTable factures={factures} />
      ) : (
        <FacturesMonthlyView factures={factures} />
      )}
    </div>
  );
}
