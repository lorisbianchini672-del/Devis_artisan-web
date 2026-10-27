// Notifications Stripe → état de l'abonnement de l'artisan (table dv_subscriptions).
// Stripe appelle cette adresse ; la signature est vérifiée avant toute écriture.
//
// Secrets : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_SOLO, STRIPE_PRICE_PRO
// Événements à cocher dans Stripe : checkout.session.completed,
//   customer.subscription.created, customer.subscription.updated, customer.subscription.deleted
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

function planFromPrice(priceId: string) {
  if (priceId && priceId === Deno.env.get("STRIPE_PRICE_SOLO")) return "solo";
  if (priceId && priceId === Deno.env.get("STRIPE_PRICE_PRO")) return "pro";
  return "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Méthode non supportée", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  if (!supabaseUrl || !serviceKey || !stripeKey || !webhookSecret) {
    return new Response("Configuration incomplète", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  const signature = req.headers.get("Stripe-Signature") || "";
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response("Signature invalide", { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function artisanIdFor(customerId: string, metaArtisan?: string | null) {
    const fromMeta = Number(metaArtisan || 0);
    if (fromMeta) return fromMeta;
    const row = await admin
      .from("dv_subscriptions")
      .select("artisan_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    return row.data ? Number(row.data.artisan_id) : 0;
  }

  async function saveSubscription(sub: Stripe.Subscription) {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const artisanId = await artisanIdFor(customerId, sub.metadata && sub.metadata.artisan_id);
    if (!artisanId) return;
    const item = sub.items && sub.items.data && sub.items.data[0];
    const priceId = item && item.price ? item.price.id : "";
    const periodEnd =
      (item && (item as unknown as { current_period_end?: number }).current_period_end) ||
      (sub as unknown as { current_period_end?: number }).current_period_end ||
      0;
    const { error } = await admin.from("dv_subscriptions").upsert({
      artisan_id: artisanId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      plan: planFromPrice(priceId) || (sub.metadata && sub.metadata.plan) || "",
      status: sub.status,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          if (!sub.metadata.artisan_id && session.client_reference_id) {
            sub.metadata.artisan_id = session.client_reference_id;
          }
          await saveSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await saveSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (err) {
    // Stripe renverra la notification plus tard si on répond en erreur.
    return new Response("Erreur : " + (err instanceof Error ? err.message : "inconnue"), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
