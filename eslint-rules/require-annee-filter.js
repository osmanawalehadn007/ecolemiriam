/**
 * ESLint rule: force le filtre d'année scolaire sur les requêtes Prisma
 *
 * @fileoverview
 * Détecte les requêtes Prisma qui manquent de filtrage par année scolaire.
 *
 * Règle 1 — Modèle racine sans filtre d'année :
 *   prisma.classe.findMany({ where: { tenantId, ...siteFilter } })
 *   → ERREUR si aucun anneeFilterForModel / scopedFilterForModel
 *     n'est étalé dans le where ET que le modèle est dans ANNEE_SCOPED_MODELS.
 *
 * Règle 2 — prismaSiteScoped / scoped exempt :
 *   scoped.classe.findMany({ where: {} })
 *   → OK : le Proxy injecte automatiquement le filtre.
 *
 * Règle 3 — eslint-disable explicite :
 *   // eslint-disable-next-line ecolemiriam/require-annee-filter
 *   prisma.parcoursScolaire.findMany({ where: { tenantId } })
 *   → OK pour les lectures d'historique légitimes.
 *
 * @example .eslintrc.js
 * rules: { "ecolemiriam/require-annee-filter": "error" }
 */

"use strict";

// Modèles qui nécessitent un filtre d'année (portent un champ `annee` ou
// sont rattachés à une classe via une relation).
const ANNEE_SCOPED_MODELS = new Set([
  "classe",
  "emploiTemps",
  "tarifNiveau",
  "candidature",
  "fournitureListe",
  "evaluation",
  "cahierTexte",
  "devoir",
  "chapitre",
]);

// Modèles exemptés (historique légitime, données transverses).
const ANNEE_EXEMPT_MODELS = new Set([
  "parcoursScolaire",
]);

// Méthodes de lecture qui nécessitent un filtre.
const READ_METHODS = new Set([
  "findMany", "findFirst", "findUnique", "count", "groupBy", "aggregate",
]);

// Fonctions qui produisent un filtre d'année.
const ANNEE_FILTER_FUNCTIONS = new Set([
  "anneeFilterForModel",
  "scopedFilterForModel",
]);

// Noms de variables historiquement reconnus.
const ANNEE_FILTER_IDENTIFIERS = new Set([
  ...ANNEE_FILTER_FUNCTIONS,
  "anneeFilter",
  "anneeWhere",
]);

/**
 * Remonte à la valeur d'initialisation d'une variable locale.
 * (Symétrique de resolveInit dans require-site-filter.js.)
 */
function resolveInit(node, scope) {
  if (!scope || !node || node.type !== "Identifier") return null;
  for (let s = scope; s; s = s.upper) {
    const variable = s.set && s.set.get(node.name);
    if (!variable) continue;
    for (const def of variable.defs) {
      if (def.node && def.node.type === "VariableDeclarator" && def.node.init) {
        return def.node.init;
      }
    }
    return null;
  }
  return null;
}

function isAnneeFilterCall(node, scope, depth = 0) {
  if (!node || node.type !== "CallExpression" || depth > 6) return false;
  const callee = node.callee.name || (node.callee.property && node.callee.property.name);

  if (ANNEE_FILTER_FUNCTIONS.has(callee)) return true;

  // mergeFilters(a, b, …) propage : il suffit qu'un argument porte le filtre.
  if (callee === "mergeFilters") {
    return node.arguments.some((a) => hasAnneeFilterInObject(a, scope, depth + 1));
  }

  // Helper local : on l'accepte seulement si toutes ses sorties portent le filtre.
  const fn = resolveFunction(node.callee, scope);
  if (fn) {
    const sorties = returnExpressions(fn);
    if (sorties.length > 0) {
      return sorties.every((s) => hasAnneeFilterInObject(s, scope, depth + 1));
    }
  }
  return false;
}

function resolveFunction(node, scope) {
  if (!scope || !node || node.type !== "Identifier") return null;
  for (let s = scope; s; s = s.upper) {
    const variable = s.set && s.set.get(node.name);
    if (!variable) continue;
    for (const def of variable.defs) {
      const d = def.node;
      if (!d) continue;
      if (d.type === "FunctionDeclaration") return d;
      if (
        d.type === "VariableDeclarator" &&
        d.init &&
        (d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression")
      ) {
        return d.init;
      }
    }
    return null;
  }
  return null;
}

function returnExpressions(fn) {
  if (!fn.body) return [];
  if (fn.body.type !== "BlockStatement") return [fn.body];

  const sorties = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (
      node !== fn &&
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression")
    ) {
      return;
    }
    if (node.type === "ReturnStatement" && node.argument) sorties.push(node.argument);
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === "string") visit(child);
    }
  };
  visit(fn.body);
  return sorties;
}

