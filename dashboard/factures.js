(async function () {
  const store = window.DevisStore;
  const F = window.DevisFactures;
  await store.ready();
  store.seedIfEmpty();

  if (!(await store.hasSession())) {
    window.location.href = "./index.html";
    return;
  }

  const $ = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const artisan = store.currentArtisan();
  const artisanId = artisan ? artisan.id : "local";
  let settings = F.readSettings(artisanId, artisan);
  let filter = "tous";
  let draft = null;
  let current = null;

  // ---------- Barre latérale ----------
  const logoutBtn = $("logout");
  if (logoutBtn && !store.authRequired()) logoutBtn.hidden = true;
  if (artisan) {
    $("brandName").textContent = artisan.displayName;
    $("brandMetier").textContent = artisan.ville ? artisan.metier + " · " + artisan.ville : artisan.metier;
    const q = store.artisanQuery(artisan);
    $("linkPage").href = "../page/index.html" + q;
    $("linkWidget").href = "../widget/index.html" + q;
    document.title = artisan.displayName + " — Factures";
  }
  logoutBtn.addEventListener("click", async () => {
    await store.logout();
    window.location.href = "./index.html";
  });

  // ---------- Navigation entre vues ----------
  const views = ["viewList", "viewEditor", "viewDetail", "viewSettings"];
  function show(view) {
    for (const v of views) $(v).hidden = v !== view;
    $("facFilters").hidden = view !== "viewList";
    $("btnNew").hidden = view !== "viewList";
    $("btnSettings").hidden = view !== "viewList";
    window.scrollTo(0, 0);
  }

  function setUrl(params) {
    const url = new URL(window.location.href);
    url.search = "";
    for (const k in params) if (params[k]) url.searchParams.set(k, params[k]);
    history.replaceState(null, "", url);
  }

  function backToList() {
    draft = null;
    current = null;
    setUrl({});
    renderList();
    show("viewList");
  }

  // ---------- Liste ----------
  function badgeFor(status) {
    const cls = { brouillon: "muted", envoyee: "gold", retard: "danger", payee: "ok" }[status] || "muted";
    return '<span class="badge ' + cls + '">' + esc(F.STATUS_LABELS[status] || status) + "</span>";
  }

  function renderList() {
    const k = F.kpis(artisanId);
    $("kpiDue").textContent = F.formatEuro(k.aEncaisser);
    $("kpiLate").textContent = F.formatEuro(k.retard);
    $("kpiLateLabel").textContent = k.nbRetard ? "En retard · " + k.nbRetard + " facture" + (k.nbRetard > 1 ? "s" : "") : "En retard";
    $("kpiPaid").textContent = F.formatEuro(k.encaisse);

    const rows = F.list(artisanId)
      .map((f) => ({ f, s: F.effectiveStatus(f) }))
      .filter(({ s }) => filter === "tous" || s === filter || (filter === "envoyee" && s === "retard"));

    $("facEmpty").hidden = rows.length > 0;
    $("facBody").innerHTML = rows
      .map(({ f, s }) => {
        const t = F.totals(f);
        const late = s === "retard" ? '<span class="fac-late">' + F.daysLate(f.dueDate) + " j de retard</span>" : "";
        return (
          '<tr data-id="' + esc(f.id) + '">' +
          '<td><span class="fac-num' + (f.number ? "" : " is-draft") + '">' + esc(f.number || "Brouillon") + "</span></td>" +
          '<td class="fac-client">' + esc(f.client.name || "—") + "<small>" + esc(f.object || "") + "</small></td>" +
          "<td>" + esc(F.formatDate(f.issueDate)) + "</td>" +
          "<td>" + esc(F.formatDate(f.dueDate)) + late + "</td>" +
          '<td class="num">' + esc(F.formatEuro(t.ttc)) + "</td>" +
          "<td>" + badgeFor(s) + "</td>" +
          '<td class="num"><span class="row-go">›</span></td>' +
          "</tr>"
        );
      })
      .join("");
  }

  $("facBody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) openInvoice(tr.dataset.id);
  });

  $("facFilters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    filter = btn.dataset.filter;
    for (const b of $("facFilters").querySelectorAll(".filter")) b.classList.toggle("is-on", b === btn);
    renderList();
  });

  function openInvoice(id) {
    const f = F.get(artisanId, id);
    if (!f) return backToList();
    if (f.status === "brouillon") openEditor(f);
    else openDetail(f);
  }

  // ---------- Éditeur de brouillon ----------
  function openEditor(inv) {
    draft = JSON.parse(JSON.stringify(inv));
    setUrl({ id: draft.id });
    $("edTitle").textContent = draft.client.name ? "Facture pour " + draft.client.name : "Nouvelle facture";
    $("edKicker").textContent = "Brouillon · pas encore numérotée";
    const lead = draft.leadId ? store.get(draft.leadId) : null;
    $("edLead").hidden = !draft.leadId;
    $("edLead").innerHTML = draft.leadId
      ? 'Créée depuis la demande <a href="fiche-client.html?id=' + encodeURIComponent(draft.leadId) + '">' +
        esc(lead ? [lead.prenom, lead.nom].filter(Boolean).join(" ") || "du client" : "d’origine") +
        "</a>. Vérifiez les montants : ce sont ceux de l’estimation."
      : "";
    $("cName").value = draft.client.name;
    $("cAddress").value = draft.client.address;
    $("cCp").value = draft.client.cp;
    $("cEmail").value = draft.client.email;
    $("fObject").value = draft.object;
    $("fIssue").value = draft.issueDate;
    $("fDue").value = draft.dueDate;
    $("fTva").value = String(draft.tvaRate);
    $("fAcompte").value = draft.acompte ? String(draft.acompte).replace(".", ",") : "";
    $("fNotes").value = draft.notes || "";
    $("edDelete").hidden = !F.get(artisanId, draft.id);
    $("edError").hidden = true;
    renderLines();
    show("viewEditor");
  }

  function readEditor() {
    draft.client = {
      name: $("cName").value.trim(),
      address: $("cAddress").value.trim(),
      cp: $("cCp").value.trim(),
      email: $("cEmail").value.trim(),
      tel: draft.client.tel || "",
    };
    draft.object = $("fObject").value.trim();
    draft.issueDate = $("fIssue").value;
    draft.dueDate = $("fDue").value;
    draft.tvaRate = Number($("fTva").value);
    draft.acompte = F.parseAmount($("fAcompte").value) || 0;
    draft.notes = $("fNotes").value.trim();
    return draft;
  }

  function renderLines() {
    $("lineBody").innerHTML = draft.lines
      .map(
        (l, i) =>
          '<tr data-i="' + i + '">' +
          '<td class="l-label"><input type="text" data-k="label" value="' + esc(l.label) + '" placeholder="Prestation" aria-label="Libellé" />' +
          '<input type="text" data-k="detail" value="' + esc(l.detail) + '" placeholder="Détail (facultatif)" aria-label="Détail" /></td>' +
          '<td class="l-qty"><input class="num" type="text" inputmode="decimal" data-k="qty" value="' + esc(String(l.qty).replace(".", ",")) + '" aria-label="Quantité" /></td>' +
          '<td class="l-unit"><input class="num" type="text" inputmode="decimal" data-k="unitHt" value="' + esc(String(l.unitHt).replace(".", ",")) + '" aria-label="Prix unitaire HT" /></td>' +
          '<td class="num l-total">' + esc(F.formatEuro(F.lineTotal(l))) + "</td>" +
          '<td><button type="button" class="l-del" data-del="' + i + '" aria-label="Supprimer la ligne">×</button></td>' +
          "</tr>"
      )
      .join("");
    renderTotals();
  }

  function renderTotals() {
    readEditor();
    const t = F.totals(draft);
    const rows = [
      ["Total HT", F.formatEuro(t.ht)],
      [t.rate ? "TVA " + String(t.rate * 100).replace(".", ",") + " %" : "TVA", t.rate ? F.formatEuro(t.tva) : "Non applicable"],
      ["Total TTC", F.formatEuro(t.ttc)],
    ];
    if (t.acompte) rows.push(["Acompte reçu", "− " + F.formatEuro(t.acompte)]);
    $("edTotals").innerHTML =
      rows.map(([a, b]) => "<dt>" + esc(a) + "</dt><dd>" + esc(b) + "</dd>").join("") +
      '<dt class="is-strong">Reste à payer</dt><dd class="is-strong">' + esc(F.formatEuro(t.reste)) + "</dd>";
  }

  $("lineBody").addEventListener("input", (e) => {
    const input = e.target.closest("input[data-k]");
    if (!input) return;
    const i = Number(input.closest("tr").dataset.i);
    const k = input.dataset.k;
    draft.lines[i][k] = k === "qty" || k === "unitHt" ? input.value : input.value;
    const cell = input.closest("tr").querySelector(".l-total");
    if (cell) cell.textContent = F.formatEuro(F.lineTotal(draft.lines[i]));
    renderTotals();
  });

  $("lineBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    draft.lines.splice(Number(btn.dataset.del), 1);
    if (!draft.lines.length) draft.lines.push({ label: "", detail: "", qty: 1, unitHt: 0 });
    renderLines();
  });

  $("addLine").addEventListener("click", () => {
    draft.lines.push({ label: "", detail: "", qty: 1, unitHt: 0 });
    renderLines();
    const inputs = $("lineBody").querySelectorAll('input[data-k="label"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  for (const id of ["fTva", "fAcompte", "fIssue", "fDue", "cName", "fObject"]) {
    $(id).addEventListener("input", renderTotals);
  }

  function normalizedLines() {
    return draft.lines.map((l) => ({
      label: String(l.label || "").trim(),
      detail: String(l.detail || "").trim(),
      qty: F.parseAmount(l.qty) == null ? l.qty : F.parseAmount(l.qty),
      unitHt: F.parseAmount(l.unitHt) == null ? l.unitHt : F.parseAmount(l.unitHt),
    }));
  }

  function editorError(err) {
    $("edError").hidden = false;
    $("edError").textContent = (err && err.message) || "Action impossible.";
  }

  $("edSave").addEventListener("click", () => {
    try {
      readEditor();
      draft.lines = normalizedLines();
      F.saveDraft(artisanId, draft);
      backToList();
    } catch (err) {
      editorError(err);
    }
  });

  $("edValidate").addEventListener("click", () => {
    try {
      readEditor();
      draft.lines = normalizedLines();
      const t = F.totals(draft);
      const ok = window.confirm(
        "Valider la facture de " + F.formatEuro(t.ttc) + " TTC pour " + (draft.client.name || "ce client") +
          " ?\n\nElle recevra son numéro définitif et ne pourra plus être modifiée."
      );
      if (!ok) return;
      const saved = F.validate(artisanId, draft);
      if (saved.leadId && store.addEvent) {
        store.addEvent(saved.leadId, "Facture " + saved.number + " émise (" + F.formatEuro(t.ttc) + " TTC)", "note").catch(() => {});
      }
      openDetail(saved);
    } catch (err) {
      editorError(err);
    }
  });

  $("edDelete").addEventListener("click", () => {
    if (!window.confirm("Supprimer ce brouillon ?")) return;
    try {
      F.removeDraft(artisanId, draft.id);
      backToList();
    } catch (err) {
      editorError(err);
    }
  });

  $("edPreview").addEventListener("click", () => {
    readEditor();
    printInvoice(Object.assign({}, draft, { lines: normalizedLines() }));
  });

  $("edClose").addEventListener("click", backToList);

  // ---------- Détail d'une facture validée ----------
  function openDetail(f) {
    current = f;
    setUrl({ id: f.id });
    const s = F.effectiveStatus(f);
    const t = F.totals(f);
    $("dtKicker").innerHTML = badgeFor(s);
    $("dtTitle").textContent = f.number + " · " + (f.client.name || "Client");
    $("dtMeta").textContent =
      "Émise le " + F.formatDate(f.issueDate) + " · échéance " + F.formatDate(f.dueDate) +
      " · " + F.formatEuro(t.ttc) + " TTC" + (s === "payee" && f.paidAt ? " · payée le " + F.formatDate(f.paidAt) : "");

    const ev = F.evaluateReminder(f);
    $("dtReminder").hidden = !ev;
    $("dtRemind").hidden = !ev;
    if (ev) {
      $("dtReminder").textContent =
        "Impayée depuis " + ev.daysLate + " jour" + (ev.daysLate > 1 ? "s" : "") + ". Prochaine étape : " +
        ev.level.label.toLowerCase() + (ev.alreadySent ? " (déjà envoyée)." : ".");
      $("dtRemind").textContent = ev.alreadySent ? "Renvoyer la relance" : ev.level.label;
    }
    $("dtPaid").textContent = s === "payee" ? "Annuler le paiement" : "Marquer comme payée";
    $("dtMail").hidden = s === "payee" || !f.client.email;
    $("dtSheet").innerHTML = sheetHtml(f);
    show("viewDetail");
  }

  $("dtClose").addEventListener("click", backToList);
  $("dtPrint").addEventListener("click", () => current && printInvoice(current));

  $("dtPaid").addEventListener("click", () => {
    if (!current) return;
    const next = current.status === "payee" ? F.markUnpaid(artisanId, current.id) : F.markPaid(artisanId, current.id);
    if (next.status === "payee" && next.leadId && store.addEvent) {
      store.addEvent(next.leadId, "Facture " + next.number + " payée", "note").catch(() => {});
    }
    openDetail(next);
  });

  function mailto(to, subject, body) {
    window.location.href =
      "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  $("dtMail").addEventListener("click", () => {
    if (!current) return;
    const t = F.totals(current);
    const body =
      "Bonjour " + current.client.name + ",\n\n" +
      "Veuillez trouver ci-jointe la facture " + current.number + " d’un montant de " + F.formatEuro(t.reste) +
      ", à régler avant le " + F.formatDate(current.dueDate) + "." +
      (settings.paymentInfo ? "\n\nRèglement : " + settings.paymentInfo : "") +
      "\n\nMerci pour votre confiance,\n" + (settings.legalName || "");
    mailto(current.client.email, "Facture " + current.number, body);
  });

  $("dtRemind").addEventListener("click", () => {
    if (!current) return;
    const ev = F.evaluateReminder(current);
    if (!ev) return;
    const mail = F.buildReminder(current, ev, settings);
    current = F.recordReminder(artisanId, current.id, ev.level.level);
    if (current.client.email) mailto(current.client.email, mail.subject, mail.text);
    else window.alert(mail.subject + "\n\n" + mail.text);
    openDetail(current);
  });

  // ---------- Feuille de facture ----------
  function sheetHtml(f) {
    const t = F.totals(f);
    const s = settings;
    const company = [
      s.address,
      s.siret ? "SIRET " + s.siret : "",
      s.tvaNumber && !s.franchiseTva ? "TVA " + s.tvaNumber : "",
      [s.phone, s.email].filter(Boolean).join(" · "),
    ]
      .filter(Boolean)
      .map(esc)
      .join("<br />");
    const lines = (f.lines || [])
      .filter((l) => String(l.label || "").trim())
      .map(
        (l) =>
          "<tr><td>" + esc(l.label) + (l.detail ? "<small>" + esc(l.detail) + "</small>" : "") + "</td>" +
          '<td class="num">' + esc(String(F.parseAmount(l.qty) ?? l.qty).replace(".", ",")) + "</td>" +
          '<td class="num">' + esc(F.formatEuro(F.parseAmount(l.unitHt) || 0)) + "</td>" +
          '<td class="num">' + esc(F.formatEuro(F.lineTotal(l))) + "</td></tr>"
      )
      .join("");
    const tvaLine = t.rate
      ? "<dt>TVA " + esc(String(t.rate * 100).replace(".", ",")) + " %</dt><dd>" + esc(F.formatEuro(t.tva)) + "</dd>"
      : "<dt>TVA</dt><dd>0,00 €</dd>";
    const acompte = t.acompte ? "<dt>Acompte reçu</dt><dd>− " + esc(F.formatEuro(t.acompte)) + "</dd>" : "";
    const legal = [
      !t.rate && s.franchiseTva ? "TVA non applicable, art. 293 B du CGI." : "",
      "Paiement à réception, au plus tard le " + F.formatDate(f.dueDate) + ". Pas d’escompte pour paiement anticipé.",
      "En cas de retard de paiement : pénalités au taux légal en vigueur et, pour les professionnels, indemnité forfaitaire de 40 € pour frais de recouvrement (art. L441-10 du Code de commerce).",
    ]
      .filter(Boolean)
      .map(esc)
      .join("<br />");
    return (
      '<article class="fac-sheet">' +
      '<header class="fs-head"><div class="fs-brand"><div class="bolt" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 10-14h-7l0-6z"/></svg></div>' +
      "<div><strong>" + esc(s.legalName || "Votre entreprise") + '</strong><span class="fs-muted">' + company + "</span></div></div>" +
      '<div class="fs-meta"><h2>Facture</h2><div><strong>' + esc(f.number || "BROUILLON") + "</strong></div>" +
      '<div class="fs-muted">Émise le ' + esc(F.formatDate(f.issueDate)) + "<br />Échéance " + esc(F.formatDate(f.dueDate)) + "</div></div></header>" +
      '<section class="fs-parties"><div></div><div><p class="fs-label">Facturé à</p><strong>' + esc(f.client.name) + "</strong><br />" +
      esc(f.client.address) + (f.client.cp && f.client.address.indexOf(f.client.cp) < 0 ? " " + esc(f.client.cp) : "") +
      (f.client.email ? "<br />" + esc(f.client.email) : "") + "</div></section>" +
      (f.object ? '<p class="fs-object">Objet : ' + esc(f.object) + "</p>" : "") +
      '<table class="fs-table"><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">Total HT</th></tr></thead><tbody>' +
      lines + "</tbody></table>" +
      '<dl class="fs-totals"><dt>Total HT</dt><dd>' + esc(F.formatEuro(t.ht)) + "</dd>" + tvaLine +
      "<dt>Total TTC</dt><dd>" + esc(F.formatEuro(t.ttc)) + "</dd>" + acompte +
      '<dt class="is-strong">Net à payer</dt><dd class="is-strong">' + esc(F.formatEuro(t.reste)) + "</dd></dl>" +
      (s.paymentInfo ? '<div class="fs-pay"><p class="fs-label">Règlement</p>' + esc(s.paymentInfo) + "</div>" : "") +
      (f.notes ? '<p class="fs-pay">' + esc(f.notes) + "</p>" : "") +
      '<p class="fs-legal">' + legal + "</p>" +
      "</article>"
    );
  }

  function printInvoice(f) {
    $("printArea").innerHTML = sheetHtml(f);
    document.body.classList.add("printing");
    const done = () => {
      document.body.classList.remove("printing");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    const prevTitle = document.title;
    document.title = f.number || "Facture-brouillon";
    window.print();
    document.title = prevTitle;
    setTimeout(done, 1000);
  }

  // ---------- Paramètres ----------
  function openSettings() {
    $("sName").value = settings.legalName;
    $("sSiret").value = settings.siret;
    $("sAddress").value = settings.address;
    $("sEmail").value = settings.email;
    $("sPhone").value = settings.phone;
    $("sTvaNum").value = settings.tvaNumber;
    $("sFranchise").checked = settings.franchiseTva;
    $("sDays").value = settings.paymentDays;
    $("sPay").value = settings.paymentInfo;
    $("stError").hidden = true;
    $("stOk").hidden = true;
    show("viewSettings");
  }

  $("btnSettings").addEventListener("click", openSettings);
  $("stClose").addEventListener("click", backToList);
  $("stSave").addEventListener("click", () => {
    $("stError").hidden = true;
    $("stOk").hidden = true;
    const siret = $("sSiret").value.replace(/\s/g, "");
    if (siret && !/^\d{14}$/.test(siret)) {
      $("stError").hidden = false;
      $("stError").textContent = "Le SIRET compte 14 chiffres.";
      return;
    }
    try {
      settings = F.saveSettings(artisanId, {
        legalName: $("sName").value.trim(),
        siret: $("sSiret").value.trim(),
        address: $("sAddress").value.trim(),
        email: $("sEmail").value.trim(),
        phone: $("sPhone").value.trim(),
        tvaNumber: $("sTvaNum").value.trim(),
        franchiseTva: $("sFranchise").checked,
        paymentDays: $("sDays").value,
        paymentInfo: $("sPay").value.trim(),
      });
      $("stOk").hidden = false;
    } catch (err) {
      $("stError").hidden = false;
      $("stError").textContent = err.message;
    }
  });

  // ---------- Nouvelle facture ----------
  $("btnNew").addEventListener("click", () => openEditor(F.blankInvoice(settings)));

  // ---------- Démarrage ----------
  const params = new URLSearchParams(location.search);
  const fromLead = params.get("from");
  const openId = params.get("id");
  renderList();
  if (fromLead) {
    const lead = store.get(fromLead);
    if (lead) {
      const existing = F.forLead(artisanId, lead.id).find((f) => f.status === "brouillon");
      openEditor(existing || F.fromLead(lead, settings));
    } else {
      backToList();
    }
  } else if (openId && F.get(artisanId, openId)) {
    openInvoice(openId);
  } else {
    show("viewList");
  }
})();
