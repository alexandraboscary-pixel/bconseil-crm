/* ===========================================================================
   B.Conseil — Couche de données partagée (Supabase)
   ---------------------------------------------------------------------------
   À inclure dans chaque page APRÈS le SDK et la config :

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="bc-config.js"></script>
     <script src="bc-supabase.js"></script>

   Expose une API globale `window.BC` :
     BC.ready()                          -> Promise, charge le cache (clients/docs/tasks)
     BC.cache                            -> { clients:[], documents:[], tasks:[], profile }
     BC.auth.signIn / signUp / signOut / getUser / requireSession
     BC.clients.all / bySociete / upsert / updateStatus / remove
     BC.docs.all / create / markSent / remove
     BC.tasks.all / create / update / move / remove / reorder
     BC.profile.get / update
     BC.onChange(table, cb)              -> realtime (cache déjà à jour quand cb est appelé)

   Pour désactiver la garde d'auth sur une page (ex : Connexion) :
     window.BC_NO_GUARD = true;  // AVANT ce script
   =========================================================================== */
(function () {
  "use strict";

  var cfg = window.BC_CONFIG || {};
  if (!window.supabase || !cfg.url || !cfg.anonKey) {
    console.error("[BC] Supabase SDK ou bc-config.js manquant.");
  }

  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var cache = { clients: [], documents: [], tasks: [], profile: null };
  var listeners = { clients: [], documents: [], tasks: [] };
  var readyPromise = null;
  // Anti-rebond : on ignore l'écho realtime de NOS propres écritures pendant un
  // court instant (le cache local est déjà à jour) → évite que la modif locale
  // soit annulée par un rechargement DB non encore propagé. Les changements
  // provenant d'un AUTRE appareil/onglet (autre instance) restent pris en compte.
  var suppress = { clients: 0, documents: 0, tasks: 0 };
  function markLocal(table) { suppress[table] = Date.now() + 2500; }

  // ===========================================================================
  // MODE DÉMO (sandbox local)
  // ---------------------------------------------------------------------------
  // Quand on se connecte avec le compte de démonstration, les données ne
  // proviennent PAS de la base partagée : elles sont chargées localement ci-dessous
  // et toutes les écritures restent en mémoire (rien n'est envoyé à Supabase).
  // Conséquence : le compte démo ne voit que ces données, et ces données
  // n'apparaissent jamais pour les comptes réels (Alexandra, François…).
  // ===========================================================================
  var DEMO_EMAIL = "demo@test.com";
  var isDemo = false;
  var demoSeq = 0;
  function demoId(prefix) { return (prefix || "demo") + "-" + (Date.now().toString(36)) + "-" + (++demoSeq); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var DEMO_CLIENTS = [
    { societe:"Lumina Tech",      contact:"Léa Fontaine",   prenom:"Léa",    nom:"Fontaine", email:"lea.fontaine@lumina-tech.fr",       tel:"+33 6 21 45 88 03", ville:"Paris",      secteur:"SaaS",            statut:"encours",     devis_date:"03/06/2026", montant:14200, referent:"François",  tjm:650 },
    { societe:"Atelier Margaux",  contact:"Hugo Lacroix",   prenom:"Hugo",   nom:"Lacroix",  email:"hugo.lacroix@ateliermargaux.fr",    tel:"+33 6 32 17 64 90", ville:"Bordeaux",   secteur:"Restauration",    statut:"devis",       devis_date:"08/06/2026", montant:4800,  referent:"Alexandra", tjm:550 },
    { societe:"NordVision",       contact:"Claire Dumas",   prenom:"Claire", nom:"Dumas",    email:"claire.dumas@nordvision.fr",        tel:"+33 6 43 09 27 51", ville:"Lille",      secteur:"Santé",           statut:"prospection", devis_date:"",           montant:0,     referent:"François",  tjm:600 },
    { societe:"Solaris Énergie",  contact:"Karim Haddad",   prenom:"Karim",  nom:"Haddad",   email:"karim.haddad@solaris-energie.fr",   tel:"+33 6 54 73 12 86", ville:"Marseille",  secteur:"Énergie",         statut:"facture",     devis_date:"28/05/2026", montant:26500, referent:"François",  tjm:700 },
    { societe:"Maison Dubreuil",  contact:"Élise Renaud",   prenom:"Élise",  nom:"Renaud",   email:"elise.renaud@maisondubreuil.fr",    tel:"+33 6 65 28 41 19", ville:"Lyon",       secteur:"Luxe",            statut:"encours",     devis_date:"31/05/2026", montant:9300,  referent:"Alexandra", tjm:620 },
    { societe:"Pixel & Co",       contact:"Thomas Berger",  prenom:"Thomas", nom:"Berger",   email:"thomas.berger@pixelandco.fr",       tel:"+33 6 76 50 38 24", ville:"Nantes",     secteur:"Communication",   statut:"devis",       devis_date:"06/06/2026", montant:6200,  referent:"Alexandra", tjm:580 },
    { societe:"Aquitaine Bio",    contact:"Sarah Olivier",  prenom:"Sarah",  nom:"Olivier",  email:"sarah.olivier@aquitaine-bio.fr",    tel:"+33 6 87 41 59 67", ville:"Bordeaux",   secteur:"Agroalimentaire", statut:"paye",        devis_date:"22/05/2026", montant:15400, referent:"François",  tjm:600 },
    { societe:"TechNova",         contact:"Antoine Marchal",prenom:"Antoine",nom:"Marchal",  email:"antoine.marchal@technova.fr",       tel:"+33 6 98 32 70 45", ville:"Toulouse",   secteur:"Industrie",       statut:"prospection", devis_date:"",           montant:0,     referent:"François",  tjm:680 },
    { societe:"Cabinet Aurélien", contact:"Manon Lopez",    prenom:"Manon",  nom:"Lopez",    email:"manon.lopez@cabinet-aurelien.fr",   tel:"+33 6 19 63 84 72", ville:"Strasbourg", secteur:"Juridique",       statut:"recontacter", devis_date:"14/05/2026", montant:3500,  referent:"Alexandra", tjm:540 },
    { societe:"Riviera Hôtels",   contact:"Lucas Henry",    prenom:"Lucas",  nom:"Henry",    email:"lucas.henry@riviera-hotels.fr",     tel:"+33 6 20 57 19 38", ville:"Nice",       secteur:"Hôtellerie",      statut:"paye",        devis_date:"03/06/2026", montant:18700, referent:"François",  tjm:660 }
  ];
  var DEMO_TASKS = [
    { title:"Préparer le devis — Atelier Margaux",                description:"Chiffrer la refonte du site et préparer le devis détaillé à envoyer au client.", assignee:"François",  client:"Atelier Margaux",  urgent:true,  due:"2026-06-15", col:"todo",    position:0 },
    { title:"Cadrage projet SaaS — Lumina Tech",                  description:"Atelier de cadrage : objectifs, périmètre fonctionnel et roadmap du SaaS.",     assignee:"Alexandra", client:"Lumina Tech",      urgent:false, due:"2026-06-18", col:"todo",    position:1 },
    { title:"Étude de besoin — NordVision",                       description:"Premier rendez-vous de découverte et analyse du besoin client.",                assignee:"François",  client:"NordVision",       urgent:false, due:"",           col:"todo",    position:2 },
    { title:"Développement module facturation — Solaris Énergie", description:"Sprint en cours sur le module de facturation et l'export comptable.",          assignee:"François",  client:"Solaris Énergie",  urgent:false, due:"2026-06-20", col:"doing",   position:0 },
    { title:"Maquettes UX — Maison Dubreuil",                     description:"Concevoir les maquettes des écrans clés et le parcours d'achat premium.",       assignee:"Alexandra", client:"Maison Dubreuil",  urgent:true,  due:"2026-06-13", col:"doing",   position:1 },
    { title:"Refonte identité — Pixel & Co",                      description:"Nouvelle direction artistique et déclinaison de la charte graphique.",          assignee:"Alexandra", client:"Pixel & Co",       urgent:false, due:"",           col:"doing",   position:2 },
    { title:"Validation devis — Riviera Hôtels",                  description:"En attente de la validation du devis par la direction de l'hôtel.",            assignee:"François",  client:"Riviera Hôtels",   urgent:false, due:"2026-06-16", col:"waiting", position:0 },
    { title:"Retour client maquettes — Aquitaine Bio",            description:"En attente des retours du client sur les maquettes proposées.",                assignee:"Alexandra", client:"Aquitaine Bio",    urgent:false, due:"",           col:"waiting", position:1 },
    { title:"Livraison site — Cabinet Aurélien",                  description:"Site livré, mis en ligne et recette validée avec le client.",                  assignee:"François",  client:"Cabinet Aurélien", urgent:false, due:"",           col:"done",    position:0 },
    { title:"Formation IA équipe — TechNova",                     description:"Session de formation à l'IA générative animée pour les équipes.",              assignee:"Alexandra", client:"TechNova",         urgent:false, due:"",           col:"done",    position:1 }
  ];
  // Documents de démo : [société, type, date]. Le montant TTC reprend le `montant`
  // du client ; HT/TVA sont déduits (TVA 20 %). Sert au dashboard (revenu, devis,
  // conversion) et à la page Comptabilité.
  var DEMO_DOCS = [
    ["Solaris Énergie", "facture", "2026-05-28"],
    ["Aquitaine Bio",   "facture", "2026-05-22"],
    ["Riviera Hôtels",  "facture", "2026-06-03"],
    ["Lumina Tech",     "devis",   "2026-06-03"],
    ["Maison Dubreuil", "devis",   "2026-05-31"],
    ["Atelier Margaux", "devis",   "2026-06-08"],
    ["Pixel & Co",      "devis",   "2026-06-06"],
    ["Cabinet Aurélien","devis",   "2026-05-14"]
  ];
  function loadDemoData() {
    var now = new Date().toISOString();
    cache.clients = DEMO_CLIENTS.map(function (c) { return Object.assign({ id: demoId("client"), logo_url: null, notes: "", history: [], created_at: now }, clone(c)); });
    cache.tasks = DEMO_TASKS.map(function (t) { return Object.assign({ id: demoId("task"), created_at: now }, clone(t)); });
    var seqN = { devis: 0, facture: 0 };
    cache.documents = DEMO_DOCS.map(function (d) {
      var cl = clients.bySociete(d[0]) || {};
      var ttc = Number(cl.montant) || 0;
      var ht = Math.round(ttc / 1.2);
      var prefix = d[1] === "facture" ? "FA" : "DV";
      seqN[d[1]] += 1;
      var num = prefix + "-2026-" + String(100 + seqN[d[1]]);
      return {
        id: demoId("doc"), type: d[1], numero: num, client_id: cl.id || null,
        societe: d[0], contact: cl.contact || "", date: d[2], ref: "",
        ht: ht, tva: ttc - ht, ttc: ttc, lines: [], notes: "",
        statut: d[1], sent: d[1] === "facture", sent_to: cl.email || "",
        created_at: now
      };
    });
  }

  // Détecte une colonne absente du schéma dans une erreur PostgREST.
  function missingCol(err) {
    if (!err) return null;
    var m = (err.message || "") + " " + (err.details || "") + " " + (err.hint || "");
    var mm = m.match(/Could not find the '([^']+)' column/i) || m.match(/column "?([a-zA-Z_]+)"? of relation/i) || m.match(/column "?([a-zA-Z_]+)"? does not exist/i);
    return mm ? mm[1] : null;
  }
  // Écriture résiliente : si une colonne n'existe pas encore (schéma incomplet),
  // on la retire et on réessaie — les autres champs sont quand même enregistrés.
  function resilientWrite(table, fields, idEq) {
    function attempt(f, tries) {
      var q = idEq ? sb.from(table).update(f).eq("id", idEq) : sb.from(table).insert(f);
      return q.select().single().then(function (r) {
        if (r.error) {
          var col = missingCol(r.error);
          if (col && Object.prototype.hasOwnProperty.call(f, col) && tries < 10) {
            var f2 = Object.assign({}, f); delete f2[col];
            console.warn("[BC] colonne absente ignorée : " + col + " — lancez le SQL ALTER pour la conserver.");
            return attempt(f2, tries + 1);
          }
          throw r.error;
        }
        return r.data;
      });
    }
    return attempt(fields, 0);
  }

  // ---- helpers --------------------------------------------------------------
  function norm(s) { return (s || "").toString().trim().toLowerCase(); }
  function emit(table) { (listeners[table] || []).forEach(function (cb) { try { cb(cache[table]); } catch (e) { console.error(e); } }); }

  // ---- AUTH -----------------------------------------------------------------
  var auth = {
    signUp: function (email, password, meta) {
      return sb.auth.signUp({ email: email, password: password, options: { data: meta || {} } });
    },
    signIn: function (email, password) {
      return sb.auth.signInWithPassword({ email: email, password: password });
    },
    signOut: function () {
      return sb.auth.signOut().then(function () { window.location.href = "Connexion.html"; });
    },
    getUser: function () {
      return sb.auth.getSession().then(function (r) { return (r.data && r.data.session) ? r.data.session.user : null; });
    },
    getSession: function () {
      return sb.auth.getSession().then(function (r) { return r.data ? r.data.session : null; });
    },
    // Redirige vers la page de connexion si aucune session active.
    requireSession: function () {
      return sb.auth.getSession().then(function (r) {
        var session = r.data ? r.data.session : null;
        if (!session) { window.location.replace("Connexion.html"); return null; }
        return session;
      });
    }
  };

  // ---- LOADERS --------------------------------------------------------------
  function loadClients() {
    return sb.from("clients").select("*").order("created_at", { ascending: true })
      .then(function (r) { if (r.error) throw r.error; cache.clients = r.data || []; return cache.clients; });
  }
  function loadDocuments() {
    return sb.from("documents").select("*").order("created_at", { ascending: true })
      .then(function (r) { if (r.error) throw r.error; cache.documents = r.data || []; return cache.documents; });
  }
  function loadTasks() {
    return sb.from("tasks").select("*").order("col", { ascending: true }).order("position", { ascending: true })
      .then(function (r) { if (r.error) throw r.error; cache.tasks = r.data || []; return cache.tasks; });
  }

  // ---- REALTIME -------------------------------------------------------------
  function subscribeRealtime() {
    try {
      sb.channel("bc-db")
        .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, function () { if (Date.now() < suppress.clients) return; loadClients().then(function () { emit("clients"); }); })
        .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, function () { if (Date.now() < suppress.documents) return; loadDocuments().then(function () { emit("documents"); }); })
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, function () { if (Date.now() < suppress.tasks) return; loadTasks().then(function () { emit("tasks"); }); })
        .subscribe();
    } catch (e) { /* realtime non bloquant */ }
  }

  // ---- READY ----------------------------------------------------------------
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = sb.auth.getSession().then(function (r) {
      var user = (r.data && r.data.session) ? r.data.session.user : null;
      isDemo = !!(user && user.email && user.email.toLowerCase() === DEMO_EMAIL);
      window.BC.isDemo = isDemo;
      if (isDemo) {
        // Sandbox : aucune lecture de la base partagée, aucun realtime.
        loadDemoData();
        return cache;
      }
      return Promise.all([loadClients(), loadDocuments(), loadTasks()])
        .then(function () { subscribeRealtime(); return cache; });
    });
    return readyPromise;
  }

  // ---- CLIENTS --------------------------------------------------------------
  var clients = {
    all: function () { return cache.clients; },
    bySociete: function (s) { var k = norm(s); return cache.clients.filter(function (c) { return norm(c.societe) === k; })[0] || null; },
    // Crée ou met à jour un client (dédup par société, comme l'app d'origine).
    upsert: function (c) {
      markLocal("clients");
      var ex = clients.bySociete(c.societe);
      var fields = {};
      ["societe", "contact", "prenom", "nom", "email", "tel", "ville", "secteur", "statut", "devis_date", "montant", "referent", "logo_url", "notes", "history", "adresse", "siret", "tjm"]
        .forEach(function (k) { if (c[k] !== undefined) fields[k] = c[k]; });
      if (isDemo) {
        if (ex) { Object.assign(ex, fields); return Promise.resolve(ex); }
        var row = Object.assign({ id: demoId("client"), created_at: new Date().toISOString() }, fields);
        cache.clients.push(row); return Promise.resolve(row);
      }
      if (ex) {
        return resilientWrite("clients", fields, ex.id).then(function (data) { Object.assign(ex, data); return ex; });
      }
      return resilientWrite("clients", fields, null).then(function (data) { cache.clients.push(data); return data; });
    },
    update: function (id, patch) {
      markLocal("clients");
      if (isDemo) { var exd = cache.clients.filter(function (c) { return c.id === id; })[0]; if (exd) Object.assign(exd, patch); return Promise.resolve(exd); }
      return resilientWrite("clients", patch, id).then(function (data) {
        var ex = cache.clients.filter(function (c) { return c.id === id; })[0]; if (ex) Object.assign(ex, data); return ex;
      });
    },
    updateStatus: function (societe, statut) {
      markLocal("clients");
      var ex = clients.bySociete(societe);
      if (!ex) return Promise.resolve(null);
      if (isDemo) { ex.statut = statut; return Promise.resolve(ex); }
      return sb.from("clients").update({ statut: statut }).eq("id", ex.id).select().single()
        .then(function (r) { if (r.error) throw r.error; ex.statut = statut; return ex; });
    },
    remove: function (id) {
      markLocal("clients");
      if (isDemo) { cache.clients = cache.clients.filter(function (c) { return c.id !== id; }); return Promise.resolve(); }
      return sb.from("clients").delete().eq("id", id)
        .then(function (r) { if (r.error) throw r.error; cache.clients = cache.clients.filter(function (c) { return c.id !== id; }); });
    }
  };

  // ---- DOCUMENTS ------------------------------------------------------------
  var docs = {
    all: function () { return cache.documents; },
    create: function (d) {
      markLocal("documents");
      if (isDemo) { var row = Object.assign({ id: demoId("doc"), created_at: new Date().toISOString() }, d); cache.documents.push(row); return Promise.resolve(row); }
      return resilientWrite("documents", d, null).then(function (data) { cache.documents.push(data); return data; });
    },
    update: function (id, patch) {
      markLocal("documents");
      if (isDemo) { var exd = cache.documents.filter(function (x) { return x.id === id; })[0]; if (exd) Object.assign(exd, patch); return Promise.resolve(exd); }
      return resilientWrite("documents", patch, id).then(function (data) {
        var ex = cache.documents.filter(function (x) { return x.id === id; })[0]; if (ex) Object.assign(ex, data); return ex;
      });
    },
    markSent: function (id, email) {
      markLocal("documents");
      if (isDemo) { var dd = cache.documents.filter(function (x) { return x.id === id; })[0]; if (dd) { dd.sent = true; dd.sent_to = email; } return Promise.resolve(dd); }
      return sb.from("documents").update({ sent: true, sent_to: email }).eq("id", id).select().single()
        .then(function (r) {
          if (r.error) throw r.error;
          var d = cache.documents.filter(function (x) { return x.id === id; })[0];
          if (d) { d.sent = true; d.sent_to = email; }
          return d;
        });
    },
    remove: function (id) {
      markLocal("documents");
      if (isDemo) { cache.documents = cache.documents.filter(function (x) { return x.id !== id; }); return Promise.resolve(); }
      return sb.from("documents").delete().eq("id", id)
        .then(function (r) { if (r.error) throw r.error; cache.documents = cache.documents.filter(function (x) { return x.id !== id; }); });
    }
  };

  // ---- TASKS ----------------------------------------------------------------
  var tasks = {
    all: function () { return cache.tasks; },
    create: function (t) {
      markLocal("tasks");
      if (isDemo) { var row = Object.assign({ id: demoId("task"), created_at: new Date().toISOString() }, t); cache.tasks.push(row); return Promise.resolve(row); }
      return sb.from("tasks").insert(t).select().single()
        .then(function (r) { if (r.error) throw r.error; cache.tasks.push(r.data); return r.data; });
    },
    update: function (id, patch) {
      markLocal("tasks");
      if (isDemo) { var td = cache.tasks.filter(function (x) { return x.id === id; })[0]; if (td) Object.assign(td, patch); return Promise.resolve(td); }
      return sb.from("tasks").update(patch).eq("id", id).select().single()
        .then(function (r) {
          if (r.error) throw r.error;
          var t = cache.tasks.filter(function (x) { return x.id === id; })[0];
          if (t) Object.assign(t, r.data);
          return t;
        });
    },
    move: function (id, col, position) {
      return tasks.update(id, { col: col, position: position });
    },
    remove: function (id) {
      markLocal("tasks");
      if (isDemo) { cache.tasks = cache.tasks.filter(function (x) { return x.id !== id; }); return Promise.resolve(); }
      return sb.from("tasks").delete().eq("id", id)
        .then(function (r) { if (r.error) throw r.error; cache.tasks = cache.tasks.filter(function (x) { return x.id !== id; }); });
    },
    // Sauvegarde l'ordre + la colonne de toutes les cartes (après drag & drop).
    reorder: function (items) {
      markLocal("tasks");
      items.forEach(function (it) { var t = cache.tasks.filter(function (x) { return x.id === it.id; })[0]; if (t) { t.col = it.col; t.position = it.position; } });
      if (isDemo) return Promise.resolve();
      var ups = items.map(function (it) { return sb.from("tasks").update({ col: it.col, position: it.position }).eq("id", it.id); });
      return Promise.all(ups);
    }
  };

  // ---- PROFILE --------------------------------------------------------------
  var profile = {
    get: function () {
      return auth.getUser().then(function (user) {
        if (!user) return null;
        return sb.from("profiles").select("*").eq("id", user.id).maybeSingle().then(function (r) {
          if (r.error) throw r.error;
          var row = r.data || { id: user.id, email: user.email, data: {} };
          cache.profile = Object.assign({}, row.data || {}, { id: row.id, email: row.email, name: row.name, role: row.role, avatar_url: row.avatar_url });
          return cache.profile;
        });
      });
    },
    update: function (patch) {
      return auth.getUser().then(function (user) {
        if (!user) return null;
        // Champs cœur en colonnes, le reste dans `data` (jsonb).
        var core = {};
        ["name", "role", "avatar_url"].forEach(function (k) { if (patch[k] !== undefined) core[k] = patch[k]; });
        var data = {};
        Object.keys(patch).forEach(function (k) { if (["name", "role", "avatar_url", "email", "id"].indexOf(k) < 0) data[k] = patch[k]; });
        var email = (patch.email !== undefined && patch.email !== "") ? patch.email : user.email;
        var row = Object.assign({ id: user.id, email: email, updated_at: new Date().toISOString(), data: data }, core);
        return sb.from("profiles").upsert(row, { onConflict: "id" }).select().single().then(function (r) {
          if (r.error) throw r.error;
          cache.profile = Object.assign({}, r.data.data || {}, { id: r.data.id, email: r.data.email, name: r.data.name, role: r.data.role, avatar_url: r.data.avatar_url });
          return cache.profile;
        });
      });
    },
    // Supprime la ligne de profil de l'utilisateur courant.
    // NB : le compte d'authentification lui-même n'est pas supprimé côté client
    // (cela nécessite la clé service_role ou une Edge Function admin).
    remove: function () {
      return auth.getUser().then(function (user) {
        if (!user) return null;
        return sb.from("profiles").delete().eq("id", user.id).then(function (r) {
          if (r.error) throw r.error;
          cache.profile = null;
          return true;
        });
      });
    }
  };

  // ---- onChange -------------------------------------------------------------
  function onChange(table, cb) { if (listeners[table]) listeners[table].push(cb); }

  // ---- Public API -----------------------------------------------------------
  window.BC = {
    sb: sb,
    cache: cache,
    ready: ready,
    auth: auth,
    clients: clients,
    docs: docs,
    tasks: tasks,
    profile: profile,
    onChange: onChange,
    norm: norm,
    isDemo: false
  };

  // ---- Garde d'authentification --------------------------------------------
  // Toute page (sauf celles avec window.BC_NO_GUARD) exige une session.
  if (!window.BC_NO_GUARD) {
    auth.requireSession();
  }

  // ---- Déconnexion universelle ---------------------------------------------
  // N'importe quel élément .logout, .pf-logout ou [data-bc-logout] déclenche
  // une vraie déconnexion Supabase, sur toutes les pages.
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest(".logout, .pf-logout, [data-bc-logout]");
    if (el) { e.preventDefault(); auth.signOut(); }
  });

  // ---- Identité affichée (barre latérale) -----------------------------------
  // Remplace le nom/rôle/email codés en dur par ceux de l'utilisateur connecté.
  function initials(name) {
    var w = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "?";
    return ((w[0][0] || "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
  }
  function setTxt(sel, val) {
    var el = document.querySelector(sel);
    if (el && val != null && val !== "") el.textContent = val;
  }
  function applyIdentity() {
    return profile.get().then(function (p) {
      if (!p) return;
      var name = p.name || (p.email ? p.email.split("@")[0] : "");
      var first = (name || "").split(" ")[0] || name;
      var role = p.role || "Membre B.Conseil";
      setTxt(".sidebar-bottom .me .name", first);
      setTxt(".sidebar-bottom .me .role", role);
      setTxt(".sidebar-bottom .me .avatar", initials(name));
      setTxt(".user-menu .um-mail", p.email);
      setTxt(".user-menu .um-id", role);
    }).catch(function (e) { console.error("[BC] identity", e); });
  }
  BC.applyIdentity = applyIdentity;

  if (!window.BC_NO_GUARD) {
    if (document.readyState !== "loading") applyIdentity();
    else document.addEventListener("DOMContentLoaded", applyIdentity);
  }
})();