function hasAnneeFilterInObject(objNode, scope, depth = 0) {
  if (!objNode || depth > 6) return false;

  if (objNode.type === "TSAsExpression") {
    return hasAnneeFilterInObject(objNode.expression, scope, depth + 1);
  }

  if (objNode.type === "CallExpression") {
    if (isAnneeFilterCall(objNode, scope, depth)) return true;
    const calleeName = objNode.callee.name || (objNode.callee.property && objNode.callee.property.name);
    if (ANNEE_FILTER_IDENTIFIERS.has(calleeName)) return true;
  }

  if (objNode.type === "ConditionalExpression") {
    return (
      hasAnneeFilterInObject(objNode.consequent, scope, depth + 1) &&
      hasAnneeFilterInObject(objNode.alternate, scope, depth + 1)
    );
  }

  if (objNode.type === "Identifier") {
    if (ANNEE_FILTER_IDENTIFIERS.has(objNode.name)) return true;
    const init = resolveInit(objNode, scope);
    return init ? hasAnneeFilterInObject(init, scope, depth + 1) : false;
  }

  if (objNode.type !== "ObjectExpression") return false;

  for (const prop of objNode.properties) {
    if (prop.type === "SpreadElement") {
      if (hasAnneeFilterInObject(prop.argument, scope, depth + 1)) return true;
      continue;
    }

    if (!prop.key) continue;

    const keyName = prop.key.name || prop.key.value;

    // AND encapsule souvent le filtre d'année.
    if (keyName === "AND" && prop.value.type === "ArrayExpression") {
      for (const element of prop.value.elements) {
        if (hasAnneeFilterInObject(element, scope, depth + 1)) return true;
      }
    }

    // Direct call: anneeFilter: anneeFilterForModel(...)
    if (prop.value && prop.value.type === "CallExpression" && isAnneeFilterCall(prop.value, scope, depth)) {
      return true;
    }

    // Champ `annee` direct dans le where : prisma.classe.findMany({ where: { annee } })
    // C'est un filtre d'année valide, même sans passer par anneeFilterForModel.
    if (keyName === "annee" || keyName === "anneeInscription") {
      return true;
    }
  }

  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Force le filtrage par année scolaire sur les requêtes Prisma",
    },
    messages: {
      missingAnneeFilter:
        "Requête Prisma sur {{model}} sans filtre d'année scolaire — utilisez anneeFilterForModel(\"{{model}}\", anneeCourante) ou ajoutez `annee` dans le where",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "MemberExpression"
        ) {
          const model = node.callee.object.property.name;
          const method = node.callee.property.name;

          const rootObj = node.callee.object.object;
          const isPrisma = rootObj.type === "Identifier" && rootObj.name === "prisma";
          const isScoped = rootObj.type === "Identifier" && rootObj.name === "scoped";

          // prismaSiteScoped() injecte automatiquement le filtre → pas d'erreur.
          if (isScoped) return;

          if (!isPrisma) return;
          if (!READ_METHODS.has(method)) return;
          if (ANNEE_EXEMPT_MODELS.has(model)) return;
          if (!ANNEE_SCOPED_MODELS.has(model)) return;

          const scope = context.sourceCode.getScope(node);

          const arg = node.arguments[0];
          if (!arg || arg.type !== "ObjectExpression") {
            if (method === "findMany" || method === "count") {
              context.report({
                node,
                messageId: "missingAnneeFilter",
                data: { model },
              });
            }
            return;
          }

          const whereProp = arg.properties.find(
            (p) => p.key && (p.key.name === "where" || p.key.value === "where")
          );

          if (!whereProp) {
            context.report({
              node,
              messageId: "missingAnneeFilter",
              data: { model },
            });
            return;
          }

          if (!hasAnneeFilterInObject(whereProp.value, scope)) {
            context.report({
              node,
              messageId: "missingAnneeFilter",
              data: { model },
            });
          }
        }
      },
    };
  },
};
