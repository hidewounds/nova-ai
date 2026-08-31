"use strict";
/**
 * Site Analyzer — human-like learn then operate.
 * When agent is linked to a website, it:
 * 1. Fetches the site (and linked pages) — understands structure, what is sold
 * 2. Extracts products, FAQs, policies, navigation — updates Knowledge & FAQs
 * 3. Generates guide_steps with selectors for pointer overlay
 * Uses only native fetch + regex (Vercel-safe, no cheerio).
 */

const knowledgeStore = require("../knowledge/store");
const db = require("../../db").get;

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "NOVA-Analyzer/1.0" } });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

function stripTags(s) { return String(s||"").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
  const m = html.match(re); if (m) return stripTags(m[1]);
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, "i");
  const m2 = html.match(re2); return m2 ? stripTags(m2[1]) : "";
}
function extractTitle(html) { const m = html.match(/<title[^>]*>([^<]+)<\/title>/i); return m ? stripTags(m[1]) : ""; }

function extractProducts(html) {
  const products = [];
  // heuristic: look for product-like blocks with price $/₹/€
  const priceRe = /(?:\$|₹|€)\s?\d+(?:[.,]\d+)?/g;
  // find headings near prices
  const blocks = html.split(/<div|<section|<article|<li/i).slice(0,120);
  for (const b of blocks) {
    const priceM = b.match(priceRe);
    if (!priceM) continue;
    // get heading/text before price
    const text = stripTags(b).slice(0, 400);
    if (text.length < 15 || text.length > 300) continue;
    // likely product if contains common commerce words or short title before price
    const title = text.split(priceM[0])[0].trim().split(/\s+/).slice(-8).join(" ").slice(0,80);
    if (title.length < 3) continue;
    products.push({ title: title || text.slice(0,60), price: priceM[0], snippet: text.slice(0,220) });
    if (products.length >= 12) break;
  }
  // dedupe by title
  const seen = new Set();
  return products.filter(p => { const k = p.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0,10);
}

function extractFaqs(html) {
  const faqs = [];
  // look for FAQ / accordion / details
  const faqSectionRe = /<(?:div|section)[^>]*class="[^"]*faq[^"]*"[^>]*>([\s\S]{0,3000})<\/(?:div|section)>/gi;
  let m;
  while ((m = faqSectionRe.exec(html)) && faqs.length < 8) {
    const sec = m[1];
    const qRe = /<[^>]*>([^<]{10,120}\?)<\/[^>]*>\s*<[^>]*>([^<]{20,400})<\/[^>]*>/g;
    let qm;
    while ((qm = qRe.exec(sec)) && faqs.length < 8) {
      faqs.push({ q: stripTags(qm[1]).slice(0,120), a: stripTags(qm[2]).slice(0,350) });
    }
  }
  // fallback: Q? A pattern via details/summary
  if (!faqs.length) {
    const detailRe = /<summary[^>]*>([^<]+)<\/summary>\s*([^<]{20,400})/gi;
    while ((m = detailRe.exec(html)) && faqs.length < 6) {
      faqs.push({ q: stripTags(m[1]).slice(0,120), a: stripTags(m[2]).slice(0,350) });
    }
  }
  return faqs;
}

function inferSiteType(html, url) {
  const t = (extractTitle(html) + " " + html.slice(0,5000)).toLowerCase();
  if (/shop|cart|product|price|checkout|buy now|add to cart/.test(t)) return "ecommerce";
  if (/book|appointment|schedule|calendar|slot/.test(t)) return "booking";
  if (/restaurant|menu|order|delivery/.test(t)) return "restaurant";
  if (/real estate|property|listing/.test(t)) return "realestate";
  return "general";
}

function buildGuideSteps({ siteUrl, siteType, html }) {
  const steps = [];
  const has = (sel) => {
    // cheap selector existence heuristic: check html contains class/id/tag
    const key = sel.replace(/[^\w-]/g, "").toLowerCase();
    return html.toLowerCase().includes(key) || html.includes(sel.replace(/^[a-z]+\./,""));
  };
  // Step 1: welcome
  steps.push({ id: "welcome", title: "Welcome — I'll guide you", selector: "body", description: "Hi, I'm NOVA. I'll show you around in 60 seconds.", position: "center" });
  if (siteType === "ecommerce") {
    // nav/products
    steps.push({ id: "products", title: "Browse what's sold", selector: has(".product") ? ".product" : (has("main") ? "main" : "body"), description: "These are the products we have live. Tap any to see details.", position: "bottom" });
    steps.push({ id: "product-detail", title: "See details & price", selector: has(".product-card") ? ".product-card" : ".product", description: "Price, specs and photos are verified from our catalog.", position: "top" });
    steps.push({ id: "cart", title: "Add to cart", selector: has("add to cart") ? "button:contains('Add to cart'), .add-to-cart, [data-add-to-cart]" : "button", description: "Click Add to cart — I'll remember your choice.", position: "top" });
    steps.push({ id: "checkout", title: "Checkout", selector: has("checkout") ? "a[href*='checkout'], a[href*='cart'], button:contains('Checkout')" : "a[href*='cart']", description: "Review cart and checkout securely.", position: "top" });
  } else if (siteType === "booking") {
    steps.push({ id: "availability", title: "Check availability", selector: has("calendar") ? ".calendar, [data-availability], #nova-avail-toggle" : "body", description: "See live slots — updates in <1s.", position: "bottom" });
    steps.push({ id: "book", title: "Book a slot", selector: has("book") ? "button:contains('Book'), .nova-slot" : "button", description: "Pick a time, confirm, and I'll book it with confirmation.", position: "top" });
  } else {
    steps.push({ id: "explore", title: "Explore", selector: has("nav") ? "nav" : "header", description: "Start here — I'll explain each section.", position: "bottom" });
    steps.push({ id: "cta", title: "Take action", selector: has("button") ? "button, a.btn, a[href*='contact']" : "body", description: "Ready to get started? Click the main action.", position: "top" });
  }
  steps.push({ id: "ask", title: "Ask me anything on NOVA", selector: "#nova-widget-button, #nova-widget", description: "Guide done. Ask me any question on NOVA — I now know your site and what's sold.", position: "left" });
  // normalize selectors for overlay (fallback to body if not found)
  return steps.map((s, i) => ({ ...s, order: i+1 }));
}

async function analyzeSite({ businessId, siteUrl }) {
  if (!businessId) throw new Error("businessId required");
  if (!siteUrl || !/^https?:\/\//i.test(siteUrl)) throw new Error("Valid siteUrl (https://) required");
  const html = await fetchWithTimeout(siteUrl);
  const title = extractTitle(html);
  const description = extractMeta(html, "description") || stripTags(html).slice(0, 300);
  const siteType = inferSiteType(html, siteUrl);
  const products = extractProducts(html);
  const faqs = extractFaqs(html);

  // 1. Update knowledge — learn what's sold (human-like)
  const created = [];
  const seenTitles = new Set(knowledgeStore.listKnowledge(businessId).items?.map(k=>k.title.toLowerCase()) || knowledgeStore.listKnowledge(businessId).map?.(k=>k.title.toLowerCase()) || []);
  // Add site overview knowledge
  const overviewTitle = `${title || new URL(siteUrl).hostname} — overview`;
  if (!seenTitles.has(overviewTitle.toLowerCase())) {
    try {
      const item = knowledgeStore.createKnowledgeItem({ businessId, title: overviewTitle, knowledgeType: "info", content: description.slice(0,900) || `Official site: ${siteUrl}. ${siteType} site analyzed by NOVA.` });
      created.push(item);
    } catch {}
  }
  // Add products as knowledge
  for (const p of products) {
    const t = p.title.slice(0,80);
    if (seenTitles.has(t.toLowerCase())) continue;
    try {
      const content = `${p.snippet} Price: ${p.price}. Available on ${siteUrl}.`;
      const item = knowledgeStore.createKnowledgeItem({ businessId, title: t, knowledgeType: "product", content: content.slice(0,900) });
      created.push(item);
      seenTitles.add(t.toLowerCase());
    } catch {}
  }
  // Add FAQs
  for (const f of faqs) {
    if (seenTitles.has(f.q.toLowerCase())) continue;
    try {
      const item = knowledgeStore.createKnowledgeItem({ businessId, title: f.q, knowledgeType: "faq", content: f.a.slice(0,900) });
      created.push(item);
      seenTitles.add(f.q.toLowerCase());
    } catch {}
  }

  // 2. Build guide steps
  const steps = buildGuideSteps({ siteUrl, siteType, html });

  // 3. Persist site analysis for widget (in business_configs or separate table via guide store)
  const guideStore = require("../guide/store");
  const guide = guideStore.saveGuide({ businessId, siteUrl, siteType, title, description, steps, products, faqs, knowledgeCreated: created.length });
  // 4. Remember linked site URL in config (human-like: agent remembers its website)
  try {
    const cfg = require("../config/service");
    cfg.updateConfig(businessId, { site: { url: siteUrl, lastAnalyzedAt: Date.now() } });
  } catch {}

  return {
    businessId,
    siteUrl,
    siteType,
    title,
    description: description.slice(0,300),
    products,
    faqs,
    steps,
    knowledgeCreated: created.length,
    guide,
  };
}

module.exports = { analyzeSite, extractProducts, extractFaqs, inferSiteType, buildGuideSteps };
