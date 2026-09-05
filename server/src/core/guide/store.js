"use strict";
const getDb = () => require("../../db/connection").get();
const dbGet = require("../../db").get; // repository for prepare fallback
const crypto = require("../../lib/crypto");

function ensureTable() {
  const db = getDb();
  if (db && typeof db.exec === "function") {
    db.exec(`
      CREATE TABLE IF NOT EXISTS site_guides (
        guide_id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        site_url TEXT NOT NULL,
        site_type TEXT NOT NULL,
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        steps_json TEXT NOT NULL DEFAULT '[]',
        products_json TEXT NOT NULL DEFAULT '[]',
        faqs_json TEXT NOT NULL DEFAULT '[]',
        knowledge_created INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (business_id) REFERENCES businesses(business_id) ON DELETE CASCADE
      );
    `);
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_site_guides_biz ON site_guides(business_id, updated_at);"); } catch {}
    // theme-aware: add theme_json and customer_base for widget adaptation (upgrade existing)
    try { db.exec("ALTER TABLE site_guides ADD COLUMN theme_json TEXT DEFAULT '{}'"); } catch {}
    try { db.exec("ALTER TABLE site_guides ADD COLUMN customer_base TEXT DEFAULT ''"); } catch {}
  } else {
    // fallback via repository prepare
    try { dbGet().prepare("CREATE TABLE IF NOT EXISTS site_guides (guide_id TEXT PRIMARY KEY, business_id TEXT NOT NULL, site_url TEXT NOT NULL, site_type TEXT NOT NULL, title TEXT DEFAULT '', description TEXT DEFAULT '', steps_json TEXT NOT NULL DEFAULT '[]', products_json TEXT NOT NULL DEFAULT '[]', faqs_json TEXT NOT NULL DEFAULT '[]', knowledge_created INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)").run(); } catch {}
    try { dbGet().prepare("ALTER TABLE site_guides ADD COLUMN theme_json TEXT DEFAULT '{}'").run(); } catch {}
    try { dbGet().prepare("ALTER TABLE site_guides ADD COLUMN customer_base TEXT DEFAULT ''").run(); } catch {}
  }
}

function saveGuide({ businessId, siteUrl, siteType, title, description, steps, products, faqs, knowledgeCreated, theme, customerBase }) {
  ensureTable();
  const now = Date.now();
  const db = getDb();
  const existing = db.prepare("SELECT guide_id FROM site_guides WHERE business_id = ? ORDER BY updated_at DESC LIMIT 1").get(businessId);
  const themeJson = JSON.stringify(theme || {});
  if (existing) {
    db.prepare("UPDATE site_guides SET site_url=?, site_type=?, title=?, description=?, steps_json=?, products_json=?, faqs_json=?, knowledge_created=?, updated_at=?, theme_json=?, customer_base=? WHERE guide_id=?")
      .run(siteUrl, siteType, title||"", description||"", JSON.stringify(steps||[]), JSON.stringify(products||[]), JSON.stringify(faqs||[]), knowledgeCreated||0, now, themeJson, customerBase||"", existing.guide_id);
    return getGuide(businessId);
  }
  const guideId = crypto.randomId("guide", 10);
  db.prepare("INSERT INTO site_guides (guide_id, business_id, site_url, site_type, title, description, steps_json, products_json, faqs_json, knowledge_created, created_at, updated_at, theme_json, customer_base) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(guideId, businessId, siteUrl, siteType, title||"", description||"", JSON.stringify(steps||[]), JSON.stringify(products||[]), JSON.stringify(faqs||[]), knowledgeCreated||0, now, now, themeJson, customerBase||"");
  return getGuide(businessId);
}

function getGuide(businessId) {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT * FROM site_guides WHERE business_id = ? ORDER BY updated_at DESC LIMIT 1").get(businessId);
  if (!row) return null;
  let theme = {};
  try { theme = JSON.parse(row.theme_json || "{}"); } catch { theme = {}; }
  return {
    guideId: row.guide_id,
    businessId: row.business_id,
    siteUrl: row.site_url,
    siteType: row.site_type,
    title: row.title,
    description: row.description,
    steps: JSON.parse(row.steps_json || "[]"),
    products: JSON.parse(row.products_json || "[]"),
    faqs: JSON.parse(row.faqs_json || "[]"),
    knowledgeCreated: row.knowledge_created,
    updatedAt: row.updated_at,
    theme,
    customerBase: row.customer_base || "",
  };
}

module.exports = { saveGuide, getGuide };
