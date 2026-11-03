/* Import de clients : lecture du fichier, aperçu, écriture dans la base. */
(function () {
  "use strict";

  var store = window.DevisStore;
  var csv = window.DevisImport;
  var el = function (id) { return document.getElementById(id); };

  var PREVIEW_MAX = 25;
  var BATCH = 100;

  var state = { parsed: null, map: {}, records: [], encoding: "", fileName: "" };

  function show(node, message) {
    if (!node) return;
    if (!message) { node.hidden = true; node.textContent = ""; return; }
    node.textContent = message;
    node.hidden = false;
  }

  var FIELD_LABEL = {
    prenom: "Prénom",
    nom: "Nom",
    telephone: "Téléphone",
    email: "Adresse électronique",
    adresse: "Adresse",
    code_postal: "Code postal",
    ville: "Ville",
    notes: "Notes",
  };

  // ------------------------------------------------------- lecture fichier --
  function handleFile(file) {
    if (!file) return;
    show(el("pageError"), "");
    var reader = new FileReader();
    reader.onerror = function () {
      show(el("pageError"), "Le fichier n’a pas pu être lu.");
    };
    reader.onload = function () {
      var decoded;
      try {
        decoded = csv.decodeBytes(reader.result);
      } catch (e) {
        show(el("pageError"), "Le fichier n’est pas un texte lisible. Exportez-le au format CSV.");
        return;
      }
      state.encoding = decoded.encoding;
      state.fileName = file.name;
      try {
        state.parsed = csv.parse(decoded.text);
      } catch (e) {
        show(el("pageError"), "Le fichier n’a pas pu être découpé en colonnes.");
        return;
      }
      if (!state.parsed.headers.length || !state.parsed.rows.length) {
        show(el("pageError"), "Le fichier ne contient aucune ligne de client sous sa ligne d’en-tête.");
        return;
      }
      var sep = { ";": "point-virgule", ",": "virgule", "\t": "tabulation", "|": "barre verticale" };
      show(el("fileInfo"),
        file.name + " — " + state.parsed.rows.length + " ligne(s), " +
        state.parsed.headers.length + " colonne(s), séparateur " +
        (sep[state.parsed.delimiter] || state.parsed.delimiter) + ", encodage " + decoded.encoding + ".");
      state.map = csv.detectColumns(state.parsed.headers);
      renderMapping();
      refreshPreview();
    };
    reader.readAsArrayBuffer(file);
  }

  el("pick").addEventListener("click", function () { el("file").click(); });
  el("file").addEventListener("change", function (e) { handleFile(e.target.files[0]); });

  var drop = el("drop");
  ["dragenter", "dragover"].forEach(function (type) {
    drop.addEventListener(type, function (e) {
      e.preventDefault();
      drop.classList.add("is-over");
    });
  });
  ["dragleave", "drop"].forEach(function (type) {
    drop.addEventListener(type, function (e) {
      e.preventDefault();
      drop.classList.remove("is-over");
    });
  });
  drop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) handleFile(e.dataTransfer.files[0]);
  });

  // ------------------------------------------------- choix des colonnes ----
  function renderMapping() {
    var box = el("mapFields");
    box.textContent = "";
    csv.fields.forEach(function (field) {
      var wrap = document.createElement("div");
      wrap.className = "ic-map-row";

      var label = document.createElement("label");
      label.className = "lab";
      label.setAttribute("for", "map-" + field);
      label.textContent = FIELD_LABEL[field];
      wrap.appendChild(label);

      var select = document.createElement("select");
      select.id = "map-" + field;
      var none = document.createElement("option");
      none.value = ""; none.textContent = "— aucune —";
      select.appendChild(none);
      state.parsed.headers.forEach(function (header, index) {
        var opt = document.createElement("option");
        opt.value = String(index);
        opt.textContent = header || "colonne " + (index + 1);
        if (state.map[field] === index) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", function () {
        if (select.value === "") delete state.map[field];
        else state.map[field] = Number(select.value);
        refreshPreview();
      });
      wrap.appendChild(select);

      // Un exemple tiré de la première ligne aide à repérer une erreur.
      var sample = document.createElement("span");
      sample.className = "ic-sample";
      var i = state.map[field];
      sample.textContent = i != null && state.parsed.rows[0] ? (state.parsed.rows[0][i] || "") : "";
      wrap.appendChild(sample);

      box.appendChild(wrap);
    });
    el("mapPanel").hidden = false;
  }

  // ------------------------------------------------------------- aperçu ----
  async function existingClients() {
    try {
      if (store && store.ready) await store.ready();
      var list = (store && store.list ? store.list() : []) || [];
      return list.map(function (lead) {
        return { telephone: lead.telephone || "", email: lead.email || "" };
      });
    } catch (e) {
      return [];
    }
  }

  var existingCache = null;

  async function refreshPreview() {
    if (!state.parsed) return;
    var result = csv.toClients(state.parsed, state.map);
    if (existingCache === null) existingCache = await existingClients();
    state.records = csv.markDuplicates(result.kept, existingCache);
    state.skipped = result.skipped;

    var dup = state.records.filter(function (r) { return r.duplicate; }).length;
    var neuf = state.records.length - dup;

    var stats = el("stats");
    stats.textContent = "";
    [
      [String(state.records.length), "fiche(s) lisible(s)"],
      [String(neuf), "nouveau(x) client(s)"],
      [String(dup), "doublon(s)"],
      [String(result.skipped.length), "ligne(s) écartée(s)"],
    ].forEach(function (pair) {
      var box = document.createElement("div");
      box.className = "ic-stat";
      var n = document.createElement("strong");
      n.textContent = pair[0];
      var l = document.createElement("span");
      l.textContent = pair[1];
      box.appendChild(n); box.appendChild(l);
      stats.appendChild(box);
    });

    var skippedBox = el("skippedBox");
    skippedBox.hidden = result.skipped.length === 0;
    if (result.skipped.length) {
      el("skippedCount").textContent =
        result.skipped.length + " ligne(s) écartée(s) — voir lesquelles";
      var ul = el("skippedList");
      ul.textContent = "";
      result.skipped.slice(0, 60).forEach(function (s) {
        var li = document.createElement("li");
        li.textContent = "Ligne " + s.line + " : " + s.reason + (s.raw ? " (" + s.raw + ")" : "");
        ul.appendChild(li);
      });
    }

    var rows = el("previewRows");
    rows.textContent = "";
    state.records.slice(0, PREVIEW_MAX).forEach(function (r) {
      var tr = document.createElement("tr");
      if (r.duplicate) tr.className = "is-dup";
      [
        (r.prenom + " " + r.nom).trim(),
        r.telephone,
        r.email,
        [r.code_postal, r.ville].filter(Boolean).join(" "),
      ].forEach(function (value) {
        var td = document.createElement("td");
        td.textContent = value || "—";
        tr.appendChild(td);
      });
      var tdState = document.createElement("td");
      tdState.textContent = r.duplicate === "deja"
        ? "déjà client"
        : r.duplicate === "fichier" ? "répété dans le fichier" : "nouveau";
      tdState.className = "ic-state";
      tr.appendChild(tdState);
      rows.appendChild(tr);
    });
    show(el("previewMore"), state.records.length > PREVIEW_MAX
      ? "Les " + PREVIEW_MAX + " premières fiches sont affichées ; les " +
        (state.records.length - PREVIEW_MAX) + " autres seront importées de la même façon."
      : "");

    el("previewPanel").hidden = false;
    show(el("importOk"), "");
    show(el("importError"), "");
  }

  el("skipDup").addEventListener("change", function () { /* lu à l'import */ });

  el("cancelBtn").addEventListener("click", function () {
    state = { parsed: null, map: {}, records: [], encoding: "", fileName: "" };
    el("file").value = "";
    el("mapPanel").hidden = true;
    el("previewPanel").hidden = true;
    show(el("fileInfo"), "");
  });

  // ------------------------------------------------------------ import -----
  function supabaseClient() {
    var c = window.DEVIS_SUPABASE || {};
    var ok = String(c.url || "").indexOf("https://") === 0 && String(c.anonKey || "").length > 20;
    if (!ok || !window.supabase || typeof window.supabase.createClient !== "function") return null;
    return window.supabase.createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  el("importBtn").addEventListener("click", async function () {
    show(el("importError"), ""); show(el("importOk"), "");
    var skipDup = el("skipDup").checked;
    var chosen = state.records.filter(function (r) { return !(skipDup && r.duplicate); });
    if (!chosen.length) {
      show(el("importError"), "Aucune fiche à importer avec les réglages actuels.");
      return;
    }

    var sb = supabaseClient();
    var session = null;
    if (sb) {
      try {
        var s = await sb.auth.getSession();
        session = s && s.data ? s.data.session : null;
      } catch (e) { session = null; }
    }
    if (!sb || !session) {
      show(el("importError"),
        "L’import écrit dans votre liste de clients : il demande le compte cloud de l’atelier. L’aperçu ci-dessus reste utilisable pour vérifier votre fichier.");
      return;
    }

    var btn = el("importBtn");
    btn.disabled = true;
    var was = btn.textContent;
    try {
      var who = await sb.auth.getUser();
      var uid = who && who.data && who.data.user ? who.data.user.id : null;
      var art = await sb.from("dv_artisans").select("id").eq("auth_user_id", uid).maybeSingle();
      if (!art.data) throw new Error("Profil artisan introuvable.");

      var status = el("statusPick").value;
      var done = 0;
      for (var start = 0; start < chosen.length; start += BATCH) {
        var slice = chosen.slice(start, start + BATCH);
        btn.textContent = "Import… " + done + "/" + chosen.length;
        var rows = slice.map(function (r) {
          return {
            artisan_id: art.data.id,
            status: status,
            source: "import",
            prenom: r.prenom || r.nom || "Client",
            nom: r.nom || null,
            // Ces trois colonnes sont obligatoires en base : une chaîne vide
            // garde la fiche importable quand le fichier ne les fournit pas.
            telephone: r.telephone || "",
            email: r.email || "",
            code_postal: r.code_postal || "",
            adresse: r.adresse || null,
            ville: r.ville || null,
            notes_internes: r.notes || null,
            consent_rgpd: false,
          };
        });
        var ins = await sb.from("dv_leads").insert(rows);
        if (ins.error) throw new Error(ins.error.message);
        done += slice.length;
      }
      show(el("importOk"), done + " client(s) importé(s). Ils apparaissent dans votre tableau de bord.");
      el("previewPanel").querySelector(".ic-actions").appendChild(backLink());
    } catch (err) {
      show(el("importError"), err.message || "Import impossible.");
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  });

  function backLink() {
    var a = document.createElement("a");
    a.className = "btn btn-gold";
    a.href = "index.html";
    a.textContent = "Voir mes clients";
    return a;
  }

  // --------------------------------------------------------- démarrage -----
  (async function start() {
    try {
      if (store && store.ready) await store.ready();
    } catch (e) { /* hors ligne : l'aperçu fonctionne quand même */ }
    try {
      var artisan = store && store.currentArtisan ? store.currentArtisan() : null;
      if (artisan) {
        if (artisan.displayName) el("brandName").textContent = artisan.displayName;
        if (artisan.metier) el("brandMetier").textContent = artisan.metier;
      }
    } catch (e) { /* ignoré */ }
    var logout = el("logout");
    if (logout && store && store.authRequired && !store.authRequired()) logout.hidden = true;
    if (logout) logout.addEventListener("click", function () {
      if (store && store.logout) store.logout();
      window.location.href = "index.html";
    });
  })();
})();
