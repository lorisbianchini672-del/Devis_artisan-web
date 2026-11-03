// Devis dicté : l'artisan décrit son chantier à la voix, l'IA en fait des lignes
// de devis en s'appuyant sur SES prix.
//
// POST { action: "draft", transcript, lead_id? }  (artisan connecté)
//   → { title, lines: [...], unmatched: n }
//
// Règle du site, reprise ici : aucun prix n'est inventé. Une prestation sans
// équivalent dans les prix de l'artisan sort à 0 € avec price_origin
// « a_completer », pour qu'il la chiffre lui-même.
//
// Secret : ANTHROPIC_API_KEY (déjà utilisé par analyze-lead et extract-quote).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";
const MAX_TRANSCRIPT = 6000;
const MAX_LINES = 40;

const PROMPT = `Tu transformes la dictée d'un artisan en lignes de devis.

L'artisan vient de décrire, à voix haute, le chantier qu'il va réaliser. Sa dictée
est parlée : phrases incomplètes, hésitations, mots mal transcrits. Tu la lis comme
un collègue du métier, et tu en tires des lignes de devis propres.

ON TE DONNE SES PRIX. Tu ne peux utiliser AUCUN autre prix.

SORTIE — UNIQUEMENT un JSON valide, sans markdown :
{
  "title": string,
  "client_name": string,
  "lines": [
    {
      "label": string,
      "detail": string,
      "quantity": number,
      "unit": string,
      "unit_price_ht": number,
      "price_origin": "prix_pratique" | "grille" | "a_completer",
      "matched_on": string
    }
  ],
  "notes": string
}

Règles de prix, les plus importantes :
- "prix_pratique" : la prestation correspond à un prix de la liste PRIX DÉJÀ
  PRATIQUÉS. Reprends ce montant exactement. matched_on = le libellé repris.
- "grille" : pas dans les prix pratiqués, mais présente dans la GRILLE TARIFAIRE.
  Reprends ce montant exactement. matched_on = la ligne de grille reprise.
- "a_completer" : aucune correspondance. unit_price_ht = 0, matched_on = "".
  N'INVENTE JAMAIS de montant, même plausible, même si l'artisan a dit un ordre
  de grandeur à l'oral.
- Exception : si l'artisan énonce lui-même un prix dans sa dictée (« je compte
  trois cents euros pour la pose »), reprends-le, price_origin = "a_completer",
  matched_on = "dicté".

Règles de forme :
- label : 4 à 140 caractères, la prestation telle qu'un client la comprend.
- detail : précision utile (pièce, matériau, accès), ou "".
- quantity : nombre > 0. Si l'artisan ne dit rien, 1.
- unit : u, ml, m2, m3, h, j, kg, forfait.
- Sépare les prestations : une ligne par geste facturable, pas un paragraphe.
- Regroupe ce qui va ensemble (« fournitures diverses » reste une ligne).
- Ignore ce qui n'est pas facturable (bavardage, notes d'organisation) : mets-le
  dans notes si c'est utile à l'artisan.
- title : titre court du chantier. client_name : le nom du client s'il est
  prononcé, sinon "".
- Au maximum 40 lignes.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clip(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function extractJson(text: string) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Réponse IA sans objet JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function asMoney(value: unknown) {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  const rounded = Math.round(n * 100) / 100;
  return rounded <= 1000000 ? rounded : 0;
}

function asQuantity(value: unknown) {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(n * 1000) / 1000;
}

const UNITS = new Set(["u", "ml", "m2", "m3", "h", "j", "kg", "forfait"]);
const ORIGINS = new Set(["prix_pratique", "grille", "a_completer"]);

type Line = {
  label: string;
  detail: string;
  quantity: number;
  unit: string;
  unit_price_ht: number;
  price_origin: string;
  matched_on: string;
};

// Garde-fou : un montant annoncé « repris des prix de l'artisan » doit
// réellement exister dans ses prix. Sinon on le ramène à compléter.
function normalize(raw: Record<string, unknown>, known: Set<number>) {
  const list = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: Line[] = [];
  let unmatched = 0;
  let corrected = 0;
  for (const entry of list) {
    if (lines.length >= MAX_LINES) break;
    const row = entry as Record<string, unknown>;
    const label = clip(row.label, 140);
    if (label.length < 3) continue;
    let origin = String(row.price_origin || "a_completer");
    if (!ORIGINS.has(origin)) origin = "a_completer";
    let price = asMoney(row.unit_price_ht);
    const dictated = clip(row.matched_on, 120).toLowerCase() === "dicté";
    if ((origin === "prix_pratique" || origin === "grille") && !known.has(price)) {
      // L'IA affirme reprendre un prix connu, mais ce montant n'est pas dans la
      // liste fournie : on refuse plutôt que de laisser passer un prix inventé.
      origin = "a_completer";
      price = 0;
      corrected++;
    }
    if (origin === "a_completer" && !dictated) price = 0;
    if (origin === "a_completer") unmatched++;
    let unit = clip(row.unit, 12).toLowerCase();
    if (!UNITS.has(unit)) unit = "u";
    lines.push({
      label,
      detail: clip(row.detail, 240),
      quantity: asQuantity(row.quantity),
      unit,
      unit_price_ht: price,
      price_origin: origin,
      matched_on: clip(row.matched_on, 120),
    });
  }
  return {
    title: clip(raw.title, 140),
    client_name: clip(raw.client_name, 120),
    notes: clip(raw.notes, 600),
    lines,
    unmatched,
    corrected,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non supportée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Supabase mal configuré" }, 500);
  if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY manquant" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Connexion requise." }, 401);
  const userRes = await admin.auth.getUser(token);
  const user = userRes.data && userRes.data.user;
  if (userRes.error || !user) return json({ ok: false, error: "Connexion requise." }, 401);

  const { data: artisan } = await admin
    .from("dv_artisans")
    .select("id, metier, tarif_grid, bareme_indicatif, bareme_autorise")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!artisan) return json({ ok: false, error: "Aucun atelier lié à ce compte." }, 403);

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "JSON attendu" }, 400);
  }

  const transcript = clip(payload.transcript, MAX_TRANSCRIPT);
  if (transcript.length < 15) {
    return json({ ok: false, error: "Dictée trop courte : décrivez le chantier en quelques phrases." }, 400);
  }

  // Les prix de l'artisan, les plus récents d'abord.
  const { data: priceRows } = await admin
    .from("dv_service_prices")
    .select("service_label, amount_ht, detail")
    .eq("artisan_id", artisan.id)
    .order("created_at", { ascending: false })
    .limit(300);

  const prices = (priceRows || []) as { service_label: string; amount_ht: number; detail?: string }[];
  const known = new Set<number>([0]);
  for (const p of prices) known.add(Math.round(Number(p.amount_ht) * 100) / 100);

  const grid = clip(artisan.tarif_grid, 4000);
  // Tout nombre lisible dans la grille compte comme un prix connu.
  for (const m of grid.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)) {
    known.add(Math.round(Number(m[1].replace(",", ".")) * 100) / 100);
  }

  if (!prices.length && !grid) {
    return json({
      ok: false,
      error:
        "Aucun prix enregistré : l’IA ne peut pas chiffrer sans vos tarifs. Renseignez votre grille dans « Former l’IA », ou dictez vos prix à voix haute.",
    }, 400);
  }

  const priceList = prices
    .slice(0, 160)
    .map((p) => `- ${clip(p.service_label, 120)} : ${Number(p.amount_ht).toFixed(2)} € HT${p.detail ? " (" + clip(p.detail, 80) + ")" : ""}`)
    .join("\n");

  const context = [
    "Métier de l’artisan : " + (clip(artisan.metier, 80) || "non précisé") + ".",
    "",
    "PRIX DÉJÀ PRATIQUÉS :",
    priceList || "(aucun)",
    "",
    "GRILLE TARIFAIRE :",
    grid || "(vide)",
    "",
    "DICTÉE :",
    transcript,
  ].join("\n");

  let body: Record<string, unknown>;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: PROMPT,
        messages: [{ role: "user", content: context }],
      }),
    });
    body = await response.json();
    if (!response.ok) {
      const message = (body?.error as { message?: string } | undefined)?.message || "Rédaction IA refusée.";
      return json({ ok: false, error: String(message).slice(0, 300) }, 502);
    }
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "Service IA injoignable." }, 502);
  }

  const text = Array.isArray(body.content)
    ? (body.content as { text?: string }[]).map((part) => part.text || "").join("")
    : "";

  let result;
  try {
    result = normalize(extractJson(text) as Record<string, unknown>, known);
  } catch {
    return json({ ok: false, error: "L’IA n’a pas renvoyé un devis lisible. Reformulez votre dictée." }, 502);
  }

  if (!result.lines.length) {
    return json({ ok: false, error: "Aucune prestation identifiée dans la dictée." }, 422);
  }

  return json({ ok: true, ...result });
});
