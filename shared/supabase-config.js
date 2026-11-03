/**
 * Clé publishable uniquement (safe dans le navigateur).
 * La clé sb_secret ne doit jamais arriver ici.
 */
window.DEVIS_SUPABASE = {
  url: "https://eqqrvnmjnoudncfuwsxt.supabase.co",
  anonKey: "sb_publishable_5dMs5Ukb65rQ4WFiS5FE_w_Nj0nMpVk",
  artisanPublicId: "art_demo_01",
  // true : l’espace artisan demande une connexion (mot de passe, puis code
  // e-mail / SMS sur un appareil inconnu).
  // Repasser à false ouvre le dashboard à n’importe quel visiteur : à réserver
  // à une démonstration, jamais avec de vraies données clients.
  authRequired: true,
};
