/* Suivi client : lit le jeton dans l'adresse et affiche le parcours. */
(function () {
  "use strict";

  var el = function (id) { return document.getElementById(id); };

  function show(node, on) { if (node) node.hidden = !on; }

  function fail(title, text) {
    show(el("loading"), false);
    show(el("view"), false);
    if (title) el("failTitle").textContent = title;
    if (text) el("failText").textContent = text;
    show(el("failed"), true);
  }

  // « 2026-11-14 » est une date sans heure ; un horodatage complet en a une.
  var DATE_SEULE = /^\d{4}-\d{2}-\d{2}$/;

  function lire(valeur) {
    if (DATE_SEULE.test(valeur)) {
      var p = valeur.split("-");
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    return new Date(valeur);
  }

  function dateCourte(valeur) {
    if (!valeur) return "";
    var d = lire(valeur);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }

  function heure(valeur) {
    if (DATE_SEULE.test(valeur)) return "";
    var d = lire(valeur);
    if (isNaN(d.getTime())) return "";
    if (d.getHours() === 0 && d.getMinutes() === 0) return "";
    return " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  // ------------------------------------------------------------ parcours ---
  function renderSteps(steps) {
    var ol = el("steps");
    ol.textContent = "";
    steps.forEach(function (step) {
      var li = document.createElement("li");
      li.className = "sv-step is-" + step.state.replace("_", "");

      var dot = document.createElement("span");
      dot.className = "sv-dot";
      dot.textContent = step.state === "fait" ? "✓" : "";
      li.appendChild(dot);

      var h = document.createElement("h3");
      h.textContent = step.label;
      li.appendChild(h);

      if (step.date) {
        var t = document.createElement("time");
        t.dateTime = step.date;
        t.textContent = dateCourte(step.date) + heure(step.date);
        li.appendChild(t);
      }
      if (step.detail) {
        var p = document.createElement("p");
        p.textContent = step.detail;
        li.appendChild(p);
      }
      ol.appendChild(li);
    });
  }

  // ------------------------------------------------------- avant / après ---
  function setupBeforeAfter(avant, apres) {
    if (!avant.length || !apres.length) return false;
    el("imgBefore").src = avant[0];
    el("imgAfter").src = apres[0];

    var range = el("range"), clip = el("clip"), handle = el("handle");
    var apply = function () {
      var v = Number(range.value);
      clip.style.width = v + "%";
      handle.style.left = v + "%";
    };
    range.addEventListener("input", apply);
    apply();

    // La photo « avant » est découpée en largeur : son image doit garder la
    // taille de la boîte, sinon elle se comprime au lieu de se dévoiler.
    var fit = function () {
      el("imgBefore").style.width = el("baBox").clientWidth + "px";
    };
    fit();
    window.addEventListener("resize", fit);
    el("imgBefore").addEventListener("load", fit);

    show(el("beforeAfter"), true);
    return true;
  }

  function renderProgress(urls) {
    if (!urls.length) return;
    var row = el("progressRow");
    row.textContent = "";
    urls.forEach(function (u, i) {
      var img = document.createElement("img");
      img.src = u;
      img.loading = "lazy";
      img.alt = "Avancement du chantier, photo " + (i + 1);
      row.appendChild(img);
    });
    el("progressHint").textContent = urls.length > 1
      ? urls.length + " photos — faites défiler."
      : "";
    show(el("progress"), true);
  }

  function renderShots(urls) {
    if (!urls.length) return;
    var row = el("shotsRow");
    row.textContent = "";
    urls.slice(0, 6).forEach(function (u, i) {
      var img = document.createElement("img");
      img.src = u;
      img.loading = "lazy";
      img.alt = "Photo " + (i + 1) + " de votre projet";
      row.appendChild(img);
    });
    show(el("shots"), true);
  }

  // ------------------------------------------------------------- contact ---
  function renderContact(artisan) {
    if (!artisan) return;
    if (artisan.telephone) {
      var call = el("callBtn");
      call.href = "tel:" + artisan.telephone.replace(/\s/g, "");
      // Le nom de l'artisan est déjà en haut de page : « Appeler » suffit, et
      // le bouton ne passe pas à la ligne sur un petit écran.
      call.textContent = "Appeler";
      show(call, true);
    }
    if (artisan.email) {
      var mail = el("mailBtn");
      mail.href = "mailto:" + artisan.email + "?subject=" + encodeURIComponent("Ma demande de devis");
      mail.textContent = "Écrire";
      show(mail, true);
    }
    if (!artisan.telephone && !artisan.email) show(el("contact"), false);
  }

  // -------------------------------------------------------- consentement ---
  function setupConsent(token) {
    var done = el("consentDone");
    var answer = function (accepte) {
      el("consentYes").disabled = true;
      el("consentNo").disabled = true;
      // La réponse est gardée sur l'appareil ; c'est l'artisan qui l'enregistre
      // depuis son espace, après vous en avoir parlé.
      try {
        window.localStorage.setItem("suivi:consent:" + token, accepte ? "oui" : "non");
      } catch (e) { /* navigation privée : sans importance */ }
      done.textContent = accepte
        ? "Merci. Dites-le à votre artisan, il pourra alors publier ces photos."
        : "C’est noté. Vos photos resteront privées.";
      show(done, true);
    };
    el("consentYes").addEventListener("click", function () { answer(true); });
    el("consentNo").addEventListener("click", function () { answer(false); });
  }

  // ------------------------------------------------------------ démarrage --
  (async function start() {
    var params = new URLSearchParams(window.location.search);
    var token = (params.get("t") || params.get("token") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(token)) {
      fail("Lien incomplet", "Ce lien ne semble pas complet. Vérifiez le message reçu, ou demandez-en un nouveau à votre artisan.");
      return;
    }

    var conf = window.DEVIS_SUPABASE || {};
    var ok = String(conf.url || "").indexOf("https://") === 0 && String(conf.anonKey || "").length > 20;
    if (!ok || !window.supabase || typeof window.supabase.createClient !== "function") {
      fail("Suivi indisponible", "Le service de suivi n’est pas joignable pour le moment. Réessayez dans un instant.");
      return;
    }

    var sb = window.supabase.createClient(conf.url, conf.anonKey);
    var data;
    try {
      var res = await sb.functions.invoke("suivi", { body: { token: token } });
      data = res.data;
      if (res.error && !data) throw res.error;
    } catch (e) {
      fail("Suivi indisponible", "Le service de suivi ne répond pas. Réessayez dans un instant.");
      return;
    }
    if (!data || data.ok === false) {
      fail("Lien introuvable", (data && data.error) || "Ce lien de suivi n’est plus valable.");
      return;
    }

    var prenom = (data.client && data.client.prenom) || "";
    el("hello").textContent = prenom ? "Bonjour " + prenom + "," : "Votre projet";
    el("subline").textContent = data.termine
      ? "Votre chantier est terminé. Voici le résultat."
      : "Voici où en est votre projet. Cette page se met à jour toute seule.";

    if (data.artisan && data.artisan.nom) {
      el("artisanLine").textContent = data.artisan.metier
        ? data.artisan.nom + " · " + data.artisan.metier
        : data.artisan.nom;
      el("contactLead").textContent = data.artisan.nom + " répond directement.";
    }

    renderSteps(data.steps || []);

    var photos = data.photos || { avant: [], apres: [] };
    var paire = setupBeforeAfter(photos.avant || [], photos.apres || []);
    renderProgress(photos.pendant || []);
    // Les photos de la demande ne s'affichent que tant qu'il n'y a rien d'autre
    // à montrer : une fois le chantier lancé, l'avancement les remplace.
    if (!paire && !(photos.pendant || []).length) renderShots(photos.avant || []);

    renderContact(data.artisan);

    if (data.demande_consentement) {
      setupConsent(token);
      show(el("consent"), true);
    }

    show(el("loading"), false);
    show(el("view"), true);
    document.title = prenom ? "Suivi — " + prenom : "Suivi de votre projet";
  })();
})();
