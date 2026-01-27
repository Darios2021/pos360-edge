// src/routes/favicon.route.js
// ✅ COPY-PASTE FINAL COMPLETO
// Same-origin favicon endpoints para evitar cache pegajoso en /shop
//
// GET /favicon.ico            -> 302 a storage con ?v=...
// GET /apple-touch-icon.png   -> 302 a storage con ?v=...

const router = require("express").Router();
const {
  FAVICON_STORAGE_URL,
  APPLE_TOUCH_STORAGE_URL,
  BRAND_ASSET_VERSION,
} = require("../config");

function addVersionParam(url, key, version) {
  if (!url) return url;
  const s = String(url);
  if (!version) return s;

  // si ya trae v= no lo duplica
  const re = new RegExp(`[?&]${key}=`, "i");
  if (re.test(s)) return s;

  return s.includes("?")
    ? `${s}&${key}=${encodeURIComponent(version)}`
    : `${s}?${key}=${encodeURIComponent(version)}`;
}

// ✅ versión estable: si seteás BRAND_ASSET_VERSION gana.
// si no, rota 1 vez por día (reduce cache sin spamear)
function assetVersion() {
  if (BRAND_ASSET_VERSION) return BRAND_ASSET_VERSION;

  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

router.get("/favicon.ico", (req, res) => {
  const v = assetVersion();
  const target = addVersionParam(FAVICON_STORAGE_URL, "v", v);

  // cache corto en el browser para que no quede pegado
  res.setHeader("Cache-Control", "public, max-age=300"); // 5 min
  res.setHeader("X-EDGE-HIT", "favicon-redirect");
  return res.redirect(302, target);
});

router.get("/apple-touch-icon.png", (req, res) => {
  const v = assetVersion();
  const target = addVersionParam(APPLE_TOUCH_STORAGE_URL, "v", v);

  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("X-EDGE-HIT", "apple-touch-redirect");
  return res.redirect(302, target);
});

module.exports = router;
