/* Équipe : affichage des rôles, ajout et gestion des membres. */
(function () {
  "use strict";

  var store = window.DevisStore;
  var api = window.DevisEquipe;
  var el = function (id) { return document.getElementById(id); };

  var ctx = null;

  function show(node, message) {
    if (!node) return;
    if (!message) { node.hidden = true; node.textContent = ""; return; }
    node.textContent = message;
    node.hidden = false;
  }

  // ------------------------------------------------- les rôles expliqués ---
  function renderRoles() {
    var box = el("roleCards");
    box.textContent = "";
    api.roles.forEach(function (role) {
      var card = document.createElement("div");
      card.className = "eq-role" + (ctx && ctx.myRole === role.value ? " is-mine" : "");
      var title = document.createElement("strong");
      title.textContent = role.label;
      var help = document.createElement("span");
      help.textContent = role.help;
      card.appendChild(title);
      card.appendChild(help);
      box.appendChild(card);
    });

    var select = el("newRole");
    select.textContent = "";
    api.roles.forEach(function (role) {
      var opt = document.createElement("option");
      opt.value = role.value;
      opt.textContent = role.label;
      if (role.value === "salarie") opt.selected = true;
      select.appendChild(opt);
    });
  }

  // ------------------------------------------------------ liste membres ---
  async function loadMembers() {
    var list = el("memberList");
    list.textContent = "";
    var members;
    try {
      members = await api.list(ctx.artisanId);
    } catch (err) {
      show(el("pageError"), err.message);
      return;
    }
    show(el("pageError"), "");
    el("listEmpty").hidden = members.length > 0;

    var isPatron = ctx.myRole === "patron";
    var patrons = members.filter(function (m) { return m.role === "patron"; }).length;

    members.forEach(function (member) {
      var isMe = member.auth_user_id && member.auth_user_id === ctx.myUserId;
      var li = document.createElement("li");
      li.className = "eq-item";

      var main = document.createElement("div");
      main.className = "eq-item-main";
      var name = document.createElement("strong");
      name.textContent = member.display_name || member.email;
      var sub = document.createElement("span");
      sub.textContent = member.display_name ? member.email : "";
      main.appendChild(name);
      if (sub.textContent) main.appendChild(sub);
      li.appendChild(main);

      if (isMe) {
        var moi = document.createElement("span");
        moi.className = "eq-tag is-moi";
        moi.textContent = "vous";
        li.appendChild(moi);
      }
      if (member.status === "invite") {
        var inv = document.createElement("span");
        inv.className = "eq-tag is-invite";
        inv.textContent = "compte à créer";
        inv.title = "Cette personne doit s’inscrire avec cette adresse pour que son accès s’ouvre.";
        li.appendChild(inv);
      }
      if (member.status === "suspendu") {
        var sus = document.createElement("span");
        sus.className = "eq-tag is-suspendu";
        sus.textContent = "suspendu";
        li.appendChild(sus);
      }

      var actions = document.createElement("div");
      actions.className = "eq-item-actions";

      if (!isPatron) {
        var ro = document.createElement("span");
        ro.className = "eq-readonly";
        ro.textContent = api.roleLabel(member.role);
        actions.appendChild(ro);
      } else {
        var select = document.createElement("select");
        select.setAttribute("aria-label", "Rôle de " + (member.display_name || member.email));
        api.roles.forEach(function (role) {
          var opt = document.createElement("option");
          opt.value = role.value;
          opt.textContent = role.label;
          if (role.value === member.role) opt.selected = true;
          select.appendChild(opt);
        });
        // Garde-fou : ne pas retirer le dernier patron, personne ne pourrait
        // plus gérer l'équipe ni les prix.
        var lastPatron = member.role === "patron" && patrons === 1;
        if (lastPatron) {
          select.disabled = true;
          select.title = "C’est le seul patron : nommez-en un autre avant de changer ce rôle.";
        }
        select.addEventListener("change", async function () {
          var before = member.role;
          select.disabled = true;
          try {
            await api.setRole(member.id, select.value);
            await loadMembers();
          } catch (err) {
            show(el("pageError"), err.message);
            select.value = before;
            select.disabled = false;
          }
        });
        actions.appendChild(select);

        if (!lastPatron) {
          var del = document.createElement("button");
          del.type = "button";
          del.className = "eq-del";
          del.textContent = isMe ? "Quitter" : "Retirer";
          del.addEventListener("click", async function () {
            del.disabled = true;
            try {
              await api.remove(member.id);
              if (isMe) { window.location.href = "index.html"; return; }
              await loadMembers();
            } catch (err) {
              show(el("pageError"), err.message);
              del.disabled = false;
            }
          });
          actions.appendChild(del);
        }
      }

      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  // ------------------------------------------------------------ ajout ----
  el("addBtn").addEventListener("click", async function () {
    show(el("addError"), ""); show(el("addOk"), "");
    var email = el("newEmail").value.trim();
    var role = el("newRole").value;
    var name = el("newName").value.trim();
    var btn = el("addBtn");
    btn.disabled = true;
    try {
      await api.add(ctx.artisanId, email, role, name);
      el("newEmail").value = "";
      el("newName").value = "";
      show(el("addOk"),
        email + " a été ajouté comme " + api.roleLabel(role).toLowerCase() +
        ". Dites-lui de créer son compte avec cette adresse : son accès s’ouvrira tout seul.");
      await loadMembers();
    } catch (err) {
      show(el("addError"), err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // --------------------------------------------------------- démarrage ---
  (async function start() {
    try {
      if (store && store.ready) await store.ready();
    } catch (e) { /* hors ligne */ }
    try {
      var artisan = store && store.currentArtisan ? store.currentArtisan() : null;
      if (artisan) {
        if (artisan.displayName) el("brandName").textContent = artisan.displayName;
        if (artisan.metier) el("brandMetier").textContent = artisan.metier;
      }
    } catch (e) { /* ignoré */ }

    var logout = el("logout");
    if (logout && store && store.authRequired && !store.authRequired()) logout.hidden = true;
    if (logout) logout.addEventListener("click", function () {
      if (store && store.logout) store.logout();
      window.location.href = "index.html";
    });

    // Hors compte cloud : on explique les rôles, sans liste de membres.
    function showRolesOnly(message) {
      renderRoles();
      el("listEmpty").hidden = false;
      el("listEmpty").textContent = "La liste des membres demande le compte cloud.";
      show(el("pageError"), message);
    }

    if (!(await api.available())) {
      showRolesOnly(
        "L’équipe se gère avec le compte cloud de l’atelier : les rôles sont tenus par la base de données. Connectez-vous pour ajouter quelqu’un.");
      return;
    }

    try {
      ctx = await api.context();
    } catch (err) {
      showRolesOnly(err.message);
      return;
    }
    if (!ctx) {
      showRolesOnly("Aucun atelier lié à ce compte.");
      return;
    }

    renderRoles();
    show(el("roleBadge"), "Vous êtes " + api.roleLabel(ctx.myRole).toLowerCase() +
      (ctx.artisanName ? " chez " + ctx.artisanName : ""));
    el("addPanel").hidden = ctx.myRole !== "patron";
    await loadMembers();
  })();
})();
