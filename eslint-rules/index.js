"use strict";

const requireTenantId = require("./require-tenant-id");
const requireSiteFilter = require("./require-site-filter");

module.exports = {
  rules: {
    "require-tenant-id": requireTenantId,
    "require-site-filter": requireSiteFilter,
  },
  configs: {
    recommended: {
      plugins: ["ecolemiriam"],
      rules: {
        "ecolemiriam/require-tenant-id": "error",
        "ecolemiriam/require-site-filter": "error",
      },
    },
  },
};
