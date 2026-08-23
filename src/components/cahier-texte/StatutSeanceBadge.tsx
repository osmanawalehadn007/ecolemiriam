"use client";

import { Badge } from "@/components/ui/badge";
import {
  Circle,
  CheckCircle2,
  Lock,
  XCircle,
  RefreshCw,
} from "lucide-react";
import type { StatutSeance } from "@prisma/client";

const STATUT_CONFIG: Record<
  StatutSeance,
  { label: string; icon: typeof Circle; className: string }
> = {
  PLANIFIEE: {
    label: "Planifiée",
    icon: Circle,
    className:
      "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-300 dark:border-slate-700",
  },
  EFFECTUEE: {
    label: "Effectuée",
    icon: CheckCircle2,
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-300 dark:border-green-800",
  },
  CLOTUREE: {
    label: "Clôturée",
    icon: Lock,
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300 dark:border-blue-800",
  },
  ANNULEE: {
    label: "Annulée",
    icon: XCircle,
    className:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-300 dark:border-red-800",
  },
  REMPLACEE: {
    label: "Remplacée",
    icon: RefreshCw,
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300 dark:border-amber-800",
  },
};

export function StatutSeanceBadge({ statut }: { statut: StatutSeance }) {
  const config = STATUT_CONFIG[statut];
  const Icon = config.icon;
  return (
    <Badge
      variant="outline"
      className={`text-xs ${config.className}`}
    >
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}

export function getStatutColor(statut: StatutSeance): string {
  return STATUT_CONFIG[statut].className;
}

export { STATUT_CONFIG };
