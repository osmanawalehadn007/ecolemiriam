"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface WeekData {
  semaine: string;
  justifiees: number;
  injustifiees: number;
  retards: number;
}

/**
 * Graphique d'absences sur 8 semaines.
 *
 * OPTIMISATION: les données sont désormais passées côté serveur par la page
 * (dashboard/page.tsx) au lieu d'être fetchées via un appel HTTP client.
 * Cela élimine:
 *  - 1 aller-retour HTTP supplémentaire
 *  - 1 appel auth() supplémentaire
 *  - 1 requête DB supplémentaire
 *  - l'état de loading (spinner) pendant le fetch
 */
export function AbsenceChart({ data }: { data: WeekData[] }) {
  const t = useTranslations("dashboard");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t("absencesChart")}</CardTitle>
        <CardDescription>{t("last8Weeks")} — {new Date().getFullYear()}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 || data.every((d) => d.justifiees === 0 && d.injustifiees === 0 && d.retards === 0) ? (
          <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
            {t("noAbsences8Weeks")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} barSize={10} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="semaine"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid hsl(var(--border))",
                  backgroundColor: "hsl(var(--popover))",
                  color: "hsl(var(--popover-foreground))",
                  fontSize: "12px",
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "12px" }}
              />
              <Bar dataKey="justifiees" name={t("justified")} fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="injustifiees" name={t("unjustified")} fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="retards" name={t("late")} fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
