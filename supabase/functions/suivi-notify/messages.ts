// Textes envoyés au client. Écrits à la main, pas par l'IA : ce sont des
// messages courts et factuels, où une tournure inventée ferait plus de mal que
// de bien. L'IA reste pour ce qui demande du jugement, comme chiffrer un devis.

export type Lead = {
  prenom: string;
  travaux: string;
  devis_promis_le: string | null;
  lien: string;
};

export type Artisan = { nom: string; telephone: string };

export type Message = { subject: string; body: string };

const salut = (l: Lead) => (l.prenom ? "Bonjour " + l.prenom + "," : "Bonjour,");

const signature = (a: Artisan) =>
  "\n\n" + a.nom + (a.telephone ? "\n" + a.telephone : "");

const suivre = (l: Lead) =>
  "\n\nVous pouvez suivre votre projet ici, à tout moment :\n" + l.lien;

const jourFr = (iso: string | null) => {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
    : new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
};

export function build(kind: string, lead: Lead, artisan: Artisan): Message | null {
  const quoi = lead.travaux ? " pour vos travaux de " + lead.travaux : "";

  switch (kind) {
    case "devis_annonce":
      return {
        subject: "Votre devis arrive",
        body:
          salut(lead) +
          "\n\nJ’ai bien votre demande" + quoi + ". Je prépare votre devis, " +
          (lead.devis_promis_le
            ? "vous le recevrez " + jourFr(lead.devis_promis_le) + "."
            : "vous le recevrez très vite.") +
          suivre(lead) + signature(artisan),
      };

    case "devis_pret":
      return {
        subject: "Votre devis est prêt",
        body:
          salut(lead) +
          "\n\nVotre devis" + quoi + " est prêt. Prenez le temps de le lire : " +
          "si une ligne n’est pas claire, appelez-moi, je vous l’explique." +
          suivre(lead) + signature(artisan),
      };

    // Les trois relances n'escaladent pas. Un client qui n'a pas répondu n'est
    // pas un mauvais payeur : il hésite, ou il a oublié. Le ton reste le même.
    case "relance_1":
      return {
        subject: "Vous avez bien reçu mon devis ?",
        body:
          salut(lead) +
          "\n\nJe voulais juste m’assurer que mon devis vous est bien parvenu — " +
          "il arrive qu’un message se perde." +
          suivre(lead) + signature(artisan),
      };

    case "relance_2":
      return {
        subject: "Une question sur le devis ?",
        body:
          salut(lead) +
          "\n\nSi quelque chose vous retient dans le devis — une ligne, un délai, " +
          "un montant — dites-le moi. On peut souvent ajuster, et je préfère en " +
          "parler plutôt que vous laisser hésiter." +
          suivre(lead) + signature(artisan),
      };

    case "relance_3":
      return {
        subject: "Mon devis arrive à échéance",
        body:
          salut(lead) +
          "\n\nMon devis arrive bientôt au bout de sa durée de validité. " +
          "Si le projet se fait plus tard, ce n’est pas un souci : dites-le moi " +
          "et je vous en referai un, aux prix du moment." +
          suivre(lead) + signature(artisan),
      };

    case "chantier_demain":
      return {
        subject: "On démarre demain",
        body:
          salut(lead) +
          "\n\nPetit rappel : le chantier commence demain. Merci de dégager " +
          "l’accès et de protéger ce qui doit l’être. À demain." +
          suivre(lead) + signature(artisan),
      };

    case "avancement":
      return {
        subject: "Des nouvelles de votre chantier",
        body:
          salut(lead) +
          "\n\nJ’ai ajouté des photos de l’avancement sur votre page de suivi." +
          suivre(lead) + signature(artisan),
      };

    case "chantier_fini":
      return {
        subject: "Votre chantier est terminé",
        body:
          salut(lead) +
          "\n\nC’est terminé. Vous trouverez l’avant/après sur votre page de suivi. " +
          "Si quelque chose ne vous convient pas, dites-le moi, je repasse." +
          suivre(lead) + signature(artisan),
      };

    default:
      return null;
  }
}
