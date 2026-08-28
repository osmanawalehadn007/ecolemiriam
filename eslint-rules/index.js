"use strict";

const requireTenantId = require("./require-tenant-id");
const requireSiteFilter = require("./require-site-filter");
const requireAnneeFilter = require("./require-annee-filter");

module.exports = {
  rules: {
    "require-tenant-id": requireTenantId,
    "require-site-filter": requireSiteFilter,
    "require-annee-filter": requireAnneeFilter,
  },
  configs: {
    recommended: {
      plugins: ["ecolemiriam"],
      rules: {
        "ecolemiriam/require-tenant-id": "error",
        "ecolemiriam/require-site-filter": "error",
        "ecolemiriam/require-annee-filter": "error",
      },
    },
  },
};
