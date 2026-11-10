// Quel message doit partir pour une demande — et surtout, lequel ne doit pas.
//
// Logique pure, sans base ni réseau, pour être testable : c'est ici qu'une
// erreur enverrait deux fois le même courriel à un client.

export type Row = Record<string, unknown>;

// Cadence des relances avant signature, en jours depuis l'envoi du devis.
const RELANCES: { jour: number; kind: string }[] = [
  { jour: 2, kind: "relance_1" },
  { jour: 7, kind: "relance_2" },
  { jour: 15, kind: "relance_3" },
];

export const jours = (depuis: string | null, maintenant: Date) => {
  if (!depuis) return -1;
  const d = new Date(depuis);
  if (isNaN(d.getTime())) return -1;
  return Math.floor((maintenant.getTime() - d.getTime()) / 86400000);
};

/** Ce qui doit partir pour une demande, au plus un message par passage. */
export function aEnvoyer(lead: Row, dejaEnvoyes: Set<string>, events: Row[], photos: Row[], now: Date): string | null {
  const statut = String(lead.status || "");
  // Une affaire perdue ou archivée ne reçoit plus rien.
  if (statut === "perdu" || statut === "archive") return null;

  const apres = photos.some((p) => p.phase === "apres");
  const pendantAujourdhui = photos.some(
    (p) => p.phase === "pendant" && String(p.created_at || "").slice(0, 10) === now.toISOString().slice(0, 10),
  );

  if (apres && !dejaEnvoyes.has("chantier_fini")) return "chantier_fini";
  if (pendantAujourdhui && !dejaEnvoyes.has("avancement")) return "avancement";

  const chantier = events.find((e) => e.kind === "chantier");
  if (chantier && !dejaEnvoyes.has("chantier_demain")) {
    const debut = new Date(String(chantier.starts_at));
    const delta = Math.floor((debut.getTime() - now.getTime()) / 86400000);
    if (delta === 0 || delta === 1) return "chantier_demain";
  }

  if (statut === "devis_envoye") {
    if (!dejaEnvoyes.has("devis_pret")) return "devis_pret";
    const age = jours(String(lead.devis_envoye_le || "") || null, now);
    // On prend la relance la plus avancée qui est due et pas encore partie :
    // un artisan qui active l'envoi après coup ne déclenche pas la série entière.
    for (let i = RELANCES.length - 1; i >= 0; i--) {
      const r = RELANCES[i];
      if (age >= r.jour && !dejaEnvoyes.has(r.kind)) return r.kind;
    }
    return null;
  }

  if (lead.devis_promis_le && !dejaEnvoyes.has("devis_annonce")) return "devis_annonce";
  return null;
}
