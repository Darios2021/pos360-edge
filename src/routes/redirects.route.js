/**
 * src/routes/redirects.route.js
 */

const { FRONTEND_INDEX_PATH } = require("../config");
const { removeTrailingSlash } = require("../utils/path");

function registerRedirectRoutes(app) {
  app.get("/", (req, res) => res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/"));
  app.get("/shop", (req, res) => res.redirect(301, "/shop/"));
  app.get("/app", (req, res) => res.redirect(301, "/app/"));
}

module.exports = { registerRedirectRoutes };
