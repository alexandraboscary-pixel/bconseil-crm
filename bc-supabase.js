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
    readyPromise = Promise.all([loadClients(), loadDocuments(), loadTasks()])
      .then(function () { subscribeRealtime(); return cache; });
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
      if (ex) {
        return sb.from("clients").update(fields).eq("id", ex.id).select().single()
          .then(function (r) { if (r.error) throw r.error; Object.assign(ex, r.data); return ex; });
      }
      return sb.from("clients").insert(fields).select().single()
        .then(function (r) { if (r.error) throw r.error; cache.clients.push(r.data); return r.data; });
    },
    update: function (id, patch) {
      markLocal("clients");
      return sb.from("clients").update(patch).eq("id", id).select().single()
        .then(function (r) { if (r.error) throw r.error; var ex = cache.clients.filter(function (c) { return c.id === id; })[0]; if (ex) Object.assign(ex, r.data); return ex; });
    },
    updateStatus: function (societe, statut) {
      markLocal("clients");
      var ex = clients.bySociete(societe);
      if (!ex) return Promise.resolve(null);
      return sb.from("clients").update({ statut: statut }).eq("id", ex.id).select().single()
        .then(function (r) { if (r.error) throw r.error; ex.statut = statut; return ex; });
    },
    remove: function (id) {
      markLocal("clients");
      return sb.from("clients").delete().eq("id", id)
        .then(function (r) { if (r.error) throw r.error; cache.clients = cache.clients.filter(function (c) { return c.id !== id; }); });
    }
  };

  // ---- DOCUMENTS ------------------------------------------------------------
  var docs = {
    all: function () { return cache.documents; },
    create: function (d) {
      markLocal("documents");
      return sb.from("documents").insert(d).select().single()
        .then(function (r) { if (r.error) throw r.error; cache.documents.push(r.data); return r.data; });
    },
    markSent: function (id, email) {
      markLocal("documents");
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
      return sb.from("documents").delete().eq("id", id)
        .then(function (r) { if (r.error) throw r.error; cache.documents = cache.documents.filter(function (x) { return x.id !== id; }); });
    }
  };

  // ---- TASKS ----------------------------------------------------------------
  var tasks = {
    all: function () { return cache.tasks; },
    create: function (t) {
      markLocal("tasks");
      return sb.from("tasks").insert(t).select().single()
        .then(function (r) { if (r.error) throw r.error; cache.tasks.push(r.data); return r.data; });
    },
    update: function (id, patch) {
      markLocal("tasks");
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
      return sb.from("tasks").delete().eq("id", id)
        .then(function (r) { if (r.error) throw r.error; cache.tasks = cache.tasks.filter(function (x) { return x.id !== id; }); });
    },
    // Sauvegarde l'ordre + la colonne de toutes les cartes (après drag & drop).
    reorder: function (items) {
      markLocal("tasks");
      var ups = items.map(function (it) { return sb.from("tasks").update({ col: it.col, position: it.position }).eq("id", it.id); });
      items.forEach(function (it) { var t = cache.tasks.filter(function (x) { return x.id === it.id; })[0]; if (t) { t.col = it.col; t.position = it.position; } });
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
    norm: norm
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
