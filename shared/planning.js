/**
 * Planning : rendez-vous, chantiers et interventions de l'équipe.
 *
 * Données via le compte cloud ; sans lui, le planning reste sur l'appareil pour
 * que la démonstration fonctionne. Fichier autonome : il réutilise la session
 * Supabase ouverte par store.js.
 */
(function (global) {
  "use strict";

  var LOCAL_KEY = "devis:events";
  var client = null;

  function getClient() {
    if (client) return client;
    var c = global.DEVIS_SUPABASE || {};
    var ok = String(c.url || "").indexOf("https://") === 0 && String(c.anonKey || "").length > 20;
    if (!ok || !global.supabase || typeof global.supabase.createClient !== "function") return null;
    client = global.supabase.createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return client;
  }

  async function session() {
    var sb = getClient();
    if (!sb) return null;
    try {
      var res = await sb.auth.getSession();
      return res && res.data && res.data.session ? sb : null;
    } catch (e) {
      return null;
    }
  }

  async function artisanId(sb) {
    var user = await sb.auth.getUser();
    var id = user && user.data && user.data.user ? user.data.user.id : null;
    if (!id) return null;
    var res = await sb.from("dv_artisans").select("id").eq("auth_user_id", id).maybeSingle();
    return res.data ? res.data.id : null;
  }

  var NOT_READY =
    "La table du planning n’est pas encore en base. Exécutez la migration " +
    "20261104100000_planning.sql dans le SQL Editor Supabase.";

  function missingTable(message) {
    return /dv_events|schema cache|does not exist|relation/i.test(String(message || ""));
  }

  // ---------------------------------------------------------------- dates ---
  /** Lundi de la semaine contenant `date`, à minuit, heure locale. */
  function weekStart(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    // getDay() : 0 = dimanche. On ramène au lundi précédent.
    var shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return d;
  }

  function addDays(date, n) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  /** « 2026-11-04T09:30 » pour un champ datetime-local, en heure locale. */
  function toInputValue(date) {
    var p = function (n) { return String(n).padStart(2, "0"); };
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate())
      + "T" + p(date.getHours()) + ":" + p(date.getMinutes());
  }

  // ---------------------------------------------------------------- local ---
  function readLocal() {
    try {
      var raw = global.localStorage.getItem(LOCAL_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocal(list) {
    try {
      global.localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  var KINDS = [
    { value: "rdv", label: "Rendez-vous client" },
    { value: "chantier", label: "Chantier" },
    { value: "autre", label: "Autre" },
  ];

  var STATUSES = [
    { value: "prevu", label: "Prévu" },
    { value: "confirme", label: "Confirmé" },
    { value: "fait", label: "Fait" },
    { value: "annule", label: "Annulé" },
  ];

  function clean(event) {
    var starts = new Date(event.starts_at);
    var ends = new Date(event.ends_at);
    if (!(starts instanceof Date) || isNaN(starts)) throw new Error("Date de début invalide.");
    if (!(ends instanceof Date) || isNaN(ends)) ends = new Date(starts.getTime() + 3600000);
    if (ends < starts) ends = new Date(starts.getTime() + 3600000);
    var title = String(event.title || "").trim().slice(0, 140);
    if (!title) throw new Error("Donnez un intitulé à cet événement.");
    return {
      title: title,
      kind: KINDS.some(function (k) { return k.value === event.kind; }) ? event.kind : "rdv",
      status: STATUSES.some(function (s) { return s.value === event.status; }) ? event.status : "prevu",
      notes: String(event.notes || "").trim().slice(0, 600) || null,
      location: String(event.location || "").trim().slice(0, 200) || null,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      all_day: Boolean(event.all_day),
      lead_id: event.lead_id || null,
      member_id: event.member_id || null,
    };
  }

  global.DevisPlanning = {
    kinds: KINDS,
    statuses: STATUSES,
    weekStart: weekStart,
    addDays: addDays,
    sameDay: sameDay,
    toInputValue: toInputValue,

    kindLabel: function (value) {
      for (var i = 0; i < KINDS.length; i++) if (KINDS[i].value === value) return KINDS[i].label;
      return value || "";
    },
    statusLabel: function (value) {
      for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].value === value) return STATUSES[i].label;
      return value || "";
    },

    async available() {
      return Boolean(await session());
    },

    /** Événements qui touchent l'intervalle [from, to[, même à cheval dessus. */
    async range(from, to) {
      var sb = await session();
      if (!sb) {
        return readLocal().filter(function (e) {
          return new Date(e.ends_at) >= from && new Date(e.starts_at) < to;
        });
      }
      var aid = await artisanId(sb);
      if (!aid) return [];
      var res = await sb
        .from("dv_events")
        .select("*")
        .eq("artisan_id", aid)
        .lt("starts_at", to.toISOString())
        .gte("ends_at", from.toISOString())
        .order("starts_at", { ascending: true });
      if (res.error) {
        if (missingTable(res.error.message)) throw new Error(NOT_READY);
        throw new Error(res.error.message);
      }
      return res.data || [];
    },

    async save(event) {
      var row = clean(event);
      var sb = await session();

      if (!sb) {
        var list = readLocal();
        var existing = event.public_id
          ? list.filter(function (e) { return e.public_id === event.public_id; })[0]
          : null;
        if (existing) {
          Object.keys(row).forEach(function (k) { existing[k] = row[k]; });
        } else {
          row.public_id = "ev_local_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          row.created_at = new Date().toISOString();
          list.push(row);
        }
        if (!writeLocal(list)) throw new Error("Enregistrement impossible sur cet appareil.");
        return existing || row;
      }

      var aid = await artisanId(sb);
      if (!aid) throw new Error("Profil artisan introuvable.");

      var res;
      if (event.public_id) {
        res = await sb.from("dv_events").update(row).eq("public_id", event.public_id).select().maybeSingle();
      } else {
        row.artisan_id = aid;
        res = await sb.from("dv_events").insert(row).select().maybeSingle();
      }
      if (res.error) {
        if (missingTable(res.error.message)) throw new Error(NOT_READY);
        if (/row-level security|permission/i.test(res.error.message || "")) {
          throw new Error("Votre rôle ne permet pas de modifier le planning.");
        }
        throw new Error(res.error.message);
      }
      return res.data;
    },

    async remove(publicId) {
      var sb = await session();
      if (!sb) {
        writeLocal(readLocal().filter(function (e) { return e.public_id !== publicId; }));
        return true;
      }
      var res = await sb.from("dv_events").delete().eq("public_id", publicId);
      if (res.error) {
        if (/row-level security|permission/i.test(res.error.message || "")) {
          throw new Error("Votre rôle ne permet pas de modifier le planning.");
        }
        throw new Error(res.error.message);
      }
      return true;
    },

    /** Les demandes récentes, pour rattacher un événement à un client. */
    async leads() {
      var sb = await session();
      if (!sb) {
        try {
          var store = global.DevisStore;
          return ((store && store.list ? store.list() : []) || []).slice(0, 200).map(function (l) {
            return { id: l.id || l.public_id, label: [l.prenom, l.nom].filter(Boolean).join(" ") || "Client", ville: l.ville || "" };
          });
        } catch (e) {
          return [];
        }
      }
      var aid = await artisanId(sb);
      if (!aid) return [];
      var res = await sb
        .from("dv_leads")
        .select("id, prenom, nom, ville, code_postal, adresse")
        .eq("artisan_id", aid)
        .order("created_at", { ascending: false })
        .limit(200);
      if (res.error) return [];
      return (res.data || []).map(function (l) {
        return {
          id: l.id,
          label: [l.prenom, l.nom].filter(Boolean).join(" ") || "Client",
          ville: l.ville || l.code_postal || "",
          adresse: [l.adresse, l.code_postal, l.ville].filter(Boolean).join(", "),
        };
      });
    },

    /** Les membres de l'équipe, pour dire qui s'en occupe. */
    async members() {
      var sb = await session();
      if (!sb) return [];
      var aid = await artisanId(sb);
      if (!aid) return [];
      var res = await sb
        .from("dv_members")
        .select("id, email, display_name, role, status")
        .eq("artisan_id", aid)
        .neq("status", "suspendu")
        .order("created_at", { ascending: true });
      // La table des membres n'existe que si la migration des rôles est passée.
      if (res.error) return [];
      return (res.data || []).map(function (m) {
        return { id: m.id, label: m.display_name || m.email, role: m.role };
      });
    },
  };
})(window);
