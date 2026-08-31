"use strict";
// Vercel serverless entry — wraps the existing Express createApp()
// Keeps dark glass admin/portal + all APIs on same deployment (platform.openai.com style)
const { createApp } = require("../server/app");

let app;
function getApp() {
  if (!app) app = createApp();
  return app;
}

module.exports = (req, res) => getApp()(req, res);
