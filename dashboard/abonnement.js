/**
 * Abonnement : offres Stripe, état de l'abonnement, paiement et gestion.
 */
(async function () {
  const store = window.DevisStore;
  const billing = window.DevisBilling;
  await store.ready();
  store.seedIfEmpty();

  if (!(await store.hasSession())) {
    window.location.href = "./index.html";
    return;
  }

  const $ = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // ---------- Barre latérale ----------
  const logoutBtn = $("logout");
  if (logoutBtn && !store.authRequired()) logoutBtn.hidden = true;
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await store.logout();
      window.location.href = "./index.html";
    });
  }
  const artisan = store.currentArtisan() || {};
  if (artisan.displayName) {
    $("brandName").textContent = artisan.displayName;
    $("brandMetier").textContent = artisan.ville ? artisan.metier + " · " + artisan.ville : artisan.metier;
    $("linkWidget").href = "../widget/index.html" + store.artisanQuery(artisan);
    document.title = artisan.displayName + " — Abonnement";
  }

  // ---------- Retour de Stripe ----------
  const retour = new URLSearchParams(location.search).get("retour");
  if (retour === "ok") $("flashOk").hidden = false;
  if (retour === "annule") $("flashCancel").hidden = false;
  if (retour) history.replaceState(null, "", location.pathname);

  function showError(message) {
    $("abError").hidden = false;
    $("abError").textContent = message;
  }

  const STATUS = {
    none: { title: "Pas encore d’abonnement", sub: "Choisissez une offre ci-dessous pour activer votre espace." },
    active: { title: "Abonnement actif", sub: "" },
    trialing: { title: "Période d’essai en cours", sub: "" },
    past_due: { title: "Paiement en attente", sub: "Le dernier prélèvement a échoué. Mettez à jour votre carte dans « Gérer mon abonnement »." },
    unpaid: { title: "Abonnement impayé", sub: "Mettez à jour votre moyen de paiement dans « Gérer mon abonnement »." },
    canceled: { title: "Abonnement résilié", sub: "Vous pouvez reprendre une offre quand vous voulez." },
    incomplete: { title: "Paiement à finaliser", sub: "Le paiement n’a pas abouti. Réessayez en choisissant une offre." },
    incomplete_expired: { title: "Paiement expiré", sub: "Choisissez à nouveau une offre pour vous abonner." },
  };

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
  const fmtPrice = (p) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: (p.currency || "eur").toUpperCase() }).format(p.amount);
  const per = (interval) => ({ month: "par mois", year: "par an", week: "par semaine", day: "par jour" }[interval] || "");

  let current = { plan: "", status: "none" };
  let plans = [];

  function renderStatus() {
    const s = STATUS[current.status] || { title: "Abonnement : " + current.status, sub: "" };
    const plan = plans.find((p) => p.key === current.plan);
    $("stTitle").textContent = s.title + (plan && current.status !== "none" ? " · " + plan.name : "");
    let sub = s.sub;
    if ((current.status === "active" || current.status === "trialing") && current.current_period_end) {
      sub = current.cancel_at_period_end
        ? "Résiliation programmée : accès jusqu’au " + fmtDate(current.current_period_end) + "."
        : "Prochain renouvellement le " + fmtDate(current.current_period_end) + ".";
    }
    $("stSub").textContent = sub;
    $("btnPortal").hidden = current.status === "none";
    $("statusPanel").classList.toggle("is-active", current.status === "active" || current.status === "trialing");
  }

  function renderPlans() {
    const subscribed = ["active", "trialing", "past_due"].includes(current.status);
    if (!plans.length) {
      $("plans").innerHTML = '<p class="ab-empty">Aucune offre n’est encore disponible.</p>';
      return;
    }
    $("plans").innerHTML = plans
      .map((p) => {
        const mine = subscribed && p.key === current.plan;
        return (
          '<article class="ab-plan' + (mine ? " is-mine" : "") + '">' +
          "<h3>" + esc(p.name) + "</h3>" +
          '<p class="ab-price"><strong>' + esc(fmtPrice(p)) + "</strong> <span>HT " + esc(per(p.interval)) + "</span></p>" +
          (p.description ? '<p class="ab-desc">' + esc(p.description) + "</p>" : "") +
          (mine
            ? '<p class="ab-mine">Votre offre actuelle</p>'
            : subscribed
              ? '<button type="button" class="btn btn-ghost" data-portal>Changer d’offre</button>'
              : '<button type="button" class="btn btn-gold" data-plan="' + esc(p.key) + '">Choisir ' + esc(p.name) + "</button>") +
          "</article>"
        );
      })
      .join("");
  }

  $("plans").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-plan], [data-portal]");
    if (!btn) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Ouverture de Stripe…";
    try {
      if (btn.dataset.plan) await billing.checkout(btn.dataset.plan);
      else await billing.portal();
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  $("btnPortal").addEventListener("click", async () => {
    $("btnPortal").disabled = true;
    try {
      await billing.portal();
    } catch (err) {
      showError(err.message);
      $("btnPortal").disabled = false;
    }
  });

  // ---------- Chargement ----------
  if (!billing.configured() || store.backend !== "supabase") {
    $("stTitle").textContent = "Paiement indisponible en démo";
    $("stSub").textContent = "L’abonnement se gère avec le compte cloud (Supabase). En démo locale, rien n’est facturé.";
    $("plans").innerHTML = "";
    return;
  }

  try {
    plans = await billing.plans();
  } catch (err) {
    $("stTitle").textContent = "Paiement pas encore activé";
    $("stSub").textContent =
      err.code === "stripe_not_configured"
        ? "Stripe n’est pas encore relié à ce site. Les offres apparaîtront ici dès que la configuration sera faite."
        : err.message;
    $("plans").innerHTML = "";
    return;
  }

  if (!(await billing.hasSession())) {
    current = { plan: "", status: "none" };
    renderStatus();
    renderPlans();
    $("stSub").textContent = "Connectez-vous avec votre compte artisan pour vous abonner.";
    for (const b of $("plans").querySelectorAll("[data-plan]")) b.disabled = true;
    return;
  }

  try {
    current = await billing.status();
  } catch (err) {
    showError(err.message);
  }
  renderStatus();
  renderPlans();
})();
