// Textes des relances : modèle fixe (toujours disponible) et rédaction par l'IA.

export type Step = { offset: number; label: string; tone: number };
export type Invoice = {
  number: string;
  client: string;
  label: string;
  amount: number;
  due: string; // AAAA-MM-JJ
  remindersSent: number;
};
export type Methods = Record<string, { on?: boolean; value?: string }>;

export const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n) || 0).replace(/ /g, " ");

export const dfr = (iso: string) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function todayParis() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
}

// Même règle que l'écran Paiements : dernière étape atteinte et pas encore envoyée.
export function dueStep(steps: Step[], due: string, lastStep: number, today = todayParis()) {
  const late = daysBetween(due, today);
  let idx = -1;
  steps.forEach((s, i) => {
    if (Number(s.offset) <= late) idx = i;
  });
  return idx >= (lastStep || 0) ? idx : -1;
}

export function payLines(methods: Methods, iban = "", link = "") {
  const ms: Methods = { ...(methods || {}) };
  if (iban && !(ms.virement && ms.virement.value)) ms.virement = { on: true, value: iban };
  if (link && !(ms.lien && ms.lien.value)) ms.lien = { on: true, value: link };
  const v = (k: string) => String((ms[k] && ms[k].value) || "").trim();
  const on = (k: string) => Boolean(ms[k] && ms[k].on);
  const lines: string[] = [];
  if (on("virement")) lines.push(v("virement") ? `- Virement : ${v("virement")}` : "- Virement bancaire");
  if (on("cheque")) lines.push(v("cheque") ? `- Chèque à l’ordre de ${v("cheque")}` : "- Chèque");
  if (on("especes")) lines.push("- Espèces, lors de notre passage");
  if (on("carte")) lines.push("- Carte bancaire, lors de notre passage");
  if (on("paypal")) lines.push(v("paypal") ? `- PayPal : ${v("paypal")}` : "- PayPal");
  if (on("wero")) lines.push(v("wero") ? `- Wero : ${v("wero")}` : "- Wero");
  if (on("lien") && v("lien")) lines.push(`- Paiement en ligne : ${v("lien")}`);
  return lines.join("\n");
}

export function templateMessage(inv: Invoice, step: Step, pay: string, artisanName: string, today = todayParis()) {
  const late = daysBetween(inv.due, today);
  const amount = eur(inv.amount);
  const payBlock = pay ? `\n\nPour régler, au choix :\n${pay}` : "";
  const hello = `Bonjour ${inv.client},`;
  const ref = `la facture ${inv.number}${inv.label ? " (" + inv.label + ")" : ""} d’un montant de ${amount}`;
  const tone = Number(step.tone) || 1;
  let subject: string;
  let body: string;
  if (tone <= 1) {
    subject = `Rappel : facture ${inv.number} à régler le ${dfr(inv.due)}`;
    body = `${hello}\n\nPetit rappel amical : ${ref} arrive à échéance le ${dfr(inv.due)}.${payBlock}\n\nSi le règlement est déjà parti, merci et ne tenez pas compte de ce message.`;
  } else if (tone === 2) {
    subject = `Facture ${inv.number} en attente de règlement`;
    body = `${hello}\n\nSauf erreur de notre part, ${ref}, échue le ${dfr(inv.due)}, n’a pas encore été réglée.\n\nPourriez-vous procéder au paiement dans les prochains jours ?${payBlock}\n\nUn souci sur la facture ? Répondez simplement à ce message.`;
  } else if (tone === 3) {
    subject = `Relance : facture ${inv.number} impayée depuis ${late} jours`;
    body = `${hello}\n\nMalgré notre précédent rappel, ${ref} reste impayée ${late} jours après son échéance du ${dfr(inv.due)}.\n\nNous vous remercions de régulariser sous 8 jours.${payBlock}`;
  } else {
    subject = `Mise en demeure de payer — facture ${inv.number}`;
    body = `${hello}\n\nNos relances concernant ${ref}, échue le ${dfr(inv.due)}, sont restées sans effet.\n\nPar la présente, nous vous mettons en demeure de régler cette somme sous 8 jours. À défaut, nous engagerons une procédure de recouvrement ; des pénalités de retard et l’indemnité forfaitaire de 40 € (art. L441-10 du Code de commerce) pourront s’appliquer.${payBlock}`;
  }
  return { subject, body: `${body}\n\nCordialement,\n${artisanName}` };
}

const TONES: Record<number, string> = {
  1: "rappel cordial avant ou le jour de l’échéance : chaleureux, sans reproche",
  2: "première relance après l’échéance : courtoise, suppose un oubli",
  3: "relance ferme : polie mais claire, demande un règlement sous 8 jours",
  4: "mise en demeure : formelle, factuelle, mentionne le délai de 8 jours, les pénalités de retard et l’indemnité forfaitaire de 40 € (art. L441-10 du Code de commerce)",
};

// Rédaction par l'IA. Renvoie null si l'IA est indisponible ou si le texte ne respecte pas les règles.
export async function aiMessage(
  apiKey: string,
  inv: Invoice,
  step: Step,
  pay: string,
  artisanName: string,
  today = todayParis(),
): Promise<{ subject: string; body: string } | null> {
  if (!apiKey) return null;
  const late = daysBetween(inv.due, today);
  const tone = Math.min(4, Math.max(1, Number(step.tone) || 1));
  const facts = {
    artisan: artisanName,
    client: inv.client,
    facture: inv.number,
    objet: inv.label || "",
    montant: eur(inv.amount),
    echeance: dfr(inv.due),
    jours_de_retard: late > 0 ? late : 0,
    relances_deja_envoyees: inv.remindersSent,
    etape: step.label,
  };
  const system = `Tu rédiges, en français, un e-mail de relance de facture envoyé par un artisan à son client particulier.
Ton à adopter : ${TONES[tone]}.
Règles strictes :
- N’invente aucun fait, montant, date, nom ni condition. Utilise uniquement les données fournies.
- Mentionne le numéro de facture et le montant exactement comme fournis.
- Termine le corps par le bloc « Pour régler, au choix : » suivi des moyens de paiement, recopiés mot pour mot, s’il y en a.
- Signe avec le nom de l’artisan, précédé de « Cordialement, ».
- Phrases courtes, vouvoiement, pas d’emoji, pas de markdown. 120 mots maximum hors moyens de paiement.
Réponds UNIQUEMENT par un JSON : {"subject": string, "body": string}`;
  const user = `Données : ${JSON.stringify(facts)}\nMoyens de paiement (à recopier tels quels) :\n${pay || "(aucun)"}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("REMINDER_MODEL") || "claude-sonnet-4-6",
        max_tokens: 700,
        temperature: 0.4,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = Array.isArray(data.content) ? data.content.map((p: { text?: string }) => p.text || "").join("") : "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const out = JSON.parse(text.slice(start, end + 1));
    const subject = String(out.subject || "").trim().slice(0, 160);
    const body = String(out.body || "").trim();
    // Garde-fous : le texte doit citer la facture et le montant, et reprendre les moyens de paiement.
    const amountDigits = eur(inv.amount).replace(/\D/g, "");
    if (!subject || !body) return null;
    if (!body.includes(inv.number)) return null;
    if (!body.replace(/\D/g, "").includes(amountDigits)) return null;
    if (pay && !pay.split("\n").every((line) => body.includes(line.replace(/^- /, "").trim()))) return null;
    return { subject, body };
  } catch {
    return null;
  }
}
