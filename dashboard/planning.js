/* Planning : affichage par semaine, création et modification d'un événement. */
(function () {
  "use strict";

  var store = window.DevisStore;
  var api = window.DevisPlanning;
  var el = function (id) { return document.getElementById(id); };

  var JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

  var state = { monday: api.weekStart(new Date()), events: [], leads: [], members: [], editing: null };

  function show(node, message) {
    if (!node) return;
    if (!message) { node.hidden = true; node.textContent = ""; return; }
    node.textContent = message;
    node.hidden = false;
  }

  function heure(date) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  // ------------------------------------------------------- en-tête semaine --
  function renderLabel() {
    var a = state.monday, b = api.addDays(a, 6);
    var mois = { month: "long" };
    var texte;
    if (a.getMonth() === b.getMonth()) {
      texte = a.getDate() + " – " + b.getDate() + " " + a.toLocaleDateString("fr-FR", mois) + " " + a.getFullYear();
    } else {
      texte = a.getDate() + " " + a.toLocaleDateString("fr-FR", mois) + " – " +
              b.getDate() + " " + b.toLocaleDateString("fr-FR", mois) + " " + b.getFullYear();
    }
    el("weekLabel").textContent = texte.charAt(0).toUpperCase() + texte.slice(1);
  }

  // ------------------------------------------------------------- semaine ---
  function renderWeek() {
    var week = el("week");
    week.textContent = "";
    var today = new Date();
    var total = 0;

    for (var i = 0; i < 7; i++) {
      var day = api.addDays(state.monday, i);
      var dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      var dayEnd = api.addDays(dayStart, 1);

      var box = document.createElement("div");
      box.className = "pl-day";
      if (api.sameDay(day, today)) box.classList.add("is-today");
      if (i >= 5) box.classList.add("is-weekend");

      var head = document.createElement("div");
      head.className = "pl-day-head";
      var name = document.createElement("span");
      name.className = "pl-day-name";
      name.textContent = JOURS[i];
      var num = document.createElement("span");
      num.className = "pl-day-num";
      num.textContent = day.getDate();
      head.appendChild(name);
      head.appendChild(num);
      box.appendChild(head);

      // Un chantier sur trois jours apparaît sur les trois.
      var ofDay = state.events.filter(function (e) {
        return new Date(e.starts_at) < dayEnd && new Date(e.ends_at) >= dayStart;
      }).sort(function (a, b) {
        return new Date(a.starts_at) - new Date(b.starts_at);
      });
      total += ofDay.length;
      if (!ofDay.length) box.classList.add("is-empty");

      ofDay.forEach(function (ev) {
        box.appendChild(eventButton(ev, dayStart, dayEnd));
      });

      var add = document.createElement("button");
      add.type = "button";
      add.className = "pl-add-day";
      add.textContent = "+";
      add.title = "Ajouter le " + day.toLocaleDateString("fr-FR");
      add.setAttribute("aria-label", "Ajouter un événement le " + day.toLocaleDateString("fr-FR"));
      (function (d) {
        add.addEventListener("click", function () { openModal(null, d); });
      })(day);
      box.appendChild(add);

      week.appendChild(box);
    }
    el("weekEmpty").hidden = total > 0;
  }

  function eventButton(ev, dayStart, dayEnd) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pl-ev k-" + ev.kind + (ev.status === "annule" ? " is-annule" : "");

    var starts = new Date(ev.starts_at), ends = new Date(ev.ends_at);
    var commenceAvant = starts < dayStart;
    var finitApres = ends >= dayEnd;

    var time = document.createElement("div");
    time.className = "pl-ev-time";
    if (ev.all_day) {
      time.textContent = "Journée";
    } else if (commenceAvant && finitApres) {
      time.textContent = "Toute la journée";
    } else if (commenceAvant) {
      time.textContent = "jusqu’à " + heure(ends);
    } else if (finitApres) {
      time.textContent = "dès " + heure(starts);
    } else {
      time.textContent = heure(starts) + " – " + heure(ends);
    }
    btn.appendChild(time);

    var title = document.createElement("div");
    title.className = "pl-ev-title";
    title.textContent = ev.title;
    btn.appendChild(title);

    var bits = [];
    if (ev.member_id) {
      var m = state.members.filter(function (x) { return x.id === ev.member_id; })[0];
      if (m) bits.push(m.label);
    }
    if (ev.lead_id) {
      var l = state.leads.filter(function (x) { return x.id === ev.lead_id; })[0];
      if (l) bits.push(l.label);
    }
    if (ev.status !== "prevu") bits.push(api.statusLabel(ev.status).toLowerCase());
    if (bits.length) {
      var who = document.createElement("div");
      who.className = "pl-ev-who";
      who.textContent = bits.join(" · ");
      btn.appendChild(who);
    }

    if (commenceAvant || finitApres) {
      var cont = document.createElement("div");
      cont.className = "pl-ev-cont";
      cont.textContent = commenceAvant && finitApres ? "en cours" : (commenceAvant ? "suite" : "début");
      btn.appendChild(cont);
    }

    btn.addEventListener("click", function () { openModal(ev); });
    return btn;
  }

  // --------------------------------------------------------------- fiche ---
  function fillSelect(select, items, keep) {
    select.textContent = "";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = select.id === "fLead" ? "— aucun —" : "— personne —";
    select.appendChild(none);
    items.forEach(function (it) {
      var opt = document.createElement("option");
      opt.value = String(it.id);
      opt.textContent = it.ville ? it.label + " (" + it.ville + ")" : it.label;
      if (keep != null && String(keep) === String(it.id)) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function openModal(ev, day) {
    state.editing = ev || null;
    show(el("formError"), "");
    el("modalTitle").textContent = ev ? "Modifier l’événement" : "Nouvel événement";
    el("deleteBtn").hidden = !ev;

    var start, end;
    if (ev) {
      start = new Date(ev.starts_at);
      end = new Date(ev.ends_at);
    } else {
      var base = day || new Date();
      start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 9, 0);
      end = new Date(start.getTime() + 3600000);
    }

    el("fTitle").value = ev ? ev.title : "";
    el("fKind").value = ev ? ev.kind : "rdv";
    el("fStatus").value = ev ? ev.status : "prevu";
    el("fStart").value = api.toInputValue(start);
    el("fEnd").value = api.toInputValue(end);
    el("fAllDay").checked = ev ? Boolean(ev.all_day) : false;
    el("fLocation").value = ev ? (ev.location || "") : "";
    el("fNotes").value = ev ? (ev.notes || "") : "";
    fillSelect(el("fLead"), state.leads, ev ? ev.lead_id : null);
    fillSelect(el("fMember"), state.members, ev ? ev.member_id : null);

    el("modal").hidden = false;
    el("fTitle").focus();
  }

  function closeModal() {
    el("modal").hidden = true;
    state.editing = null;
  }

  el("cancelBtn").addEventListener("click", closeModal);
  el("modal").addEventListener("click", function (e) {
    if (e.target === el("modal")) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !el("modal").hidden) closeModal();
  });

  // Quand on avance l'heure de début, la fin suit, pour garder la durée.
  el("fStart").addEventListener("change", function () {
    var s = new Date(el("fStart").value);
    var e = new Date(el("fEnd").value);
    if (isNaN(s)) return;
    if (isNaN(e) || e <= s) {
      el("fEnd").value = api.toInputValue(new Date(s.getTime() + 3600000));
    }
  });

  el("fAllDay").addEventListener("change", function () {
    if (!el("fAllDay").checked) return;
    var s = new Date(el("fStart").value);
    if (isNaN(s)) return;
    var debut = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 8, 0);
    var fin = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 18, 0);
    el("fStart").value = api.toInputValue(debut);
    el("fEnd").value = api.toInputValue(fin);
  });

  // Choisir un client remplit l'adresse si elle est vide.
  el("fLead").addEventListener("change", function () {
    if (el("fLocation").value.trim()) return;
    var l = state.leads.filter(function (x) { return String(x.id) === el("fLead").value; })[0];
    if (l && l.adresse) el("fLocation").value = l.adresse;
  });

  el("saveBtn").addEventListener("click", async function () {
    show(el("formError"), "");
    var btn = el("saveBtn");
    btn.disabled = true;
    try {
      await api.save({
        public_id: state.editing ? state.editing.public_id : null,
        title: el("fTitle").value,
        kind: el("fKind").value,
        status: el("fStatus").value,
        starts_at: new Date(el("fStart").value).toISOString(),
        ends_at: new Date(el("fEnd").value).toISOString(),
        all_day: el("fAllDay").checked,
        location: el("fLocation").value,
        notes: el("fNotes").value,
        lead_id: el("fLead").value ? Number(el("fLead").value) : null,
        member_id: el("fMember").value ? Number(el("fMember").value) : null,
      });
      closeModal();
      await loadWeek();
    } catch (err) {
      show(el("formError"), err.message || "Enregistrement impossible.");
    } finally {
      btn.disabled = false;
    }
  });

  el("deleteBtn").addEventListener("click", async function () {
    if (!state.editing) return;
    var btn = el("deleteBtn");
    btn.disabled = true;
    try {
      await api.remove(state.editing.public_id);
      closeModal();
      await loadWeek();
    } catch (err) {
      show(el("formError"), err.message || "Suppression impossible.");
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------- navigation ---
  el("prevWeek").addEventListener("click", function () {
    state.monday = api.addDays(state.monday, -7);
    loadWeek();
  });
  el("nextWeek").addEventListener("click", function () {
    state.monday = api.addDays(state.monday, 7);
    loadWeek();
  });
  el("today").addEventListener("click", function () {
    state.monday = api.weekStart(new Date());
    loadWeek();
  });
  el("addBtn").addEventListener("click", function () { openModal(null, new Date()); });

  async function loadWeek() {
    renderLabel();
    var from = state.monday;
    var to = api.addDays(state.monday, 7);
    try {
      state.events = await api.range(from, to);
      show(el("pageError"), "");
    } catch (err) {
      state.events = [];
      show(el("pageError"), err.message || "Lecture du planning impossible.");
    }
    renderWeek();
  }

  // ---------------------------------------------------------- démarrage ----
  (async function start() {
    el("fKind").textContent = "";
    api.kinds.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k.value; o.textContent = k.label;
      el("fKind").appendChild(o);
    });
    el("fStatus").textContent = "";
    api.statuses.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.value; o.textContent = s.label;
      el("fStatus").appendChild(o);
    });

    try {
      if (store && store.ready) await store.ready();
    } catch (e) { /* hors ligne : le planning local fonctionne quand même */ }
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

    if (!(await api.available())) {
      show(el("pageNote"),
        "Hors compte cloud : le planning reste sur cet appareil, et la liste de l’équipe n’est pas disponible. Tout le reste fonctionne.");
    }

    try {
      state.leads = await api.leads();
      state.members = await api.members();
    } catch (e) {
      state.leads = []; state.members = [];
    }
    await loadWeek();
  })();
})();
