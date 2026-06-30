"use strict";
/* SAM converters: csv / xls / xlsx / docx -> markdown. Vendored browser libs
   (Papa, XLSX, mammoth + Turndown). All offline. Returns { md } or { error }. */
(function () {
  function escCell(s) { return String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\r?\n/g, " "); }
  function rowsToTable(rows) {
    rows = (rows || []).filter((r) => Array.isArray(r));
    if (!rows.length) return "";
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const pad = (r) => { const a = r.slice(); while (a.length < cols) a.push(""); return a; };
    const head = pad(rows[0]).map(escCell);
    const sep = head.map(() => "---");
    const body = rows.slice(1).map((r) => "| " + pad(r).map(escCell).join(" | ") + " |");
    return "| " + head.join(" | ") + " |\n| " + sep.join(" | ") + " |\n" + (body.length ? body.join("\n") + "\n" : "");
  }
  function csvToMd(text) {
    if (!window.Papa) return { error: "CSV parser not loaded" };
    const res = window.Papa.parse(text || "", { skipEmptyLines: true });
    if ((!res.data || !res.data.length) && res.errors && res.errors.length) return { error: res.errors[0].message };
    return { md: rowsToTable(res.data) };
  }
  function xlsxToMd(u8) {
    if (!window.XLSX) return { error: "XLSX parser not loaded" };
    const wb = window.XLSX.read(u8, { type: "array" });
    const out = [];
    (wb.SheetNames || []).forEach((name) => {
      const ws = wb.Sheets[name];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
      if (wb.SheetNames.length > 1) out.push("## " + name + "\n");
      out.push(rowsToTable(rows));
    });
    return { md: out.join("\n").trim() + "\n" };
  }
  function htmlToMd(html) {
    try {
      if (window.TurndownService) {
        const td = new window.TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
        if (window.turndownPluginGfm) td.use(window.turndownPluginGfm.gfm);
        return td.turndown(html);
      }
    } catch (e) {}
    return html;
  }
  async function docxToMd(arrayBuffer) {
    if (!window.mammoth) return { error: "DOCX parser not loaded" };
    // ignore embedded images (convert to nothing) so the md doesn't bloat with base64
    const opts = { convertImage: window.mammoth.images.imgElement(() => Promise.resolve({ src: "" })) };
    const r = await window.mammoth.convertToHtml({ arrayBuffer }, opts);
    return { md: htmlToMd((r && r.value) || ""), note: (r && r.messages && r.messages.length) ? (r.messages.length + " conversion note(s)") : "" };
  }
  function b64ToU8(b64) { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }

  // ext: lowercase, no dot. payload: { text } for csv, { b64 } for xls/xlsx/docx.
  async function convert(ext, payload) {
    try {
      if (ext === "csv") return csvToMd(payload.text);
      if (ext === "xlsx" || ext === "xls") return xlsxToMd(b64ToU8(payload.b64));
      if (ext === "docx") return await docxToMd(b64ToU8(payload.b64).buffer);
      return { error: "Can't convert ." + ext };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  }
  window.SAMConvert = { convert: convert, supports: (ext) => ["csv", "xls", "xlsx", "docx"].includes(ext) };
})();
