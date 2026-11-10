// Messages automatiques au client : annonce du devis, relances avant signature,
// démarrage du chantier, photos d'avancement, fin de chantier.
//
// POST { action: "run" } + en-tête x-cron-secret   → tous les artisans qui l'ont activé
// POST { action: "run_mine" }  (artisan connecté)  → le sien, à la demande
// POST { action: "preview" }   (artisan connecté)  → ce qui partirait, sans envoyer
//
// Secrets : RESEND_API_KEY, REMINDER_FROM, CRON_SECRET, SITE_URL
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { build, Artisan, Lead } from "./messages.ts";
import { aEnvoyer, Row } from "./decide.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");


async function envoyer(to: string, replyTo: string, nom: string, subject: string, body: string) {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("REMINDER_FROM") || "";
  if (!key || !from) throw new Error("Envoi d’e-mails non configuré (RESEND_API_KEY / REMINDER_FROM).");
  const adresse = from.match(/<([^>]+)>/)?.[1] || from;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${nom.replace(/[<>"]/g, "")} <${adresse}>`,
      to: [to],
      reply_to: replyTo || undefined,
      subject,
      text: body,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0D1B2E">${
        esc(body).replace(/\n/g, "<br>")
      }</div>`,
    }),
  });
  if (!res.ok) throw new Error("Resend HTTP " + res.status + " : " + (await res.text()).slice(0, 180));
}



async function traiter(
  admin: SupabaseClient,
  artisan: Row,
  siteUrl: string,
  dryRun: boolean,
) {
  const now = new Date();
  const { data: leads, error } = await admin
    .from("dv_leads")
    .select("id, public_id, prenom, email, status, devis_promis_le, devis_envoye_le, suivi_token")
    .eq("artisan_id", artisan.id)
    .not("status", "in", '("perdu","archive")');
  if (error) throw new Error(error.message);

  const envoyes: Row[] = [];
  const ignores: string[] = [];

  for (const lead of (leads || []) as Row[]) {
    const { data: deja } = await admin
      .from("dv_client_messages")
      .select("kind, sent_at")
      .eq("lead_id", lead.id);
    const set = new Set<string>();
    for (const m of (deja || []) as Row[]) {
      // « avancement » peut repartir, mais pas deux fois le même jour.
      if (m.kind === "avancement") {
        if (String(m.sent_at || "").slice(0, 10) === now.toISOString().slice(0, 10)) set.add("avancement");
      } else {
        set.add(String(m.kind));
      }
    }

    const { data: events } = await admin
      .from("dv_events")
      .select("kind, starts_at")
      .eq("lead_id", lead.id)
      .neq("status", "annule");
    const { data: photos } = await admin
      .from("dv_photos")
      .select("phase, created_at")
      .eq("lead_id", lead.id);
    const { data: travaux } = await admin
      .from("dv_lead_travaux")
      .select("travaux")
      .eq("lead_id", lead.id);

    const kind = aEnvoyer(lead, set, (events || []) as Row[], (photos || []) as Row[], now);
    if (!kind) continue;

    if (!lead.email) {
      ignores.push(String(lead.public_id) + " : pas d’adresse électronique");
      continue;
    }

    const payload: Lead = {
      prenom: String(lead.prenom || ""),
      travaux: ((travaux || []) as Row[]).map((t) => String(t.travaux)).filter(Boolean).join(", "),
      devis_promis_le: (lead.devis_promis_le as string) || null,
      lien: siteUrl.replace(/\/+$/, "") + "/suivi/index.html?t=" + String(lead.suivi_token || ""),
    };
    const who: Artisan = {
      nom: String(artisan.display_name || "Votre artisan"),
      telephone: String(artisan.telephone || ""),
    };
    const message = build(kind, payload, who);
    if (!message) continue;

    if (dryRun) {
      envoyes.push({ lead: lead.public_id, kind, subject: message.subject });
      continue;
    }

    try {
      await envoyer(
        String(lead.email),
        String(artisan.email || ""),
        who.nom,
        message.subject,
        message.body,
      );
    } catch (err) {
      ignores.push(String(lead.public_id) + " : " + (err instanceof Error ? err.message : "envoi impossible"));
      continue;
    }

    await admin.from("dv_client_messages").insert({
      lead_id: lead.id,
      kind,
      channel: "email",
      subject: message.subject,
    });
    await admin.from("dv_lead_events").insert({
      lead_id: lead.id,
      kind: "note",
      message: "Message automatique envoyé au client : " + message.subject,
    });
    envoyes.push({ lead: lead.public_id, kind, subject: message.subject });
  }

  return { envoyes: envoyes.length, detail: envoyes, ignores };
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
  const siteUrl = Deno.env.get("SITE_URL") || "";
  if (!siteUrl) return json({ ok: false, error: "SITE_URL manquant : le lien de suivi serait incomplet." }, 500);

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const action = String(payload.action || "");

  if (action === "run") {
    const secret = Deno.env.get("CRON_SECRET") || "";
    if (!secret || req.headers.get("x-cron-secret") !== secret) {
      return json({ ok: false, error: "Accès refusé" }, 401);
    }
    const { data: artisans, error } = await admin
      .from("dv_artisans")
      .select("id, display_name, telephone, email")
      .eq("suivi_auto", true);
    if (error) return json({ ok: false, error: error.message }, 500);
    const rapport: Row[] = [];
    for (const a of (artisans || []) as Row[]) {
      try {
        rapport.push({ artisan: a.id, ...(await traiter(admin, a, siteUrl, false)) });
      } catch (err) {
        rapport.push({ artisan: a.id, error: err instanceof Error ? err.message : "erreur" });
      }
    }
    return json({ ok: true, rapport });
  }

  // ---- Actions de l'artisan connecté ---------------------------------------
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const userRes = token ? await admin.auth.getUser(token) : null;
  const user = userRes?.data?.user;
  if (!user) return json({ ok: false, error: "Connexion requise." }, 401);
  const { data: artisan } = await admin
    .from("dv_artisans")
    .select("id, display_name, telephone, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!artisan) return json({ ok: false, error: "Profil artisan introuvable." }, 404);

  if (action === "preview" || action === "run_mine") {
    try {
      const res = await traiter(admin, artisan as Row, siteUrl, action === "preview");
      return json({ ok: true, apercu: action === "preview", ...res });
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : "Envoi impossible." }, 500);
    }
  }

  return json({ ok: false, error: "Action inconnue." }, 400);
});
