/**
 * Lecture d'un fichier de clients exporté d'un CRM ou d'un tableur.
 *
 * Fonctions pures, sans accès au réseau ni au DOM, pour être testables :
 * décodage du fichier, découpage du CSV, reconnaissance des colonnes,
 * normalisation des fiches et repérage des doublons.
 */
(function (global) {
  "use strict";

  // --------------------------------------------------------- décodage ------
  /**
   * Les tableurs français exportent souvent en Windows-1252 : décodé en UTF-8,
   * « Benoît » devient « Beno?t ». On tente l'UTF-8 strict, et on retombe sur
   * Windows-1252 dès qu'un octet est invalide.
   */
  function decodeBytes(buffer) {
    var bytes = new Uint8Array(buffer);
    // Marque d'ordre des octets UTF-8 : on la retire, elle polluerait l'en-tête.
    if (bytes.length > 2 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      bytes = bytes.subarray(3);
    }
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        encoding: "UTF-8",
      };
    } catch (e) {
      return {
        text: new TextDecoder("windows-1252").decode(bytes),
        encoding: "Windows-1252",
      };
    }
  }

  // ------------------------------------------------------- découpage CSV ---
  /** Séparateur le plus probable : celui qui donne le plus de colonnes stables. */
  function sniffDelimiter(text) {
    var sample = text.split(/\r?\n/).slice(0, 12).filter(function (l) { return l.trim(); });
    if (!sample.length) return ";";
    var best = ";", bestScore = -1;
    [";", ",", "\t", "|"].forEach(function (d) {
      var counts = sample.map(function (line) { return splitLine(line, d).length; });
      var first = counts[0];
      if (first < 2) return;
      var stable = counts.filter(function (c) { return c === first; }).length;
      var score = first * 10 + stable;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function splitLine(line, delimiter) {
    var out = [], field = "", quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        out.push(field); field = "";
      } else {
        field += ch;
      }
    }
    out.push(field);
    return out;
  }

  /** Découpe le texte en lignes, en respectant les retours à la ligne entre guillemets. */
  function parse(text, delimiter) {
    var d = delimiter || sniffDelimiter(text);
    var rows = [], field = "", row = [], quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === d) { row.push(field); field = ""; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(function (c) { return c.trim(); })) rows.push(row);
        row = [];
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(function (c) { return c.trim(); })) rows.push(row);

    var headers = (rows.shift() || []).map(function (h) { return h.trim(); });
    return { headers: headers, rows: rows, delimiter: d };
  }

  // -------------------------------------------- reconnaissance des colonnes -
  function slug(s) {
    return String(s || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Les en-têtes des CRM et tableurs les plus courants, français et anglais.
  var PATTERNS = {
    prenom: ["prenom", "first name", "firstname", "given name"],
    nom: ["nom", "nom de famille", "last name", "lastname", "surname", "name", "nom complet",
          "full name", "client", "contact", "raison sociale", "societe", "company"],
    telephone: ["telephone", "tel", "tel portable", "portable", "mobile", "phone", "phone number",
                "numero", "tel fixe", "telephone 1"],
    email: ["email", "e mail", "mail", "courriel", "adresse email", "email address", "mail 1"],
    adresse: ["adresse", "address", "rue", "street", "adresse 1", "address line 1", "voie"],
    code_postal: ["code postal", "cp", "zip", "zipcode", "postal code", "postcode"],
    ville: ["ville", "city", "commune", "localite", "town"],
    notes: ["notes", "note", "commentaire", "commentaires", "remarque", "remarques",
            "description", "comment", "observations"],
  };

  function detectColumns(headers) {
    var map = {};
    var taken = {};
    Object.keys(PATTERNS).forEach(function (field) {
      var best = -1, bestRank = 1e9;
      headers.forEach(function (h, index) {
        if (taken[index]) return;
        var s = slug(h);
        if (!s) return;
        var rank = PATTERNS[field].indexOf(s);
        if (rank < 0) {
          // Correspondance partielle : « tel. portable client » → telephone.
          rank = PATTERNS[field].some(function (p) {
            return s === p || s.indexOf(p + " ") === 0 || s.indexOf(" " + p) >= 0;
          }) ? 50 : -1;
        }
        if (rank >= 0 && rank < bestRank) { bestRank = rank; best = index; }
      });
      if (best >= 0) { map[field] = best; taken[best] = true; }
    });
    return map;
  }

  // ------------------------------------------------------- normalisation ---
  function clean(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  /** Téléphone français : on garde les chiffres et on remet 0X XX XX XX XX. */
  function normalizePhone(raw) {
    var digits = clean(raw).replace(/[^\d+]/g, "");
    if (!digits) return "";
    if (digits.indexOf("+33") === 0) digits = "0" + digits.slice(3);
    else if (digits.indexOf("0033") === 0) digits = "0" + digits.slice(4);
    digits = digits.replace(/\D/g, "");
    if (digits.length === 9 && digits[0] !== "0") digits = "0" + digits;
    if (digits.length !== 10) return clean(raw);
    return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  }

  function normalizeEmail(raw) {
    var v = clean(raw).toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : "";
  }

  function splitName(full) {
    var v = clean(full);
    if (!v) return { prenom: "", nom: "" };
    // « Dupont, Jean » : les exports de CRM écrivent souvent le nom en premier.
    var comma = v.indexOf(",");
    if (comma > 0) {
      var last = clean(v.slice(0, comma));
      var first = clean(v.slice(comma + 1));
      if (last && first) return { prenom: first, nom: last };
    }
    var parts = v.split(" ");
    if (parts.length === 1) return { prenom: v, nom: "" };
    // « M. Jean Dupont » : on écarte la civilité.
    if (/^(m|mr|mme|mlle|monsieur|madame|dr|me)\.?$/i.test(parts[0])) parts.shift();
    if (!parts.length) return { prenom: v, nom: "" };
    if (parts.length === 1) return { prenom: parts[0], nom: "" };
    return { prenom: parts[0], nom: parts.slice(1).join(" ") };
  }

  var POSTAL = /^\d{5}$/;

  /**
   * Transforme les lignes brutes en fiches clients.
   * Renvoie les fiches retenues et celles écartées, avec le motif.
   */
  function toClients(parsed, map) {
    var kept = [], skipped = [];
    parsed.rows.forEach(function (row, index) {
      var at = function (field) {
        var i = map[field];
        return i == null ? "" : clean(row[i]);
      };
      var prenom = at("prenom");
      var nom = at("nom");
      if (!prenom && nom) {
        var split = splitName(nom);
        prenom = split.prenom; nom = split.nom;
      }
      var telephone = normalizePhone(at("telephone"));
      var email = normalizeEmail(at("email"));
      var cp = at("code_postal");
      if (!POSTAL.test(cp)) {
        // Un code postal parfois collé à la ville : « 69100 Villeurbanne ».
        var m = (at("code_postal") + " " + at("ville") + " " + at("adresse")).match(/\b(\d{5})\b/);
        cp = m ? m[1] : "";
      }

      var line = index + 2; // +1 pour l'en-tête, +1 pour compter à partir de 1
      if (!prenom && !nom) {
        skipped.push({ line: line, reason: "pas de nom", raw: row.join(" ").slice(0, 60) });
        return;
      }
      if (!telephone && !email) {
        skipped.push({ line: line, reason: "ni téléphone ni adresse électronique", raw: (prenom + " " + nom).trim() });
        return;
      }
      kept.push({
        line: line,
        prenom: prenom.slice(0, 80),
        nom: nom.slice(0, 80),
        telephone: telephone.slice(0, 30),
        email: email.slice(0, 160),
        adresse: at("adresse").slice(0, 200),
        code_postal: cp,
        ville: at("ville").slice(0, 80),
        notes: at("notes").slice(0, 600),
      });
    });
    return { kept: kept, skipped: skipped };
  }

  // ------------------------------------------------------------ doublons ---
  function key(record) {
    var digits = String(record.telephone || "").replace(/\D/g, "");
    return {
      phone: digits.length >= 9 ? digits.slice(-9) : "",
      email: String(record.email || "").toLowerCase(),
    };
  }

  /**
   * Marque les fiches déjà présentes (même téléphone ou même adresse
   * électronique) et les répétitions à l'intérieur du fichier.
   */
  function markDuplicates(records, existing) {
    var phones = {}, emails = {};
    (existing || []).forEach(function (e) {
      var k = key(e);
      if (k.phone) phones[k.phone] = true;
      if (k.email) emails[k.email] = true;
    });
    var seenPhone = {}, seenEmail = {};
    records.forEach(function (r) {
      var k = key(r);
      if ((k.phone && phones[k.phone]) || (k.email && emails[k.email])) {
        r.duplicate = "deja";
      } else if ((k.phone && seenPhone[k.phone]) || (k.email && seenEmail[k.email])) {
        r.duplicate = "fichier";
      } else {
        r.duplicate = "";
      }
      if (k.phone) seenPhone[k.phone] = true;
      if (k.email) seenEmail[k.email] = true;
    });
    return records;
  }

  global.DevisImport = {
    decodeBytes: decodeBytes,
    sniffDelimiter: sniffDelimiter,
    parse: parse,
    detectColumns: detectColumns,
    toClients: toClients,
    markDuplicates: markDuplicates,
    normalizePhone: normalizePhone,
    normalizeEmail: normalizeEmail,
    splitName: splitName,
    fields: Object.keys(PATTERNS),
  };
})(window);
