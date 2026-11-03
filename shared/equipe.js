/**
 * Équipe : membres d'une entreprise et leurs rôles.
 * Les droits sont tenus par la base (règles d'accès). Ce fichier ne fait que
 * lire et écrire ; il ne décide de rien.
 */
(function (global) {
  "use strict";

  var client = null;

  function getClient() {
    if (client) return client;
    var c = global.DEVIS_SUPABASE || {};
    var ok = String(c.url || "").indexOf("https://") === 0 && String(c.anonKey || "").length > 20;
    if (!ok || !global.supabase || typeof global.supabase.createClient !== "function") return null;
    client = global.supabase.createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return client;
  }

  async function session() {
    var sb = getClient();
    if (!sb) return null;
    try {
      var res = await sb.auth.getSession();
      return res && res.data && res.data.session ? sb : null;
    } catch (e) {
      return null;
    }
  }

  function missingTable(message) {
    return /dv_members|schema cache|does not exist|relation/i.test(String(message || ""));
  }

  var NOT_READY =
    "La table des membres n’est pas encore en base. Exécutez la migration " +
    "20261103120000_roles_equipe.sql dans le SQL Editor Supabase.";

  var ROLES = [
    {
      value: "patron",
      label: "Patron",
      help: "Tout : clients, prix, devis, paiements, réglages et équipe.",
    },
    {
      value: "salarie",
      label: "Salarié",
      help: "Les demandes et les chantiers. Ne voit ni les prix, ni les paiements.",
    },
    {
      value: "comptable",
      label: "Comptable",
      help: "Les paiements et les factures. Les demandes en lecture seule, pas les prix.",
    },
  ];

  global.DevisEquipe = {
    roles: ROLES,

    roleLabel: function (value) {
      for (var i = 0; i < ROLES.length; i++) if (ROLES[i].value === value) return ROLES[i].label;
      return value || "";
    },

    async available() {
      return Boolean(await session());
    },

    /** L'entreprise courante et mon rôle dedans. */
    async context() {
      var sb = await session();
      if (!sb) return null;
      var who = await sb.auth.getUser();
      var uid = who && who.data && who.data.user ? who.data.user.id : null;
      if (!uid) return null;

      var mine = await sb.rpc("dv_my_artisan_ids");
      if (mine.error) {
        if (missingTable(mine.error.message)) throw new Error(NOT_READY);
        throw new Error(mine.error.message);
      }
      var ids = (mine.data || []).map(function (row) {
        return typeof row === "object" ? row.dv_my_artisan_ids : row;
      });
      if (!ids.length) return null;
      var artisanId = ids[0];

      var role = await sb.rpc("dv_my_role", { p_artisan_id: artisanId });
      if (role.error) throw new Error(role.error.message);

      var art = await sb.from("dv_artisans").select("id, display_name").eq("id", artisanId).maybeSingle();
      return {
        artisanId: artisanId,
        artisanName: art.data ? art.data.display_name : "",
        myUserId: uid,
        myRole: role.data || "",
      };
    },

    async list(artisanId) {
      var sb = await session();
      if (!sb) throw new Error("Connexion requise.");
      var res = await sb
        .from("dv_members")
        .select("id, email, display_name, role, status, auth_user_id, created_at")
        .eq("artisan_id", artisanId)
        .order("created_at", { ascending: true });
      if (res.error) {
        if (missingTable(res.error.message)) throw new Error(NOT_READY);
        throw new Error(res.error.message);
      }
      return res.data || [];
    },

    /**
     * Ajoute un membre par son adresse. Il n'a pas besoin d'un compte :
     * sa ligne se rattachera d'elle-même quand il s'inscrira avec cette adresse.
     */
    async add(artisanId, email, role, displayName) {
      var sb = await session();
      if (!sb) throw new Error("Connexion requise.");
      var clean = String(email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
        throw new Error("Cette adresse électronique n’est pas valide.");
      }
      var res = await sb.from("dv_members").insert({
        artisan_id: artisanId,
        email: clean,
        display_name: String(displayName || "").trim() || null,
        role: role,
        status: "invite",
      });
      if (res.error) {
        if (/duplicate key|uq_dv_members_email/i.test(res.error.message || "")) {
          throw new Error("Cette adresse fait déjà partie de l’équipe.");
        }
        if (missingTable(res.error.message)) throw new Error(NOT_READY);
        if (/row-level security|permission/i.test(res.error.message || "")) {
          throw new Error("Seul le patron peut ajouter un membre.");
        }
        throw new Error(res.error.message);
      }
      return true;
    },

    async setRole(memberId, role) {
      var sb = await session();
      if (!sb) throw new Error("Connexion requise.");
      var res = await sb.from("dv_members").update({ role: role }).eq("id", memberId);
      if (res.error) {
        if (/row-level security|permission/i.test(res.error.message || "")) {
          throw new Error("Seul le patron peut changer un rôle.");
        }
        throw new Error(res.error.message);
      }
      return true;
    },

    async setStatus(memberId, status) {
      var sb = await session();
      if (!sb) throw new Error("Connexion requise.");
      var res = await sb.from("dv_members").update({ status: status }).eq("id", memberId);
      if (res.error) throw new Error(res.error.message);
      return true;
    },

    async remove(memberId) {
      var sb = await session();
      if (!sb) throw new Error("Connexion requise.");
      var res = await sb.from("dv_members").delete().eq("id", memberId);
      if (res.error) {
        if (/row-level security|permission/i.test(res.error.message || "")) {
          throw new Error("Seul le patron peut retirer un membre.");
        }
        throw new Error(res.error.message);
      }
      return true;
    },
  };
})(window);
