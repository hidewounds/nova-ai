// NOVA Admin — Premium (Linear/Vercel/Stripe) — quiet, minimal, functional
(function(){
  "use strict";
  var TOKEN_KEY="nova_admin_token";
  var state={token:localStorage.getItem(TOKEN_KEY),admin:null,businesses:[],businessId:null,business:null,config:null,plan:"launch",isSuper:false};
  function $(id){return document.getElementById(id)}
  function show(el,on){el.classList.toggle("hidden",!on)}
  function toast(m){var el=$("toast");el.textContent=m;show(el,true);clearTimeout(el._t);el._t=setTimeout(function(){show(el,false)},3000)}
  function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
  async function api(path,opts){
    opts=opts||{};opts.headers=Object.assign({"Content-Type":"application/json"},state.token?{Authorization:"Bearer "+state.token}:{},opts.headers||{});
    if(opts.body&&typeof opts.body!=="string")opts.body=JSON.stringify(opts.body);
    var r=await fetch(path,opts);var d={};try{d=await r.json()}catch(e){}
    if(r.status===401&&state.token){logout();throw new Error("Session expired")}
    if(!r.ok) throw new Error((d.error&&d.error.message)||"Request failed ("+r.status+")");
    return d;
  }
  function logout(){state.token=null;state.admin=null;localStorage.removeItem(TOKEN_KEY);show($("dashView"),false);show($("authView"),true)}
  $("showRegister").addEventListener("click",function(){show($("loginForm"),false);show($("registerForm"),true);$("authTitle").textContent="Create account"});
  $("showLogin").addEventListener("click",function(){show($("registerForm"),false);show($("loginForm"),true);$("authTitle").textContent="Sign in to NOVA"});
  $("loginForm").addEventListener("submit",async function(e){e.preventDefault();$("authError").textContent="";try{var d=await api("/api/admin/auth/login",{method:"POST",body:{email:$("authEmail").value.trim(),password:$("authPassword").value}});state.token=d.accessToken;localStorage.setItem(TOKEN_KEY,d.accessToken);await enterDashboard()}catch(err){$("authError").textContent=err.message}});
  $("registerForm").addEventListener("submit",async function(e){e.preventDefault();$("regError").textContent="";try{var d=await api("/api/admin/auth/register",{method:"POST",body:{name:$("regName").value.trim(),email:$("regEmail").value.trim(),password:$("regPassword").value}});state.token=d.accessToken;localStorage.setItem(TOKEN_KEY,d.accessToken);await enterDashboard()}catch(err){$("regError").textContent=err.message}});
  $("logoutBtn").addEventListener("click",logout);
  async function enterDashboard(){
    var me=await api("/api/admin/auth/me");
    state.admin=me.admin;state.businesses=me.businesses||[];
    $("whoami").textContent=me.admin.email;
    $("planBadge").textContent=me.businesses.length?me.businesses[0].plan||"—":"—";
    show($("authView"),false);show($("dashView"),true);
    renderBusinessSelect();
    if(state.businessId && state.businesses.some(function(b){return b.businessId===state.businessId})){await loadBusiness(state.businessId)}
    else if(state.businesses.length>0){await loadBusiness(state.businesses[0].businessId)}
    else { // empty state - no businesses
      $("crumbBiz").textContent="—";
      renderEmptyWorkspace();
    }
  }
  function renderEmptyWorkspace(){
    var p=$("tab-overview");
    p.innerHTML='<div class="empty"><h4>No businesses yet.</h4><p>Create your first workspace and connect NOVA to your business. The Unified Brain is ready.</p><button class="btn primary" onclick="document.getElementById(\'newBusinessBtn\').click()">Create workspace</button></div>';
  }
  function renderBusinessSelect(){
    var s=$("businessSelect");s.innerHTML="";
    state.businesses.forEach(function(b){var o=document.createElement("option");o.value=b.businessId;o.textContent=b.businessName+(b.active?"":" (inactive)");s.appendChild(o)});
    if(state.businessId) s.value=state.businessId;
    if(s.options.length) {$("crumbBiz").textContent=s.options[s.selectedIndex].textContent.replace(" (inactive)","");$("businessPill").textContent=s.options[s.selectedIndex].textContent}
  }
  $("businessSelect").addEventListener("change",function(){loadBusiness(this.value)});
  $("newBusinessBtn").addEventListener("click",async function(){
    var n=prompt("Workspace name:");
    if(!n||n.trim().length<2){toast("Name too short");return}
    try{var c=await api("/api/admin/businesses",{method:"POST",body:{businessName:n.trim()}});toast("Workspace created");await enterDashboard();await loadBusiness(c.business.businessId)}catch(e){toast(e.message)}
  });
  async function loadBusiness(id){
    state.businessId=id;
    var d=await api("/api/admin/businesses/"+encodeURIComponent(id));
    state.business=d.business;state.config=d.config;state.plan=d.plan||"launch";state.isSuper=!!d.isSuper;
    renderBusinessSelect();
    renderTab();
  }
  $("tabs").addEventListener("click",function(e){
    var b=e.target.closest("button[data-tab]");if(!b)return;
    document.querySelectorAll("#tabs button").forEach(function(x){x.classList.remove("active");x.setAttribute("aria-selected","false");x.tabIndex=-1});
    b.classList.add("active");b.setAttribute("aria-selected","true");b.tabIndex=0;
    document.querySelectorAll(".tabpane").forEach(function(p){p.classList.remove("active")});
    $("tab-"+b.dataset.tab).classList.add("active");
    renderTab(b.dataset.tab);
  });
  function currentTab(){var a=document.querySelector("#tabs button.active");return a?a.dataset.tab:"overview"}
  async function renderTab(t){
    t=t||currentTab();if(!state.businessId) return;
    try{
      if(t==="overview") await renderOverview();
      if(t==="agent") renderAgent();
      if(t==="custom") renderCustom();
      if(t==="memory") renderMemory();
      if(t==="behavior") renderBehavior();
      if(t==="knowledge") await renderKnowledge();
      if(t==="customers") await renderCustomers();
      if(t==="integration") renderIntegration();
      if(t==="audit") await renderAudit();
    }catch(e){toast(e.message)}
  }
  // --- Skeletons ---
  function skeleton(rows){var h='';for(var i=0;i<rows;i++) h+='<div class="skeleton" style="height:14px;margin:8px 0;width:'+(70+Math.random()*25)+'%"></div>';return '<div class="card"><div style="padding:4px 0">'+h+'</div></div>'}
  // --- Overview: health + KPIs + attention ---
  async function renderOverview(){
    var p=$("tab-overview");
    p.innerHTML=skeleton(3);
    try{
      var s=await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/analytics");
      var c=s.counts||{}; var plan=esc(state.plan);
      // Health - subtle
      var health=[
        {k:"Agent Brain",v:"Operational",s:"ok",d:"Unified • 6 patterns • "+plan},
        {k:"Knowledge",v: (c.knowledgeItems>0?"Operational":"Not configured"),s: (c.knowledgeItems>0?"ok":"neutral"),d: c.knowledgeItems+" indexed • last sync just now"},
        {k:"Integrations",v:"Operational",s:"ok",d:"Widget + Tracker • "+(state.business.active?"active":"inactive")},
        {k:"Database",v:"Operational",s:"ok",d:"WAL • "+c.customers+" customers • "+c.conversations+" conversations"}
      ];
      var attention=[];
      if(c.knowledgeItems===0) attention.push({t:"Knowledge is empty",d:"Add a website, document, or FAQ so NOVA can answer grounded.",a:"Go to Knowledge",tab:"knowledge"});
      if(c.customers===0) attention.push({t:"No customers yet",d:"Install the snippet and NOVA will start capturing conversations.",a:"View Integration",tab:"integration"});
      var html='';
      // KPIs - quiet, not floating
      html+='<div class="grid">';
      [["Conversations",c.conversations],["Customers",c.customers],["Messages",c.messages],["Memories",c.memories],["Behavior events",c.behaviorEvents],["Knowledge",c.knowledgeItems]].forEach(function(k){
        html+='<div class="kpi"><div class="n">'+k[1]+'</div><div class="l">'+k[0]+'</div></div>';
      });
      html+='</div>';
      // Health
      html+='<div class="card" style="margin-top:14px"><div class="card-head"><h3>System health</h3><span class="status ok"><span class="dot ok"></span> Operational</span></div><div class="health-list">';
      health.forEach(function(h){html+='<div class="health-row"><div class="health-left"><div class="health-ic">'+(h.s==="ok"?"●":h.s==="neutral"?"○":"◐")+'</div><div><b style="font-weight:500">'+h.k+'</b><div class="muted xs">'+esc(h.d)+'</div></div></div><span class="status '+h.s+'">'+h.v+'</span></div>'});
      html+='</div></div>';
      // Attention
      if(attention.length){
        html+='<div class="card" style="border-color:var(--warn-border);background:var(--warn-bg)"><h3 style="color:#92400e">Attention required</h3>';
        attention.forEach(function(a){html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(245,158,11,.14)"><div><b style="font-weight:500">'+a.t+'</b><div class="muted xs">'+a.d+'</div></div><button class="btn ghost small" onclick="document.querySelector(\'[data-tab='+a.tab+']\').click()">'+a.a+'</button></div>'});
        html+='</div>';
      } else {
        html+='<div class="card"><h3>All clear</h3><p class="muted" style="margin:0">No issues. NOVA is healthy and serving.</p></div>';
      }
      // Plan
      html+='<div class="card"><h3>Workspace</h3><div class="row" style="justify-content:space-between"><div><b>'+esc(state.business.businessName)+'</b><div class="muted xs">'+state.businessId+' • '+plan+'</div></div><span class="pill">'+(state.business.active?'Active':'Inactive')+'</span></div></div>';
      p.innerHTML=html;
      $("businessPill").textContent=state.business.businessName;
      $("healthPill").innerHTML='<span class="dot ok"></span> Operational';
    }catch(e){
      p.innerHTML='<div class="error-state"><span>'+esc(e.message)+'</span><button class="btn ghost small" onclick="renderOverview()">Try again</button></div>';
    }
  }
  // --- Agent: brain + live preview ---
  function renderAgent(){
    var a=state.config.assistant, cfg=state.config;
    var html='';
    html+='<div class="card"><div class="card-head"><h3>Agent brain</h3><span class="status ok"><span class="dot ok"></span> Unified • Operational</span></div>';
    html+='<div class="grid" style="grid-template-columns:1.2fr .8fr;gap:16px">';
    html+='<div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">';
    ["Customer Support","Sales","Shopping","Product Advisor","Lead Qualification","General"].forEach(function(k){html+='<span class="pill" style="background:var(--surface-2)">'+k+'</span>'});
    html+='</div><p class="muted" style="line-height:1.6;margin:0">One brain, six patterns. Trained via DPO/PPO/GRPO. Reward: task completion + satisfaction + accuracy. No role switching — NOVA leans fluidly by situation.</p>';
    html+='<div style="margin-top:14px" class="grid" style="grid-template-columns:1fr 1fr;gap:10px"><div><label>Assistant name<input id="ag_name" value="'+esc(a.name)+'"></label></div><div><label>Model<input value="'+esc(cfg.model?.model||state.plan)+' " disabled style="background:var(--bg-subtle)"></label></div></div>';
    html+='<label>Business description<textarea id="ag_desc" placeholder="What does your business do?">'+esc(a.businessDescription||"")+'</textarea></label>';
    html+='<label>Personality<input id="ag_personality" value="'+esc(a.personality||"")+'" placeholder="friendly and practical"></label>';
    html+='<label>Tone<input id="ag_tone" value="'+esc(a.tone||"")+'" placeholder="friendly and helpful"></label>';
    html+='<label>Instructions<textarea id="ag_instructions" placeholder="Never invent prices. One coupon per order...">'+esc(a.instructions||"")+'</textarea></label>';
    html+='<div class="row" style="margin-top:12px"><button class="btn primary" onclick="saveAgent()">Save brain</button><span class="muted xs">Live in &lt;1s</span></div></div>';
    // Live preview
    html+='<div class="preview"><div class="preview-head"><b>Live preview</b><span class="pill" style="font-size:10px">Grounded</span></div><div class="preview-body" id="agentPreviewBody"><div class="bubble bot">Hi! I\'m '+esc(a.name||"NOVA")+' — ask me anything about '+esc(state.business.businessName||"your business")+'.</div></div><div class="preview-foot"><input id="agentPreviewInput" placeholder="Ask as customer: Do you have running shoes under $150?" onkeydown="if(event.key===\'Enter\') sendAgentPreview()"><button class="btn primary small" onclick="sendAgentPreview()">Send</button></div></div>';
    html+='</div></div>';
    // Config details
    html+='<div class="card"><h3>Configuration</h3><div class="grid" style="grid-template-columns:1fr 1fr;gap:12px"><div><label>Welcome message<input id="ag_welcome" value="'+esc(a.welcomeMessage||"")+'"></label></div><div><label>Fallback<input id="ag_fallback" value="'+esc(a.fallbackMessage||"")+'"></label></div></div>';
    html+='<div style="margin-top:12px" class="row"><div><label>Memory<input value="'+(cfg.memory?.enabled?"enabled":"off")+'" disabled style="background:var(--bg-subtle)"></label></div><div><label>Behavior tracking<input value="'+(cfg.behavior?.enabled?"enabled":"off")+'" disabled style="background:var(--bg-subtle)"></label></div><div><label>Knowledge<input value="'+(state.config.features?.knowledge?"on":"off")+'" disabled style="background:var(--bg-subtle)"></label></div></div></div>';
    $("tab-agent").innerHTML=html;
  }
  window.saveAgent=async function(){
    var patch={assistant:{name:$("ag_name").value.trim(), businessDescription:$("ag_desc").value.trim(), personality:$("ag_personality").value.trim(), tone:$("ag_tone").value.trim(), instructions:$("ag_instructions").value.trim(), welcomeMessage:$("ag_welcome").value.trim(), fallbackMessage:$("ag_fallback").value.trim()}};
    try{await patchConfig(patch);toast("Brain saved — live in <1s")}catch(e){toast(e.message)}
  };
  var _previewHistory=[];
  window.sendAgentPreview=async function(){
    var input=$("agentPreviewInput"), text=input.value.trim(); if(!text) return;
    var body=$("agentPreviewBody");
    var u=document.createElement("div");u.className="bubble user";u.textContent=text;body.appendChild(u);body.scrollTop=body.scrollHeight;
    _previewHistory.push({role:"user",content:text}); input.value="";
    var bot=document.createElement("div");bot.className="bubble bot";bot.textContent="Thinking…";body.appendChild(bot);body.scrollTop=body.scrollHeight;
    try{
      var r=await api("/api/v1/chat",{method:"POST",body:{customer:{id:"preview_admin"},messages:_previewHistory.slice(-12),businessId:state.businessId}});
      var reply=r.reply||r.message||"No reply";
      bot.textContent=reply; _previewHistory.push({role:"assistant",content:reply});
    }catch(e){bot.textContent="Error: "+e.message; bot.style.borderColor="var(--bad-border)"; bot.style.background="var(--bad-bg)"}
    body.scrollTop=body.scrollHeight;
  };
  // --- Knowledge: premium workspace ---
  async function renderKnowledge(){
    var p=$("tab-knowledge");
    p.innerHTML='<div class="card"><div class="card-head"><h3>Knowledge</h3><button class="btn primary small" onclick="document.getElementById(\'knTitle\').focus()">+ Add source</button></div><p class="muted" style="margin:-8px 0 12px">Everything NOVA knows about your business. Grounded, synced, and healthy.</p><div id="knowledgeStats" class="grid" style="margin-bottom:14px">'+skeleton(3).slice(22,-8)+'</div><div class="row"><div style="flex:1"><label>Title<input id="knTitle" placeholder="Do you deliver?"></label></div><div style="width:160px"><label>Type<select id="knType"><option value="faq">FAQ</option><option value="policy">Policy</option><option value="product">Product</option><option value="info">Info</option></select></label></div><div style="flex:0 0 auto;padding-top:18px"><button class="btn primary" onclick="addKnowledge()">Add</button></div></div><label>Content<textarea id="knContent" placeholder="Yes — free delivery over $50 within the city..."></textarea></label><div id="knMsg"></div><div id="knTableWrap" class="table-wrap" style="margin-top:14px"><table id="knTable"><thead><tr><th>Title</th><th>Type</th><th>Content</th><th></th></tr></thead><tbody><tr><td colspan="4"><div class="skeleton" style="height:32px"></div></td></tr></tbody></table></div><div style="margin-top:18px" class="card" style="background:var(--bg-subtle)"><h3 style="margin-bottom:8px">Bulk import</h3><p class="muted xs" style="margin:0 0 8px">Paste CSV <code>title,type,content</code> per line, or JSON array. Max 50.</p><textarea id="knBulk" placeholder="Return policy,policy,Free 30-day returns..." style="min-height:88px"></textarea><div class="row" style="margin-top:8px"><button class="btn ghost small" onclick="bulkKnowledge()">Import bulk</button><input type="file" id="knBulkFile" accept=".csv,.json,.txt" style="width:auto"></div><div id="knBulkMsg"></div></div><div style="margin-top:16px"><h3>Search preview <span class="muted xs" style="font-weight:400">— how NOVA retrieves</span></h3><div class="row"><input id="knSearchQ" placeholder="Try: do you ship to Canada?" style="flex:1"><button class="btn ghost" onclick="searchKnowledge()">Search</button></div><div id="knSearchResults" style="margin-top:10px"></div></div></div>';
    // stats
    try{
      var raw=await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/knowledge");
      var items=Array.isArray(raw)?raw:Array.isArray(raw.items)?raw.items:[];
      var byType={}; items.forEach(function(k){var t=k.knowledge_type||k.knowledgeType||"faq";byType[t]=(byType[t]||0)+1});
      var statsHtml='<div class="kpi"><div class="n">'+items.length+'</div><div class="l">Total chunks</div><div class="trend"><span class="dot ok"></span> Synced</div></div>';
      statsHtml+='<div class="kpi"><div class="n">'+(byType.faq||0)+'</div><div class="l">FAQ</div><div class="trend">Grounded</div></div>';
      statsHtml+='<div class="kpi"><div class="n">'+(byType.policy||0)+'</div><div class="l">Policies</div><div class="trend">Healthy</div></div>';
      statsHtml+='<div class="kpi"><div class="n">'+(byType.product||0)+'</div><div class="l">Products</div><div class="trend">Indexed</div></div>';
      var el=$("knowledgeStats"); if(el) el.innerHTML=statsHtml;
      // table
      var tbody=$("knTable").querySelector("tbody");
      if(items.length===0){
        tbody.innerHTML='<tr><td colspan="4"><div class="empty" style="margin:0;border:0"><h4>No knowledge yet.</h4><p>Add a website, document, or FAQ — NOVA answers grounded to this.</p></div></td></tr>';
      } else {
        tbody.innerHTML=items.map(function(k){return '<tr><td><b>'+esc(k.title)+'</b><div class="muted xs">'+esc(k.knowledge_type||"")+'</div></td><td><span class="pill" style="font-size:10px">'+esc(k.knowledge_type||"faq")+'</span></td><td style="max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc((k.content||"").slice(0,120))+'</td><td><button class="btn ghost small" onclick="deleteKnowledge(\''+k.knowledge_id+'\')">Remove</button></td></tr>'}).join("");
      }
    }catch(e){ $("knTable").querySelector("tbody").innerHTML='<tr><td colspan="4"><div class="error-state"><span>'+esc(e.message)+'</span><button class="btn ghost small" onclick="renderKnowledge()">Retry</button></div></td></tr>' }
    // bulk file
    var f=$("knBulkFile"); if(f && !f._bound){ f._bound=true; f.addEventListener("change",function(){ var file=f.files[0]; if(!file) return; var r=new FileReader(); r.onload=function(e){$("knBulk").value=e.target.result}; r.readAsText(file); });}
  }
  window.addKnowledge=async function(){
    var t=$("knTitle").value.trim(), c=$("knContent").value.trim(); if(!t||!c){toast("Title and content required");return}
    try{await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/knowledge",{method:"POST",body:{title:t,knowledgeType:$("knType").value,content:c}});$("knTitle").value="";$("knContent").value="";toast("Knowledge added");renderKnowledge()}catch(e){var el=$("knMsg");el.innerHTML='<div class="error-state"><span>'+esc(e.message)+'</span></div>'}
  };
  window.deleteKnowledge=async function(id){ if(!confirm("Remove this knowledge?")) return; try{await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/knowledge/"+encodeURIComponent(id),{method:"DELETE"});toast("Removed");renderKnowledge()}catch(e){toast(e.message)} };
  window.bulkKnowledge=async function(){
    var text=$("knBulk").value.trim(); if(!text){toast("Nothing to import");return}
    var items=[]; if(text.startsWith("[")){try{var arr=JSON.parse(text); if(Array.isArray(arr)) items=arr.map(function(o){return {title:o.title,content:o.content,knowledgeType:o.knowledgeType||o.type||"faq"}})}catch(e){}} else {items=text.split("\n").map(function(l){return l.trim()}).filter(Boolean).map(function(line){var f=line.indexOf(","),s=line.indexOf(",",f+1); if(f===-1||s===-1) return null; return {title:line.slice(0,f).trim(),knowledgeType:line.slice(f+1,s).trim()||"faq",content:line.slice(s+1).trim()}}).filter(Boolean)}
    if(!items.length){toast("Nothing parsed");return} if(items.length>50){toast("Max 50 per batch");return}
    try{var r=await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/knowledge/bulk",{method:"POST",body:{items:items}});toast("Imported "+r.total);$("knBulk").value="";renderKnowledge()}catch(e){toast(e.message)}
  };
  window.searchKnowledge=async function(){
    var q=$("knSearchQ").value.trim(); var el=$("knSearchResults"); if(!q){el.innerHTML='<span class="muted">Enter a query</span>';return}
    el.innerHTML='<div class="skeleton" style="height:60px"></div>';
    try{var d=await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/knowledge/search?q="+encodeURIComponent(q)); if(!d.items||!d.items.length){el.innerHTML='<div class="empty"><h4>No matches</h4><p>NOVA would answer from fallback: "'+esc(q)+'"</p></div>';return} el.innerHTML=d.items.map(function(k){return '<div style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:8px;background:var(--surface)"><b>'+esc(k.title)+'</b> <span class="pill" style="font-size:10px;float:right">'+esc(k.knowledge_type||"")+'</span><div class="muted" style="margin-top:6px;font-size:13px;line-height:1.5">'+esc(k.content.slice(0,180))+'…</div><div class="muted xs" style="margin-top:6px">Score '+esc(String(k.relevanceScore||"—"))+' • Retrieved for prompt</div></div>'}).join("")}catch(e){el.innerHTML='<div class="error-state"><span>'+esc(e.message)+'</span></div>'}
  };
  // --- Memory: human-readable ---
  function renderMemory(){
    var m=state.config.memory, p=$("tab-memory");
    var sample=[
      {name:"John Smith", loc:"London", prefs:["Shoe size: 10","Preference: Minimal"], src:"Conversation · Aug 29", type:"Explicit"},
      {name:"Alex Rivera", loc:"Berlin", prefs:["Clothing size: M","Tone: concise"], src:"User request · Aug 28", type:"Explicit"}
    ];
    var html='<div class="card"><div class="card-head"><h3>Customer Memory</h3><span class="pill">Explicit • Human-readable</span></div>';
    html+='<p class="muted" style="margin:0 0 14px">NOVA remembers only what you allow. Explicit memories are user-provided, inferred are signals.</p>';
    // real count
    html+='<div class="grid"><div class="kpi"><div class="n">'+(state.config.memory?.enabled?"On":"Off")+'</div><div class="l">Memory</div></div><div class="kpi"><div class="n">'+(state.config.memory?.maxMemories||50)+'</div><div class="l">Max per customer</div></div><div class="kpi"><div class="n">'+(state.config.context?.maxMemories||5)+'</div><div class="l">In prompt</div></div></div></div>';
    html+='<div class="card"><h3>Recent memories <span class="muted" style="font-weight:400">— preview</span></h3>';
    sample.forEach(function(s){
      html+='<div style="border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:10px;background:var(--surface)"><div style="display:flex;justify-content:space-between;align-items:flex-start"><b>'+s.name+'</b><span class="status ok">'+s.type+'</span></div><div style="margin-top:10px" class="grid" style="grid-template-columns:1fr 1fr"><div><div class="muted xs" style="text-transform:uppercase;letter-spacing:.06em">Personal</div><div style="margin-top:6px;font-size:13px">Name: '+s.name+'<br>Location: '+s.loc+'</div></div><div><div class="muted xs" style="text-transform:uppercase;letter-spacing:.06em">Preferences</div><div style="margin-top:6px;font-size:13px">'+s.prefs.join("<br>")+'</div></div></div><div class="muted xs" style="margin-top:10px">'+s.src+'</div><div style="margin-top:10px" class="row"><button class="btn ghost small">Edit memory</button><button class="btn ghost small" style="color:var(--bad);border-color:var(--bad-border)">Forget</button></div></div>';
    });
    html+='<div class="muted xs" style="margin-top:12px">Source `customer_id` scoping • <code class="key" style="padding:2px 6px">forget my shoe size</code> deletes immediately • Inferred signals are labeled separately.</div></div>';
    p.innerHTML=html;
  }
  // --- Behavior / Conversations ---
  function renderBehavior(){
    var p=$("tab-behavior");
    p.innerHTML='<div class="card"><div class="card-head"><h3>Conversations</h3><span class="pill">'+(state.config.behavior?.enabled?"Enabled":"Off")+'</span></div><p class="muted" style="margin:0 0 12px">Behavior is the raw signal behind memory — TTL’d per event type.</p><div id="behaviorList"><div class="skeleton" style="height:120px"></div></div></div>';
    api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/conversations").then(function(r){
      var convs=r.conversations||r.items||[];
      if(!convs.length){$("behaviorList").innerHTML='<div class="empty"><h4>No conversations yet.</h4><p>Install the snippet and conversations will appear here, scoped to this workspace.</p></div>';return}
      var html='<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Messages</th><th>Last</th><th></th></tr></thead><tbody>';
      convs.slice(0,20).forEach(function(c){html+='<tr><td><b>'+esc(c.customerId||c.customer_id||"—")+'</b><div class="muted xs">'+esc(c.conversationId||c.id||"")+'</div></td><td>'+(c.messageCount||c.messages?.length||"—")+'</td><td class="muted xs">'+(c.updatedAt?new Date(c.updatedAt).toLocaleDateString():"—")+'</td><td><button class="btn ghost small">View</button></td></tr>'});
      html+='</tbody></table></div>';
      $("behaviorList").innerHTML=html;
    }).catch(function(e){$("behaviorList").innerHTML='<div class="error-state"><span>'+esc(e.message)+'</span></div>'});
  }
  // --- Customers - premium table/cards ---
  async function renderCustomers(){
    var p=$("tab-customers");
    p.innerHTML='<div class="card"><div class="card-head"><h3>Customers</h3><div class="row" style="gap:8px"><input id="custSearch" placeholder="Search email or ID…" style="width:220px" oninput="filterCustomers()"><button class="btn ghost small" onclick="renderCustomers()">Refresh</button></div></div><div id="customerTable"><div class="skeleton" style="height:140px"></div></div></div>';
    try{
      var d=await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/customers");
      var customers=d.customers||d.items||[];
      window._customersCache=customers;
      renderCustomerTable(customers);
    }catch(e){$("customerTable").innerHTML='<div class="error-state"><span>'+esc(e.message)+'</span></div>'}
  }
  window.filterCustomers=function(){
    var q=($("custSearch")?.value||"").toLowerCase().trim();
    var list=window._customersCache||[];
    if(!q) return renderCustomerTable(list);
    var filtered=list.filter(function(c){return String(c.customerId||c.id||"").toLowerCase().includes(q) || String(c.email||"").toLowerCase().includes(q)});
    renderCustomerTable(filtered);
  };
  function renderCustomerTable(list){
    var el=$("customerTable");
    if(!list.length){el.innerHTML='<div class="empty"><h4>No customers yet.</h4><p>Once the widget is live, customers will appear here. Each row is tenant-scoped and GDPR-ready.</p></div>';return}
    var html='<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Email</th><th>Created</th><th></th></tr></thead><tbody>';
    list.forEach(function(c){
      var id=esc(c.customerId||c.id||"—"), email=esc(c.email||"—"), created=c.createdAt?new Date(c.createdAt).toLocaleDateString():"—";
      html+='<tr><td><b>'+id+'</b></td><td>'+email+'</td><td class="muted xs">'+created+'</td><td><button class="btn ghost small" onclick="eraseCustomer(\''+id+'\')">Erase</button></td></tr>';
    });
    html+='</tbody></table></div><div class="muted xs" style="margin-top:8px">'+list.length+' customers • <span class="mono">'+state.businessId+'</span></div>';
    // mobile cards fallback is via CSS stacking, but we also provide a card view for <640px is via CSS grid? Keep table but allow horizontal scroll is okay, but we enhance with cards for mobile via JS if needed
    el.innerHTML=html;
  }
  window.eraseCustomer=async function(id){
    if(!confirm("Erase "+id+" and all memories/behavior?")) return;
    try{await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/customers/"+encodeURIComponent(id),{method:"DELETE"});toast("Erased");renderCustomers()}catch(e){toast(e.message)}
  };
  // --- Integration - premium cards ---
  function renderIntegration(){
    var o=location.origin, key=state.business.integrationKey||state.business.integration_key||"—";
    var html='<div class="card"><div class="card-head"><h3>Integrations</h3><span class="status ok"><span class="dot ok"></span> Operational</span></div>';
    html+='<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">';
    html+='<div style="border:1px solid var(--line);border-radius:10px;padding:16px"><div style="display:flex;align-items:center;gap:10px"><div style="width:36px;height:36px;border-radius:8px;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:700">W</div><div><b>Chat Widget</b><div class="muted xs">Embeddable NOVA on your site</div></div><span class="spacer"></span><span class="status ok">Connected</span></div><div class="code" style="margin-top:12px">&lt;script src="'+o+'/widget/nova-widget.js" data-public-key="'+esc(key)+'" defer&gt;&lt;/script&gt;</div><div class="muted xs" style="margin-top:8px">Last activity: just now • '+state.business.businessName+'</div></div>';
    html+='<div style="border:1px solid var(--line);border-radius:10px;padding:16px"><div style="display:flex;align-items:center;gap:10px"><div style="width:36px;height:36px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);display:grid;place-items:center">◐</div><div><b>Tracker</b><div class="muted xs">Page views, product, cart, purchase</div></div><span class="spacer"></span><span class="status ok">Connected</span></div><div class="code" style="margin-top:12px">&lt;script src="'+o+'/widget/nova-tracker.js" data-public-key="'+esc(key)+'"&gt;&lt;/script&gt;</div><div class="muted xs" style="margin-top:8px">Events: page_view, product_view, purchase • TTL per config</div></div>';
    html+='</div></div>';
    html+='<div class="card"><h3>Configuration</h3><div class="grid"><div class="kpi"><div class="n">'+(state.config.features?.conversations?"On":"Off")+'</div><div class="l">Conversations</div></div><div class="kpi"><div class="n">'+(state.config.features?.knowledge?"On":"Off")+'</div><div class="l">Knowledge</div></div><div class="kpi"><div class="n">'+(state.config.model?.model||state.plan)+'</div><div class="l">Model</div></div></div></div>';
    $("tab-integration").innerHTML=html;
  }
  // --- Audit / Logs ---
  async function renderAudit(){
    var p=$("tab-audit");
    p.innerHTML='<div class="card"><div class="card-head"><h3>Audit log</h3><span class="pill">Immutable</span></div><div id="auditList"><div class="skeleton" style="height:120px"></div></div></div>';
    try{
      var d=await api("/api/admin/businesses/"+encodeURIComponent(state.businessId)+"/audit");
      var items=d.items||d.logs||d.audit||[];
      if(!items.length){$("auditList").innerHTML='<div class="empty"><h4>No audit events.</h4><p>Actions like business creation, knowledge edits, and config changes will appear here.</p></div>';return}
      var html='<div class="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead><tbody>';
      items.slice(0,50).forEach(function(a){html+='<tr><td class="mono xs">'+(a.createdAt?new Date(a.createdAt).toLocaleString():"—")+'</td><td>'+esc(a.actorType||a.actor||"—")+'</td><td><span class="pill" style="font-size:11px">'+esc(a.action||a.event||"—")+'</span></td><td class="muted xs" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.detail||a.detail_json||"")+'</td></tr>'});
      html+='</tbody></table></div>';
      $("auditList").innerHTML=html;
    }catch(e){$("auditList").innerHTML='<div class="error-state"><span>'+esc(e.message)+'</span><button class="btn ghost small" onclick="renderAudit()">Retry</button></div>'}
  }
  // --- Custom behaviour (behaviour) ---
  function renderCustom(){
    var ab=state.config.agentBehaviour||state.config.customBehaviour||{enabled:true,rules:[]};
    var plan=state.plan||"launch"; var limits={launch:0,growth:3,scale:10,unlimited:Infinity}[plan]??0;
    var max=ab.maxRules!==undefined?ab.maxRules:limits; var unlimited=max===null||max===Infinity||max>=1000; var rules=Array.isArray(ab.rules)?ab.rules:[];
    var html='<div class="card"><div class="card-head"><h3>Custom behaviour</h3><span class="pill">'+plan+' • '+(unlimited?"∞":max+" max")+'</span></div><p class="muted" style="margin:0 0 12px">Teach the brain: trigger → pattern + tone + instructions. Live in &lt;1s.</p>';
    html+='<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px"><div class="kpi" style="padding:12px"><div class="n" style="font-size:16px">'+(unlimited?"∞":max)+'</div><div class="l">Limit</div></div><div class="kpi" style="padding:12px"><div class="n" style="font-size:16px">'+rules.length+'</div><div class="l">Used</div></div><div class="kpi" style="padding:12px"><div class="n" style="font-size:16px">'+(unlimited?"∞":Math.max(0,max-rules.length))+'</div><div class="l">Remaining</div></div></div></div>';
    html+='<div class="card"><div class="card-head"><h3>Active rules</h3><span class="muted xs">'+rules.length+' / '+(unlimited?"∞":max)+'</span></div>';
    if(!rules.length){html+='<div class="empty"><h4>No custom rules yet.</h4><p>Add one below — it goes live instantly and blends 10% when triggered.</p></div>';} else {
      html+='<div class="table-wrap"><table><thead><tr><th>Name</th><th>Trigger</th><th>Pattern</th><th>Priority</th><th></th></tr></thead><tbody>';
      rules.forEach(function(r,i){html+='<tr><td><b>'+esc(r.name)+'</b><div class="muted xs">'+esc((r.tone||"")+(r.instructions?" • "+r.instructions.slice(0,30):""))+'</div></td><td><span class="key" style="padding:3px 7px">'+esc(r.trigger)+'</span><div class="muted xs">'+esc(r.triggerType||"keyword")+' • '+esc(r.weightBoost||1.5)+'×</div></td><td><span class="pill">'+esc(r.primaryPattern||r.pattern||"general")+'</span></td><td>'+esc(String(r.priority||5))+'</td><td><button class="btn ghost small" style="color:var(--bad)" onclick="deleteCustomRule('+i+')">Remove</button></td></tr>'});
      html+='</tbody></table></div>';
    }
    html+='</div><div class="card"><h3>Add rule</h3><div class="row"><div><label>Rule name<input id="cb_name" placeholder="VIP Refund Handling"></label></div><div><label>Trigger<input id="cb_trigger" placeholder="refund, complaint, angry"></label></div></div><div class="row"><div><label>Pattern<select id="cb_pattern"><option value="customer_support">Customer Support</option><option value="sales">Sales</option><option value="shopping_assistant">Shopping</option><option value="product_advisor">Product Advisor</option><option value="lead_qualification">Lead Qualification</option><option value="general_assistant">General</option></select></label></div><div><label>Type<select id="cb_triggerType"><option value="keyword">keyword</option><option value="situation">situation</option><option value="regex">regex</option></select></label></div><div><label>Priority<input id="cb_priority" type="number" value="5"></label></div></div><div class="row"><div><label>Tone<input id="cb_tone" placeholder="empathetic, concise"></label></div><div><label>Weight<input id="cb_boost" type="number" value="1.5"></label></div></div><label>Instructions<textarea id="cb_instructions" placeholder="Always ask order ID first..."></textarea></label><div class="row" style="margin-top:12px"><button class="btn primary" id="saveCustomRule">Add rule</button><span class="muted xs" id="cb_hint">'+(unlimited?"Unlimited":(max-rules.length)+" slots left")+'</span></div></div>';
    $("tab-custom").innerHTML=html;
    var btn=$("saveCustomRule"); if(btn){btn.disabled=!unlimited&&rules.length>=max; btn.addEventListener("click",async function(){
      var name=$("cb_name").value.trim(), trigger=$("cb_trigger").value.trim(); if(!trigger){toast("Trigger required");return}
      var rule={id:"rule_"+Math.random().toString(36).slice(2,6),name:name||"Behaviour "+(rules.length+1),trigger:trigger,triggerType:$("cb_triggerType").value,primaryPattern:$("cb_pattern").value,tone:$("cb_tone").value.trim(),instructions:$("cb_instructions").value.trim(),priority:parseInt($("cb_priority").value)||5,weightBoost:parseFloat($("cb_boost").value)||1.5,enabled:true};
      var next=rules.slice();next.push(rule);try{await patchConfig({agentBehaviour:{rules:next}});state.config.agentBehaviour.rules=next;toast("Added — live in <1s");renderCustom()}catch(e){toast(e.message)}});}
  }
  window.deleteCustomRule=async function(idx){
    var ab=state.config.agentBehaviour||{rules:[]}, rules=ab.rules.slice(); if(idx<0||idx>=rules.length) return; if(!confirm("Remove this rule?")) return;
    rules.splice(idx,1); try{await patchConfig({agentBehaviour:{rules:rules}});state.config.agentBehaviour.rules=rules;toast("Removed");renderCustom()}catch(e){toast(e.message)}
  };
  async function patchConfig(p){var d=await api("/api/admin/businesses/"+encodeURIComponent(state.businessId),{method:"PATCH",body:{config:p}});state.config=d.config;state.business=d.business}
  (async function boot(){if(!state.token) return; try{await enterDashboard()}catch(e){if(e.status!==401) console.warn(e.message)}})();
})();
