// ============================================================
// NOVA WIDGET — embeddable chat widget (chrono + echo aware)
//
// Usage:
//   <script src="https://your-nova-host/widget/nova-widget.js"
//           data-public-key="nova_pk_xxx"
//           data-api="https://your-nova-host"
//           defer></script>
// ============================================================

(function () {
    "use strict";

    var currentScript =
        document.currentScript ||
        (function () {
            var scripts = document.getElementsByTagName("script");
            return scripts[scripts.length - 1];
        })();

    if (!currentScript) {
        console.error("NOVA Widget: unable to locate script element.");
        return;
    }

    var publicKey = currentScript.getAttribute("data-public-key") || "";
    var apiBase = (currentScript.getAttribute("data-api") || "").replace(/\/+$/, "");

    if (!apiBase) {
        try {
            apiBase = new URL(currentScript.src, window.location.href).origin;
        } catch (e) {
            apiBase = "";
        }
    }

    if (!publicKey) {
        console.error('NOVA Widget: data-public-key is required. Example: <script data-public-key="nova_pk_...">');
        return;
    }

    // -------------------------------------------------------
    // load guide overlay (pointer) — nova-guide.js
    // -------------------------------------------------------
    (function loadGuide(){
        try {
            var g = document.createElement("script");
            g.src = apiBase + "/widget/nova-guide.js";
            g.async = true;
            g.onerror = function(){};
            document.head.appendChild(g);
        } catch {}
    })();

    // -------------------------------------------------------
    // visitor identity
    // -------------------------------------------------------

    function getVisitorId() {
        try {
            var id = localStorage.getItem("nova_visitor_id");
            if (id) return id;
            id = "visitor_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
            localStorage.setItem("nova_visitor_id", id);
            return id;
        } catch (e) {
            return "anonymous";
        }
    }

    // -------------------------------------------------------
    // styles
    // -------------------------------------------------------

    var style = document.createElement("style");
    style.textContent = [
        "#nova-widget-button{position:fixed;right:24px;bottom:24px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:#111;color:#fff;font-size:22px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.25);z-index:2147483000}",
        "#nova-widget{position:fixed;right:24px;bottom:92px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 130px);display:none;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
        "#nova-widget.open{display:flex}",
        "#nova-widget-header{padding:14px 18px;background:#111;color:#fff;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center}",
        "#nova-widget-header button{background:rgba(255,255,255,.12);border:none;color:#fff;border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer}",
        "#nova-widget-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f7f7f8}",
        ".nova-msg{max-width:82%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}",
        ".nova-msg.user{align-self:flex-end;background:#111;color:#fff;border-bottom-right-radius:4px}",
        ".nova-msg.assistant{align-self:flex-start;background:#fff;color:#16181d;border:1px solid #e5e7eb;border-bottom-left-radius:4px}",
        ".nova-msg.nova-loading{opacity:.55;font-size:13px;background:transparent;border:none;padding:2px 6px}",
        "#nova-widget-input-area{display:flex;gap:6px;padding:10px;border-top:1px solid #e5e7eb;background:#fff;align-items:flex-end}",
        "#nova-widget-input{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:8px 10px;font-size:14px;font-family:inherit;outline:none;max-height:120px}",
        "#nova-widget-send{width:40px;height:36px;border:none;border-radius:10px;background:#111;color:#fff;font-size:16px;cursor:pointer}",
        "#nova-widget-send:disabled{opacity:.5;cursor:default}",
        "#nova-mic{width:36px;height:36px;border:none;border-radius:10px;background:#f3f4f6;color:#111;font-size:15px;cursor:pointer;display:none}",
        "#nova-mic.on{background:#ef4444;color:#fff;animation:pulse 1.2s infinite}",
        "@keyframes pulse{0%{opacity:1}50%{opacity:.6}100%{opacity:1}}",
        "#nova-avail-toggle{width:36px;height:36px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;font-size:14px;cursor:pointer}",
        "#nova-avail-panel{display:none;max-height:160px;overflow-y:auto;border-top:1px solid #e5e7eb;background:#fff;padding:8px;font-size:12.5px}",
        "#nova-avail-panel.open{display:block}",
        ".nova-slot{display:inline-block;margin:3px 4px;padding:4px 8px;border:1px solid #e5e7eb;border-radius:999px;cursor:pointer;font-size:12px;background:#fff;color:#111}",
        ".nova-slot:hover{background:#111;color:#fff;border-color:#111}",
        ".nova-msg strong{font-weight:700;color:#111}",
        ".nova-msg em{font-style:italic}",
        "@media(max-width:500px){#nova-widget{right:12px;left:12px;width:auto;bottom:84px;height:70vh}#nova-widget-button{right:16px;bottom:16px}}"
    ].join("\n");
    document.head.appendChild(style);

    // deeper UI improvisation — widget learns design system so it sits well with site, improves as site changes
    function applyWidgetTheme(theme, customerBase){
        if(!theme || typeof theme !== "object") return;
        try{
            if(theme.restricted) return;
            var primary = theme.primary || null;
            var secondary = theme.secondary || null;
            var bg = theme.background || null;
            var surface = theme.surface || null;
            var text = theme.text || null;
            var muted = theme.muted || null;
            var border = theme.border || null;
            var font = theme.fontFamily || null;
            var headingFont = theme.headingFont || null;
            var radius = theme.radius || null;
            var radiusLg = theme.radiusLg || null;
            var shadow = theme.shadow || null;
            var spacing = theme.spacing || null;
            var darkMode = theme.darkMode;
            var css = "";
            // primary — button, header, send
            if(primary && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(primary)){
                css += "\n#nova-widget-button{background:"+primary+"!important;color:#fff!important;border-color:transparent!important}";
                css += "\n#nova-widget-header{background:"+primary+"!important;color:#fff!important}";
                css += "\n#nova-widget-send{background:"+primary+"!important;color:#fff!important}";
                css += "\n.nova-msg.user{background:"+primary+"!important;color:#fff!important;border-color:"+primary+"!important}";
                try{ document.documentElement.style.setProperty("--nova-primary", primary); }catch{}
                if(button) button.style.background = primary;
                var header = widget ? widget.querySelector("#nova-widget-header") : null;
                if(header) header.style.background = primary;
            }
            if(secondary && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(secondary)){
                css += "\n#nova-mic.on{background:"+secondary+"!important}";
            }
            // dark/light — site dark (#050508) → widget dark, site light → widget light
            if(darkMode === true){
                css += "\n#nova-widget{background:#0f0f11!important;color:#f4f4f5!important;border-color:rgba(255,255,255,.08)!important}";
                css += "\n#nova-widget-messages{background:#0f0f11!important}";
                css += "\n.nova-msg.assistant{background:#1a1a1e!important;color:#f4f4f5!important;border-color:#27272a!important}";
                css += "\n#nova-widget-input-area{background:#0f0f11!important;border-color:#27272a!important}";
                css += "\n#nova-widget-input{background:#1a1a1e!important;color:#f4f4f5!important;border-color:#27272a!important}";
                css += "\n#nova-avail-panel{background:#1a1a1e!important;border-color:#27272a!important;color:#f4f4f5!important}";
                css += "\n.nova-slot{background:#27272a!important;color:#f4f4f5!important;border-color:#3f3f46!important}";
                css += "\n.nova-slot:hover{background:#f4f4f5!important;color:#0f0f11!important;border-color:#f4f4f5!important}";
                if(widget){ widget.style.background = "#0f0f11"; widget.style.color = "#f4f4f5"; }
            } else if(darkMode === false){
                css += "\n#nova-widget{background:#fff!important}";
                css += "\n#nova-avail-panel{background:#fff!important;border-color:#e5e7eb!important;color:#111!important}";
                css += "\n.nova-slot{background:#fff!important;color:#111!important;border-color:#e5e7eb!important}";
                css += "\n.nova-slot:hover{background:#111!important;color:#fff!important;border-color:#111!important}";
            }
            if(bg && bg.length>2 && bg !== "rgba(255,255,255,.015)"){
                // use site bg as subtle hint for widget header if not primary
                try{ if(widget) widget.style.background = bg; }catch{}
            }
            if(surface && surface.length>2){
                css += "\n.nova-msg.assistant{background:"+surface+"!important}";
            }
            if(text && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)){
                css += "\n#nova-widget{color:"+text+"!important}";
            }
            if(muted && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(muted)){
                css += "\n#nova-widget-messages .nova-msg.nova-loading{color:"+muted+"!important}";
            }
            if(border && border.length>2){
                css += "\n#nova-widget{border-color:"+border+"!important}";
                css += "\n#nova-widget-header{border-color:"+border+"!important}";
            }
            // fonts — site uses Instrument Sans / Space Grotesk / JetBrains Mono
            if(font && font.length>2){
                var f = font + ", -apple-system, BlinkMacSystemFont, sans-serif";
                if(widget) widget.style.fontFamily = f;
                if(button) button.style.fontFamily = font + ", sans-serif";
                css += "\n#nova-widget{font-family:"+f+"!important}";
            }
            if(headingFont && headingFont.length>2){
                css += "\n#nova-widget-header{font-family:"+headingFont+", sans-serif!important}";
            }
            // radius — site --r-lg 22px etc. → widget radius
            var r = radiusLg || radius;
            if(r && /^\d+(px|rem|%|)$/.test(r)){
                var rv = r.match(/^\d+$/) ? r+"px" : r;
                css += "\n#nova-widget{border-radius:"+rv+"!important}";
                css += "\n#nova-widget-header{border-radius:"+rv+" "+rv+" 0 0!important}";
                if(widget) widget.style.borderRadius = rv;
            }
            // shadow — site --shadow-soft
            if(shadow && shadow.length>5){
                css += "\n#nova-widget{box-shadow:"+shadow+"!important}";
            }
            // spacing — site gap
            if(spacing && /^\d+(px|rem)$/.test(spacing)){
                css += "\n#nova-widget-messages{gap:"+spacing+"!important}";
            }
            if(css) {
                var s = document.createElement("style");
                s.id = "nova-widget-theme";
                s.textContent = css;
                // remove old theme style if exists
                var old = document.getElementById("nova-widget-theme");
                if(old) old.remove();
                document.head.appendChild(s);
            }
            // customer base — adapt tone, keep simple human
            if(customerBase){
                var title = widget ? widget.querySelector("#nova-widget-title") : null;
                if(customerBase.indexOf("fashion")!==-1 && title && title.textContent === "AI Assistant") title.textContent = "Style Assistant";
                if(customerBase.indexOf("business")!==-1 && title) title.textContent = "Business Assistant";
                // also adapt welcome message tone if needed — keep short
            }
            try{ localStorage.setItem("nova_widget_theme", JSON.stringify({primary:primary, secondary:secondary, bg:bg, surface:surface, font:font, headingFont:headingFont, radius:r, shadow:shadow, customerBase:customerBase, darkMode:darkMode, at:Date.now()})); }catch{}
        }catch(e){}
    }
    // expose for manual refresh
    window.NOVA_APPLY_THEME = applyWidgetTheme;

    // -------------------------------------------------------
    // elements
    // -------------------------------------------------------

    var button = document.createElement("button");
    button.id = "nova-widget-button";
    button.setAttribute("aria-label", "Open NOVA assistant");
    button.textContent = "N";

    var widget = document.createElement("div");
    widget.id = "nova-widget";
    widget.innerHTML =
        '<div id="nova-widget-header"><span id="nova-widget-title">AI Assistant</span></div>' +
        '<div id="nova-widget-messages"></div>' +
        '<div id="nova-avail-panel"></div>' +
        '<div id="nova-widget-input-area">' +
        '<textarea id="nova-widget-input" placeholder="Ask something..." rows="1"></textarea>' +
        '<button id="nova-mic" title="Hold to speak" aria-label="Voice input">🎙</button>' +
        '<button id="nova-avail-toggle" title="Availability" aria-label="Availability">📅</button>' +
        '<button id="nova-widget-send" aria-label="Send">&#8593;</button>' +
        "</div>";

    function mountWhenReady() {
        if (document.body) {
            document.body.appendChild(button);
            document.body.appendChild(widget);
        } else {
            document.addEventListener("DOMContentLoaded", function () {
                document.body.appendChild(button);
                document.body.appendChild(widget);
            });
        }
    }
    mountWhenReady();

    var messagesEl = null;
    var inputEl = null;
    var sendEl = null;
    var micEl = null;
    var availToggle = null;
    var availPanel = null;

    // will be assigned after DOM ready
    var voiceEnabled = false;
    var multilanguageEnabled = false;

    setTimeout(function () {
        messagesEl = widget.querySelector("#nova-widget-messages");
        inputEl = widget.querySelector("#nova-widget-input");
        sendEl = widget.querySelector("#nova-widget-send");
        micEl = widget.querySelector("#nova-mic");
        availToggle = widget.querySelector("#nova-avail-toggle");
        availPanel = widget.querySelector("#nova-avail-panel");

        sendEl.addEventListener("click", sendMessage);
        button.addEventListener("click", toggle);
        if (availToggle) availToggle.addEventListener("click", toggleAvailability);
        inputEl.addEventListener("keydown", function (event) {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });
        // echo mic handlers
        if (micEl) {
            micEl.addEventListener("click", toggleMic);
        }

        loadConfig();
    }, 0);

    // -------------------------------------------------------
    // state
    // -------------------------------------------------------

    var messages = [];
    var conversationId = null;
    var busy = false;
    var availOpen = false;
    var recording = false;
    var mediaRecorder = null;
    var audioChunks = [];
    var hasWelcomed = false;
    var configLoaded = false;

    // -------------------------------------------------------
    // API
    // -------------------------------------------------------

    var availCache = null;
    var availCacheAt = 0;
    async function api(path, options) {
        options = options || {};
        options.headers = Object.assign({ "Content-Type": "application/json", "x-nova-key": publicKey }, options.headers || {});
        // Short timeout for widget: 12s for chat, 8s for others — faster fallback than 120s server default
        var isChat = path.indexOf("/chat") !== -1;
        var timeoutMs = isChat ? 12000 : 8000;
        var controller = null;
        var timeoutId = null;
        try {
            if (typeof AbortController !== "undefined") {
                controller = new AbortController();
                options.signal = controller.signal;
                timeoutId = setTimeout(function () { try { controller.abort(); } catch {} }, timeoutMs);
            }
            var response = await fetch(apiBase + path, options);
            if (timeoutId) clearTimeout(timeoutId);
            var data = {};
            try {
                data = await response.json();
            } catch (e) {
                data = {};
            }
            if (!response.ok) {
                throw new Error((data && data.error && data.error.message) || "NOVA request failed.");
            }
            return data;
        } catch (e) {
            if (timeoutId) clearTimeout(timeoutId);
            if (e.name === "AbortError" || (e.message && e.message.indexOf("abort") !== -1)) {
                throw new Error(isChat ? "NOVA is thinking a bit long — please try again in a moment." : "Request timed out — please try again.");
            }
            throw e;
        }
    }

    async function loadConfig() {
        if (configLoaded && hasWelcomed) return;
        try {
            var data = await api("/api/v1/widget/config");
            if (data.config && data.config.assistantName) {
                var title = widget.querySelector("#nova-widget-title");
                if (title) title.textContent = data.config.assistantName;
            }
            if (data.config) {
                voiceEnabled = Boolean(data.config.voiceEnabled || data.config.addons?.voice_channel);
                multilanguageEnabled = Boolean(data.config.multilanguageEnabled || data.config.addons?.multilanguage);
                if ((voiceEnabled || multilanguageEnabled) && navigator.mediaDevices && window.MediaRecorder) {
                    if (micEl) micEl.style.display = "inline-block";
                }
                // auto guide ONLY on first login visit — not on every first visit, not on "guide me" chat
                try {
                    var login = null; try { login = localStorage.getItem("nova_web_login") || localStorage.getItem("nova_login") || sessionStorage.getItem("nova_web_login"); } catch {}
                    var seenKey = login ? "nova_guide_seen_" + login : "nova_guide_seen";
                    var seen = null; try { seen = localStorage.getItem(seenKey); } catch {}
                    // only auto-start if logged in and not seen for this login
                    if(login && !seen && window.NOVA_GUIDE){
                        setTimeout(function(){
                            api("/api/v1/widget/guide",{method:"GET"}).then(function(gd){
                                var steps = (gd && gd.guide && gd.guide.steps && gd.guide.steps.length) ? gd.guide.steps : [
                                    { id:"welcome", title:"Welcome — I'll guide you", selector:"body", description:"Hi, I'm NOVA. I'll show you around in 60 seconds.", position:"center" },
                                    { id:"explore", title:"Explore", selector:"nav, header", description:"Browse what's here — I'll explain as we go.", position:"bottom" },
                                    { id:"ask", title:"Ask me anything on NOVA", selector:"#nova-widget-button", description:"Tour done. Ask any question — I handle basics, bookings and voice.", position:"left" }
                                ];
                                if(window.NOVA_GUIDE && window.NOVA_GUIDE.start){
                                    window.NOVA_GUIDE.start(steps, { onStep: function(){}});
                                    try { localStorage.setItem(seenKey,"1"); localStorage.setItem("nova_guide_seen","1"); } catch {}
                                    addMessage("assistant", "👋 Welcome back — showing you around. Follow the highlight, then ask me anything.");
                                    messages.push({role:"assistant", content:"Showing tour — follow highlight"});
                                    hasWelcomed=true;
                                }
                            }).catch(function(){
                                if(window.NOVA_GUIDE){
                                    window.NOVA_GUIDE.start([
                                        { id:"welcome", title:"Welcome — I'll guide you", selector:"body", description:"Hi, I'm NOVA. I'll show you around in 60 seconds.", position:"center" },
                                        { id:"ask", title:"Ask me anything on NOVA", selector:"#nova-widget-button", description:"Tour done. Ask any question.", position:"left" }
                                    ]);
                                    try { localStorage.setItem(seenKey,"1"); } catch {}
                                }
                            });
                        }, 1200);
                    }
                } catch {}
                // theme-aware: widget learns design & customer base from site, improves as site changes (except restricted)
                try {
                    var themeData = data.config.theme;
                    var customerBase = data.config.customerBase;
                    // also try dedicated theme endpoint for fresher data (site may have changed since config)
                    api("/api/v1/widget/theme",{method:"GET"}).then(function(td){
                        if(td && td.theme) themeData = td.theme;
                        if(td && td.customerBase) customerBase = td.customerBase;
                        applyWidgetTheme(themeData, customerBase);
                    }).catch(function(){ if(themeData) applyWidgetTheme(themeData, customerBase); });
                    // fallback: apply immediately from config
                    if(themeData) applyWidgetTheme(themeData, customerBase);
                    // also adapt welcome tone to customer base
                    if(customerBase && customerBase.indexOf("fashion")!==-1 && data.config.welcomeMessage){
                        // keep welcome but note fashion tone — widget will be more style-aware
                    }
                } catch {}
                // poll for theme changes as site evolves (every 5 min, widget improves)
                try {
                    if(!window._novaThemeInterval){
                        window._novaThemeInterval = setInterval(function(){
                            api("/api/v1/widget/theme",{method:"GET"}).then(function(td){
                                if(td && td.theme) applyWidgetTheme(td.theme, td.customerBase);
                            }).catch(function(){});
                        }, 300000);
                    }
                } catch {}
            }
            configLoaded = true;
            if (data.config && data.config.welcomeMessage && !hasWelcomed) {
                var alreadyHasWelcome = false;
                if (messagesEl) {
                    for (var i = 0; i < messagesEl.children.length; i++) {
                        if (messagesEl.children[i].textContent === data.config.welcomeMessage) {
                            alreadyHasWelcome = true;
                            break;
                        }
                    }
                }
                if (!alreadyHasWelcome && messages.length === 0) {
                    addMessage("assistant", data.config.welcomeMessage);
                    messages.push({ role: "assistant", content: data.config.welcomeMessage });
                    hasWelcomed = true;
                } else if (alreadyHasWelcome) {
                    hasWelcomed = true;
                }
            }
        } catch (error) {
            console.warn("NOVA Widget:", error.message);
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function formatMessage(content) {
        // Escape then render **bold** as <strong>, *italic* as <em>, and preserve line breaks via pre-wrap
        var escaped = escapeHtml(content);
        // **bold** (non-greedy, allow spaces)
        escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        // *italic* (avoid matching **)
        escaped = escaped.replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, function (m, p1, p2, p3) { return p1 + "<em>" + p2 + "</em>" + p3; });
        return escaped;
    }
    function addMessage(role, content) {
        if (!messagesEl) return;
        var element = document.createElement("div");
        element.className = "nova-msg " + role;
        // Render markdown bold/italic as HTML (already escaped), keep pre-wrap for line breaks
        element.innerHTML = formatMessage(content);
        messagesEl.appendChild(element);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return element;
    }

    function maybeGuideIntent(text){
        // guide overlay is NOT triggered by chat anymore — only auto on first login visit (see loadConfig)
        // keep helper for legacy but never auto-start guide here
        return false;
    }
    function maybeNavigateIntent(text){
        var t = String(text||"").toLowerCase();
        var m = t.match(/guide me to (?:the )?(\w+)/);
        if(m){
            var target = (m[1]||"").toLowerCase();
            var map = { features:"features.html", pricing:"pricing.html", home:"index.html", checkout:"checkout.html", login:"login.html", featureshtml:"features.html" };
            if(map[target]) return map[target];
            // also handle "features section" -> features.html
            if(target==="features" || target==="feature") return "features.html";
            if(target==="pricing" || target==="price") return "pricing.html";
            return null;
        }
        // also handle direct "open features" etc.
        if(/open (features|pricing|home)/.test(t)){
            var mm = t.match(/open (features|pricing|home)/);
            var tgt = mm?mm[1]:"";
            if(tgt==="features") return "features.html";
            if(tgt==="pricing") return "pricing.html";
            if(tgt==="home") return "index.html";
        }
        return null;
    }
    function genericGuideSteps(){
        return [
            { id:"welcome", title:"Welcome — I'll guide you", selector:"body", description:"Hi, I'm NOVA. I'll show you around in 60 seconds.", position:"center" },
            { id:"explore", title:"Explore", selector:"nav, header", description:"Browse what's here — I'll explain as we go.", position:"bottom" },
            { id:"talk", title:"Ask me anything on NOVA", selector:"#nova-widget-button", description:"Guide done. Ask any question — I still handle basics like support, sales, bookings.", position:"left" }
        ];
    }
    async function sendMessage() {
        var text = (inputEl.value || "").trim();
        if (!text || busy) return;

        // navigation intent: "guide me to features" -> open that section, not guide overlay
        var navTarget = maybeNavigateIntent(text);
        if(navTarget){
            inputEl.value = "";
            addMessage("user", text);
            messages.push({ role: "user", content: text });
            addMessage("assistant", "Opening "+navTarget.replace(".html","")+" for you — taking you there.");
            messages.push({ role: "assistant", content: "Opening "+navTarget });
            setTimeout(function(){
                try{
                    // if same page section, scroll; else navigate
                    if(navTarget.indexOf("features")!==-1){
                        // if on index, scroll to bento, else go to features.html
                        var bento = document.querySelector(".bento");
                        if(bento && window.location.pathname.indexOf("features")===-1 && window.location.pathname.indexOf("index")!==-1){
                            bento.scrollIntoView({behavior:"smooth", block:"start"});
                        } else {
                            window.location.href = navTarget;
                        }
                    } else {
                        window.location.href = navTarget;
                    }
                } catch(e){ window.location.href = navTarget; }
            }, 600);
            return;
        }

        inputEl.value = "";
        addMessage("user", text);
        messages.push({ role: "user", content: text });
        busy = true;
        sendEl.disabled = true;

        var loading = addMessage("assistant", "...");
        loading.className = "nova-msg nova-loading";

        try {
            var data = await api("/api/v1/widget/chat", {
                method: "POST",
                body: JSON.stringify({
                    customerId: getVisitorId(),
                    conversationId: conversationId,
                    messages: messages.slice(-30)
                })
            });

            loading.remove();
            conversationId = data.conversationId || conversationId;

            var reply = data.reply || "Sorry, I could not generate a response.";
            // handle server-side navigation intent [NAVIGATE:features.html]
            var navMatch = reply.match(/\[NAVIGATE:([^\]]+)\]/);
            if(navMatch){
                var target = navMatch[1].trim();
                reply = reply.replace(/\[NAVIGATE:[^\]]+\]/g, "").trim();
                if(!reply) reply = "Opening "+target.replace(".html","")+" for you — taking you there.";
            }
            addMessage("assistant", reply);
            messages.push({ role: "assistant", content: reply });
            if(navMatch){
                try{
                    setTimeout(function(){
                        var tgt = navMatch[1].trim();
                        if(tgt.indexOf("features")!==-1){
                            var bento = document.querySelector(".bento");
                            if(bento && window.location.pathname.indexOf("features")===-1){
                                bento.scrollIntoView({behavior:"smooth", block:"start"});
                                return;
                            }
                        }
                        window.location.href = tgt;
                    }, 800);
                } catch{}
            }
        } catch (error) {
            loading.remove();
            addMessage("assistant", error.message || "Something went wrong.");
        } finally {
            busy = false;
            sendEl.disabled = false;
            inputEl.focus();
        }
    }

    function toggle() {
        widget.classList.toggle("open");
        if (widget.classList.contains("open")) {
            if (inputEl) inputEl.focus();
            if (!hasWelcomed) loadConfig();
        }
    }

    // ── chrono: ranked availability (cached 60s for speed) ──
    async function toggleAvailability() {
        availOpen = !availOpen;
        if (!availPanel) return;
        availPanel.classList.toggle("open", availOpen);
        if (availOpen) {
            // Use cache if fresh (60s) to avoid refetch on every toggle
            if (availCache && (Date.now() - availCacheAt) < 60000) {
                renderAvailability(availCache);
                return;
            }
            availPanel.textContent = "Loading availability…";
            try {
                var data = await api("/api/v1/widget/availability?days=14");
                availCache = data.availability;
                availCacheAt = Date.now();
                renderAvailability(availCache);
                return;
            } catch (e) {
                availPanel.textContent = e.message;
                return;
            }
        }
    }
    function renderAvailability(avail) {
        try {
            if (!avail || !avail.days || !avail.days.length) {
                availPanel.textContent = "No availability in the next 2 weeks.";
                return;
            }
            availPanel.innerHTML = avail.days.map(function (day) {
                if (!day.openSlots.length) return '<div style="padding:4px 0;color:#9ca3af">' + day.date + ' — closed</div>';
                var slots = day.openSlots.slice(0, 6).map(function (t) {
                    return '<span class="nova-slot" data-iso="' + day.date + "T" + t + ':00Z">' + t + "</span>";
                }).join("");
                return '<div style="padding:4px 0"><b>' + day.date + "</b> " + slots + "</div>";
            }).join("");
            availPanel.querySelectorAll(".nova-slot").forEach(function (el) {
                el.addEventListener("click", function () {
                    var iso = el.getAttribute("data-iso");
                    inputEl.value = "I'd like to book for " + iso.replace("T", " ").replace("Z", " UTC");
                    availPanel.classList.remove("open");
                    availOpen = false;
                    inputEl.focus();
                });
            });
        } catch (e) {
            availPanel.textContent = e.message;
        }
    }

    // ── echo: voice input ──
    async function toggleMic() {
        if (recording) { stopMic(); return; }
        startMic();
    }

    async function startMic() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            // Fallback to browser SpeechRecognition if available
            if (window.SpeechRecognition || window.webkitSpeechRecognition) {
                try {
                    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                    var rec = new SR();
                    rec.lang = multilanguageEnabled ? "" : "en-US";
                    rec.interimResults = false;
                    rec.maxAlternatives = 1;
                    var srLoading = addMessage("assistant", "Listening…");
                    if (srLoading) srLoading.className = "nova-msg nova-loading";
                    rec.onresult = async function (ev) {
                        if (srLoading) srLoading.remove();
                        var transcript = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : "";
                        if (!transcript) { addMessage("assistant", "Didn't catch that — please try again or type."); return; }
                        addMessage("user", transcript);
                        messages.push({ role: "user", content: transcript });
                        busy = true;
                        if (sendEl) sendEl.disabled = true;
                        var cl = addMessage("assistant", "...");
                        if (cl) cl.className = "nova-msg nova-loading";
                        try {
                            var cd = await api("/api/v1/widget/chat", {method:"POST", body:JSON.stringify({customerId:getVisitorId(), conversationId:conversationId, messages:messages.slice(-30)})});
                            if (cl) cl.remove();
                            conversationId = cd.conversationId || conversationId;
                            var reply2=cd.reply||"";
                            addMessage("assistant", reply2);
                            messages.push({role:"assistant", content: reply2});
                            try{ var tts2=await api("/api/v1/tts/synthesize",{method:"POST", body:JSON.stringify({text:reply2, language: multilanguageEnabled?"auto":"en"})}).catch(function(){return null}); if(tts2&&tts2.audioBase64){ var a2=new Audio("data:audio/mp3;base64,"+tts2.audioBase64); a2.play().catch(function(){}); } }catch{}
                        } catch (e) { if (cl) cl.remove(); addMessage("assistant", e.message || "Chat failed."); }
                        finally { busy = false; if (sendEl) sendEl.disabled = false; if (inputEl) inputEl.focus(); }
                    };
                    rec.onerror = function () { if (srLoading) srLoading.remove(); addMessage("assistant", "Voice recognition failed — please type."); };
                    rec.onend = function () { if (srLoading && srLoading.parentNode) srLoading.remove(); };
                    rec.start();
                    return;
                } catch (e) {}
            }
            addMessage("assistant", "Voice input not supported in this browser.");
            return;
        }
        var stream = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            var mime = (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) ? "audio/webm;codecs=opus" : "audio/webm";
            mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
            mediaRecorder.ondataavailable = function (e) { if (e.data && e.data.size) audioChunks.push(e.data); };
            mediaRecorder.onstop = async function () {
                try {
                    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
                    var blob = new Blob(audioChunks, { type: mime });
                    if (!blob.size) { addMessage("assistant", "No audio captured. Please try again or type."); return; }
                    // Ensure FileReader exists (jsdom fallback)
                    if (typeof FileReader === "undefined") {
                        addMessage("assistant", "Voice captured (" + blob.size + " bytes) — transcribing via browser. Please type your message for now.");
                        return;
                    }
                    var reader = new FileReader();
                    reader.onerror = function () { addMessage("assistant", "Failed to read audio — please type."); };
                    reader.onload = async function () {
                        var base64 = "";
                        try { base64 = String(reader.result).split(",")[1] || ""; } catch (e) { addMessage("assistant", "Audio read failed — please type."); return; }
                        var loading = addMessage("assistant", "Transcribing…");
                        if (loading) loading.className = "nova-msg nova-loading";
                        busy = true; if (sendEl) sendEl.disabled = true;
                        try {
                            // let Echo auto-detect any of 100+ langs when multilanguage on, else default
                            var tLang = multilanguageEnabled ? "auto" : (voiceEnabled ? "auto" : "en");
                            var data = await api("/api/v1/widget/transcribe", {
                                method: "POST",
                                body: JSON.stringify({ audioBase64: base64, mimeType: mime, customerId: getVisitorId(), conversationId: conversationId, language: tLang })
                            });
                            if (loading) loading.remove();
                            var text = data.text || data.transcript || "";
                            var lang = data.language || tLang || "auto";
                            if (!text) {
                                text = data.message || "Heard you — please type your message while echo warms up.";
                                addMessage("assistant", text);
                                return;
                            }
                            // inject transcript as user message and send on their behalf — Nova AI + OpenAI see it as normal chat in detected language
                            addMessage("user", text + (lang && lang!=="en" ? " ["+lang+"]" : ""));
                            messages.push({ role: "user", content: text });
                            var chatLoading = addMessage("assistant", "...");
                            if (chatLoading) chatLoading.className = "nova-msg nova-loading";
                            var chatData = await api("/api/v1/widget/chat", {
                                method: "POST",
                                body: JSON.stringify({ customerId: getVisitorId(), conversationId: conversationId, messages: messages.slice(-30) })
                            });
                            if (chatLoading) chatLoading.remove();
                            conversationId = chatData.conversationId || conversationId;
                            var reply = chatData.reply || "";
                            addMessage("assistant", reply);
                            messages.push({ role: "assistant", content: reply });
                            // speak reply via TTS in same language — Echo 24/7 (piper/openai)
                            try{
                                var ttsLang = lang && lang!=="auto" ? lang : (multilanguageEnabled ? (data.language||"auto") : "en");
                                var ttsRes = await api("/api/v1/tts/synthesize",{method:"POST", body:JSON.stringify({text:reply, language:ttsLang})}).catch(function(){return null});
                                if(ttsRes && ttsRes.audioBase64){
                                    var audio = new Audio("data:audio/mp3;base64,"+ttsRes.audioBase64);
                                    audio.play().catch(function(){});
                                }
                            }catch{}
                        } catch (e) {
                            if (loading) loading.remove();
                            addMessage("assistant", e.message || "Transcription failed. Please type your message.");
                        } finally {
                            busy = false; if (sendEl) sendEl.disabled = false; if (inputEl) inputEl.focus();
                        }
                    };
                    reader.readAsDataURL(blob);
                } catch (e) {
                    addMessage("assistant", "Voice processing failed — please type your message.");
                } finally {
                    // ensure mic resets even if FileReader setup fails
                    recording = false;
                    if (micEl) { micEl.classList.remove("on"); micEl.textContent = "🎙"; }
                    // busy will be cleared in the inner finally after transcribe/chat
                    if (!busy) { busy = false; if (sendEl) sendEl.disabled = false; }
                }
            };
            mediaRecorder.start();
            recording = true;
            if (micEl) { micEl.classList.add("on"); micEl.textContent = "■"; }
        } catch (e) {
            addMessage("assistant", "Microphone permission denied. Please check browser permissions or type your message.");
            recording = false;
            if (micEl) { micEl.classList.remove("on"); micEl.textContent = "🎙"; }
            busy = false; if (sendEl) sendEl.disabled = false;
        }
    }

    function stopMic() {
        if (mediaRecorder && recording) {
            try { mediaRecorder.stop(); } catch {}
        }
        recording = false;
        if (micEl) { micEl.classList.remove("on"); micEl.textContent = "🎙"; }
    }

    function toggleLegacy() { toggle(); }

    // --- proactive engagement (growth suite) ---------------------------------
    var proactiveFired = false;
    function maybeProactive() {
        if (proactiveFired || widget.classList.contains("open")) return;
        try {
            var intent = window.NOVATracker && typeof window.NOVATracker.lastIntent === "function" ? window.NOVATracker.lastIntent() : null;
            if (!intent) return;
            proactiveFired = true;
            // suppress the generic welcome when proactive opens — show only the intent
            if (!hasWelcomed) hasWelcomed = true;
            toggle();
            // ensure config is loaded for title/voice, but don't add welcome again
            loadConfig().then(function () {
                // avoid duplicate intent if already shown
                var alreadyShown = messages.some(function (m) { return m.content === intent.message; });
                if (!alreadyShown) {
                    addMessage("assistant", intent.message);
                    messages.push({ role: "assistant", content: intent.message });
                }
            });
        } catch (e) { /* never break the host page */ }
    }

    setTimeout(function () {
        document.addEventListener("mouseout", function (event) {
            if (!event.relatedTarget && event.clientY <= 0) maybeProactive();
        }, { passive: true });

        var idleTimer = null;
        function resetIdle() {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(maybeProactive, 45000);
        }
        ["mousemove", "keydown", "scroll", "touchstart"].forEach(function (evt) {
            document.addEventListener(evt, resetIdle, { passive: true });
        });
        resetIdle();
        document.addEventListener("nova:intent", maybeProactive);
    }, 4000);

    window.NOVA_WIDGET = Object.assign(window.NOVA_WIDGET || {}, {
        open: toggle,
        proactive: maybeProactive,
        toggleAvailability: toggleAvailability,
        captureEmail: function (email, name) {
            try {
                return api("/api/v1/customers/" + encodeURIComponent(getVisitorId()), {
                    method: "PATCH",
                    body: JSON.stringify({ email: email, name: name }),
                }).then(function () { return true; }).catch(function () { return false; });
            } catch (e) { return Promise.resolve(false); }
        },
        requestHandoff: function (reason) {
            return api("/api/v1/widget/call/handoff", {
                method: "POST",
                body: JSON.stringify({ customerId: getVisitorId(), reason: reason || "Customer requested human" })
            });
        }
    });
})();
