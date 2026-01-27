/**
 * src/routes/ogDefault.route.js
 */

const fs = require("fs");
const { OG_DEFAULT_FILE, SHOP_UPSTREAM } = require("../config");
const { removeTrailingSlash } = require("../utils/path");
const { OG_DEFAULT_PNG_BUFFER } = require("../og/png");

function registerOgDefaultRoute(app) {
  app.get("/og-default.png", async (req, res) => {
    try {
      if (fs.existsSync(OG_DEFAULT_FILE)) {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("X-EDGE-HIT", "og-default-local");
        return res.sendFile(OG_DEFAULT_FILE);
      }

      const upstreamUrl = `${removeTrailingSlash(SHOP_UPSTREAM)}/og-default.png`;
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(upstreamUrl, { method: "GET", signal: controller.signal }).finally(() =>
          clearTimeout(t)
        );

        const ct = String(resp.headers.get("content-type") || "").toLowerCase();
        if (resp.ok && ct.includes("image/")) {
          const buf = Buffer.from(await resp.arrayBuffer());
          res.status(200);
          res.setHeader("Content-Type", ct || "image/png");
          res.setHeader("Cache-Control", "public, max-age=86400");
          res.setHeader("X-EDGE-HIT", "og-default-upstream");
          return res.send(buf);
        }
      } catch (_) {}

      res.status(200);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-EDGE-HIT", "og-default-generated");
      return res.send(OG_DEFAULT_PNG_BUFFER);
    } catch (e) {
      res.status(200);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-EDGE-HIT", "og-default-generated");
      return res.send(OG_DEFAULT_PNG_BUFFER);
    }
  });
}

module.exports = { registerOgDefaultRoute };
