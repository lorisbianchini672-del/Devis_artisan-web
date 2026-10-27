/**
 * Abonnement artisan (Stripe) — appels à la fonction serveur « billing ».
 * Fichier autonome : il réutilise la session Supabase déjà ouverte par store.js
 * (même projet, même stockage), sans modifier store.js.
 */
(function (global) {
  "use strict";

  let client = null;

  function cfg() {
    return global.DEVIS_SUPABASE || {};
  }

  function configured() {
    const c = cfg();
    return Boolean(String(c.url || "").startsWith("https://") && String(c.anonKey || "").length > 20);
  }

  function getClient() {
    if (client) return client;
    if (!configured() || !global.supabase || typeof global.supabase.createClient !== "function") return null;
    const c = cfg();
    client = global.supabase.createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return client;
  }

  async function call(action, extra) {
    const sb = getClient();
    if (!sb) {
      const err = new Error("Le paiement en ligne n’est disponible qu’avec le compte cloud.");
      err.code = "offline";
      throw err;
    }
    const { data, error } = await sb.functions.invoke("billing", { body: Object.assign({ action }, extra || {}) });
    if (data && data.ok === false) {
      const err = new Error(data.error || "Action impossible.");
      err.code = data.code || "";
      throw err;
    }
    if (error) {
      let detail = null;
      try {
        detail = error.context && typeof error.context.json === "function" ? await error.context.json() : null;
      } catch (e) {
        detail = null;
      }
      const err = new Error((detail && detail.error) || "Le service d’abonnement ne répond pas.");
      err.code = (detail && detail.code) || "unavailable";
      throw err;
    }
    return data || {};
  }

  async function hasSession() {
    const sb = getClient();
    if (!sb) return false;
    const { data } = await sb.auth.getSession();
    return Boolean(data && data.session);
  }

  global.DevisBilling = {
    configured,
    hasSession,
    async plans() {
      return (await call("plans")).plans || [];
    },
    async status() {
      return (await call("status")).subscription || { plan: "", status: "none" };
    },
    async checkout(plan) {
      const data = await call("checkout", { plan });
      if (data.url) global.location.href = data.url;
    },
    async portal() {
      const data = await call("portal");
      if (data.url) global.location.href = data.url;
    },
  };
})(window);
