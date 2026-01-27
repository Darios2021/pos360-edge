/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL (modular)
 */

const express = require("express");
const { PORT, applyCoreSettings } = require("./src/config");
const { registerMounts } = require("./src/routes/mounts");

const app = express();

applyCoreSettings(app);
registerMounts(app);

// ====== 404 edge ======
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

// ====== Start ======
app.listen(PORT, () => {
  const {
    SHOP_UPSTREAM,
    API_ORIGIN,
    API_BASE,
    PUBLIC_BASE_URL,
    FRONTEND_INDEX_PATH,
    APP_INDEX_PATH,
    FB_APP_ID,
    OG_BRANCH_ID,
    OG_TITLE_INCLUDE_PRICE,
    OG_DEFAULT_FILE,
  } = require("./src/config");

  console.log(`✅ pos360-edge listo en :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}`);
  console.log(`api -> ${API_ORIGIN}${API_BASE}`);
  console.log(`app -> ${SHOP_UPSTREAM} (transparent /app -> /shop/app/)`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
  console.log(`APP_INDEX_PATH -> ${APP_INDEX_PATH}`);
  console.log(`FB_APP_ID -> ${FB_APP_ID ? "SET" : "NOT_SET"}`);
  console.log(`OG_BRANCH_ID -> ${OG_BRANCH_ID}`);
  console.log(`OG_TITLE_INCLUDE_PRICE -> ${OG_TITLE_INCLUDE_PRICE ? "1" : "0"}`);
  console.log(`OG_DEFAULT_FILE -> ${OG_DEFAULT_FILE}`);
});
