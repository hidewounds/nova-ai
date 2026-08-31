"use strict";
// Embed NOVA widget + tracker before </body> on all public pages.
const fs = require("fs");
const path = require("path");

const KEY = "nova_pk_40d32c478e27559616acfd7827347d437b1c207d3d9f1e1c0375759d81bbb6da";
const API = "http://localhost:3000";

const SNIPPET = `
<!-- NOVA assistant (all skills: support · sales · shopping · advisor · booking · leads) -->
<script src="${API}/widget/nova-tracker.js" data-public-key="${KEY}" data-api="${API}" defer></script>
<script src="${API}/widget/nova-widget.js" data-public-key="${KEY}" data-api="${API}" defer></script>`;

const dir = "D:/nova web";
for (const file of ["index.html", "pricing.html", "roles.html", "features.html"]) {
    const full = path.join(dir, file);
    let html = fs.readFileSync(full, "utf8");
    if (html.includes("nova-widget.js")) { console.log(file, "-> already embedded"); continue; }
    if (!html.includes("</body>")) { console.log(file, "-> no </body>, skipped"); continue; }
    html = html.replace(/<\/body>/i, SNIPPET + "\n</body>");
    fs.writeFileSync(full, html, "utf8");
    console.log(file, "-> embedded");
}
