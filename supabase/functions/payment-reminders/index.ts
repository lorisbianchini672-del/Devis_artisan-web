// Relances de paiement : rédaction par l'IA et envoi automatique chaque matin.
//
// POST { action: "draft", invoice_id }  (artisan connecté)
//   → { subject, body, ai } : texte proposé pour l'étape due (IA, sinon modèle).
// POST { action: "run" }  + en-tête x-cron-secret  (tâche planifiée du matin)
//   → envoie les relances dues pour tous les artisans en envoi automatique.
// POST { action: "run_mine" }  (artisan connecté)
//   → même chose pour l'artisan connecté uniquement (bouton « Envoyer maintenant »).
//
// Secrets : ANTHROPIC_API_KEY (déjà utilisé par le site), RESEND_API_KEY,
//           REMINDER_FROM (ex. « Devis artisan <relances@votre-domaine.fr> »), CRON_SECRET
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aiMessage, dueStep, payLines, Step, templateMessage, todayParis } from "./messages.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_STEPS: Step[] = [
  { offset: -3, label: "Rappel cordial", tone: 1 },
  { offset: 3, label: "Relance", tone: 2 },
  { offset: 10, label: "Relance ferme", tone: 3 },
  { offset: 20, label: "Mise en demeure", tone: 4 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Settings = { steps?: Step[]; methods?: Record<string, { on?: boolean; value?: string }>; iban?: string; payment_link?: string; auto_send?: boolean };
type Artisan = { id: number; display_name: string; email: string };
type InvoiceRow = {
  id: number;
  public_id: string;
  artisan_id: number;
  lead_id: number | null;
  client_name: string;
  client_email: string;
  label: string;
  number: string;
  amount_ttc: number;
  due_on: string;
  paid_at: string | null;
  reminders: { at: string; step: number; channel: string; subject?: string }[];
  last_step: number;
};

function stepsOf(settings: Settings | null): Step[] {
  const raw = settings && Array.isArray(settings.steps) && settings.steps.length ? settings.steps : DEFAULT_STEPS;
  return raw
    .map((s, i) => ({ offset: Number(s.offset) || 0, label: String(s.label || DEFAULT_STEPS[i]?.label || "Relance"), tone: Number(s.tone) || i + 1 }))
    .sort((a, b) => a.offset - b.offset)
    .map((s, i) => ({ ...s, tone: i + 1 }));
}

async function compose(inv: InvoiceRow, step: Step, settings: Settings | null, artisan: Artisan, useAi: boolean) {
  const pay = payLines(settings?.methods || {}, settings?.iban || "", settings?.payment_link || "");
  const facts = {
    number: inv.number,
    client: inv.client_name,
    label: inv.label || "",
    amount: Number(inv.amount_ttc) || 0,
    due: inv.due_on,
    remindersSent: (inv.reminders || []).length,
  };
  const name = artisan.display_name || "Votre artisan";
  const ai = useAi ? await aiMessage(Deno.env.get("ANTHROPIC_API_KEY") || "", facts, step, pay, name) : null;
  return ai ? { ...ai, ai: true } : { ...templateMessage(facts, step, pay, name), ai: false };
}

async function sendEmail(to: string, replyTo: string, fromName: string, subject: string, body: string) {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("REMINDER_FROM") || "";
  if (!key || !from) throw new Error("Envoi d’e-mails non configuré (RESEND_API_KEY / REMINDER_FROM).");
  // Le nom affiché est celui de l'artisan, l'adresse d'envoi celle du site ; les réponses vont à l'artisan.
  const address = from.match(/<([^>]+)>/)?.[1] || from;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName.replace(/[<>"]/g, "")} <${address}>`,
      to: [to],
      reply_to: replyTo || undefined,
      subject,
      text: body,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#0D1B2E">${escHtml(body).replace(/\n/g, "<br>")}</div>`,
    }),
  });
  if (!res.ok) throw new Error("Resend HTTP " + res.status + " : " + (await res.text()).slice(0, 200));
}

