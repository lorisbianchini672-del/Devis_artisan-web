// Abonnement artisan : offres, paiement Stripe (Checkout) et espace de gestion.
// Actions (POST JSON { action }) :
//   "plans"    → offres disponibles (prix lus dans Stripe), sans connexion
//   "status"   → abonnement de l'artisan connecté
//   "checkout" → { plan: "solo" | "pro" } → URL de paiement Stripe
//   "portal"   → URL de l'espace Stripe pour gérer / résilier
//
// Secrets à définir dans Supabase (Edge Functions → Secrets) :
//   STRIPE_SECRET_KEY, STRIPE_PRICE_SOLO, STRIPE_PRICE_PRO, SITE_URL (facultatif)
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLAN_NAMES: Record<string, string> = { solo: "Solo", pro: "Pro" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function priceIds(): Record<string, string> {
  return {
    solo: Deno.env.get("STRIPE_PRICE_SOLO") || "",
    pro: Deno.env.get("STRIPE_PRICE_PRO") || "",
  };
}

function siteUrl() {
  return (Deno.env.get("SITE_URL") || "https://arthur-savin.github.io/Devis_artisan-web").replace(/\/+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Méthode non supportée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!supabaseUrl || !serviceKey) return jsonResponse({ ok: false, error: "Supabase mal configuré" }, 500);
  if (!stripeKey) {
    return jsonResponse({ ok: false, code: "stripe_not_configured", error: "Le paiement n’est pas encore activé." }, 503);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "JSON attendu" }, 400);
  }
  const action = String(payload.action || "");
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  const prices = priceIds();

  // Offres : lisibles sans connexion (page d'accueil, page abonnement).
  if (action === "plans") {
    const plans = [];
    for (const key of ["solo", "pro"]) {
      if (!prices[key]) continue;
      try {
        const p = await stripe.prices.retrieve(prices[key], { expand: ["product"] });
        const product = p.product && typeof p.product === "object" && !("deleted" in p.product && p.product.deleted)
          ? (p.product as Stripe.Product)
          : null;
        plans.push({
          key,
          name: (product && product.name) || PLAN_NAMES[key],
          description: (product && product.description) || "",
          amount: (p.unit_amount || 0) / 100,
          currency: p.currency,
          interval: p.recurring ? p.recurring.interval : null,
        });
      } catch {
        // Prix introuvable dans Stripe : l'offre n'est pas proposée.
      }
    }
    return jsonResponse({ ok: true, plans });
  }

  // Tout le reste exige un artisan connecté.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ ok: false, error: "Connexion requise." }, 401);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userRes = await admin.auth.getUser(token);
  const user = userRes.data && userRes.data.user;
  if (userRes.error || !user) return jsonResponse({ ok: false, error: "Connexion requise." }, 401);

  const artisanRes = await admin
    .from("dv_artisans")
    .select("id, display_name, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const artisan = artisanRes.data as { id: number; display_name?: string; email?: string } | null;
  if (!artisan) return jsonResponse({ ok: false, error: "Profil artisan introuvable." }, 404);

  const subRes = await admin.from("dv_subscriptions").select("*").eq("artisan_id", artisan.id).maybeSingle();
  if (subRes.error) {
    return jsonResponse({
      ok: false,
      code: "table_missing",
      error: "La table des abonnements n’existe pas encore. Exécutez la migration 20261027190000_stripe_subscriptions.sql.",
    }, 500);
  }
  const sub = subRes.data as Record<string, unknown> | null;

  if (action === "status") {
    return jsonResponse({
      ok: true,
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            current_period_end: sub.current_period_end,
            cancel_at_period_end: sub.cancel_at_period_end,
          }
        : { plan: "", status: "none" },
    });
  }

  if (action === "checkout") {
    const plan = String(payload.plan || "");
    const price = prices[plan];
    if (!price) return jsonResponse({ ok: false, error: "Offre inconnue." }, 400);
    if (sub && ["active", "trialing", "past_due"].includes(String(sub.status))) {
      return jsonResponse({ ok: false, error: "Vous avez déjà un abonnement. Gérez-le depuis « Gérer mon abonnement »." }, 409);
    }

    let customerId = sub && sub.stripe_customer_id ? String(sub.stripe_customer_id) : "";
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || artisan.email || undefined,
        name: artisan.display_name || undefined,
        metadata: { artisan_id: String(artisan.id), auth_user_id: user.id },
      });
      customerId = customer.id;
      await admin.from("dv_subscriptions").upsert({
        artisan_id: artisan.id,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      });
    }

    const base = siteUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: String(artisan.id),
      subscription_data: { metadata: { artisan_id: String(artisan.id), plan } },
      metadata: { artisan_id: String(artisan.id), plan },
      allow_promotion_codes: true,
      locale: "fr",
      success_url: base + "/dashboard/abonnement.html?retour=ok",
      cancel_url: base + "/dashboard/abonnement.html?retour=annule",
    });
    return jsonResponse({ ok: true, url: session.url });
  }

  if (action === "portal") {
    if (!sub || !sub.stripe_customer_id) {
      return jsonResponse({ ok: false, error: "Aucun abonnement à gérer pour l’instant." }, 404);
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: String(sub.stripe_customer_id),
      return_url: siteUrl() + "/dashboard/abonnement.html",
      locale: "fr",
    });
    return jsonResponse({ ok: true, url: portal.url });
  }

  return jsonResponse({ ok: false, error: "Action inconnue." }, 400);
});
