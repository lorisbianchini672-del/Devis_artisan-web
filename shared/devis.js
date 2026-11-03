/**
 * Devis rédigés dans l'outil : dictée, mise en forme par l'IA, puis
 * enregistrement. Fonctionne avec le compte cloud ; sans lui, les devis sont
 * gardés sur l'appareil pour que la démonstration reste utilisable.
 * Fichier autonome : il réutilise la session Supabase ouverte par store.js.
 */
(function (global) {
  "use strict";

  var LOCAL_KEY = "devis:quotes";
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

  function localNumber(list) {
    var year = new Date().getFullYear();
    var prefix = "DEV-" + year + "-";
    var max = 0;
    list.forEach(function (q) {
      if (String(q.number || "").indexOf(prefix) === 0) {
        var n = parseInt(String(q.number).slice(prefix.length), 10);
        if (n > max) max = n;
      }
    });
    return prefix + String(max + 1).padStart(4, "0");
  }

  function newId() {
    return "dq_local_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // --------------------------------------------------------------- formats ---
  var UNITS = ["u", "ml", "m2", "m3", "h", "j", "kg", "forfait"];

  function cleanLine(line, index) {
    var qty = Number(line.quantity);
    var price = Number(line.unit_price_ht);
    var unit = String(line.unit || "u").toLowerCase();
    return {
      sort_order: index,
      label: String(line.label || "").slice(0, 140),
      detail: String(line.detail || "").slice(0, 240),
      quantity: isFinite(qty) && qty > 0 ? Math.round(qty * 1000) / 1000 : 1,
      unit: UNITS.indexOf(unit) >= 0 ? unit : "u",
      unit_price_ht: isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0,
      price_origin: ["prix_pratique", "grille", "a_completer", "saisi"].indexOf(line.price_origin) >= 0
        ? line.price_origin
        : "saisi",
    };
  }

  function totals(quote) {
    var ht = 0;
    (quote.lines || []).forEach(function (l) {
      ht += (Number(l.quantity) || 0) * (Number(l.unit_price_ht) || 0);
    });
    ht = Math.round(ht * 100) / 100;
    var rate = Number(quote.vat_rate);
    if (!isFinite(rate) || rate < 0) rate = 20;
    var tva = Math.round(ht * rate) / 100;
    return { ht: ht, tva: tva, ttc: Math.round((ht + tva) * 100) / 100, rate: rate };
  }

  // ------------------------------------------------------------------ API ---
  global.DevisRedaction = {
    units: UNITS,
    totals: totals,

    async available() {
      return Boolean(await session());
    },

    /** Dictée → lignes de devis. Nécessite le compte cloud (appel IA). */
    async draft(transcript, leadId) {
      var sb = await session();
      if (!sb) {
        throw new Error(
          "La rédaction par l’IA demande le compte cloud de l’atelier. Vous pouvez saisir les lignes à la main."
        );
      }
      var res = await sb.functions.invoke("draft-quote", {
        body: { action: "draft", transcript: transcript, lead_id: leadId || null },
      });
      var data = res.data;
      if (data && data.ok === false) throw new Error(data.error || "Rédaction impossible.");
      if (res.error) {
        var detail = null;
        try {
          detail =
            res.error.context && typeof res.error.context.json === "function"
              ? await res.error.context.json()
              : null;
        } catch (e) {
          detail = null;
        }
        var msg = (detail && detail.error) || res.error.message || "";
        if (/draft-quote|not found|404|failed to send/i.test(msg)) {
          throw new Error(
            "La rédaction IA n’est pas encore déployée. Déployez la fonction draft-quote, ou saisissez les lignes à la main."
          );
        }
        throw new Error(msg || "Le service de rédaction ne répond pas.");
      }
      return data || {};
    },

    async list() {
      var sb = await session();
      if (!sb) {
        return readLocal().sort(function (a, b) {
          return String(b.created_at).localeCompare(String(a.created_at));
        });
      }
      var aid = await artisanId(sb);
      if (!aid) return [];
      var res = await sb
        .from("dv_quotes")
        .select("*, lines:dv_quote_lines(*)")
        .eq("artisan_id", aid)
        .order("created_at", { ascending: false })
        .limit(200);
      if (res.error) {
        if (/dv_quotes|schema cache|does not exist|relation/i.test(res.error.message || "")) {
          throw new Error(
            "La table des devis n’est pas encore en base. Exécutez la migration 20261103110000_devis_rediges.sql dans le SQL Editor Supabase."
          );
        }
        throw new Error(res.error.message);
      }
      return (res.data || []).map(function (q) {
        q.lines = (q.lines || []).sort(function (a, b) {
          return (a.sort_order || 0) - (b.sort_order || 0);
        });
        return q;
      });
    },

    async get(publicId) {
      var all = await this.list();
      return all.filter(function (q) {
        return q.public_id === publicId;
      })[0] || null;
    },

    async save(quote) {
      var lines = (quote.lines || []).map(cleanLine).filter(function (l) {
        return l.label.length > 1;
      });
      var sb = await session();

      if (!sb) {
        var list = readLocal();
        var existing = quote.public_id
          ? list.filter(function (q) { return q.public_id === quote.public_id; })[0]
          : null;
        var row = existing || {
          public_id: newId(),
          created_at: new Date().toISOString(),
          number: localNumber(list),
        };
        row.updated_at = new Date().toISOString();
        ["title", "client_name", "client_email", "client_address", "notes", "transcript", "status"].forEach(
          function (k) { if (quote[k] !== undefined) row[k] = quote[k]; }
        );
        row.vat_rate = Number(quote.vat_rate) >= 0 ? Number(quote.vat_rate) : 20;
        row.validity_days = Number(quote.validity_days) >= 0 ? Number(quote.validity_days) : 30;
        row.drafted_by_ai = Boolean(quote.drafted_by_ai);
        row.lines = lines;
        if (!existing) list.unshift(row);
        if (!writeLocal(list)) throw new Error("Enregistrement impossible sur cet appareil.");
        return row;
      }

      var aid = await artisanId(sb);
      if (!aid) throw new Error("Profil artisan introuvable.");

      var head = {
        artisan_id: aid,
        lead_id: quote.lead_id || null,
        title: quote.title || null,
        client_name: quote.client_name || null,
        client_email: quote.client_email || null,
        client_address: quote.client_address || null,
        notes: quote.notes || null,
        transcript: quote.transcript || null,
        status: quote.status || "brouillon",
        vat_rate: Number(quote.vat_rate) >= 0 ? Number(quote.vat_rate) : 20,
        validity_days: Number(quote.validity_days) >= 0 ? Number(quote.validity_days) : 30,
        drafted_by_ai: Boolean(quote.drafted_by_ai),
      };

      var saved;
      if (quote.public_id) {
        var up = await sb.from("dv_quotes").update(head).eq("public_id", quote.public_id).select().maybeSingle();
        if (up.error) throw new Error(up.error.message);
        saved = up.data;
        await sb.from("dv_quote_lines").delete().eq("quote_id", saved.id);
      } else {
        var num = await sb.rpc("dv_next_quote_number", { p_artisan_id: aid });
        head.number = (num && num.data) || null;
        var ins = await sb.from("dv_quotes").insert(head).select().maybeSingle();
        if (ins.error) {
          if (/dv_quotes|schema cache|does not exist|relation/i.test(ins.error.message || "")) {
            throw new Error(
              "La table des devis n’est pas encore en base. Exécutez la migration 20261103110000_devis_rediges.sql dans le SQL Editor Supabase."
            );
          }
          throw new Error(ins.error.message);
        }
        saved = ins.data;
      }

      if (lines.length) {
        var rows = lines.map(function (l) {
          return {
            quote_id: saved.id,
            sort_order: l.sort_order,
            label: l.label,
            detail: l.detail || null,
            quantity: l.quantity,
            unit: l.unit,
            unit_price_ht: l.unit_price_ht,
            price_origin: l.price_origin,
          };
        });
        var insLines = await sb.from("dv_quote_lines").insert(rows);
        if (insLines.error) throw new Error(insLines.error.message);
      }
      saved.lines = lines;
      return saved;
    },

    async remove(publicId) {
      var sb = await session();
      if (!sb) {
        writeLocal(readLocal().filter(function (q) { return q.public_id !== publicId; }));
        return true;
      }
      var res = await sb.from("dv_quotes").delete().eq("public_id", publicId);
      if (res.error) throw new Error(res.error.message);
      return true;
    },
  };
})(window);
