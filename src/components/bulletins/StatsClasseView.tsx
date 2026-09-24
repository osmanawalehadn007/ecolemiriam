"use client";

import { useState, useEffect } from "react";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, Award, Users, BarChart3, ArrowUp, ArrowDown } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

interface StatsData {
  effectif: number;
  moyenneClasse: number;
  mediane: number;
  ecartType: number;
  tauxReussite: number;
  meilleureNote: number;
  plusBasseNote: number;
  matieresStats: Array<{
    id: string; nom: string; code: string; moyenne: number;
    tauxReussite: number; effectif: number; meilleure: number; plusBasse: number;
  }>;
  classement: Array<{
    rang: number; eleveId: string; nom: string; matricule: string;
    moyenne: number | null; decision: string | null;
  }>;
  decisions: Record<string, number>;
  evolution: Array<{ periodeId: string; periodeNom: string; moyenne: number; effectif: number }>;
  top5: Array<{ rang: number; nom: string; moyenne: number | null; eleveId?: string }>;
  bottom5: Array<{ rang: number; nom: string; moyenne: number | null; eleveId?: string }>;
}

const DECISION_COLORS: Record<string, string> = {
  FELICITATIONS: "#eab308",
  ENCOURAGEMENTS: "#3b82f6",
  PASSAGE: "#22c55e",
  AVERTISSEMENT: "#f97316",
  REDOUBLEMENT: "#ef4444",
  NON_RENSEIGNE: "#9ca3af",
};

const DECISION_LABELS: Record<string, string> = {
  FELICITATIONS: "Félicitations",
  ENCOURAGEMENTS: "Encouragements",
  PASSAGE: "Passage",
  AVERTISSEMENT: "Avertissement",
  REDOUBLEMENT: "Redoublement",
  NON_RENSEIGNE: "Non renseigné",
};

export function StatsClasseView({ classeId, periodeId }: { classeId: string; periodeId: string }) {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!classeId || !periodeId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/bulletins/stats-classe?classeId=${classeId}&periodeId=${periodeId}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error ?? "Erreur");
        }
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [classeId, periodeId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const decisionPieData = Object.entries(data.decisions)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: DECISION_LABELS[k] ?? k, value: v, key: k }));

  return (
    <div className="space-y-6">
      {/* KPIs principaux */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Effectif</span>
            </div>
            <p className="text-2xl font-bold">{data.effectif}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Moyenne classe</span>
            </div>
            <p className="text-2xl font-bold">{data.moyenneClasse}/20</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Taux réussite</span>
            </div>
            <p className="text-2xl font-bold text-green-600">{data.tauxReussite}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Award className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Médiane / Écart</span>
            </div>
            <p className="text-2xl font-bold">{data.mediane} <span className="text-sm text-muted-foreground">±{data.ecartType}</span></p>
          </CardContent>
        </Card>
      </div>

      {/* Évolution entre périodes */}
      {data.evolution.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Évolution de la moyenne de classe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.evolution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="periodeNom" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 20]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="moyenne" stroke="#6366f1" strokeWidth={2} name="Moyenne /20" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Taux de réussite par matière */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Taux de réussite par matière
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.matieresStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <YAxis dataKey="code" type="category" tick={{ fontSize: 11 }} width={60} />
                <Tooltip
                  formatter={(v: number) => [`${v}%`, "Taux réussite"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.nom ?? ""}
                />
                <Bar dataKey="tauxReussite" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Répartition des décisions */}
        {decisionPieData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Award className="d-4 w-4" />
                Répartition des décisions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={decisionPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(e: { name: string; value: number }) => `${e.name}: ${e.value}`}
                  >
                    {decisionPieData.map((entry) => (
                      <Cell key={entry.key} fill={DECISION_COLORS[entry.key] ?? "#999"} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Top 5 / Bottom 5 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-green-600">
              <ArrowUp className="h-4 w-4" />
              Top 5
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Rang</th>
                  <th className="text-left px-4 py-2 font-medium">Élève</th>
                  <th className="text-right px-4 py-2 font-medium">Moyenne</th>
                </tr>
              </thead>
              <tbody>
                {data.top5.map((e, idx) => (
                  <tr key={e.eleveId ?? idx} className="border-b">
                    <td className="px-4 py-2"><Badge variant="info">{e.rang}</Badge></td>
                    <td className="px-4 py-2 font-medium">{e.nom}</td>
                    <td className="px-4 py-2 text-right font-bold text-green-600">{e.moyenne?.toFixed(2) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-red-600">
              <ArrowDown className="h-4 w-4" />
              Élèves en difficulté
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Rang</th>
                  <th className="text-left px-4 py-2 font-medium">Élève</th>
                  <th className="text-right px-4 py-2 font-medium">Moyenne</th>
                </tr>
              </thead>
              <tbody>
                {data.bottom5.map((e, idx) => (
                  <tr key={e.eleveId ?? idx} className="border-b">
                    <td className="px-4 py-2"><Badge variant="destructive">{e.rang}</Badge></td>
                    <td className="px-4 py-2 font-medium">{e.nom}</td>
                    <td className="px-4 py-2 text-right font-bold text-red-600">{e.moyenne?.toFixed(2) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Détail par matière */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Détail par matière</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Matière</th>
                  <th className="text-right px-4 py-2 font-medium">Moyenne</th>
                  <th className="text-right px-4 py-2 font-medium">Taux réussite</th>
                  <th className="text-right px-4 py-2 font-medium">Max</th>
                  <th className="text-right px-4 py-2 font-medium">Min</th>
                  <th className="text-right px-4 py-2 font-medium">Effectif</th>
                </tr>
              </thead>
              <tbody>
                {data.matieresStats.map((m) => (
                  <tr key={m.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{m.nom}</td>
                    <td className={`px-4 py-2 text-right font-bold ${m.moyenne >= 10 ? "text-green-600" : "text-red-600"}`}>
                      {m.moyenne.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Badge variant={m.tauxReussite >= 70 ? "success" : m.tauxReussite >= 50 ? "info" : "destructive"}>
                        {m.tauxReussite}%
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right text-green-600">{m.meilleure.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right text-red-600">{m.plusBasse.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{m.effectif}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
