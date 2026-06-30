"use strict";
/* SAM comments engine v2 — sidecar <file>.md.notes.
   ROBUST format: ONE comment thread per line, as a JSON object. A corrupt/edited line
   can only ever drop that single thread — never the others (no shared block structure
   to break). Legacy v1 (<!-- thread --> blocks) is still read and auto-migrated to v2
   on the next save. Pure logic, no DOM. window.SAMNotes. */
(function () {
  const HEADER = "<!-- SAM notes v2 — one comment thread per line (JSON). Readable; edit with care. -->";

  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return "t" + Math.floor(performance.now() * 1000).toString(36) + "-" + Math.floor((performance.now() % 1) * 1e9).toString(36);
  }
  function normMsg(m) { return { author: String((m && m.author) || "?"), time: String((m && m.time) || ""), body: String((m && m.body) || "") }; }
  function normThread(o) {
    const a = (o.anchor && typeof o.anchor === "object") ? o.anchor : null;
    return {
      id: String(o.id),
      status: (o.status === "resolved" || o.status === "deleted") ? o.status : "open",
      anchor: a ? { exact: String(a.exact || ""), prefix: String(a.prefix || ""), suffix: String(a.suffix || ""), pos: (+a.pos) || 0, len: (+a.len) || 0 } : null,
      messages: Array.isArray(o.messages) ? o.messages.map(normMsg) : [],
      meta: String(o.meta || ""),
    };
  }

  // ---- legacy v1 reader (<!-- thread --> blocks); kept so old test files aren't lost ----
  function parseV1(text) {
    const threads = [], quarantine = [];
    const TH = /<!--\s*thread\s+([^>]*?)-->([\s\S]*?)<!--\s*\/thread\s*-->/g;
    const unq = (line) => { const m = /"(?:[^"\\]|\\.)*"/.exec(line || ""); if (!m) return ""; try { return JSON.parse(m[0]); } catch (e) { return ""; } };
    const attr = (attrs, k) => { const m = new RegExp("\\b" + k + "=(\\S+)").exec(attrs || ""); return m ? m[1] : ""; };
    let m;
    while ((m = TH.exec(text)) !== null) {
      try {
        const attrs = m[1], block = m[2];
        const exactL = /^>\s*exact:\s*(.*)$/m.exec(block);
        const anchor = exactL ? { exact: unq(exactL[1]), prefix: unq((/^>\s*before:\s*(.*)$/m.exec(block) || [])[1] || ""), suffix: unq((/^>\s*after:\s*(.*)$/m.exec(block) || [])[1] || ""), pos: parseInt((/^>\s*pos:\s*(\d+)/m.exec(block) || [])[1] || "0", 10) || 0, len: parseInt((/\blen:\s*(\d+)/.exec(block) || [])[1] || "0", 10) || 0 } : null;
        const rows = []; let cur = null;
        block.split("\n").forEach((ln) => { const mm = /^- \*\*(.+?)\*\*\s*·\s*(\S+)/.exec(ln); if (mm) { if (cur) rows.push(cur); cur = { author: mm[1], time: mm[2], lines: [] }; } else if (cur) cur.lines.push(ln.replace(/^ {2}/, "")); });
        if (cur) rows.push(cur);
        const messages = rows.map((c) => ({ author: c.author, time: c.time, body: c.lines.join("\n").replace(/^\n+|\n+$/g, "") }));
        const meta = /^>\s*meta:\s*(.*)$/m.exec(block);
        threads.push(normThread({ id: attr(attrs, "id") || newId(), status: (/(open|resolved|deleted)/.exec(attr(attrs, "status")) || ["open"])[0], anchor, messages, meta: meta ? unq(meta[1]) : "" }));
      } catch (e) { quarantine.push(m[0]); }
    }
    return { version: 1, threads, quarantine };
  }

  function parse(text) {
    const threads = [], quarantine = [];
    if (!text || !text.trim()) return { version: 2, threads, quarantine };
    if (text.indexOf("<!-- thread") >= 0 || text.indexOf("<!--thread") >= 0) return parseV1(text);   // legacy -> migrates on next save
    text.split(/\r?\n/).forEach((line) => {
      const s = line.trim();
      if (!s || s.charAt(0) !== "{") return;            // header / blank / comment lines ignored
      try { const o = JSON.parse(s); if (o && o.id && Array.isArray(o.messages)) threads.push(normThread(o)); else quarantine.push(line); }
      catch (e) { quarantine.push(line); }              // ONE bad line quarantined; the rest are unaffected
    });
    return { version: 2, threads, quarantine };
  }

  function serialize(model) {
    const out = [HEADER, ""];
    (model.threads || []).forEach((t) => { try { out.push(JSON.stringify({ id: t.id, status: t.status || "open", anchor: t.anchor || null, messages: t.messages || [], meta: t.meta || "" })); } catch (e) {} });
    if (model.quarantine && model.quarantine.length) { out.push("", "<!-- lines SAM could not read are kept below, untouched -->"); model.quarantine.forEach((q) => out.push(q)); }
    return out.join("\n") + "\n";
  }

  // 1:1 (length-preserving) normalization so match indices stay valid against the ORIGINAL docText.
  // Only non-ASCII look-alikes -> ASCII (smart quotes, en/em dash, nbsp). NOT backticks (markdown code).
  function norm1(s) {
    return (s || "")
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[–—−]/g, "-")
      .replace(/ /g, " ");
  }
  // Bitap fuzzy search (the algorithm behind diff-match-patch's match_main) — returns the best match index
  // for `pattern` near `loc`, or -1 if nothing clears the threshold. Pattern is capped at 32 chars (bit width);
  // for a longer quote we match its head and take the length from a.exact, which is enough to re-anchor.
  function fuzzyFind(text, pattern, loc, threshold, distance) {
    if (!pattern || !text) return -1;
    if (pattern.length > 32) pattern = pattern.slice(0, 32);
    const n = pattern.length;
    loc = Math.max(0, Math.min(loc || 0, text.length));
    threshold = (threshold == null) ? 0.5 : threshold;
    distance = (distance == null) ? 1000 : distance;
    const score = (e, x) => { const acc = e / n, prox = Math.abs(loc - x); if (!distance) return prox ? 1 : acc; return acc + prox / distance; };
    let best = text.indexOf(pattern, loc); if (best !== -1) threshold = Math.min(score(0, best), threshold);
    best = text.lastIndexOf(pattern, Math.min(loc + n, text.length)); if (best !== -1) threshold = Math.min(score(0, best), threshold);
    const alphabet = {}; for (let i = 0; i < n; i++) { const c = pattern.charAt(i); alphabet[c] = (alphabet[c] || 0) | (1 << (n - i - 1)); }
    const matchmask = 1 << (n - 1);
    let matchLoc = -1, binMax = n + text.length, binMin, binMid, lastRd = [];
    for (let d = 0; d < n; d++) {
      binMin = 0; binMid = binMax;
      while (binMin < binMid) { if (score(d, loc + binMid) <= threshold) binMin = binMid; else binMax = binMid; binMid = Math.floor((binMax - binMin) / 2 + binMin); }
      binMax = binMid;
      let start = Math.max(1, loc - binMid + 1);
      const finish = Math.min(loc + binMid, text.length) + n;
      const rd = new Array(finish + 2); rd[finish + 1] = (1 << d) - 1;
      for (let j = finish; j >= start; j--) {
        const charMatch = alphabet[text.charAt(j - 1)] || 0;
        if (d === 0) rd[j] = ((rd[j + 1] << 1) | 1) & charMatch;
        else rd[j] = (((rd[j + 1] << 1) | 1) & charMatch) | (((lastRd[j + 1] | lastRd[j]) << 1) | 1) | lastRd[j + 1];
        if (rd[j] & matchmask) {
          const s = score(d, j - 1);
          if (s <= threshold) { threshold = s; matchLoc = j - 1; if (matchLoc > loc) start = Math.max(1, 2 * loc - matchLoc); else break; }
        }
      }
      if (score(d + 1, loc) > threshold) break;
      lastRd = rd;
    }
    return matchLoc;
  }
  function relocate(thread, rawDoc) {
    const a = thread && thread.anchor;
    if (!a || !a.exact || !rawDoc) return null;
    const docText = norm1(rawDoc);                                    // 1:1 -> indices valid against rawDoc
    const exact = norm1(a.exact), prefix = norm1(a.prefix || ""), suffix = norm1(a.suffix || "");
    const pos = a.pos || 0;
    const nearest = (needle) => { if (!needle) return -1; let idx = -1, best = Infinity, from = 0, i; while ((i = docText.indexOf(needle, from)) >= 0) { const d = Math.abs(i - pos); if (d < best) { best = d; idx = i; } from = i + 1; } return idx; };
    let i = nearest(prefix + exact + suffix); if (i >= 0) return { start: i + prefix.length, end: i + prefix.length + exact.length };
    i = nearest(exact + suffix); if (i >= 0) return { start: i, end: i + exact.length };
    i = nearest(prefix + exact); if (i >= 0) return { start: i + prefix.length, end: i + prefix.length + exact.length };
    i = nearest(exact); if (i >= 0) return { start: i, end: i + exact.length };
    // every exact attempt failed -> fuzzy fallback (survives in-place edits). Below threshold => null (orphan),
    // never a wild guess: mis-anchoring is worse than orphaning.
    const fi = fuzzyFind(docText, exact, pos, 0.5, 1000);
    if (fi >= 0) return { start: fi, end: Math.min(rawDoc.length, fi + a.exact.length), fuzzy: true };
    return null;
  }
  function makeAnchor(docText, start, end) {
    const exact = docText.slice(start, end);
    return { exact: exact, prefix: docText.slice(Math.max(0, start - 32), start), suffix: docText.slice(end, Math.min(docText.length, end + 32)), pos: start, len: exact.length };
  }

  window.SAMNotes = { parse, serialize, relocate, makeAnchor, newId };
})();
