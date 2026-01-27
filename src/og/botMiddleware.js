/**
 * src/og/botMiddleware.js
 */

const { SHOP_UPSTREAM, FRONTEND_INDEX_PATH, OG_BRANCH_ID } = require("../config");
const { joinPrefix } = require("../utils/path");
const { isBot, wantsHtml, replaceTokens, matchProductId } = require("./html");
const { fetchProductOg } = require("./productOg");

async function fetchUpstreamHtml(pathname) {
  const url = `${String(SHOP_UPSTREAM).replace(/\/+$/, "")}${pathname}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);

  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/html,*/*;q=0.8" },
    signal: controller.signal,
  }).finally(() => clearTimeout(t));

  const ct = String(resp.headers.get("content-type") || "");
  const text = await resp.text();

  return { status: resp.status, contentType: ct, body: text };
}

// Middleware que solo aplica a BOTS para /shop/*
async function botOgMiddleware(req, res, next) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isBot(req)) return next();
    if (!wantsHtml(req)) return next();

    if (
      req.originalUrl.startsWith("/shop/assets/") ||
      req.originalUrl.startsWith("/assets/") ||
      req.originalUrl.startsWith("/api/") ||
      req.originalUrl.startsWith("/public/") ||
      req.originalUrl.startsWith("/app/") ||
      req.originalUrl === "/og-default.png"
    ) {
      return next();
    }

    // Pedimos HTML al upstream usando prefijo /shop
    const upstreamPath = joinPrefix(FRONTEND_INDEX_PATH, req.path);
    const { status, contentType, body } = await fetchUpstreamHtml(upstreamPath);

    if (!String(contentType).toLowerCase().includes("text/html")) {
      res.status(status).send(body);
      return;
    }

    const pid = matchProductId(req.originalUrl);
    const branchId = (req.query && req.query.branch_id ? String(req.query.branch_id) : "") || OG_BRANCH_ID;

    const og = pid ? await fetchProductOg(pid, branchId) : null;
    const patched = replaceTokens(body, req, og);

    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-EDGE-HIT", og ? "bot-og-product" : "bot-og-default");
    res.send(patched);
  } catch (e) {
    console.error("❌ botOgMiddleware error:", e && e.message ? e.message : e);
    next();
  }
}

module.exports = { botOgMiddleware };