// Envoie les relances dues pour un artisan. Renvoie le nombre d'envois et les erreurs.
async function runForArtisan(admin: SupabaseClient, artisan: Artisan, settings: Settings | null) {
  const steps = stepsOf(settings);
  const today = todayParis();
  const { data, error } = await admin
    .from("dv_payment_invoices")
    .select("*")
    .eq("artisan_id", artisan.id)
    .is("paid_at", null);
  if (error) throw new Error(error.message);
  let sent = 0;
  const skipped: string[] = [];
  for (const inv of (data || []) as InvoiceRow[]) {
    const idx = dueStep(steps, inv.due_on, inv.last_step || 0, today);
    if (idx < 0) continue;
    // Une seule relance par facture et par jour, même si la tâche repasse.
    if ((inv.reminders || []).some((r) => String(r.at || "").slice(0, 10) === today)) continue;
    if (!inv.client_email) {
      skipped.push(`${inv.number} : pas d’e-mail client`);
      continue;
    }
    const step = steps[idx];
    const msg = await compose(inv, step, settings, artisan, true);
    try {
      await sendEmail(inv.client_email, artisan.email, artisan.display_name || "Votre artisan", msg.subject, msg.body);
    } catch (err) {
      skipped.push(`${inv.number} : ${err instanceof Error ? err.message : "envoi impossible"}`);
      continue;
    }
    const reminders = [...(inv.reminders || []), { at: new Date().toISOString(), step: idx + 1, channel: "auto", subject: msg.subject }];
    await admin
      .from("dv_payment_invoices")
      .update({ reminders, last_step: Math.max(inv.last_step || 0, idx + 1), updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (inv.lead_id) {
      await admin.from("dv_lead_events").insert({
        lead_id: inv.lead_id,
        kind: "note",
        message: `${step.label} envoyée automatiquement pour la facture ${inv.number}.`,
      });
    }
    sent++;
  }
  return { sent, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non supportée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Supabase mal configuré" }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const action = String(payload.action || "");

  // ---------- Tâche du matin : tous les artisans en envoi automatique ----------
  if (action === "run") {
    const secret = Deno.env.get("CRON_SECRET") || "";
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ ok: false, error: "Accès refusé" }, 401);
    const { data: rows, error } = await admin.from("dv_payment_settings").select("*").eq("auto_send", true);
    if (error) return json({ ok: false, error: error.message }, 500);
    const report: Record<string, unknown>[] = [];
    for (const settings of rows || []) {
      const { data: artisan } = await admin
        .from("dv_artisans")
        .select("id, display_name, email")
        .eq("id", settings.artisan_id)
        .maybeSingle();
      if (!artisan) continue;
      try {
        report.push({ artisan: artisan.id, ...(await runForArtisan(admin, artisan as Artisan, settings as Settings)) });
      } catch (err) {
        report.push({ artisan: artisan.id, error: err instanceof Error ? err.message : "erreur" });
      }
    }
    return json({ ok: true, report });
  }

  // ---------- Actions de l'artisan connecté ----------
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const userRes = token ? await admin.auth.getUser(token) : null;
  const user = userRes?.data?.user;
  if (!user) return json({ ok: false, error: "Connexion requise." }, 401);
  const { data: artisan } = await admin
    .from("dv_artisans")
    .select("id, display_name, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!artisan) return json({ ok: false, error: "Profil artisan introuvable." }, 404);
  const { data: settings } = await admin.from("dv_payment_settings").select("*").eq("artisan_id", artisan.id).maybeSingle();

  if (action === "draft") {
    const { data: inv } = await admin
      .from("dv_payment_invoices")
      .select("*")
      .eq("artisan_id", artisan.id)
      .eq("public_id", String(payload.invoice_id || ""))
      .maybeSingle();
    if (!inv) return json({ ok: false, error: "Facture introuvable." }, 404);
    const steps = stepsOf(settings as Settings | null);
    let idx = dueStep(steps, inv.due_on, inv.last_step || 0);
    if (idx < 0) idx = Math.min(steps.length - 1, inv.last_step || 0);
    const msg = await compose(inv as InvoiceRow, steps[idx], settings as Settings | null, artisan as Artisan, true);
    return json({ ok: true, step: idx, ...msg });
  }

  if (action === "run_mine") {
    try {
      return json({ ok: true, ...(await runForArtisan(admin, artisan as Artisan, settings as Settings | null)) });
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : "Envoi impossible." }, 500);
    }
  }

  return json({ ok: false, error: "Action inconnue." }, 400);
});
