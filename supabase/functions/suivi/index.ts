// Suivi client : la page que le client ouvre avec son lien, sans compte.
//
// POST { token }  →  le parcours de sa demande, ses photos, et de quoi joindre
// l'artisan. Aucune authentification : le jeton de 128 bits fait office de clé.
//
// Rien n'est demandé à l'artisan : le parcours se déduit de ce qu'il fait déjà
// dans l'outil — le statut de la demande, un rendez-vous au planning, un devis
// enregistré, des photos de fin de chantier.
//
// La fonction tolère l'absence des tables dv_events et dv_quotes : le suivi
// marche avec le schéma de base, et s'enrichit si ces migrations sont passées.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "chantier-photos";
const SIGNED_FOR = 3600; // une heure : le temps d'une consultation

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type Step = {
  key: string;
  label: string;
  state: "fait" | "en_cours" | "a_venir";
  date: string | null;
  detail: string;
};

// Une colonne « date » n'a pas d'heure. La convertir en horodatage la décale
// d'un fuseau et le client lit « jeudi 8 octobre à 02:00 ». On renvoie donc les
// dates nues telles quelles, et la page sait les distinguer.
const jour = (d: string | Date | null) => {
  if (!d) return null;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const date = typeof d === "string" ? new Date(d) : d;
  return isNaN(date.getTime()) ? null : date.toISOString();
};

/** Une requête qui échoue parce que la table n'existe pas ne doit rien casser.
    PromiseLike et non Promise : le constructeur de requête de supabase-js est
    « thenable », il n'expose pas catch ni finally. */
