/**
 * École Miriam — Catalogue des permissions disponibles
 * ============================================================
 * Utilisé par l'UI de gestion des permissions pour afficher
 * les checkboxes organisées par module.
 */

export interface PermissionAction {
  key: string;       // ex: "read"
  label: string;     // ex: "Lecture"
}

export interface PermissionModule {
  key: string;       // ex: "eleves"
  label: string;     // ex: "Élèves"
  icon: string;      // nom de l'icône lucide
  actions: PermissionAction[];
}

// Actions standard disponibles sur la plupart des modules
const CRUD_ACTIONS: PermissionAction[] = [
  { key: "read", label: "Lecture" },
  { key: "write", label: "Écriture" },
  { key: "delete", label: "Suppression" },
];

const CRUD_PUBLISH_ACTIONS: PermissionAction[] = [
  { key: "read", label: "Lecture" },
  { key: "write", label: "Écriture" },
  { key: "delete", label: "Suppression" },
  { key: "publish", label: "Publication" },
];

const CRUD_SEND_ACTIONS: PermissionAction[] = [
  { key: "read", label: "Lecture" },
  { key: "write", label: "Écriture" },
  { key: "delete", label: "Suppression" },
  { key: "send", label: "Envoi" },
];

export const PERMISSION_CATALOG: PermissionModule[] = [
  {
    key: "eleves",
    label: "Élèves",
    icon: "Users",
    actions: CRUD_ACTIONS,
  },
  {
    key: "parents",
    label: "Parents",
    icon: "UserCheck",
    actions: CRUD_ACTIONS,
  },
  {
    key: "enseignants",
    label: "Enseignants",
    icon: "GraduationCap",
    actions: CRUD_ACTIONS,
  },
  {
    key: "classes",
    label: "Classes",
    icon: "School",
    actions: CRUD_ACTIONS,
  },
  {
    key: "matieres",
    label: "Matières",
    icon: "BookOpen",
    actions: CRUD_ACTIONS,
  },
  {
    key: "notes",
    label: "Notes",
    icon: "ClipboardList",
    actions: CRUD_ACTIONS,
  },
  {
    key: "evaluations",
    label: "Évaluations",
    icon: "FileText",
    actions: CRUD_ACTIONS,
  },
  {
    key: "bulletins",
    label: "Bulletins",
    icon: "ScrollText",
    actions: CRUD_PUBLISH_ACTIONS,
  },
  {
    key: "absences",
    label: "Absences",
    icon: "CalendarX",
    actions: CRUD_ACTIONS,
  },
  {
    key: "examens",
    label: "Examens",
    icon: "Award",
    actions: CRUD_ACTIONS,
  },
  {
    key: "emploi-du-temps",
    label: "Emploi du temps",
    icon: "Calendar",
    actions: CRUD_ACTIONS,
  },
  {
    key: "communication",
    label: "Communication",
    icon: "Megaphone",
    actions: CRUD_SEND_ACTIONS,
  },
  {
    key: "messages",
    label: "Messagerie",
    icon: "MessageSquare",
    actions: CRUD_ACTIONS,
  },
  {
    key: "vie-scolaire",
    label: "Vie scolaire",
    icon: "Shield",
    actions: CRUD_ACTIONS,
  },
  {
    key: "admissions",
    label: "Admissions",
    icon: "UserPlus",
    actions: CRUD_ACTIONS,
  },
  {
    key: "rh",
    label: "Ressources humaines",
    icon: "Briefcase",
    actions: CRUD_ACTIONS,
  },
  {
    key: "finance",
    label: "Finances",
    icon: "DollarSign",
    actions: CRUD_ACTIONS,
  },
  {
    key: "inventaire",
    label: "Inventaire",
    icon: "Package",
    actions: CRUD_ACTIONS,
  },
  {
    key: "alumni",
    label: "Anciens élèves",
    icon: "Users2",
    actions: CRUD_ACTIONS,
  },
  {
    key: "orientation",
    label: "Orientation",
    icon: "Compass",
    actions: CRUD_ACTIONS,
  },
  {
    key: "cours",
    label: "Cours",
    icon: "BookCopy",
    actions: CRUD_ACTIONS,
  },
  {
    key: "analytics",
    label: "Statistiques",
    icon: "BarChart3",
    actions: [
      { key: "read", label: "Lecture" },
    ],
  },
  {
    key: "rapports",
    label: "Rapports",
    icon: "FileBarChart",
    actions: [
      { key: "read", label: "Lecture" },
    ],
  },
  {
    key: "documents",
    label: "Documents",
    icon: "FolderOpen",
    actions: CRUD_ACTIONS,
  },
  {
    key: "ai",
    label: "Intelligence artificielle",
    icon: "Sparkles",
    actions: [
      { key: "teacher", label: "Assistant enseignant" },
      { key: "parent", label: "Assistant parent" },
    ],
  },
  {
    key: "audit",
    label: "Journal d'audit",
    icon: "History",
    actions: [
      { key: "read", label: "Lecture" },
    ],
  },
  {
    key: "parametres",
    label: "Paramètres",
    icon: "Settings",
    actions: CRUD_ACTIONS,
  },
  {
    key: "structures",
    label: "Structures",
    icon: "Building2",
    actions: [
      { key: "read", label: "Lecture" },
      { key: "write", label: "Écriture" },
    ],
  },
];

/**
 * Génère toutes les permissions possibles au format "module:action".
 */
export function getAllPermissionKeys(): string[] {
  const keys: string[] = [];
  for (const mod of PERMISSION_CATALOG) {
    for (const action of mod.actions) {
      keys.push(`${mod.key}:${action.key}`);
    }
  }
  return keys;
}
