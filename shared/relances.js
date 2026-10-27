/**
 * Relances de paiement côté serveur (fonction « payment-reminders ») :
 * rédaction par l'IA et envoi immédiat des relances du jour.
 * Fichier autonome : il réutilise la session Supabase ouverte par store.js.
 */
(function (global) {
  "use strict";

  let client = null;

  function getClient() {
    if (client) return client;
    const c = global.DEVIS_SUPABASE || {};
    const ok = String(c.url || "").startsWith("https://") && String(c.anonKey || "").length > 20;
    if (!ok || !global.supabase || typeof global.supabase.createClient !== "function") return null;
    client = global.supabase.createClient(c.url, c.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    return client;
  }

  async function available() {
    const sb = getClient();
    if (!sb) return false;
    const { data } = await sb.auth.getSession();
    return Boolean(data && data.session);
  }

  async function call(action, extra) {
    const sb = getClient();
    if (!sb) throw new Error("Disponible uniquement avec le compte cloud.");
    const { data, error } = await sb.functions.invoke("payment-reminders", {
      body: Object.assign({ action }, extra || {}),
    });
    if (data && data.ok === false) throw new Error(data.error || "Action impossible.");
    if (error) {
      let detail = null;
      try {
        detail = error.context && typeof error.context.json === "function" ? await error.context.json() : null;
      } catch (e) {
        detail = null;
      }
      throw new Error((detail && detail.error) || "Le service de relance ne répond pas.");
    }
    return data || {};
  }

  global.DevisRelances = {
    available,
    draft(invoiceId) {
      return call("draft", { invoice_id: invoiceId });
    },
    runNow() {
      return call("run_mine");
    },
  };
})(window);