async function tryQuery<T>(
  run: () => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T | null> {
  try {
    const { data, error } = await run();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

async function signed(admin: SupabaseClient, paths: string[]) {
  const clean = paths.filter(Boolean).slice(0, 12);
  if (!clean.length) return [];
  try {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(clean, SIGNED_FOR);
    if (error || !data) return [];
    return data.filter((d) => d.signedUrl).map((d) => d.signedUrl as string);
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non supportée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Supabase mal configuré" }, 500);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const token = String(payload.token || "").trim();
  // 32 caractères hexadécimaux : on refuse tout le reste sans toucher la base.
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return json({ ok: false, error: "Lien de suivi invalide." }, 400);
  }

  const { data: lead } = await admin
    .from("dv_leads")
    .select("id, public_id, artisan_id, prenom, status, created_at, ville, devis_promis_le, consent_photos")
    .eq("suivi_token", token)
    .maybeSingle();
  if (!lead) return json({ ok: false, error: "Ce lien de suivi n’existe pas ou a été retiré." }, 404);

  const { data: artisan } = await admin
    .from("dv_artisans")
    .select("display_name, metier, ville, telephone, email, public_id, slug")
    .eq("id", lead.artisan_id)
    .maybeSingle();

  // ---- Ce que l'artisan a déjà fait, lu là où il l'a fait -------------------
  const travaux = (await tryQuery<{ travaux: string }[]>(() =>
    admin.from("dv_lead_travaux").select("travaux").eq("lead_id", lead.id)
  )) || [];

  const events = (await tryQuery<
    { kind: string; title: string; starts_at: string; ends_at: string; status: string }[]
  >(() =>
    admin
      .from("dv_events")
      .select("kind, title, starts_at, ends_at, status")
      .eq("lead_id", lead.id)
      .neq("status", "annule")
      .order("starts_at", { ascending: true })
  )) || [];

  const quotes = (await tryQuery<{ number: string; status: string; created_at: string }[]>(() =>
    admin
      .from("dv_quotes")
      .select("number, status, created_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
  )) || [];

  const photos = (await tryQuery<{ phase: string; storage_path: string; sort_order: number }[]>(() =>
    admin
      .from("dv_photos")
      .select("phase, storage_path, sort_order")
      .eq("lead_id", lead.id)
      .order("sort_order", { ascending: true })
  )) || [];

  const now = new Date();
  const visite = events.find((e) => e.kind === "rdv");
  const chantier = events.find((e) => e.kind === "chantier");
  const devisEnvoye = lead.status === "devis_envoye" || quotes.some((q) => q.status === "envoye");
  const signe = lead.status === "gagne" || quotes.some((q) => q.status === "accepte");
  const apres = photos.filter((p) => p.phase === "apres");
  const avant = photos.filter((p) => p.phase === "avant");
  const termine = apres.length > 0 || (chantier != null && new Date(chantier.ends_at) < now);

  // ---- Le parcours ---------------------------------------------------------
  const steps: Step[] = [];

  steps.push({
    key: "recue",
    label: "Demande reçue",
    state: "fait",
    date: jour(lead.created_at),
    detail: travaux.length
      ? travaux.map((t) => t.travaux).filter(Boolean).join(", ")
      : "",
  });

  if (visite) {
    const passee = new Date(visite.ends_at) < now;
    steps.push({
      key: "visite",
      label: passee ? "Visite faite" : "Visite prévue",
      state: passee ? "fait" : "en_cours",
      date: jour(visite.starts_at),
      detail: passee ? "" : "Votre artisan passe voir le chantier.",
    });
  } else if (lead.status === "nouveau") {
    steps.push({
      key: "visite",
      label: "Prise de contact",
      state: "en_cours",
      date: null,
      detail: "Votre artisan revient vers vous pour convenir d’un rendez-vous.",
    });
  }

  if (devisEnvoye || signe) {
    steps.push({
      key: "devis",
      label: "Devis envoyé",
      state: "fait",
      date: quotes.length ? jour(quotes[0].created_at) : null,
      detail: quotes.length && quotes[0].number ? "Devis " + quotes[0].number : "",
    });
  } else {
    steps.push({
      key: "devis",
      label: "Devis en préparation",
      state: lead.status === "contacte" || visite != null ? "en_cours" : "a_venir",
      date: jour(lead.devis_promis_le),
      detail: lead.devis_promis_le ? "Votre devis vous parvient pour cette date." : "",
    });
  }

  steps.push({
    key: "accord",
    label: signe ? "Devis accepté" : "En attente de votre accord",
    state: signe ? "fait" : devisEnvoye ? "en_cours" : "a_venir",
    date: null,
    detail: signe ? "" : devisEnvoye ? "Prenez le temps : une question est toujours la bienvenue." : "",
  });

  if (chantier) {
    const commence = new Date(chantier.starts_at) <= now;
    steps.push({
      key: "chantier",
      label: termine ? "Chantier terminé" : commence ? "Chantier en cours" : "Chantier prévu",
      state: termine ? "fait" : commence ? "en_cours" : "a_venir",
      date: jour(chantier.starts_at),
      detail: chantier.ends_at && !termine
        ? "Jusqu’au " + new Date(chantier.ends_at).toLocaleDateString("fr-FR")
        : "",
    });
  } else if (signe) {
    steps.push({
      key: "chantier",
      label: termine ? "Chantier terminé" : "Chantier à planifier",
      state: termine ? "fait" : "en_cours",
      date: null,
      detail: termine ? "" : "Votre artisan vous propose une date.",
    });
  }

  return json({
    ok: true,
    client: { prenom: lead.prenom || "" },
    artisan: artisan
      ? {
          nom: artisan.display_name || "",
          metier: artisan.metier || "",
          ville: artisan.ville || "",
          telephone: artisan.telephone || "",
          email: artisan.email || "",
          page: artisan.slug || artisan.public_id || "",
        }
      : null,
    steps,
    photos: {
      avant: await signed(admin, avant.map((p) => p.storage_path)),
      apres: await signed(admin, apres.map((p) => p.storage_path)),
    },
    termine,
    // L'artisan n'a demandé l'accord de publication qu'une fois le chantier fini.
    demande_consentement: termine && apres.length > 0 && !lead.consent_photos,
  });
});
