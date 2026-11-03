/* Devis dicté : reconnaissance vocale, rédaction par l'IA, édition, impression. */
(function () {
  "use strict";

  var store = window.DevisStore;
  var api = window.DevisRedaction;

  var el = function (id) { return document.getElementById(id); };
  var micBtn = el("micBtn"), micLabel = el("micLabel"), micState = el("micState");
  var transcript = el("transcript"), interim = el("interim");
  var draftBtn = el("draftBtn"), blankBtn = el("blankBtn"), draftNote = el("draftNote");
  var panel = el("quotePanel"), rows = el("lineRows");
  var pageError = el("pageError"), saveError = el("saveError"), saveOk = el("saveOk");

  var current = null;   // devis en cours d'édition
  var lines = [];       // lignes affichées

  // --------------------------------------------------------------- outils --
  function euro(n) {
    var value = Math.round((Number(n) || 0) * 100) / 100;
    // Espaces insécables : un montant ne doit jamais se couper en fin de ligne.
    return value
      .toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .replace(/\u202f|\s/g, "\u00a0") + "\u00a0\u20ac";
  }

  function show(node, message, warn) {
    if (!node) return;
    if (!message) { node.hidden = true; node.textContent = ""; return; }
    node.textContent = message;
    node.hidden = false;
    if (warn !== undefined) node.classList.toggle("is-warn", Boolean(warn));
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ------------------------------------------------------------- dictée ----
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recog = null, listening = false, baseText = "";

  function setMic(on) {
    listening = on;
    micBtn.setAttribute("aria-pressed", on ? "true" : "false");
    micLabel.textContent = on ? "Arrêter" : "Dicter";
    show(micState, on
      ? "J’écoute. Parlez normalement, et appuyez sur « Arrêter » quand vous avez fini."
      : "Appuyez et parlez. Vous pouvez aussi écrire directement.");
    if (!on) show(interim, "");
  }

  function startDictation() {
    if (!Recognition) return;
    recog = new Recognition();
    recog.lang = "fr-FR";
    recog.continuous = true;
    recog.interimResults = true;
    baseText = transcript.value.trim();

    recog.onresult = function (event) {
      var settled = "", pending = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) settled += piece;
        else pending += piece;
      }
      if (settled) {
        baseText = (baseText ? baseText + " " : "") + settled.trim();
        transcript.value = baseText;
      }
      show(interim, pending ? "… " + pending : "");
    };

    recog.onerror = function (event) {
      var code = event.error;
      var message = "La dictée s’est arrêtée.";
      if (code === "not-allowed" || code === "service-not-allowed") {
        message = "Le micro est bloqué. Autorisez-le dans votre navigateur, puis réessayez.";
      } else if (code === "no-speech") {
        message = "Je n’ai rien entendu. Réessayez en parlant plus près du micro.";
      } else if (code === "network") {
        message = "La dictée a besoin d’une connexion. Vous pouvez écrire à la place.";
      } else if (code === "aborted") {
        return;
      }
      show(micState, message);
      setMic(false);
    };

    recog.onend = function () { if (listening) setMic(false); };

    try {
      recog.start();
      setMic(true);
    } catch (e) {
      show(micState, "La dictée n’a pas démarré. Vous pouvez écrire votre devis.");
      setMic(false);
    }
  }

  if (!Recognition) {
    micBtn.disabled = true;
    show(micState, "Ce navigateur ne sait pas dicter. Chrome, Edge ou Safari le font ; sinon, écrivez votre devis ci-dessous, l’IA le mettra en forme pareil.");
  } else {
    micBtn.addEventListener("click", function () {
      if (listening) { listening = false; try { recog.stop(); } catch (e) {} setMic(false); }
      else startDictation();
    });
  }

  // ------------------------------------------------------- lignes du devis --
  var ORIGIN_LABEL = {
    prix_pratique: "votre prix habituel",
    grille: "votre grille tarifaire",
    a_completer: "à chiffrer",
    saisi: "",
  };

  // Une zone de texte d'une ligne coupe les libellés longs : on l'ajuste au contenu.
  function autoGrow(node) {
    var fit = function () {
      node.style.height = "auto";
      node.style.height = node.scrollHeight + "px";
    };
    node.addEventListener("input", fit);
    requestAnimationFrame(fit);
    return node;
  }

  function lineTotal(line) {
    return (Number(line.quantity) || 0) * (Number(line.unit_price_ht) || 0);
  }

  function renderLines() {
    rows.textContent = "";
    lines.forEach(function (line, index) {
      var tr = document.createElement("tr");
      tr.className = "dv-row" + (line.price_origin === "a_completer" && !line.unit_price_ht ? " is-todo" : "");

      var tdLabel = document.createElement("td");
      var label = document.createElement("textarea");
      label.rows = 1;
      label.value = line.label || "";
      label.setAttribute("aria-label", "Prestation, ligne " + (index + 1));
      label.addEventListener("input", function () { line.label = label.value; });
      tdLabel.appendChild(autoGrow(label));
      if (line.detail) {
        var detail = document.createElement("textarea");
        detail.rows = 1;
        detail.value = line.detail;
        detail.className = "dv-detail";
        detail.setAttribute("aria-label", "Précision, ligne " + (index + 1));
        detail.addEventListener("input", function () { line.detail = detail.value; });
        tdLabel.appendChild(autoGrow(detail));
      }
      var originText = ORIGIN_LABEL[line.price_origin] || "";
      if (originText) {
        var small = document.createElement("small");
        small.className = "dv-origin" + (line.price_origin === "a_completer" ? " is-todo" : "");
        small.textContent = line.matched_on && line.price_origin !== "a_completer"
          ? originText + " · " + line.matched_on
          : originText;
        tdLabel.appendChild(small);
      }
      tr.appendChild(tdLabel);

      var tdQty = document.createElement("td");
      tdQty.dataset.label = "Quantité";
      tdQty.dataset.short = "Qté";
      var qty = document.createElement("input");
      qty.type = "number"; qty.min = "0"; qty.step = "0.01"; qty.className = "dv-num";
      qty.value = line.quantity;
      qty.setAttribute("aria-label", "Quantité, ligne " + (index + 1));
      qty.addEventListener("input", function () {
        line.quantity = Number(qty.value) || 0;
        refreshTotals();
      });
      tdQty.appendChild(qty);
      tr.appendChild(tdQty);

      var tdUnit = document.createElement("td");
      tdUnit.dataset.label = "Unité";
      var unit = document.createElement("select");
      unit.setAttribute("aria-label", "Unité, ligne " + (index + 1));
      api.units.forEach(function (u) {
        var opt = document.createElement("option");
        opt.value = u; opt.textContent = u;
        if (u === line.unit) opt.selected = true;
        unit.appendChild(opt);
      });
      unit.addEventListener("change", function () { line.unit = unit.value; });
      tdUnit.appendChild(unit);
      tr.appendChild(tdUnit);

      var tdPrice = document.createElement("td");
      tdPrice.dataset.label = "Prix unitaire HT";
      tdPrice.dataset.short = "Prix HT";
      var price = document.createElement("input");
      price.type = "number"; price.min = "0"; price.step = "0.01";
      price.className = "dv-num dv-price";
      price.value = line.unit_price_ht;
      price.setAttribute("aria-label", "Prix unitaire hors taxes, ligne " + (index + 1));
      price.addEventListener("input", function () {
        line.unit_price_ht = Number(price.value) || 0;
        if (line.price_origin === "a_completer" && line.unit_price_ht > 0) line.price_origin = "saisi";
        refreshTotals();
        tr.classList.toggle("is-todo", line.price_origin === "a_completer" && !line.unit_price_ht);
      });
      tdPrice.appendChild(price);
      tr.appendChild(tdPrice);

      var tdTotal = document.createElement("td");
      tdTotal.dataset.label = "Total HT";
      var total = document.createElement("span");
      total.className = "dv-line-total";
      total.textContent = euro(lineTotal(line));
      tdTotal.appendChild(total);
      line._totalNode = total;
      tr.appendChild(tdTotal);

      var tdDel = document.createElement("td");
      var del = document.createElement("button");
      del.type = "button"; del.className = "dv-del"; del.textContent = "×";
      del.title = "Retirer cette ligne";
      del.setAttribute("aria-label", "Retirer la ligne " + (index + 1));
      del.addEventListener("click", function () {
        lines.splice(index, 1);
        renderLines();
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);

      rows.appendChild(tr);
    });
    refreshTotals();
  }

  function refreshTotals() {
    lines.forEach(function (line) {
      if (line._totalNode) line._totalNode.textContent = euro(lineTotal(line));
    });
    var t = api.totals({ lines: lines, vat_rate: Number(el("qVat").value) });
    el("totHt").textContent = euro(t.ht);
    el("totTva").textContent = euro(t.tva);
    el("totTtc").textContent = euro(t.ttc);
    el("tvaLabel").textContent = "TVA " + String(t.rate).replace(".", ",") + " %";

    var todo = lines.filter(function (l) {
      return l.price_origin === "a_completer" && !l.unit_price_ht;
    }).length;
    show(el("todoNote"), todo
      ? (todo === 1
          ? "Une ligne attend son prix : l’IA ne l’a pas trouvée dans vos tarifs et n’en invente pas."
          : todo + " lignes attendent leur prix : l’IA ne les a pas trouvées dans vos tarifs et n’en invente pas.")
      : "");
  }

  el("qVat").addEventListener("change", refreshTotals);

  el("addLine").addEventListener("click", function () {
    lines.push({ label: "", detail: "", quantity: 1, unit: "u", unit_price_ht: 0, price_origin: "saisi" });
    renderLines();
    var last = rows.querySelector("tr:last-child textarea");
    if (last) last.focus();
  });

  // -------------------------------------------------------- ouvrir / vider --
  function openQuote(quote) {
    current = quote || {};
    lines = (current.lines || []).map(function (l) {
      return {
        label: l.label || "",
        detail: l.detail || "",
        quantity: Number(l.quantity) || 1,
        unit: l.unit || "u",
        unit_price_ht: Number(l.unit_price_ht) || 0,
        price_origin: l.price_origin || "saisi",
        matched_on: l.matched_on || "",
      };
    });
    el("qTitle").value = current.title || "";
    el("qClient").value = current.client_name || "";
    el("qEmail").value = current.client_email || "";
    el("qAddress").value = current.client_address || "";
    el("qNotes").value = current.notes || "";
    el("qVat").value = String(current.vat_rate != null ? current.vat_rate : 20);
    el("qValidity").value = String(current.validity_days || 30);
    el("quoteHeading").textContent = current.public_id ? "Modifier le devis" : "Votre devis";
    show(el("quoteNumber"), current.number || "");
    show(saveError, ""); show(saveOk, "");
    panel.hidden = false;
    renderLines();
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  blankBtn.addEventListener("click", function () {
    openQuote({ lines: [{ label: "", detail: "", quantity: 1, unit: "u", unit_price_ht: 0, price_origin: "saisi" }] });
  });

  el("closeBtn").addEventListener("click", function () {
    panel.hidden = true;
    current = null;
    lines = [];
  });

  // ------------------------------------------------------------- rédiger ---
  draftBtn.addEventListener("click", async function () {
    var text = transcript.value.trim();
    show(draftNote, "");
    if (text.length < 15) {
      show(draftNote, "Décrivez le chantier en quelques phrases avant de lancer la rédaction.", true);
      return;
    }
    draftBtn.disabled = true;
    var was = draftBtn.textContent;
    draftBtn.textContent = "Rédaction en cours…";
    try {
      var result = await api.draft(text);
      openQuote({
        title: result.title || "",
        client_name: result.client_name || "",
        notes: result.notes || "",
        transcript: text,
        drafted_by_ai: true,
        vat_rate: 20,
        validity_days: 30,
        lines: result.lines || [],
      });
      var found = (result.lines || []).length - (result.unmatched || 0);
      show(draftNote,
        (result.lines || []).length + " ligne(s) rédigée(s), " + found + " chiffrée(s) avec vos prix. Relisez tout avant d’envoyer.");
    } catch (err) {
      show(draftNote, err.message || "Rédaction impossible.", true);
    } finally {
      draftBtn.disabled = false;
      draftBtn.textContent = was;
    }
  });

  // ---------------------------------------------------------- enregistrer --
  el("saveBtn").addEventListener("click", async function () {
    show(saveError, ""); show(saveOk, "");
    var usable = lines.filter(function (l) { return String(l.label).trim().length > 1; });
    if (!usable.length) {
      show(saveError, "Ajoutez au moins une prestation avant d’enregistrer.");
      return;
    }
    var btn = el("saveBtn");
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Enregistrement…";
    try {
      var saved = await api.save({
        public_id: current && current.public_id,
        title: el("qTitle").value.trim(),
        client_name: el("qClient").value.trim(),
        client_email: el("qEmail").value.trim(),
        client_address: el("qAddress").value.trim(),
        notes: el("qNotes").value.trim(),
        transcript: current && current.transcript,
        drafted_by_ai: Boolean(current && current.drafted_by_ai),
        vat_rate: Number(el("qVat").value),
        validity_days: Number(el("qValidity").value),
        lines: usable,
      });
      current = Object.assign({}, current, saved);
      show(el("quoteNumber"), saved.number || "");
      saveOk.hidden = false;
      await loadHistory();
    } catch (err) {
      show(saveError, err.message || "Enregistrement impossible.");
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  });

  // ----------------------------------------------------------- impression --
  el("printBtn").addEventListener("click", function () {
    var artisan = store && store.currentArtisan ? store.currentArtisan() : null;
    var t = api.totals({ lines: lines, vat_rate: Number(el("qVat").value) });
    var today = new Date();
    var validity = Number(el("qValidity").value) || 30;
    var until = new Date(today.getTime() + validity * 86400000);
    var fmt = function (d) { return d.toLocaleDateString("fr-FR"); };

    var body = lines
      .filter(function (l) { return String(l.label).trim().length > 1; })
      .map(function (l) {
        return "<tr><td>" + escapeHtml(l.label) +
          (l.detail ? "<br><small>" + escapeHtml(l.detail) + "</small>" : "") +
          "</td><td class='p-num'>" + String(l.quantity).replace(".", ",") + " " + escapeHtml(l.unit) +
          "</td><td class='p-num'>" + euro(l.unit_price_ht) +
          "</td><td class='p-num'>" + euro(lineTotal(l)) + "</td></tr>";
      }).join("");

    el("printArea").innerHTML =
      "<h1>Devis" + (el("quoteNumber").textContent ? " " + escapeHtml(el("quoteNumber").textContent) : "") + "</h1>" +
      "<p class='p-sub'>" + escapeHtml(el("qTitle").value || "") +
      "<br>Établi le " + fmt(today) + " · valable jusqu’au " + fmt(until) + "</p>" +
      "<div class='p-parties'>" +
        "<div><strong>Artisan</strong>" +
          (artisan && artisan.displayName
            ? escapeHtml(artisan.displayName) +
              (artisan.metier ? "<br>" + escapeHtml(artisan.metier) : "") +
              (artisan.ville ? "<br>" + escapeHtml(artisan.ville) : "") +
              (artisan.telephone ? "<br>" + escapeHtml(artisan.telephone) : "") +
              (artisan.email ? "<br>" + escapeHtml(artisan.email) : "")
            : "<em>Vos coordonn\u00e9es n\u2019ont pas \u00e9t\u00e9 trouv\u00e9es : compl\u00e9tez votre fiche " +
              "dans l\u2019espace artisan avant d\u2019envoyer ce devis.</em>") + "</div>" +
        "<div><strong>Client</strong>" + escapeHtml(el("qClient").value || "") +
          (el("qAddress").value ? "<br>" + escapeHtml(el("qAddress").value) : "") +
          (el("qEmail").value ? "<br>" + escapeHtml(el("qEmail").value) : "") + "</div>" +
      "</div>" +
      "<table><thead><tr><th>Prestation</th><th class='p-num'>Qté</th>" +
        "<th class='p-num'>Prix unitaire HT</th><th class='p-num'>Total HT</th></tr></thead>" +
        "<tbody>" + body + "</tbody></table>" +
      "<table class='p-totals'><tbody>" +
        "<tr><td>Total HT</td><td>" + euro(t.ht) + "</td></tr>" +
        "<tr><td>TVA " + String(t.rate).replace(".", ",") + " %</td><td>" + euro(t.tva) + "</td></tr>" +
        "<tr class='p-ttc'><td>Total TTC</td><td>" + euro(t.ttc) + "</td></tr>" +
      "</tbody></table>" +
      (el("qNotes").value ? "<p class='p-notes'>" + escapeHtml(el("qNotes").value).replace(/\n/g, "<br>") + "</p>" : "") +
      "<p class='p-legal'>Devis gratuit et sans engagement. Les prix sont exprimés en euros. " +
        "Ce document ne vaut commande qu’une fois daté, signé et retourné avec la mention « bon pour accord ». " +
        "Mentions obligatoires à compléter par l’artisan : SIRET, assurance de responsabilité civile professionnelle " +
        "et, le cas échéant, garantie décennale avec le nom de l’assureur et la zone couverte.</p>" +
      "<p class='p-sign'>Bon pour accord, le <span></span></p>";

    window.print();
  });

  // ----------------------------------------------------------- historique --
  async function loadHistory() {
    var list = el("historyList"), empty = el("historyEmpty");
    list.textContent = "";
    var quotes;
    try {
      quotes = await api.list();
    } catch (err) {
      show(pageError, err.message || "Lecture des devis impossible.");
      return;
    }
    show(pageError, "");
    el("quoteCount").textContent = quotes.length
      ? quotes.length + (quotes.length > 1 ? " devis" : " devis")
      : "Aucun devis";
    empty.hidden = quotes.length > 0;

    quotes.forEach(function (quote) {
      var t = api.totals(quote);
      var li = document.createElement("li");
      li.className = "dv-item";

      var main = document.createElement("div");
      main.className = "dv-item-main";
      var title = document.createElement("strong");
      title.textContent = quote.title || "Devis sans objet";
      var sub = document.createElement("span");
      var parts = [];
      if (quote.number) parts.push(quote.number);
      if (quote.client_name) parts.push(quote.client_name);
      if (quote.created_at) parts.push(new Date(quote.created_at).toLocaleDateString("fr-FR"));
      if (quote.drafted_by_ai) parts.push("dicté");
      sub.textContent = parts.join(" · ");
      main.appendChild(title);
      main.appendChild(sub);
      li.appendChild(main);

      var sum = document.createElement("span");
      sum.className = "dv-item-sum";
      sum.textContent = euro(t.ttc) + " TTC";
      li.appendChild(sum);

      var actions = document.createElement("div");
      actions.className = "dv-item-actions";
      var open = document.createElement("button");
      open.type = "button"; open.textContent = "Ouvrir";
      open.addEventListener("click", function () { openQuote(quote); });
      var del = document.createElement("button");
      del.type = "button"; del.textContent = "Supprimer"; del.className = "dv-item-del";
      del.addEventListener("click", async function () {
        del.disabled = true;
        try {
          await api.remove(quote.public_id);
          if (current && current.public_id === quote.public_id) {
            panel.hidden = true; current = null; lines = [];
          }
          await loadHistory();
        } catch (err) {
          show(pageError, err.message || "Suppression impossible.");
          del.disabled = false;
        }
      });
      actions.appendChild(open);
      actions.appendChild(del);
      li.appendChild(actions);

      list.appendChild(li);
    });
  }

  // ------------------------------------------------------------ démarrage --
  (async function start() {
    // store.js peut échouer (CDN injoignable, hors ligne) : la page doit rester
    // utilisable en mode local plutôt que de s'arrêter sur un message.
    try {
      if (store && store.ready) await store.ready();
    } catch (e) {
      show(micState, "Mode hors ligne : vos devis restent sur cet appareil.");
    }
    try {
      var artisan = null;
      try {
        artisan = store && store.currentArtisan ? store.currentArtisan() : null;
      } catch (e) {
        artisan = null;
      }
      if (artisan) {
        if (artisan.displayName) el("brandName").textContent = artisan.displayName;
        if (artisan.metier) el("brandMetier").textContent = artisan.metier;
      }
      var logout = el("logout");
      if (logout && store && store.authRequired && !store.authRequired()) logout.hidden = true;
      if (logout) logout.addEventListener("click", function () {
        if (store && store.logout) store.logout();
        window.location.href = "index.html";
      });
      if (!(await api.available())) {
        show(draftNote, "Hors compte cloud : la rédaction par l’IA n’est pas disponible, et les devis restent sur cet appareil. Vous pouvez quand même les créer et les imprimer.");
      }
      await loadHistory();
    } catch (err) {
      show(pageError, err.message || "Chargement impossible.");
    }
  })();
})();
