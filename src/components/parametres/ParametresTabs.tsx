"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Settings, Users, GraduationCap, BookOpen, UserCog, Settings2, Calendar, Stamp, Building2,
  School, UsersRound, BookOpenCheck, ChevronDown, DollarSign, CopyCheck, ClipboardList, DoorOpen,
  Shield, HardDriveDownload, CalendarX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EtablissementTab } from "./EtablissementTab";
import { UsersTab } from "./UsersTab";
import { ClassesTab } from "./ClassesTab";
import { MatieresTab } from "./MatieresTab";
import { ParentsTab } from "./ParentsTab";
import { ReglesAppreciationManager } from "./ReglesAppreciationManager";
import { PeriodesClotureManager } from "./PeriodesClotureManager";
import { SignatureCachetManager } from "./SignatureCachetManager";
import { SitesTab } from "./SitesTab";
import { TarifsTab } from "./TarifsTab";
import { DoublonsTab } from "./DoublonsTab";
import { Security2FA } from "./Security2FA";
import { SauvegardesTab } from "./SauvegardesTab";
import { AnneesScolairesTab } from "./AnneesScolairesTab";
import { EnseignantsAffectationTab } from "./EnseignantsAffectationTab";
import { EdtPersonnelsTab } from "./EdtPersonnelsTab";
import { SallesTab } from "./SallesTab";

import type { AvailableTenant } from "@/auth.config";

type Tab =
  | "etablissement"
  | "annees"
  | "utilisateurs"
  | "parents"
  | "classes"
  | "matieres"
  | "enseignants"
  | "edtPersonnels"
  | "salles"
  | "appreciations"
  | "periodes"
  | "signature"
  | "sites"
  | "tarifs"
  | "doublons"
  | "securite"
  | "sauvegardes";
import type { ParametresTab as Tab } from "@/lib/parametres-tabs";
export type { Tab };

type TabDef = { id: Tab; labelKey: string; icon: typeof Settings };

type TabGroup = {
  groupKey: string;
  icon: typeof Settings;
  tabs: TabDef[];
  /** Si défini, le groupe n'est visible que pour ces rôles. */
  adminOnly?: boolean;
};

const tabGroups: TabGroup[] = [
  {
    groupKey: "groupEtablissement",
    icon: School,
    tabs: [
      { id: "etablissement", labelKey: "etablissement", icon: Settings },
      { id: "annees", labelKey: "anneesScolaires", icon: Calendar },
      { id: "sites", labelKey: "sites", icon: Building2 },
      { id: "signature", labelKey: "signature", icon: Stamp },
    ],
  },
  {
    groupKey: "groupUsers",
    icon: UsersRound,
    tabs: [
      { id: "utilisateurs", labelKey: "users", icon: Users },
      { id: "parents", labelKey: "parents", icon: UserCog },
      { id: "doublons", labelKey: "doublons", icon: CopyCheck },
    ],
  },
  {
    groupKey: "groupPedagogie",
    icon: BookOpenCheck,
    tabs: [
      { id: "classes", labelKey: "classes", icon: GraduationCap },
      { id: "matieres", labelKey: "matieres", icon: BookOpen },
      { id: "enseignants", labelKey: "enseignantsAffectation", icon: ClipboardList },
      { id: "edtPersonnels", labelKey: "edtPersonnels", icon: CalendarX },
      { id: "salles", labelKey: "salles", icon: DoorOpen },
      { id: "appreciations", labelKey: "appreciations", icon: Settings2 },
      { id: "periodes", labelKey: "periodes", icon: Calendar },
    ],
  },
  {
    groupKey: "groupFinance",
    icon: DollarSign,
    tabs: [
      { id: "tarifs", labelKey: "tarifs", icon: DollarSign },
    ],
  },
  {
    groupKey: "groupSecurite",
    icon: Shield,
    adminOnly: true,
    tabs: [
      { id: "securite", labelKey: "securite", icon: Shield },
      { id: "sauvegardes", labelKey: "sauvegardes", icon: HardDriveDownload },
    ],
  },
];

interface ParametresTabsProps {
  etablissement: NonNullable<Awaited<ReturnType<typeof import("@/lib/actions/parametres").getEtablissementData>>>;
  users: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getUsersForTenant>>;
  parents: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getParentsForSettings>>;
  eleves: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getElevesForLinking>>;
  classes: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getClassesForSettings>>;
  matieres: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getMatieresForSettings>>;
  regles: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getReglesAppreciation>>;
  periodes: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getPeriodesForCloture>>;
  sites: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getSitesForSettings>>;
  annees: Awaited<ReturnType<typeof import("@/lib/actions/parametres").getAnneesScolaires>>;
  canManage: boolean;
  sessionRole?: string;
  sessionSiteId?: string;
  availableTenants?: AvailableTenant[];
  /**
   * Onglets auxquels l'appelant a droit. Calculé côté serveur depuis la matrice
   * RBAC : l'interface ne propose donc que ce que le serveur acceptera.
   * Absent = tous les onglets (rétro-compatibilité).
   */
  allowedTabs?: Tab[];
}

