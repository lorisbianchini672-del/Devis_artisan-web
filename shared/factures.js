// ============================================================
// shared/factures.js — Facturation intégrée (moteur PayFlow / IZI)
// ------------------------------------------------------------
// Reprend la logique métier d'IZI-Facture côté navigateur :
//   • montants arrondis au centime à chaque ligne (lib/money.js) ;
//   • brouillon sans numéro, numéro définitif FAC-AAAA-NNNN attribué
//     à la validation, sans trou ni doublon ;
//   • une facture validée n'est plus modifiable ni supprimable ;
//   • relances en trois niveaux J+1 / J+7 / J+15 (lib/reminders.js).
// Les factures sont rangées par artisan dans ce navigateur.
// ============================================================
(function (global) {
  "use strict";

  const KEY_INVOICES = "dv_factures_v1:";
  const KEY_SETTINGS = "dv_factures_settings_v1:";
  const MAX_AMOUNT = 1000000000;
  const TVA_RATES = [0.2, 0.1, 0.055, 0];

  const FR = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function parseAmount(value) {
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT) return null;
      return round2(value);
    }
    if (typeof value !== "string") return null;
    const raw = value.trim();
    if (!raw || /[a-z]/i.test(raw)) return null;
    let cleaned = raw.replace(/[^\d.,+-]/g, "");
    if (!/[0-9]/.test(cleaned)) return null;
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? "." : ",";
      const thousands = dec === "." ? "," : ".";
      cleaned = cleaned.split(thousands).join("");
      if (dec === ",") cleaned = cleaned.replace(",", ".");
    } else if (lastComma >= 0) {
      if ((cleaned.match(/,/g) || []).length > 1) return null;
      cleaned = cleaned.replace(",", ".");
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n) || Math.abs(n) > MAX_AMOUNT) return null;
    return round2(n);
  }

  function formatEuro(value) {
    return FR.format(round2(Number(value) || 0)) + " €";
  }

  function todayIso(now) {
    const d = now || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function addDaysIso(iso, days) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + days);
    return todayIso(d);
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso + "T12:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function uid() {
    return "fac_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function safeRead(key, fallback) {
    try {
      const raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- Calculs ----------

  function lineTotal(line) {
    const qty = parseAmount(line.qty);
    const unit = parseAmount(line.unitHt);
    return round2((qty == null ? 0 : qty) * (unit == null ? 0 : unit));
  }

  function totals(invoice) {
    const ht = round2((invoice.lines || []).reduce((sum, l) => sum + lineTotal(l), 0));
    const rate = TVA_RATES.includes(Number(invoice.tvaRate)) ? Number(invoice.tvaRate) : 0.2;
    const tva = round2(ht * rate);
    const acompte = Math.max(0, parseAmount(invoice.acompte) || 0);
    const ttc = round2(ht + tva);
    return { ht, tva, ttc, acompte, reste: round2(Math.max(0, ttc - acompte)), rate };
  }

  // ---------- Statut et relances (repris de lib/reminders.js) ----------

  function daysLate(dueDate, now) {
    if (!dueDate) return 0;
    const due = new Date(dueDate + "T00:00:00");
    if (Number.isNaN(due.getTime())) return 0;
    const ref = now || new Date();
    const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    return Math.floor((today.getTime() - due.getTime()) / 86400000);
  }

  function effectiveStatus(invoice, now) {
    if (invoice.status === "envoyee" && daysLate(invoice.dueDate, now) >= 1) return "retard";
    return invoice.status || "brouillon";
  }

  const STATUS_LABELS = {
    brouillon: "Brouillon",
    envoyee: "Envoyée",
    retard: "En retard",
    payee: "Payée",
  };

  const LEVELS = [
    { level: "courtoise", minDaysLate: 1, tone: "friendly", label: "Relance courtoise" },
    { level: "ferme", minDaysLate: 7, tone: "firm", label: "Relance ferme" },
    { level: "avant-mise-en-demeure", minDaysLate: 15, tone: "final", label: "Dernier rappel" },
  ];

  function evaluateReminder(invoice, now) {
    const status = effectiveStatus(invoice, now);
    if (status !== "retard") return null;
    const late = daysLate(invoice.dueDate, now);
    let matched = null;
    for (const l of LEVELS) if (late >= l.minDaysLate) matched = l;
    if (!matched) return null;
    const sent = invoice.remindersSent || [];
    return { level: matched, daysLate: late, alreadySent: sent.includes(matched.level) };
  }

  function buildReminder(invoice, evaluation, settings) {
    const number = invoice.number;
    const client = invoice.client && invoice.client.name ? invoice.client.name : "";
    const due = formatDate(invoice.dueDate);
    const total = formatEuro(totals(invoice).reste);
    const late = evaluation.daysLate;
    const templates = {
      friendly: {
        subject: "Rappel : facture " + number + " arrivée à échéance",
        intro: "Sauf erreur de notre part, la facture " + number + " arrivée à échéance le " + due + " semble ne pas encore être réglée.",
        closing: "Il s’agit probablement d’un simple oubli — merci de procéder au règlement dès que possible.",
      },
      firm: {
        subject: "Relance — facture " + number + " en retard de " + late + " jours",
        intro: "Malgré notre précédent rappel, la facture " + number + " d’un montant de " + total + " reste impayée à ce jour (" + late + " jours de retard).",
        closing: "Nous vous rappelons que conformément à l’article L441-10 du Code de commerce, tout retard de paiement entraîne des pénalités au taux légal ainsi qu’une indemnité forfaitaire de 40 € pour frais de recouvrement.",
      },
      final: {
        subject: "Dernier rappel avant mise en demeure — facture " + number,
        intro: "La facture " + number + " d’un montant de " + total + " est impayée depuis " + late + " jours, malgré nos relances précédentes.",
        closing: "Sans règlement sous 8 jours, nous engagerons une procédure de recouvrement avec mise en demeure formelle.",
      },
    };
    const t = templates[evaluation.level.tone] || templates.friendly;
    const company = (settings && settings.legalName) || "";
    const pay = settings && settings.paymentInfo ? "\n\nRèglement : " + settings.paymentInfo : "";
    return {
      subject: t.subject,
      text: "Bonjour " + client + ",\n\n" + t.intro + "\n\n" + t.closing + pay + "\n\nCordialement,\n" + company,
    };
  }

  // ---------- Stockage ----------

  function artisanKey(artisanId) {
    return String(artisanId || "local");
  }

  function list(artisanId) {
    const rows = safeRead(KEY_INVOICES + artisanKey(artisanId), []);
    return Array.isArray(rows) ? rows : [];
  }

  function writeList(artisanId, rows) {
    if (!safeWrite(KEY_INVOICES + artisanKey(artisanId), rows)) {
      throw new Error("Impossible d’enregistrer la facture dans ce navigateur.");
    }
  }

  function get(artisanId, id) {
    return list(artisanId).find((f) => f.id === id) || null;
  }

  function readSettings(artisanId, artisan) {
    const saved = safeRead(KEY_SETTINGS + artisanKey(artisanId), null);
    const base = {
      legalName: artisan ? artisan.displayName || "" : "",
      siret: "",
      address: artisan && artisan.ville ? artisan.ville : "",
      email: artisan ? artisan.email || "" : "",
      phone: "",
      tvaNumber: "",
      franchiseTva: false,
      paymentDays: 30,
      paymentInfo: "",
    };
    return Object.assign(base, saved || {});
  }

  function saveSettings(artisanId, settings) {
    const days = Math.round(Number(settings.paymentDays));
    const clean = Object.assign({}, settings, {
      paymentDays: Number.isFinite(days) && days >= 0 && days <= 60 ? days : 30,
      franchiseTva: Boolean(settings.franchiseTva),
    });
    if (!safeWrite(KEY_SETTINGS + artisanKey(artisanId), clean)) {
      throw new Error("Impossible d’enregistrer vos informations.");
    }
    return clean;
  }

  function nextNumber(artisanId, year) {
    const prefix = "FAC-" + year + "-";
    let max = 0;
    for (const f of list(artisanId)) {
      if (f.number && f.number.indexOf(prefix) === 0) {
        const n = parseInt(f.number.slice(prefix.length), 10);
        if (n > max) max = n;
      }
    }
    return prefix + String(max + 1).padStart(4, "0");
  }

  function blankInvoice(settings) {
    const issue = todayIso();
    return {
      id: uid(),
      number: "",
      status: "brouillon",
      leadId: "",
      client: { name: "", address: "", cp: "", email: "", tel: "" },
      issueDate: issue,
      dueDate: addDaysIso(issue, settings ? settings.paymentDays : 30),
      object: "",
      lines: [{ label: "", detail: "", qty: 1, unitHt: 0 }],
      tvaRate: settings && settings.franchiseTva ? 0 : 0.1,
      acompte: 0,
      notes: "",
      remindersSent: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function fromLead(lead, settings) {
    const inv = blankInvoice(settings);
    inv.leadId = lead.id;
    inv.client = {
      name: [lead.prenom, lead.nom].filter(Boolean).join(" "),
      address: [lead.adresse, lead.ville].filter(Boolean).join(", "),
      cp: lead.cp || "",
      email: lead.email || "",
      tel: lead.tel || "",
    };
    const est = lead.estimate;
    inv.object = (est && est.titrePredevis) || (lead.details ? String(lead.details).slice(0, 90) : "Travaux");
    const lines = est && Array.isArray(est.prestations) ? est.prestations : [];
    if (lines.length) {
      inv.lines = lines.map((p) => ({
        label: p.label || "Prestation",
        detail: p.detail || "",
        qty: 1,
        unitHt: round2(Number(p.amount) || 0),
      }));
    } else {
      inv.lines = [{ label: inv.object, detail: "", qty: 1, unitHt: round2(Number(lead.prixReelHt) || 0) }];
    }
    return inv;
  }

  function validateDraft(inv) {
    if (!inv.client || !String(inv.client.name || "").trim()) throw new Error("Indiquez le nom du client.");
    const lines = (inv.lines || []).filter((l) => String(l.label || "").trim());
    if (!lines.length) throw new Error("Ajoutez au moins une ligne avec un libellé.");
    for (const l of lines) {
      if (parseAmount(l.qty) == null || parseAmount(l.qty) <= 0) throw new Error("Quantité invalide sur « " + l.label + " ».");
      if (parseAmount(l.unitHt) == null || parseAmount(l.unitHt) < 0) throw new Error("Prix invalide sur « " + l.label + " ».");
    }
    if (!inv.issueDate) throw new Error("Indiquez la date d’émission.");
    if (!inv.dueDate || inv.dueDate < inv.issueDate) throw new Error("L’échéance doit être après la date d’émission.");
    return lines;
  }

  function saveDraft(artisanId, inv) {
    const rows = list(artisanId);
    const idx = rows.findIndex((f) => f.id === inv.id);
    if (idx >= 0 && rows[idx].status !== "brouillon") {
      throw new Error("Une facture validée ne se modifie plus..");
    }
    const next = Object.assign({}, inv, { status: "brouillon", number: "", updatedAt: Date.now() });
    if (idx >= 0) rows[idx] = next;
    else rows.unshift(next);
    writeList(artisanId, rows);
    return next;
  }

  function validate(artisanId, inv) {
    const lines = validateDraft(inv);
    const year = String(inv.issueDate).slice(0, 4);
    const rows = list(artisanId);
    const idx = rows.findIndex((f) => f.id === inv.id);
    if (idx >= 0 && rows[idx].status !== "brouillon") throw new Error("Cette facture est déjà validée.");
    const next = Object.assign({}, inv, {
      lines,
      status: "envoyee",
      number: nextNumber(artisanId, year),
      validatedAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (idx >= 0) rows[idx] = next;
    else rows.unshift(next);
    writeList(artisanId, rows);
    return next;
  }

  function patch(artisanId, id, changes) {
    const rows = list(artisanId);
    const idx = rows.findIndex((f) => f.id === id);
    if (idx < 0) throw new Error("Facture introuvable.");
    rows[idx] = Object.assign({}, rows[idx], changes, { updatedAt: Date.now() });
    writeList(artisanId, rows);
    return rows[idx];
  }

  function markPaid(artisanId, id) {
    const f = get(artisanId, id);
    if (!f || f.status === "brouillon") throw new Error("Validez d’abord la facture.");
    return patch(artisanId, id, { status: "payee", paidAt: todayIso() });
  }

  function markUnpaid(artisanId, id) {
    return patch(artisanId, id, { status: "envoyee", paidAt: "" });
  }

  function recordReminder(artisanId, id, level) {
    const f = get(artisanId, id);
    const sent = (f && f.remindersSent) || [];
    return patch(artisanId, id, { remindersSent: sent.includes(level) ? sent : sent.concat(level) });
  }

  function removeDraft(artisanId, id) {
    const rows = list(artisanId);
    const f = rows.find((r) => r.id === id);
    if (!f) return;
    if (f.status !== "brouillon") throw new Error("Une facture numérotée ne peut pas être supprimée.");
    writeList(artisanId, rows.filter((r) => r.id !== id));
  }

  function forLead(artisanId, leadId) {
    return list(artisanId).filter((f) => f.leadId === leadId);
  }

  function kpis(artisanId, now) {
    const out = { aEncaisser: 0, retard: 0, encaisse: 0, brouillons: 0, nbRetard: 0 };
    for (const f of list(artisanId)) {
      const s = effectiveStatus(f, now);
      const t = totals(f);
      if (s === "brouillon") out.brouillons += 1;
      else if (s === "payee") out.encaisse = round2(out.encaisse + t.ttc);
      else {
        out.aEncaisser = round2(out.aEncaisser + t.reste);
        if (s === "retard") {
          out.retard = round2(out.retard + t.reste);
          out.nbRetard += 1;
        }
      }
    }
    return out;
  }

  global.DevisFactures = {
    TVA_RATES,
    STATUS_LABELS,
    round2,
    parseAmount,
    formatEuro,
    formatDate,
    todayIso,
    addDaysIso,
    lineTotal,
    totals,
    daysLate,
    effectiveStatus,
    evaluateReminder,
    buildReminder,
    list,
    get,
    readSettings,
    saveSettings,
    blankInvoice,
    fromLead,
    saveDraft,
    validate,
    markPaid,
    markUnpaid,
    recordReminder,
    removeDraft,
    forLead,
    kpis,
  };
})(window);