export function ParametresTabs({
  etablissement,
  users,
  parents,
  eleves,
  classes,
  matieres,
  regles,
  periodes,
  sites,
  annees,
  canManage,
  sessionRole,
  sessionSiteId,
  availableTenants,
  allowedTabs,
}: ParametresTabsProps) {
  const t = useTranslations("parametres");
  // Année courante du tenant : sert de valeur par défaut aux formulaires
  // (création de classe notamment), à la place d'un libellé écrit en dur.
  const anneeCourante = annees.find((a) => a.isCurrent)?.libelle ?? annees[0]?.libelle;
  const [activeTab, setActiveTab] = useState<Tab>("etablissement");

  // ── Filtrage par rôle : le groupe Sécurité (2FA + Sauvegardes) n'est
  //    visible que pour TENANT_ADMIN et SUPER_ADMIN (le directeur).
  const isAdmin = sessionRole === "TENANT_ADMIN" || sessionRole === "SUPER_ADMIN";
  const visibleGroups = tabGroups.filter((g) => !g.adminOnly || isAdmin);

  // Trouver le groupe actif (parmi les groupes visibles seulement)
  const activeGroup = visibleGroups.find((g) => g.tabs.some((tab) => tab.id === activeTab)) ?? visibleGroups[0];
  const [activeGroupId, setActiveGroupId] = useState(activeGroup.groupKey);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(activeGroup.groupKey);
  // Groupes réduits aux onglets autorisés — un groupe sans onglet disparaît.
  const groups = tabGroups
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((tab) => !allowedTabs || allowedTabs.includes(tab.id)),
    }))
    .filter((group) => group.tabs.length > 0);
  const firstTab: Tab = groups[0]?.tabs[0]?.id ?? "etablissement";
  const [activeTab, setActiveTab] = useState<Tab>(firstTab);
  // Trouver le groupe actif
  const activeGroup = groups.find((g) => g.tabs.some((tab) => tab.id === activeTab)) ?? groups[0];
  const [activeGroupId, setActiveGroupId] = useState(activeGroup?.groupKey ?? "");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(activeGroup?.groupKey ?? null);

  // Quand on change de groupe, activer le premier sous-onglet
  function handleGroupClick(group: TabGroup) {
    setActiveGroupId(group.groupKey);
    setExpandedGroup(expandedGroup === group.groupKey ? null : group.groupKey);
    if (expandedGroup !== group.groupKey) {
      setActiveTab(group.tabs[0].id);
    }
  }

  return (
    <div className="space-y-4">
      {/* Niveau 1: Onglets de groupe */}
      <div className="flex flex-wrap gap-2">
        {visibleGroups.map((group) => (
        {groups.map((group) => (
          <button
            key={group.groupKey}
            onClick={() => handleGroupClick(group)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
              activeGroupId === group.groupKey
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <group.icon className="h-4 w-4" />
            {t(group.groupKey)}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expandedGroup === group.groupKey && "rotate-180"
              )}
            />
          </button>
        ))}
      </div>

      {/* Niveau 2: Sous-onglets du groupe actif */}
      {expandedGroup && (
        <div className="flex flex-wrap gap-1.5 border-b pb-px">
          {visibleGroups
          {groups
            .find((g) => g.groupKey === expandedGroup)
            ?.tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {t(tab.labelKey)}
              </button>
            ))}
        </div>
      )}

      {/* Contenu de l'onglet actif */}
      <div>
        {activeTab === "etablissement" && <EtablissementTab etablissement={etablissement} canManage={canManage} />}
        {activeTab === "annees" && <AnneesScolairesTab annees={annees} canManage={canManage} />}
        {activeTab === "utilisateurs" && <UsersTab users={users} canManage={canManage} sessionRole={sessionRole} sessionSiteId={sessionSiteId} availableTenants={availableTenants} sites={sites} />}
        {activeTab === "utilisateurs" && <UsersTab users={users} canManage={canManage} availableTenants={availableTenants} sites={sites} />}
        {activeTab === "parents" && <ParentsTab parents={parents} eleves={eleves} canManage={canManage} />}
        {activeTab === "classes" && (
          <ClassesTab
            classes={classes}
            canManage={canManage}
            sites={sites}
            anneeCourante={anneeCourante}
          />
        )}
        {activeTab === "matieres" && <MatieresTab matieres={matieres} canManage={canManage} />}
        {activeTab === "enseignants" && <EnseignantsAffectationTab canManage={canManage} />}
        {activeTab === "edtPersonnels" && <EdtPersonnelsTab canManage={canManage} />}
        {activeTab === "salles" && <SallesTab canManage={canManage} sites={sites} />}
        {activeTab === "appreciations" && <ReglesAppreciationManager regles={regles} />}
        {activeTab === "periodes" && (
          <PeriodesClotureManager
            periodes={periodes.map((p) => ({
              id: p.id,
              nom: p.nom,
              numero: p.numero,
              dateDebut: p.dateDebut.toISOString(),
              dateFin: p.dateFin.toISOString(),
              isCurrent: p.isCurrent,
              statut: p.statut,
              cloturedAt: p.cloturedAt ? p.cloturedAt.toISOString() : null,
              dateLimiteSaisie: p.dateLimiteSaisie ? p.dateLimiteSaisie.toISOString() : null,
            }))}
          />
        )}
        {activeTab === "signature" && (
          <SignatureCachetManager
            tenant={{
              name: etablissement.name,
              chefEtablissement: etablissement.chefEtablissement,
              signatureUrl: etablissement.signatureUrl,
              cachetUrl: etablissement.cachetUrl,
              logoUrl: etablissement.logoUrl,
            }}
          />
        )}
        {activeTab === "sites" && <SitesTab sites={sites} canManage={canManage} />}
        {activeTab === "tarifs" && <TarifsTab anneeCourante={anneeCourante} />}
        {activeTab === "doublons" && <DoublonsTab />}
        {activeTab === "securite" && <Security2FA />}
        {activeTab === "sauvegardes" && <SauvegardesTab />}
      </div>
    </div>
  );
}
