
"use strict";
const $ = (id) => document.getElementById(id);
const editor = $("editor"), preview = $("preview");

/* ---------- raw editor is a contenteditable div: textarea-compatible shim (value / selection) ----------
   so the formatting / find / cursor code keeps using editor.value, .selectionStart/End, .setSelectionRange,
   .setRangeText exactly as it did for the <textarea>. Offsets are plain-text char offsets (newlines are real
   "\n" in text nodes thanks to contenteditable="plaintext-only"). */
function _edTextNodes() { const w = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null), a = []; let n; while ((n = w.nextNode())) a.push(n); return a; }
function _edCaret() {
  const sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0); if (!editor.contains(r.startContainer)) return null;
  const pre = r.cloneRange(); pre.selectNodeContents(editor); pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return { start: start, end: start + r.toString().length };
}
function _edLocate(offset) {
  const nodes = _edTextNodes(); if (!nodes.length) return { node: editor, offset: 0 };
  let rem = offset; for (const n of nodes) { const len = n.nodeValue.length; if (rem <= len) return { node: n, offset: rem }; rem -= len; }
  const last = nodes[nodes.length - 1]; return { node: last, offset: last.nodeValue.length };
}
function _edSetSel(start, end) {
  try { const a = _edLocate(start), b = _edLocate(end == null ? start : end); const r = document.createRange(); r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
}
Object.defineProperty(editor, "value", { get() { return editor.textContent; }, set(v) { editor.textContent = (v == null ? "" : String(v)); } });
Object.defineProperty(editor, "selectionStart", { get() { const c = _edCaret(); return c ? c.start : editor.textContent.length; } });
Object.defineProperty(editor, "selectionEnd", { get() { const c = _edCaret(); return c ? c.end : editor.textContent.length; } });
editor.setSelectionRange = function (s, e) { editor.focus(); _edSetSel(s, e); };
editor.setRangeText = function (text, s, e, mode) {
  const v = editor.textContent; if (s == null) { const c = _edCaret() || { start: 0, end: 0 }; s = c.start; e = c.end; }
  editor.textContent = v.slice(0, s) + text + v.slice(e);
  if (mode === "select") _edSetSel(s, s + text.length); else _edSetSel(s + text.length, s + text.length);
  editor.dispatchEvent(new Event("input"));
};

/* ---------- raw editor custom undo (programmatic DOM edits + innerHTML rebuilds break native undo) ---------- */
let _undoStack = [], _redoStack = [], _undoLast = null;
function _edSnap() { const c = _edCaret() || { start: 0, end: 0 }; return { text: editor.textContent, s: c.start, e: c.end }; }
function rawUndoReset() { _undoStack = []; _redoStack = []; _undoLast = _edSnap(); }
function rawUndoRecord() { if (_undoLast) { _undoStack.push(_undoLast); if (_undoStack.length > 400) _undoStack.shift(); _redoStack = []; } _undoLast = _edSnap(); }
function _edApply(snap) { const st = editor.scrollTop; editor.textContent = snap.text; _edSetSel(snap.s, snap.e); editor.scrollTop = st; _undoLast = _edSnap(); setDirty(true); updateCursor(); highlightRaw(); }
function rawUndo() { if (!_undoStack.length) return; editor.focus(); _redoStack.push(_edSnap()); _edApply(_undoStack.pop()); }
function rawRedo() { if (!_redoStack.length) return; editor.focus(); _undoStack.push(_edSnap()); _edApply(_redoStack.pop()); }
let _hlT = null;
function scheduleHighlightRaw() { clearTimeout(_hlT); _hlT = setTimeout(() => { if (state.mode === "raw" && state.commentsOpen) highlightRaw(); }, 140); }
function onEditInput() {
  if (editor._composing) return;
  if (!state.dirty) setDirty(true);
  if (state.mode === "raw") { rawUndoRecord(); updateCursor(); scheduleHighlightRaw(); }
}

const SAMPLE = `# SAM — Simple As Markdown

A tiny Markdown editor. **Just start typing** — this page is an ordinary document, so
edit it, delete it, or write straight over it. Open a file with **Ctrl+O**, or **drag one
onto the window**. Press **F12** any time to flip between the **raw** text and the
**rendered** view — both are fully editable.

---

## The two views
- **Raw** (what you're reading now) is plain Markdown text; **Rendered** (**F12**) is the
  formatted preview — and you can edit in either one.
- SAM remembers the view you last used for each file (new files start in raw).
- **Ctrl + mouse-wheel** zooms the text up or down in either view.

## Formatting ribbon
The icon strip along the top formats the selected text. Left to right:
- **B** bold, *I* italic, ~~S~~ strikethrough
- **▲ / ▼** make the heading bigger / smaller
- inline \`code\`, a fenced code block, and a > blockquote
- bullet list, numbered list, task list \`- [ ]\`
- link, image, table, and a horizontal rule

Hover an icon, slide into its tooltip, and **click the key chip to rebind its shortcut**.
Built in: **Ctrl+B** bold, **Ctrl+I** italic, **Ctrl+K** link.

## Open & convert
- Open, edit and save real **.md** and **.txt** files.
- **Drag a file onto the window** to open it.
- Drop a **.csv**, **.xlsx**, **.xls** or **.docx** and SAM **converts it to Markdown**
  (spreadsheets come in as tables — no PDF).
- **File → New** (**Ctrl+N**) opens another window — one process, low memory.

## Find & replace
- **Ctrl+F** to find, **Ctrl+H** to replace — the classic way, also in the **Edit** menu.

## Comments & threads
- Open the panel with the **speech-bubble** (top-right) or **View → Comments Panel**.
- Select text in the raw view, press **+**, write, and send — a **numbered red box** then
  marks that text in **both** views.
- Reply to grow a thread; **resolve** or **delete** it. Delete just greys it out with an
  **Undo** for 5 seconds — nothing is lost, it stays in the file.
- Comments live beside your file as \`yourfile.md.notes\`; nothing is written until you
  send the first one.
- Search with **author:Name** or **is:open / is:resolved / is:deleted**, and step through
  with the **◀ ▶** arrows. The footer counts **position / open / resolved / deleted**.
- SAM watches that file and flashes if a comment arrives while you're away.

## Make it yours
- **View → Background Colour** — pick any colour.
- **View → High-visibility** (**Ctrl+Shift+H**) — a 1px halo so text never vanishes, even on
  a background the same colour as the text.
- **View → Word Wrap**, **Status Bar**, and **Instructions at startup** (switch this page
  off once you know your way around).
- **View → Keep on Top** (**F11**); the small switch beside it makes SAM go 50% transparent
  whenever it loses focus.

## Window
- Frameless: **–  □  ✕** at the top-right are minimize, maximize and close.
- **Drag any icon or menu** on the top bar to move the whole window.
- Opening a file into a blank or intro window reuses it instead of leaving an empty one.

## Handy extras
- **Edit → Copy Full Path**, **Copy Directory**, **Open Containing Folder**.
- **About → Set as Default .md Viewer** so .md files open in SAM.
- Copy from SAM and it **drops the text colour**, so it pastes in your destination's colour
  instead of grey.
- **Edit → Reset Settings** puts everything back to defaults.

### Shortcuts
| Action | Keys |
|---|---|
| New / Open | Ctrl+N / Ctrl+O |
| Save / Save As | Ctrl+S / Ctrl+Shift+S |
| Close window | Ctrl+W |
| Undo / Redo | Ctrl+Z / Ctrl+Y |
| Find / Replace | Ctrl+F / Ctrl+H |
| Toggle raw / rendered | F12 |
| Keep on top | F11 |
| High-visibility | Ctrl+Shift+H |
| Bold / Italic / Link | Ctrl+B / Ctrl+I / Ctrl+K |
| Zoom text | Ctrl + wheel |

*Sample document — edit away, or hide it via **View → Instructions at startup**.*
`;

const DEFAULTS = { bg: "#1e1e1e", highvis: false, statusbar: true, wordwrap: false, showInstructions: true };
const state = {
  path: null, dirty: false, mode: "raw", richEdited: false, pristine: false, _fromName: "",
  bg: DEFAULTS.bg, highvis: DEFAULTS.highvis, statusbar: DEFAULTS.statusbar,
  wordwrap: DEFAULTS.wordwrap, showInstructions: DEFAULTS.showInstructions, onTop: false, recents: [],
  fileMtime: 0, fileSize: -1, dontAsk: [], reloadBusy: false,
  viewModes: {}, matchCase: false, wrapAround: true, fontScale: 1,
  commentAuthor: "", commentsWidth: 0.28, commentsOpen: false, showResolved: false, transWhenUnfocused: false,
  notesModel: { threads: [], quarantine: [] }, selThread: null, _notesSig: "",
};
let api = null;
function blog(msg) { try { if (api && api.jslog) api.jslog("info", msg); } catch (e) {} }
window.addEventListener("error", (e) => { try { if (api && api.jslog) api.jslog("error", (e.message || "") + " @ " + (e.filename || "") + ":" + (e.lineno || "")); } catch (_) {} });
window.addEventListener("unhandledrejection", (e) => { try { if (api && api.jslog) api.jslog("error", "promise: " + ((e.reason && e.reason.message) || e.reason || "")); } catch (_) {} });

/* ---------- themed dialogs: one dark modal that replaces native alert/confirm/prompt AND the Electron
   message boxes (external-change reload, reset settings, save-over-notes). resolve -> {index, checked, value}. */
function samDialog(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const dlg = $("samdlg"); if (!dlg) { resolve({ index: -1, checked: false, value: "" }); return; }
    const titleEl = $("samdlg-title"), msgEl = $("samdlg-msg"), inp = $("samdlg-input");
    const crow = $("samdlg-checkrow"), chk = $("samdlg-check"), clabel = $("samdlg-checklabel"), btnWrap = $("samdlg-btns");
    titleEl.textContent = opts.title || "";
    msgEl.textContent = opts.message || "";
    const useInput = !!opts.input;
    inp.style.display = useInput ? "block" : "none";
    if (useInput) { inp.value = (opts.input.value != null ? opts.input.value : ""); inp.placeholder = opts.input.placeholder || ""; }
    crow.style.display = opts.checkbox ? "flex" : "none";
    if (opts.checkbox) { clabel.textContent = opts.checkbox.label || ""; chk.checked = !!opts.checkbox.checked; }
    const buttons = (opts.buttons && opts.buttons.length) ? opts.buttons : [{ label: "OK", primary: true }];
    const defIdx = (opts.defaultIndex != null) ? opts.defaultIndex : buttons.findIndex((b) => b.primary);
    const cancIdx = (opts.cancelIndex != null) ? opts.cancelIndex : -1;
    let done = false;
    function finish(index) {
      if (done) return; done = true;
      dlg.classList.remove("show");
      document.removeEventListener("keydown", onKey, true);
      resolve({ index: index, checked: chk.checked, value: inp.value });
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(cancIdx); }
      else if (e.key === "Enter" && defIdx >= 0) { e.preventDefault(); e.stopPropagation(); finish(defIdx); }
    }
    btnWrap.textContent = "";
    buttons.forEach((b, i) => { const el = document.createElement("button"); el.textContent = b.label; if (b.primary) el.classList.add("primary"); if (b.danger) el.classList.add("danger"); el.onclick = () => finish(i); btnWrap.appendChild(el); });
    dlg.classList.add("show");
    document.addEventListener("keydown", onKey, true);
    setTimeout(() => {
      if (useInput) { inp.focus(); inp.select(); }
      else { const def = (defIdx >= 0 && btnWrap.children[defIdx]) || btnWrap.querySelector("button.primary") || btnWrap.querySelector("button"); if (def) def.focus(); }
      _kickFocus();   // rebind Chromium's input client to the modal (same fix as the comment boxes)
    }, 0);
  });
}
function samAlert(message, title) { return samDialog({ title: title || "", message: String(message == null ? "" : message), buttons: [{ label: "OK", primary: true }], cancelIndex: 0 }); }
function samConfirm(message, o) { o = o || {}; return samDialog({ title: o.title || "", message: String(message == null ? "" : message), buttons: [{ label: o.cancel || "Cancel" }, { label: o.ok || "OK", primary: !o.danger, danger: !!o.danger }], defaultIndex: 1, cancelIndex: 0 }).then((r) => r.index === 1); }
function samPrompt(message, o) { o = o || {}; return samDialog({ title: o.title || "", message: String(message == null ? "" : message), input: { placeholder: o.placeholder || "", value: o.value || "" }, buttons: [{ label: "Cancel" }, { label: o.ok || "OK", primary: true }], defaultIndex: 1, cancelIndex: 0 }).then((r) => (r.index === 1 ? (r.value != null ? r.value : "") : null)); }
// Electron message boxes (reload / reset / save-over-notes) are routed here so they match the theme; main.js
// keeps all its file logic and just asks us to show the dialog (see main.js askThemed).
if (window.sam && window.sam.onAskDialog) {
  window.sam.onAskDialog((id, spec) => {
    spec = spec || {};
    samDialog({
      title: spec.title || "",
      message: (spec.message || "") + (spec.detail ? "\n\n" + spec.detail : ""),
      buttons: (spec.buttons && spec.buttons.length) ? spec.buttons : [{ label: "OK", primary: true }],
      checkbox: spec.checkbox ? { label: spec.checkbox } : null,
      defaultIndex: spec.defaultId,
      cancelIndex: (spec.cancelId != null ? spec.cancelId : -1),
    }).then((res) => { try { if (window.sam.ask_dialog_reply) window.sam.ask_dialog_reply(id, { response: res.index, checkboxChecked: !!res.checked }); } catch (e) {} });
  });
}

/* ---------- colour / contrast ---------- */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return { r: 30, g: 30, b: 30 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function relLuminance({ r, g, b }) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); }
function applyTheme() {
  const L = relLuminance(hexToRgb(state.bg));
  const dark = contrast(L, 0) >= contrast(L, 1);
  const root = document.documentElement.style;
  root.setProperty("--bg", state.bg);
  root.setProperty("--fg", dark ? "#111111" : "#f0f0f0");
  root.setProperty("--outline", dark ? "#ffffff" : "#000000");
  root.setProperty("--scroll", dark ? "rgba(0,0,0,.30)" : "rgba(255,255,255,.30)");      // scrollbar thumb tracks the bg
  root.setProperty("--scroll-hi", dark ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.55)");
  $("bgPick").value = state.bg;
}

/* ---------- markdown <-> html ---------- */
if (window.DOMPurify && DOMPurify.addHook) DOMPurify.addHook("afterSanitizeAttributes", (n) => { if (n.nodeName === "A" && n.getAttribute("target") === "_blank") n.setAttribute("rel", "noopener noreferrer"); });
function render() {
  blog("render start len=" + editor.value.length);
  const html = marked.parse(editor.value, { gfm: true, breaks: false });
  preview.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
  blog("render done");
}
let td = null;
function setupTurndown() {
  try {
    td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
    if (window.turndownPluginGfm) td.use(window.turndownPluginGfm.gfm);
  } catch (e) { td = null; }
}
function mdFromPreview() { try { return td ? td.turndown(preview.innerHTML) : editor.value; } catch (e) { return editor.value; } }
function syncFromRich() {
  if (state.mode === "rich" && state.richEdited) {
    blog("turndown start htmlLen=" + preview.innerHTML.length);
    const t0 = performance.now();
    editor.value = mdFromPreview();
    blog("turndown done ms=" + Math.round(performance.now() - t0) + " mdLen=" + editor.value.length);
    state.richEdited = false;
  }
}

/* ---------- view mode (both views editable) ---------- */
function caretContext() {   // A13: text snippet near the caret/top, to re-find in the other view
  try {
    if (state.mode === "raw") return editor.value.slice(editor.selectionStart, editor.selectionStart + 60).replace(/\s+/g, " ").trim();
    const sel = window.getSelection(); let t = "";
    if (sel && sel.anchorNode) t = (sel.anchorNode.textContent || "");
    if (!t) { const r = preview.getBoundingClientRect(); const el = document.elementFromPoint(r.left + 24, r.top + 10); if (el) t = el.textContent || ""; }
    return t.slice(0, 60).replace(/\s+/g, " ").trim();
  } catch (e) { return ""; }
}
function restoreContext(snippet, toMode) {
  if (!snippet || snippet.length < 4) return;
  const key = snippet.toLowerCase().slice(0, 28);
  if (toMode === "rich") {
    const w = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null); let n;
    while ((n = w.nextNode())) { if ((n.textContent || "").toLowerCase().includes(key)) { const el = n.parentElement; if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" }); return; } }
  } else {
    const idx = editor.value.toLowerCase().indexOf(key);
    if (idx >= 0) { editor.focus(); editor.setSelectionRange(idx, idx); scrollEditorTo(idx); }
  }
}
function setMode(mode) {
  const switching = mode !== state.mode;
  const ctx = switching ? caretContext() : "";
  blog("setMode " + state.mode + "->" + mode);
  if (mode === "raw" && state.mode === "rich") syncFromRich();
  state.mode = mode;
  document.body.classList.toggle("mode-raw", mode === "raw");
  document.body.classList.toggle("mode-rich", mode === "rich");
  $("stMode").textContent = mode === "rich" ? "rendered" : "raw";
  if (mode === "rich") { render(); preview.contentEditable = "true"; state.richEdited = false; }
  else { preview.contentEditable = "false"; if (switching) rawUndoReset(); editor.focus(); }
  if (switching) restoreContext(ctx, mode);
  if (typeof renderCommentHighlights === "function") renderCommentHighlights();
  if (state.path) { state.viewModes[state.path] = mode; persist({ viewModes: state.viewModes }); }   // A9: remember per file
  updateCursor(); updateChecks();
}
function toggleMode() { setMode(state.mode === "raw" ? "rich" : "raw"); }

/* ---------- toggles ---------- */
function setHighvis(on) { state.highvis = on; document.body.classList.toggle("highvis", on); persist({ highvis: on }); updateChecks(); }
function setStatusbar(on) { state.statusbar = on; document.body.classList.toggle("no-status", !on); persist({ statusbar: on }); updateChecks(); fitStatusPath(); }
function setWordwrap(on) { state.wordwrap = on; document.body.classList.toggle("wrap", on); persist({ wordwrap: on }); updateChecks(); }
function applyFontScale() {   // Ctrl+wheel text zoom (editor + preview only, not the chrome)
  const sc = Math.min(3, Math.max(0.6, state.fontScale || 1)), r = document.documentElement.style;
  r.setProperty("--edfs", Math.round(14 * sc) + "px"); r.setProperty("--edlh", Math.round(22 * sc) + "px"); r.setProperty("--pvfs", Math.round(16 * sc) + "px");
  if (typeof scheduleDrawBoxes === "function") scheduleDrawBoxes();   // glyphs moved -> repaint comment boxes (ResizeObserver won't fire; box size unchanged)
  if (typeof scheduleDePreview === "function") scheduleDePreview();   // same for the rendered-view badges on zoom
}
function bumpFontScale(dir) { state.fontScale = Math.min(3, Math.max(0.6, Math.round(((state.fontScale || 1) + dir * 0.1) * 100) / 100)); applyFontScale(); persist({ fontScale: state.fontScale }); }
[editor, preview].forEach((el) => el.addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); bumpFontScale(e.deltaY < 0 ? 1 : -1); }, { passive: false }));
function setOnTop(on) { state.onTop = on; if (api && api.set_on_top) api.set_on_top(on); if (!on && api && api.set_opacity) api.set_opacity(1); updateChecks(); }

/* ---------- dirty / title / status ---------- */
function setDirty(d) {
  state.dirty = d;
  document.body.classList.toggle("dirty", d);
  if (api && api.set_dirty) api.set_dirty(d);
  updateTitle(); updatePristine();
}
function baseName(p) { return p ? p.replace(/^.*[\\/]/, "") : "untitled"; }
function dirName(p) { return p ? p.replace(/[\\/][^\\/]*$/, "") : ""; }
function docLabel() { return state.path ? baseName(state.path) : (state._fromName ? "untitled (from " + state._fromName + ")" : "untitled"); }
function updateTitle() {
  fitStatusPath();   // status bar shows the path; in-app top bar is the static program name
  if (api && api.set_title) api.set_title((state.dirty ? "* " : "") + docLabel() + " — SAM");
}
function isPristineContent() { return state.path == null && !state.dirty && (editor.value === SAMPLE || editor.value.trim() === ""); }
function updatePristine() { const p = isPristineContent(); state.pristine = p; if (api && api.set_pristine) api.set_pristine(p); }   // A11

/* ---------- status-bar path fit (item 11: middle-ellipsis ladder) ---------- */
const _fitCtx = document.createElement("canvas").getContext("2d");
function _measure(el, s) { _fitCtx.font = getComputedStyle(el).font || "12px sans-serif"; return _fitCtx.measureText(s).width; }
function _pathCandidates(full) {
  const sep = full.indexOf("\\") >= 0 ? "\\" : "/";
  const parts = full.split(/[\\/]/).filter(Boolean);
  const name = parts.length ? parts[parts.length - 1] : full;
  const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
  const drive = parts.length ? parts[0] : "";
  const cands = [full];
  if (drive && parent && parts.length > 3) cands.push(drive + sep + "…" + sep + parent + sep + name);  // 1: drive … parent name
  if (parent) cands.push("…" + sep + parent + sep + name);
  cands.push(name);                                                                                     // 2: name only
  return { cands, name };
}
function _elideMiddle(s, budget, el) {  // 3: star…end.ext (keep head + tail incl extension)
  if (_measure(el, s) <= budget) return s;
  const dot = s.lastIndexOf("."), ext = dot > 0 ? s.slice(dot) : "", base = dot > 0 ? s.slice(0, dot) : s;
  for (let total = base.length - 1; total >= 1; total--) {
    const head = Math.ceil(total / 2), tail = total - head;
    const cand = base.slice(0, head) + "…" + (tail > 0 ? base.slice(base.length - tail) : "") + ext;
    if (_measure(el, cand) <= budget) return cand;
  }
  return "…" + ext;
}
function fitStatusPath() {
  const el = $("stPath"); if (!el) return;
  if (!state.path) { el.textContent = "(untitled)"; el.title = ""; return; }
  el.title = state.path;
  const budget = el.clientWidth;
  if (budget <= 0) { el.textContent = state.path; return; }   // not laid out yet; CSS clips
  const { cands, name } = _pathCandidates(state.path);
  for (const c of cands) if (_measure(el, c) <= budget) { el.textContent = c; return; }
  el.textContent = _elideMiddle(name, budget, el);
}
window.addEventListener("resize", () => { reflowBar(); fitStatusPath(); });
function updateCursor() {
  if (state.mode !== "raw") { $("stLnCol").textContent = "—"; return; }
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  $("stLnCol").textContent = `Ln ${before.split("\n").length}, Col ${pos - before.lastIndexOf("\n")}`;
}
function updateChecks() {
  $("mi-md").classList.toggle("checked", state.mode === "rich");
  $("mi-ontop").classList.toggle("checked", state.onTop);
  $("mi-highvis").classList.toggle("checked", state.highvis);
  $("mi-status").classList.toggle("checked", state.statusbar);
  $("mi-wrap").classList.toggle("checked", state.wordwrap);
  $("mi-comments").classList.toggle("checked", state.commentsOpen);
  $("mi-instructions").classList.toggle("checked", state.showInstructions);
}

/* ---------- settings ---------- */
function persist(patch) { if (api && api.save_settings) api.save_settings(patch); }
async function loadSettings() {
  if (!api || !api.load_settings) return;
  let s = {};
  try { s = (await api.load_settings()) || {}; } catch (e) {}
  state.bg = s.bg || DEFAULTS.bg;
  state.highvis = typeof s.highvis === "boolean" ? s.highvis : DEFAULTS.highvis;
  state.statusbar = typeof s.statusbar === "boolean" ? s.statusbar : DEFAULTS.statusbar;
  state.recents = s.recents || [];
  state.wordwrap = typeof s.wordwrap === "boolean" ? s.wordwrap : DEFAULTS.wordwrap;
  state.dontAsk = Array.isArray(s.dontAskReload) ? s.dontAskReload : [];
  state.showInstructions = typeof s.showInstructions === "boolean" ? s.showInstructions : DEFAULTS.showInstructions;
  state.viewModes = (s.viewModes && typeof s.viewModes === "object") ? s.viewModes : {};
  state.matchCase = !!s.matchCase; state.wrapAround = s.wrapAround !== false;
  state.fontScale = (typeof s.fontScale === "number") ? s.fontScale : 1;
  state.commentAuthor = typeof s.commentAuthor === "string" ? s.commentAuthor : "";
  state.commentsWidth = typeof s.commentsWidth === "number" ? s.commentsWidth : 0.28;
  state.commentsOpen = !!s.commentsOpen; state.showResolved = !!s.showResolved;
  state.transWhenUnfocused = !!s.transWhenUnfocused;
  keybinds = Object.assign({}, DEFAULT_KEYS, s.keybinds || {});
  applyTheme();
  document.body.classList.toggle("highvis", state.highvis);
  document.body.classList.toggle("no-status", !state.statusbar);
  document.body.classList.toggle("wrap", state.wordwrap);
  if ($("cmtName")) $("cmtName").value = state.commentAuthor || defaultAuthor();
  applyFontScale(); applyCommentsWidth(); applyMinSize(); document.body.classList.toggle("comments", state.commentsOpen);
  if ($("btnComments")) $("btnComments").classList.toggle("on", state.commentsOpen);
  if ($("ontopTrans")) $("ontopTrans").classList.toggle("on", state.transWhenUnfocused);
  updateChecks(); refreshKeyLabels(); rebuildDispatch(); fitStatusPath();
}

/* ---------- recents ---------- */
function buildRecents() {
  const box = $("recent-sub");
  box.innerHTML = "";
  if (!state.recents.length) { box.innerHTML = '<div class="empty">(none)</div>'; return; }
  state.recents.forEach((p) => {
    const el = document.createElement("div");
    el.className = "mi"; el.textContent = baseName(p); el.title = p;
    el.addEventListener("click", () => { closeMenus(); openPath(p); });
    box.appendChild(el);
  });
  const sep = document.createElement("div"); sep.className = "sep"; box.appendChild(sep);
  const clr = document.createElement("div"); clr.className = "mi"; clr.textContent = "Clear recent";
  clr.addEventListener("click", async () => { closeMenus(); state.recents = []; if (api) await api.clear_recents(); });
  box.appendChild(clr);
}
async function refreshRecents() {
  if (api && api.load_settings) { try { state.recents = (await api.load_settings()).recents || []; } catch (e) {} }
  buildRecents();
}
async function noteRecent(path) { if (api && api.add_recent) { try { state.recents = await api.add_recent(path); } catch (e) {} } }

/* ---------- file ops ---------- */
function loadDoc(path, content) {
  editor.value = content; state.path = path; state.richEdited = false; state._fromName = ""; rawUndoReset();
  const want = (path && state.viewModes[path]) || "raw";   // A9: remembered per-file view
  setDirty(false);
  if (want === "rich" && state.mode !== "rich") setMode("rich");
  else if (want === "raw" && state.mode === "rich") setMode("raw");
  else if (state.mode === "rich") render();
  updateTitle(); updateCursor(); recordStat();
  loadNotes();   // B: load sidecar comments for this file
}
async function doOpen() {
  if (!api) return;
  const res = await api.open_dialog();
  if (!res) return;
  if (res.error) { await samAlert("Open failed:\n" + res.error); return; }
  api.new_window(res.path); noteRecent(res.path);
}
function openPath(path) { if (api) { api.new_window(path); noteRecent(path); } }
async function doSave() {
  if (!api) return;
  syncFromRich();
  if (!state.path) return doSaveAs();
  const res = await api.save(state.path, editor.value);
  if (res && res.error) { await samAlert("Save failed:\n" + res.error); return; }
  if ((state.notesModel.threads || []).some((t) => t.messages && t.messages.length) || _notesDirty) await saveNotes();   // .md.notes rides with the .md
  _notesDirty = false; setDirty(false); recordStat();
}
async function doSaveAs() {
  if (!api) return;
  syncFromRich();
  const prevPath = state.path;
  const res = await api.save_dialog(editor.value, baseName(state.path) === "untitled" ? "untitled.md" : baseName(state.path));
  if (!res) return;
  if (res.error) { await samAlert("Save failed:\n" + res.error); return; }
  state.path = res.path; state._fromName = ""; setDirty(false); updateTitle(); noteRecent(res.path); recordStat();
  state.viewModes[res.path] = state.mode;
  if ((state.notesModel.threads || []).some((t) => t.messages && t.messages.length) || _notesDirty) {
    state._notesLoadedFor = res.path; await saveNotes();                                       // our in-memory comments -> the new file
  } else {
    if (api.handle_saved_notes) { try { await api.handle_saved_notes(res.path, prevPath); } catch (e) {} }   // none of ours -> warn about any stale notes already there
    state._notesLoadedFor = null;
    if (state.commentsOpen) await loadNotes(); else state.notesModel = { threads: [], quarantine: [] };
  }
  _notesDirty = false;
}
async function doNew() {   // File -> New: if THIS window is the untouched intro/blank, close it as the new one opens; if changed, leave it open
  if (!api) return;
  const pristine = isPristineContent();
  await api.new_window();
  if (pristine && api.close_window) api.close_window();
}
function doClose() { if (api) api.close_window(); }
function doExit() { if (api) api.exit_app(); }
function doExplorer() { if (api && api.open_in_explorer && state.path) api.open_in_explorer(state.path); }   // no-op when untitled
async function doReset() { if (api && api.reset_settings) await api.reset_settings(); }                       // main confirms + broadcasts settings-reset

/* ---------- external-change watch (item 14: Notepad++ style, with per-file opt-out) ---------- */
async function recordStat() {
  if (!api || !api.stat_path || !state.path) { state.fileMtime = 0; state.fileSize = -1; return; }
  try { const s = await api.stat_path(state.path); if (s) { state.fileMtime = s.mtimeMs; state.fileSize = s.size; } } catch (e) {}
}
function dontAskHas(p) { return state.dontAsk.some((x) => String(x).toLowerCase() === String(p).toLowerCase()); }
async function checkExternal() {
  if (state.reloadBusy || !api || !api.stat_path || !state.path || state.fileSize < 0) return;
  if (dontAskHas(state.path)) return;
  let s = null; try { s = await api.stat_path(state.path); } catch (e) { return; }
  if (!s) return;                                                     // file gone/unreadable -> ignore
  if (s.mtimeMs === state.fileMtime && s.size === state.fileSize) return;
  state.reloadBusy = true;
  try {
    const res = await api.confirm_reload(baseName(state.path), state.dirty);
    if (res && res.checkbox) { state.dontAsk.push(state.path); try { await api.add_dont_ask_reload(state.path); } catch (e) {} }
    if (res && res.response === 0) {                                  // Reload
      const f = await api.read_path(state.path);
      if (f && f.content !== undefined && !f.error) loadDoc(state.path, f.content);   // loadDoc re-records stat
      else { state.fileMtime = s.mtimeMs; state.fileSize = s.size; }
    } else { state.fileMtime = s.mtimeMs; state.fileSize = s.size; }  // Keep mine: adopt new baseline so we don't re-nag for this change
  } catch (e) {}
  state.reloadBusy = false;
}
let _pollTimer = null;
window.addEventListener("focus", () => { if (api && api.set_opacity) api.set_opacity(1); pollTick(); if (!_pollTimer) _pollTimer = setInterval(pollTick, 1500); });
window.addEventListener("blur", () => { if (state.onTop && state.transWhenUnfocused && api && api.set_opacity) api.set_opacity(0.5); if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } });

/* ---------- edit ops ---------- */
function execEdit(cmd) {
  if (state.mode === "raw" && (cmd === "undo" || cmd === "redo")) { editor.focus(); cmd === "undo" ? rawUndo() : rawRedo(); return; }   // custom undo for the contenteditable editor
  editor.focus(); try { document.execCommand(cmd); } catch (e) {}
  if (cmd !== "copy") { setDirty(true); updateCursor(); if (state.mode === "raw") scheduleHighlightRaw(); }
}
async function doPaste() {
  if (state.mode !== "raw") return;
  editor.focus();
  try { if (document.execCommand("paste")) { setDirty(true); return; } } catch (e) {}
  try {
    const t = await navigator.clipboard.readText();
    const s = editor.selectionStart, e = editor.selectionEnd;
    editor.setRangeText(t, s, e, "end"); setDirty(true); updateCursor();
  } catch (e) {}
}
function clip(text) { if (navigator.clipboard) navigator.clipboard.writeText(text || "").catch(() => {}); }

/* ---------- formatting (works in raw textarea AND rich contentEditable) ---------- */
function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function escapeAttr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

function wrapRaw(before, after) {
  after = after === undefined ? before : after;
  editor.focus();
  const val = editor.value, s = editor.selectionStart, e = editor.selectionEnd, sel = val.slice(s, e);
  if (sel.length >= before.length + after.length && sel.startsWith(before) && sel.endsWith(after)) {
    const inner = sel.slice(before.length, sel.length - after.length);
    editor.setSelectionRange(s, e); document.execCommand("insertText", false, inner);
    editor.setSelectionRange(s, s + inner.length);
  } else if (val.slice(s - before.length, s) === before && val.slice(e, e + after.length) === after) {
    editor.setSelectionRange(s - before.length, e + after.length); document.execCommand("insertText", false, sel);
    editor.setSelectionRange(s - before.length, s - before.length + sel.length);
  } else {
    editor.setSelectionRange(s, e); document.execCommand("insertText", false, before + sel + after);
    if (sel) editor.setSelectionRange(s + before.length, s + before.length + sel.length);
    else editor.setSelectionRange(s + before.length, s + before.length);
  }
  setDirty(true); updateCursor();
}
function lineSpan() {
  const val = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
  const ls = val.lastIndexOf("\n", s - 1) + 1;
  let le = val.indexOf("\n", e); if (le === -1) le = val.length;
  return { ls, le, lines: val.slice(ls, le).split("\n") };
}
function replaceSpan(ls, le, out) {
  editor.setSelectionRange(ls, le); document.execCommand("insertText", false, out);
  editor.setSelectionRange(ls, ls + out.length); setDirty(true); updateCursor();
}
function prefixRaw(prefix) {
  editor.focus();
  const { ls, le, lines } = lineSpan();
  const all = lines.every((l) => l.startsWith(prefix));
  replaceSpan(ls, le, lines.map((l) => all ? l.slice(prefix.length) : prefix + l).join("\n"));
}
function olRaw() {
  editor.focus();
  const { ls, le, lines } = lineSpan();
  const all = lines.every((l) => /^\d+\.\s/.test(l));
  replaceSpan(ls, le, lines.map((l, i) => all ? l.replace(/^\d+\.\s/, "") : (i + 1) + ". " + l).join("\n"));
}
function nextHeadingLevel(L, dir) {
  if (dir === "up") return L === 0 ? 1 : Math.max(1, L - 1);   // bigger: fewer #, up to H1
  return L === 0 ? 0 : (L >= 6 ? 0 : L + 1);                   // smaller: more #, H6 -> paragraph
}
function headingRaw(dir) {
  editor.focus();
  const { ls, le, lines } = lineSpan();
  const m = lines[0].match(/^(#{1,6})\s+/);
  const nL = nextHeadingLevel(m ? m[1].length : 0, dir);
  const stripped = lines[0].replace(/^#{1,6}\s+/, "");
  replaceSpan(ls, le, (nL ? "#".repeat(nL) + " " : "") + stripped + lines.slice(1).map((l) => "\n" + l).join(""));
}
function insertRaw(text, selectFrom, selectLen) {
  editor.focus();
  const s = editor.selectionStart, e = editor.selectionEnd;
  editor.setSelectionRange(s, e); document.execCommand("insertText", false, text);
  if (selectFrom != null) editor.setSelectionRange(s + selectFrom, s + selectFrom + selectLen);
  setDirty(true); updateCursor();
}
function blockPrefix() { const s = editor.selectionStart; return (s > 0 && editor.value[s - 1] !== "\n") ? "\n" : ""; }
function codeblockRaw() { const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd) || "code"; insertRaw("```\n" + sel + "\n```"); }
function linkRaw() { const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd) || "text"; const ins = "[" + sel + "](url)"; insertRaw(ins, ins.indexOf("(url)") + 1, 3); }
function imageRaw() { const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd) || "alt"; const ins = "![" + sel + "](url)"; insertRaw(ins, ins.indexOf("(url)") + 1, 3); }
function hrRaw() { insertRaw(blockPrefix() + "\n---\n"); }
function tableRaw() { insertRaw(blockPrefix() + "\n| Column A | Column B |\n| --- | --- |\n| 1 | 2 |\n"); }

function richCmd(cmd) { document.execCommand(cmd, false, null); }
function richInsert(html) { document.execCommand("insertHTML", false, html); }
function selText() { return window.getSelection ? window.getSelection().toString() : ""; }
function currentBlockTag() {
  let n = window.getSelection().anchorNode;
  while (n && n !== preview) { if (n.nodeType === 1 && /^(H[1-6]|P|BLOCKQUOTE|PRE)$/.test(n.tagName)) return n.tagName; n = n.parentNode; }
  return "";
}
function levelFromTag(t) { const m = /^H([1-6])$/.exec(t || ""); return m ? +m[1] : 0; }
function headingRich(dir) { const nL = nextHeadingLevel(levelFromTag(currentBlockTag()), dir); document.execCommand("formatBlock", false, nL ? "H" + nL : "P"); }
async function linkRich() {
  const sel = window.getSelection(), r = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;   // save selection — the modal steals it
  const url = await samPrompt("Link URL:", { value: "https://", ok: "Insert" });
  if (!url) return;
  preview.focus(); if (r) { try { sel.removeAllRanges(); sel.addRange(r); } catch (e) {} }
  document.execCommand("createLink", false, url);
}
async function imageRich() {
  const sel = window.getSelection(), r = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null, alt = selText() || "alt";
  const url = await samPrompt("Image URL:", { value: "https://", ok: "Insert" });
  if (!url) return;
  preview.focus(); if (r) { try { sel.removeAllRanges(); sel.addRange(r); } catch (e) {} }
  richInsert('<img src="' + escapeAttr(url) + '" alt="' + escapeAttr(alt) + '">');
}

const FORMATS = {
  bold:      { name: "Bold", desc: "**bold**", key: "Ctrl+B", raw: () => wrapRaw("**"), rich: () => richCmd("bold") },
  italic:    { name: "Italic", desc: "*italic*", key: "Ctrl+I", raw: () => wrapRaw("*"), rich: () => richCmd("italic") },
  strike:    { name: "Strikethrough", desc: "~~text~~", key: "", raw: () => wrapRaw("~~"), rich: () => richCmd("strikeThrough") },
  headingup:   { name: "Heading bigger", desc: "▲ fewer #  (up to H1)", key: "", raw: () => headingRaw("up"), rich: () => headingRich("up") },
  headingdown: { name: "Heading smaller", desc: "▼ more #  (down to text)", key: "", raw: () => headingRaw("down"), rich: () => headingRich("down") },
  code:      { name: "Inline code", desc: "`code`", key: "", raw: () => wrapRaw("`"), rich: () => richInsert("<code>" + escapeHtml(selText() || "code") + "</code>") },
  codeblock: { name: "Code block", desc: "``` fenced ```", key: "", raw: codeblockRaw, rich: () => richInsert("<pre><code>" + escapeHtml(selText() || "code") + "</code></pre>") },
  quote:     { name: "Blockquote", desc: "> quote", key: "", raw: () => prefixRaw("> "), rich: () => document.execCommand("formatBlock", false, "BLOCKQUOTE") },
  ul:        { name: "Bullet list", desc: "- item", key: "", raw: () => prefixRaw("- "), rich: () => richCmd("insertUnorderedList") },
  ol:        { name: "Numbered list", desc: "1. item", key: "", raw: olRaw, rich: () => richCmd("insertOrderedList") },
  task:      { name: "Task list", desc: "- [ ] task", key: "", raw: () => prefixRaw("- [ ] "), rich: () => richInsert("<ul><li>[ ] " + escapeHtml(selText() || "task") + "</li></ul>") },
  link:      { name: "Link", desc: "[text](url)", key: "Ctrl+K", raw: linkRaw, rich: linkRich },
  image:     { name: "Image", desc: "![alt](url)", key: "", raw: imageRaw, rich: imageRich },
  table:     { name: "Table", desc: "| a | b |", key: "", raw: tableRaw, rich: () => richInsert("<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>") },
  hr:        { name: "Horizontal rule", desc: "---", key: "", raw: hrRaw, rich: () => richInsert("<hr>") },
};
const RIB_ORDER = ["bold", "italic", "strike", "|", "headingup", "headingdown", "code", "codeblock", "quote", "|", "ul", "ol", "task", "|", "link", "image", "table", "hr"];
const ICONS = {
  bold: '<text x="3.5" y="12.5" font-family="Georgia,serif" font-size="13" font-weight="800" fill="currentColor">B</text>',
  italic: '<text x="5" y="12.5" font-family="Georgia,serif" font-size="13" font-style="italic" fill="currentColor">I</text>',
  strike: '<text x="3.4" y="12" font-family="Georgia,serif" font-size="12" fill="currentColor">S</text><line x1="2.5" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1.4"/>',
  headingup: '<text x="1" y="12.5" font-family="Georgia,serif" font-size="11" font-weight="800" fill="currentColor">H</text><path d="M10.5 8 L12.6 5.4 L14.7 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><line x1="12.6" y1="5.8" x2="12.6" y2="12.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  headingdown: '<text x="1" y="12.5" font-family="Georgia,serif" font-size="11" font-weight="800" fill="currentColor">H</text><path d="M10.5 10 L12.6 12.6 L14.7 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><line x1="12.6" y1="5.6" x2="12.6" y2="12.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  code: '<path d="M6 4.5 L2.5 8 L6 11.5 M10 4.5 L13.5 8 L10 11.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  codeblock: '<rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 6 L4 8 L6 10 M10 6 L12 8 L10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
  quote: '<rect x="2.5" y="4" width="1.6" height="8" fill="currentColor"/><line x1="6" y1="5.5" x2="13.5" y2="5.5" stroke="currentColor" stroke-width="1.4"/><line x1="6" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1.4"/><line x1="6" y1="10.5" x2="11" y2="10.5" stroke="currentColor" stroke-width="1.4"/>',
  ul: '<circle cx="3" cy="4.5" r="1.1" fill="currentColor"/><circle cx="3" cy="8" r="1.1" fill="currentColor"/><circle cx="3" cy="11.5" r="1.1" fill="currentColor"/><line x1="6" y1="4.5" x2="13.5" y2="4.5" stroke="currentColor" stroke-width="1.4"/><line x1="6" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1.4"/><line x1="6" y1="11.5" x2="13.5" y2="11.5" stroke="currentColor" stroke-width="1.4"/>',
  ol: '<text x="0.5" y="6" font-size="5" fill="currentColor">1</text><text x="0.5" y="10" font-size="5" fill="currentColor">2</text><text x="0.5" y="14" font-size="5" fill="currentColor">3</text><line x1="6" y1="4.5" x2="13.5" y2="4.5" stroke="currentColor" stroke-width="1.4"/><line x1="6" y1="8.5" x2="13.5" y2="8.5" stroke="currentColor" stroke-width="1.4"/><line x1="6" y1="12.5" x2="13.5" y2="12.5" stroke="currentColor" stroke-width="1.4"/>',
  task: '<rect x="1.5" y="5.5" width="5.5" height="5.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 8.3 L3.9 9.7 L6.2 6.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="8.3" x2="14" y2="8.3" stroke="currentColor" stroke-width="1.4"/>',
  link: '<path d="M6.8 9.2 a2.4 2.4 0 0 1 0-3.4 l1.4-1.4 a2.4 2.4 0 0 1 3.4 3.4 l-1.1 1.1 M9.2 6.8 a2.4 2.4 0 0 1 0 3.4 l-1.4 1.4 a2.4 2.4 0 0 1-3.4-3.4 l1.1-1.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  image: '<rect x="1.5" y="3" width="13" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="6.5" r="1.2" fill="currentColor"/><path d="M2.5 12 L6.5 8 L9 10.5 L11 8.5 L13.5 11.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  table: '<rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="1.5" y1="6.5" x2="14.5" y2="6.5" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" stroke-width="1.1"/><line x1="10" y1="3" x2="10" y2="13" stroke="currentColor" stroke-width="1.1"/>',
  hr: '<line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};
function applyFormat(kind) {
  const f = FORMATS[kind]; if (!f) return;
  blog("fmt " + kind + " mode=" + state.mode);
  if (state.mode === "rich") { preview.focus(); f.rich(); state.richEdited = true; setDirty(true); }
  else { editor.focus(); f.raw(); }
}
function buildRibbon() {
  const rib = $("ribbon");
  RIB_ORDER.forEach((kind) => {
    if (kind === "|") { const s = document.createElement("div"); s.className = "ribsep"; rib.appendChild(s); return; }
    const b = document.createElement("button");
    b.className = "ribx"; b.dataset.fmt = kind;
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' + ICONS[kind] + "</svg>";
    b.addEventListener("mousedown", (e) => e.preventDefault());   // item 1: keep editor focus + selection so format applies
    b.addEventListener("mouseenter", () => { clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(b, kind), 400); });
    b.addEventListener("mouseleave", () => clearTimeout(tipTimer));
    b.addEventListener("click", (e) => { e.stopPropagation(); applyFormat(kind); });
    rib.appendChild(b);
  });
}

/* ---------- corridor tooltip ---------- */
const fmttip = $("fmttip");
let tipState = null, tipTimer = null;
function showTip(btn, kind) {
  const f = FORMATS[kind];
  fmttip.querySelector(".nm").textContent = f.name;
  fmttip.querySelector(".ds").textContent = f.desc;
  const chip = fmttip.querySelector(".keybtn");
  chip.dataset.action = "fmt." + kind;
  renderKeyLabel(chip, keybinds["fmt." + kind] || "");
  const r = btn.getBoundingClientRect();
  fmttip.style.left = Math.round(r.left) + "px";
  fmttip.style.top = Math.round(r.bottom + 4) + "px";
  fmttip.classList.add("show");
  const tr = fmttip.getBoundingClientRect();
  if (tr.right > window.innerWidth - 4) fmttip.style.left = Math.round(window.innerWidth - 4 - tr.width) + "px";
  tipState = { icon: btn.getBoundingClientRect(), tip: fmttip.getBoundingClientRect() };
}
function hideTip() { if (capture) return; clearTimeout(tipTimer); fmttip.classList.remove("show"); tipState = null; }
function inCorridor(x, y) {
  if (!tipState) return false;
  const i = tipState.icon, t = fmttip.getBoundingClientRect();
  const inR = (r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
  if (inR(i) || inR(t)) return true;
  const cx1 = Math.min(i.left, t.left), cx2 = Math.max(i.right, t.right);
  return y >= i.bottom - 2 && y <= t.top + 2 && x >= cx1 - 2 && x <= cx2 + 2;  // downward corridor
}
document.addEventListener("mousemove", (e) => { if (tipState && !inCorridor(e.clientX, e.clientY)) hideTip(); });
fmttip.querySelector(".keybtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const chip = fmttip.querySelector(".keybtn");
  startCapture(chip.dataset.action, chip);
});

/* ---------- about + coffee ---------- */
let appInfo = null;
async function getInfo() {
  if (appInfo) return appInfo;
  try { appInfo = (api && api.app_info) ? (await api.app_info()) || {} : {}; } catch (e) { appInfo = {}; }
  return appInfo;
}
function openExternal(url) { if (api && api.open_external && url) api.open_external(url); }  // system browser, not the webview
async function showAbout() {
  const info = await getInfo();
  $("ab-title").textContent = info.title || "SAM";
  $("ab-ver").textContent = "v" + (info.version || "0.0.0");
  const gh = $("ab-gh"), url = info.github;
  if (url) { gh.textContent = url.replace(/^https?:\/\//, ""); gh.className = "link"; gh.onclick = () => openExternal(url); }
  else { gh.textContent = "(coming soon)"; gh.className = ""; gh.onclick = null; }
  const cf = $("ab-coffee"), curl = info.coffee;   // item 12: buy-me-a-coffee hyperlink (stub until COFFEE_URL set)
  if (curl) { cf.textContent = "Buy me a coffee"; cf.className = "link"; cf.onclick = () => openExternal(curl); }
  else { cf.textContent = "(coming soon)"; cf.className = ""; cf.onclick = null; }
  $("about").classList.add("show");
}
function hideAbout() { $("about").classList.remove("show"); }
async function showCoffee() {
  const info = await getInfo();
  const a = $("cf-url"), url = info.coffee;
  if (url) { a.textContent = url.replace(/^https?:\/\//, ""); a.className = ""; a.onclick = () => openExternal(url); }
  else { a.textContent = "(link coming soon)"; a.className = "disabled"; a.onclick = null; }
  $("coffee").classList.add("show");
}
function hideCoffee() { $("coffee").classList.remove("show"); }

/* ---------- actions ---------- */
const actions = {
  "file.new": doNew, "file.open": doOpen, "file.save": doSave, "file.saveas": doSaveAs,
  "file.close": doClose, "file.exit": doExit,
  "edit.undo": () => execEdit("undo"), "edit.redo": () => execEdit("redo"),
  "edit.cut": () => execEdit("cut"), "edit.copy": () => execEdit("copy"),
  "edit.paste": doPaste, "edit.selectall": () => execEdit("selectAll"),
  "edit.copypath": () => clip(state.path || ""), "edit.copydir": () => clip(dirName(state.path)),
  "view.markdown": toggleMode, "view.ontop": () => setOnTop(!state.onTop),
  "view.highvis": () => setHighvis(!state.highvis), "view.bg": () => $("bgPick").click(),
  "view.status": () => setStatusbar(!state.statusbar), "view.wrap": () => setWordwrap(!state.wordwrap),
  "edit.explorer": doExplorer, "edit.reset": doReset,
  "win.restore": () => api && api.restore(), "win.minimize": () => api && api.minimize(),
  "win.maximize": () => api && api.toggle_maximize(), "win.close": doClose,
  "about.about": showAbout, "app.setdefault": () => api && api.set_default(),
  "edit.find": () => openFind(false), "edit.replace": () => openFind(true),
  "view.instructions": toggleInstructions, "view.comments": () => toggleComments(),
};

/* ---------- menus ---------- */
function closeMenus() { document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open")); }
document.querySelectorAll("#menubar .menu").forEach((menu) => {
  const title = menu.querySelector(".title");
  title.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = menu.classList.contains("open");
    closeMenus();
    if (!wasOpen) { menu.classList.add("open"); if (menu.querySelector("#recent-sub")) refreshRecents(); }
  });
  title.addEventListener("mouseenter", () => {
    if (document.querySelector(".menu.open") && !menu.classList.contains("open")) {
      closeMenus(); menu.classList.add("open"); if (menu.querySelector("#recent-sub")) refreshRecents();
    }
  });
});
document.querySelectorAll(".mi[data-action]").forEach((mi) => {
  mi.addEventListener("click", (e) => { e.stopPropagation(); const a = mi.getAttribute("data-action"); closeMenus(); if (actions[a]) actions[a](); });
});
document.addEventListener("click", closeMenus);

/* ---------- bg picker + window controls ---------- */
$("bgPick").addEventListener("input", (e) => { state.bg = e.target.value; applyTheme(); persist({ bg: state.bg }); });
$("btnMin").onclick = () => { if (api) api.minimize(); };
$("btnMax").onclick = () => { if (api) api.toggle_maximize(); };
$("btnClose").onclick = () => doClose();
$("btnCoffee").onclick = showCoffee;
$("ab-closebtn").onclick = hideAbout;     // CSP blocks inline onclick=, so wire these here
$("cof-closebtn").onclick = hideCoffee;

/* ---------- editor / preview events ---------- */
editor.addEventListener("compositionstart", () => { editor._composing = true; });
editor.addEventListener("compositionend", () => { editor._composing = false; onEditInput(); });
editor.addEventListener("input", onEditInput);
["keyup", "click", "mouseup"].forEach((ev) => editor.addEventListener(ev, updateCursor));
editor.addEventListener("click", (e) => {   // boxes are on a pointer-events:none overlay -> hit-test the click point against them
  const layer = $("rawboxes"); if (!layer || !layer.firstChild) return;
  for (const b of layer.children) { const r = b.getBoundingClientRect(); if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { if (b.dataset.id) selectThread(b.dataset.id); return; } }
});
preview.addEventListener("input", () => { if (state.mode === "rich") { state.richEdited = true; if (!state.dirty) setDirty(true); } });

/* ---------- copy/cut: omit SAM's text colour so it pastes as the destination's colour (usually black) ---------- */
function _stripColor(root) {
  root.querySelectorAll("[style]").forEach((el) => { el.style.removeProperty("color"); el.style.removeProperty("-webkit-text-fill-color"); el.style.removeProperty("background-color"); if (!el.getAttribute("style")) el.removeAttribute("style"); });
  root.querySelectorAll("font[color]").forEach((el) => el.removeAttribute("color"));
}
function onCopyCut(e) {
  const sel = window.getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !e.clipboardData) return;
  const inEd = editor.contains(sel.anchorNode), inPv = preview.contains(sel.anchorNode);
  if (!inEd && !inPv) return;                                    // comment boxes etc. -> leave default behaviour
  e.clipboardData.setData("text/plain", sel.toString());
  if (inPv) { const d = document.createElement("div"); d.appendChild(sel.getRangeAt(0).cloneContents()); _stripColor(d); e.clipboardData.setData("text/html", d.innerHTML); }  // rich: keep structure, drop colour
  e.preventDefault();                                            // raw: plain text only
  if (e.type === "cut") { try { sel.getRangeAt(0).deleteContents(); } catch (_) {} if (inEd) onEditInput(); else { state.richEdited = true; setDirty(true); } }
}
document.addEventListener("copy", onCopyCut);
document.addEventListener("cut", onCopyCut);

/* ---------- rebindable keybindings ---------- */
const DEFAULT_KEYS = {
  "file.new": "Ctrl+N", "file.open": "Ctrl+O", "file.save": "Ctrl+S", "file.saveas": "Ctrl+Shift+S",
  "file.close": "Ctrl+W", "file.exit": "",
  "edit.undo": "Ctrl+Z", "edit.redo": "Ctrl+Y", "edit.cut": "Ctrl+X", "edit.copy": "Ctrl+C",
  "edit.paste": "Ctrl+V", "edit.selectall": "Ctrl+A", "edit.copypath": "", "edit.copydir": "",
  "view.markdown": "F12", "view.ontop": "F11", "view.highvis": "Ctrl+Shift+H", "view.bg": "", "view.status": "",
  "view.wrap": "", "view.instructions": "", "view.comments": "",
  "edit.explorer": "", "edit.find": "Ctrl+F", "edit.replace": "Ctrl+H",
};
Object.keys(FORMATS).forEach((k) => { actions["fmt." + k] = () => applyFormat(k); DEFAULT_KEYS["fmt." + k] = FORMATS[k].key || ""; });
const NATIVE_EDIT = new Set(["Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+A", "Ctrl+Z", "Ctrl+Y"]);
let keybinds = Object.assign({}, DEFAULT_KEYS);
let dispatch = {};

function isMod(k) { return k === "Control" || k === "Alt" || k === "Shift" || k === "Meta"; }
function normKey(k) { if (/^F([1-9]|1[0-2])$/.test(k)) return k; if (k === " " || k === "Spacebar") return "Space"; if (k.length === 1) return k.toUpperCase(); return k; }
function buildCombo(mods, main) { const p = []; if (mods.ctrl) p.push("Ctrl"); if (mods.alt) p.push("Alt"); if (mods.shift) p.push("Shift"); if (main) p.push(main); return p.join("+"); }
function comboFromEvent(e) { if (isMod(e.key)) return ""; return buildCombo({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey }, normKey(e.key)); }
function validCombo(combo) {
  if (!combo) return false;
  const parts = combo.split("+"); if (parts.length < 1 || parts.length > 3) return false;
  const isM = (p) => p === "Ctrl" || p === "Alt" || p === "Shift";
  const main = parts.filter((p) => !isM(p)); if (main.length !== 1) return false;
  if (parts.length === 1) return /^F([1-9]|1[0-2])$/.test(main[0]);
  return true;
}
function rebuildDispatch() { dispatch = {}; for (const a in keybinds) if (keybinds[a]) dispatch[keybinds[a]] = a; }
function renderKeyLabel(el, combo) { el.textContent = combo || "set"; el.classList.toggle("unset", !combo); }
function refreshKeyLabels() { document.querySelectorAll(".keybtn").forEach((el) => renderKeyLabel(el, keybinds[el.dataset.action] || "")); }
function setupKeyButtons() {
  document.querySelectorAll(".mi[data-action]").forEach((mi) => {
    if (mi.hasAttribute("data-nokey")) return;   // item 5: window-menu / About / Reset items are menu-only (no rebind chip)
    const action = mi.getAttribute("data-action");
    let el = mi.querySelector(".key");
    if (!el) { el = document.createElement("span"); el.className = "key"; mi.appendChild(el); }
    el.classList.add("keybtn"); el.dataset.action = action;
    renderKeyLabel(el, keybinds[action] || "");
    el.addEventListener("click", (e) => { e.stopPropagation(); startCapture(action, el); });
  });
}

let capture = null;
function startCapture(action, el) {
  cancelCapture();
  capture = { action, el, old: keybinds[action] || "", mods: { ctrl: false, alt: false, shift: false }, main: null, cand: "" };
  el.classList.add("capturing"); el.textContent = "press keys…";
  document.addEventListener("keydown", capKeydown, true);
  document.addEventListener("keyup", capKeyup, true);
  document.addEventListener("mousedown", capMousedown, true);
}
function endCapture() {
  if (!capture) return;
  document.removeEventListener("keydown", capKeydown, true);
  document.removeEventListener("keyup", capKeyup, true);
  document.removeEventListener("mousedown", capMousedown, true);
  capture.el.classList.remove("capturing"); capture = null;
}
function cancelCapture() { if (capture) { renderKeyLabel(capture.el, capture.old); endCapture(); } }
function capMousedown(e) { if (capture && e.target === capture.el) return; cancelCapture(); }
function capKeydown(e) {
  e.preventDefault(); e.stopPropagation();
  if (e.key === "Escape") { cancelCapture(); return; }
  capture.mods = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
  if (!isMod(e.key)) capture.main = normKey(e.key);
  capture.cand = buildCombo(capture.mods, capture.main);
  capture.el.textContent = capture.cand || "press keys…";
}
function capKeyup(e) {
  e.preventDefault(); e.stopPropagation();
  if (!capture) return;
  const allUp = !e.ctrlKey && !e.altKey && !e.shiftKey, releasedMain = !isMod(e.key) && capture.main;
  if (releasedMain || (allUp && capture.main)) commitCapture();
  else if (allUp && !capture.main) cancelCapture();
}
function commitCapture() {
  const combo = capture.cand, action = capture.action, el = capture.el, old = capture.old;
  if (!validCombo(combo)) {
    el.textContent = "invalid"; endCapture();
    setTimeout(() => { const b = document.querySelector('.keybtn[data-action="' + action + '"]'); if (b) renderKeyLabel(b, keybinds[action] || old); }, 850);
    return;
  }
  for (const a in keybinds) if (a !== action && keybinds[a] === combo) keybinds[a] = "";
  keybinds[action] = combo;
  endCapture(); refreshKeyLabels(); rebuildDispatch(); persist({ keybinds });
}

document.addEventListener("keydown", (e) => {
  if (capture) return;
  if (e.key === "Escape") { if ($("finddlg").classList.contains("show")) { closeFind(); return; } hideAbout(); hideCoffee(); closeMenus(); hideTip(); return; }
  const ae = document.activeElement;
  const inField = ae && ae !== editor && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
  const combo = comboFromEvent(e); if (!combo) return;
  const action = dispatch[combo]; if (!action || !actions[action]) return;
  if (inField && (action.startsWith("fmt.") || NATIVE_EDIT.has(combo))) return;   // typing in a panel field: block only format + native-edit combos; let Ctrl+S / Ctrl+N / Ctrl+O / Ctrl+W / find etc. through
  if (action.startsWith("edit.") && NATIVE_EDIT.has(combo) && document.activeElement === editor) return;
  e.preventDefault(); actions[action]();
});

/* ======================= v0.9 features ======================= */
function scrollEditorTo(idx) {
  const before = editor.value.slice(0, idx), line = before.split("\n").length;
  const lh = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (line - 4) * lh);
}
function defaultAuthor() { return "Me"; }   // neutral default — NEVER the OS login name (it lands in the shareable .md.notes)

/* ---------- A12: responsive top strip — title drops first, then ribbon to row 2 ---------- */
function reflowBar() {
  const bar = $("menubar"); if (!bar) return;
  bar.classList.remove("hide-title", "ribbon-2");        // reset, then measure inline widths
  const avail = bar.clientWidth; if (!avail) return;
  const w = (el) => el ? el.getBoundingClientRect().width : 0;
  const logo = $("logo"), wctl = $("wctl"), ribbon = $("ribbon");
  let menusW = 0; bar.querySelectorAll(".menu").forEach((m) => { if (m !== logo) menusW += w(m); });
  const withRibbon = w(logo) + menusW + w(wctl) + w(ribbon) + 14;
  if (withRibbon + 165 > avail) {                         // <165px left for the title -> hide it (so it never wraps)
    bar.classList.add("hide-title");
    if (withRibbon > avail) bar.classList.add("ribbon-2"); // ribbon would collide with comment/buttons -> row 2
  }
}

/* ---------- A8: instructions at startup ---------- */
function toggleInstructions() { state.showInstructions = !state.showInstructions; persist({ showInstructions: state.showInstructions }); updateChecks(); }

/* ---------- A1/A2: drag-drop open + convert ---------- */
let _dragDepth = 0;
function extOf(p) { const m = /\.([a-z0-9]+)$/i.exec(p || ""); return m ? m[1].toLowerCase() : ""; }
function showDrop(on) { $("dropmask").classList.toggle("show", on); }
function pathsFromDrop(e) {
  const out = [], fl = (e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files : [];
  for (let i = 0; i < fl.length; i++) { const p = (api && api.path_for_file) ? api.path_for_file(fl[i]) : (fl[i].path || ""); if (p) out.push(p); }
  return out;
}
async function handleDrop(e) {
  if (!api) return;
  for (const p of pathsFromDrop(e)) {
    const ext = extOf(p);
    if (window.SAMConvert && SAMConvert.supports(ext)) await convertAndOpen(p, ext);
    else { api.new_window(p); noteRecent(p); }                       // md / txt / unknown -> open
  }
}
async function convertAndOpen(p, ext) {
  const restore = () => { $("stMode").textContent = state.mode === "rich" ? "rendered" : "raw"; };
  try {
    $("stMode").textContent = "converting…";
    let payload = null;
    if (ext === "csv") { const r = await api.read_path(p); if (!r || r.error) { await samAlert("Read failed:\n" + ((r && r.error) || "")); return restore(); } payload = { text: r.content }; }
    else { const r = await api.read_binary(p); if (!r || r.error) { await samAlert("Read failed:\n" + ((r && r.error) || "")); return restore(); } payload = { b64: r.b64 }; }
    const out = await SAMConvert.convert(ext, payload);
    if (out.error) { await samAlert("Convert failed (." + ext + "):\n" + out.error); return restore(); }
    openConverted(p, out.md);
  } catch (err) { await samAlert("Convert error:\n" + ((err && err.message) || err)); }
  restore();
}
async function openConverted(srcPath, md) {
  const name = baseName(srcPath);
  if (state.dirty && !isPristineContent()) { if (!(await samConfirm("Replace the current unsaved document with the conversion of “" + name + "”?", { ok: "Replace" }))) return; }
  editor.value = md; state.path = null; state.richEdited = false; state._fromName = name; rawUndoReset();
  setDirty(true);
  if (state.mode === "rich") render();
  updateTitle(); updateCursor();
  state.notesModel = { threads: [], quarantine: [] }; renderComments();
  blog("converted " + name + " -> " + md.length + " md chars");
}
function isFileDrag(e) { try { return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"); } catch (_) { return false; } }
window.addEventListener("dragenter", (e) => { if (!isFileDrag(e)) return; e.preventDefault(); _dragDepth++; showDrop(true); });
window.addEventListener("dragover", (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
window.addEventListener("dragleave", (e) => { if (!isFileDrag(e)) return; e.preventDefault(); _dragDepth = Math.max(0, _dragDepth - 1); if (!_dragDepth) showDrop(false); });
window.addEventListener("drop", async (e) => { if (!isFileDrag(e)) return; e.preventDefault(); _dragDepth = 0; showDrop(false); await handleDrop(e); });
editor.addEventListener("dragstart", (e) => e.preventDefault());   // don't drag-move selected text -> click-drag just re-selects

/* ---------- A7: find / replace ---------- */
function showReplaceRows(on) { document.querySelectorAll("#finddlg .replace-only").forEach((el) => { el.style.display = on ? (el.tagName === "BUTTON" ? "inline-block" : "flex") : "none"; }); }
function openFind(replace) {
  if (state.mode !== "raw") setMode("raw");
  showReplaceRows(!!replace);
  $("findCase").checked = state.matchCase; $("findWrap").checked = state.wrapAround !== false;
  const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (sel && sel.length < 100 && sel.indexOf("\n") < 0) $("findIn").value = sel;
  $("findStat").textContent = ""; $("finddlg").classList.add("show");
  $("findIn").focus(); $("findIn").select();
}
function closeFind() { $("finddlg").classList.remove("show"); editor.focus(); }
function findNext() {
  const q = $("findIn").value; if (!q) return;
  const cs = $("findCase").checked, wrap = $("findWrap").checked, up = $("findUp").checked;
  state.matchCase = cs; state.wrapAround = wrap; persist({ matchCase: cs, wrapAround: wrap });
  const hay = cs ? editor.value : editor.value.toLowerCase(), needle = cs ? q : q.toLowerCase();
  let idx;
  if (up) { idx = hay.lastIndexOf(needle, Math.max(0, editor.selectionStart - 1)); if (idx < 0 && wrap) idx = hay.lastIndexOf(needle); }
  else { idx = hay.indexOf(needle, editor.selectionEnd); if (idx < 0 && wrap) idx = hay.indexOf(needle, 0); }
  if (idx < 0) { $("findStat").textContent = "No matches"; return; }
  editor.focus(); editor.setSelectionRange(idx, idx + q.length); scrollEditorTo(idx); updateCursor(); $("findStat").textContent = "";
}
function replaceOne() {
  const q = $("findIn").value, r = $("replIn").value; if (!q) return;
  const cs = $("findCase").checked, selv = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (cs ? selv === q : selv.toLowerCase() === q.toLowerCase()) { editor.setRangeText(r, editor.selectionStart, editor.selectionEnd, "end"); setDirty(true); }
  findNext();
}
function replaceAll() {
  const q = $("findIn").value, r = $("replIn").value; if (!q) return;
  const cs = $("findCase").checked, val = editor.value, hay = cs ? val : val.toLowerCase(), needle = cs ? q : q.toLowerCase();
  let out = "", i = 0, j, n = 0;
  while ((j = hay.indexOf(needle, i)) >= 0) { out += val.slice(i, j) + r; i = j + needle.length; n++; }
  out += val.slice(i);
  if (n) { const at = Math.min(editor.selectionStart, out.length); editor.value = out; editor.setSelectionRange(at, at); setDirty(true); updateCursor(); }
  $("findStat").textContent = n + " replaced";
}

/* ---------- A10: drag-to-move window from titlebar icons/menus ---------- */
let _wm = null, _swallowClick = false;
function initWindowDrag() {
  const bar = $("menubar");
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("input, textarea")) return;
    _wm = { sx: e.screenX, sy: e.screenY, moving: false, bounds: null };
  });
  window.addEventListener("pointermove", async (e) => {
    if (!_wm) return;
    const dx = e.screenX - _wm.sx, dy = e.screenY - _wm.sy;
    if (!_wm.moving) { if (Math.abs(dx) + Math.abs(dy) < 50) return; _wm.moving = true; closeMenus(); hideTip(); try { _wm.bounds = (api && api.get_bounds) ? await api.get_bounds() : null; } catch (_) {} }
    if (_wm.moving && _wm.bounds && api && api.set_position) api.set_position(_wm.bounds.x + dx, _wm.bounds.y + dy);
  });
  window.addEventListener("pointerup", () => { if (_wm && _wm.moving) { _swallowClick = true; setTimeout(() => { _swallowClick = false; }, 60); } _wm = null; });
  bar.addEventListener("click", (e) => { if (_swallowClick) { e.stopPropagation(); e.preventDefault(); _swallowClick = false; } }, true);
}

/* ---------- A3: themed close-confirm ---------- */
function showCloseDlg() { $("close-msg").textContent = (state.path ? baseName(state.path) : "This document") + " has unsaved changes."; $("closedlg").classList.add("show"); }
function hideCloseDlg() { $("closedlg").classList.remove("show"); }

/* ---------- B: comments & threads ---------- */
function nowISO() { return new Date().toISOString(); }
function fmtTime(iso) { try { return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }); } catch (e) { return iso; } }
function findThread(id) { return (state.notesModel.threads || []).find((t) => t.id === id); }
function countMessages(model) { return (model && model.threads ? model.threads : []).reduce((n, t) => n + (t.messages ? t.messages.length : 0), 0); }
function activeThreads() { return (state.notesModel.threads || []).filter((t) => t.status === "open" && t.messages && t.messages.length); }   // only highlight/number/count threads with a SENT message (not empty drafts)
function applyCommentsWidth() {
  const c = $("comments"); if (!c) return;
  const total = ($("content") && $("content").clientWidth) || window.innerWidth;
  c.style.flex = "0 0 " + Math.round(Math.min(0.72, Math.max(0.15, state.commentsWidth || 0.28)) * total) + "px";
}
function applyMinSize() { if (api && api.set_min_size) api.set_min_size(state.commentsOpen ? 445 : 225, 240); }
async function openComments() {
  state.commentsOpen = true;
  document.body.classList.add("comments"); $("btnComments").classList.add("on", "has");
  persist({ commentsOpen: true }); updateChecks(); applyMinSize(); applyCommentsWidth();
  $("btnComments").classList.remove("flash"); if (api && api.flash_frame) api.flash_frame(false);
  if (state._notesLoadedFor !== state.path && !_notesDirty) await loadNotes(); else renderComments();   // don't reload (would wipe unsaved comments)
}
function closeComments() {
  state.commentsOpen = false;
  document.body.classList.remove("comments"); $("btnComments").classList.remove("on");
  persist({ commentsOpen: false }); updateChecks(); applyMinSize(); renderCommentHighlights();
}
function toggleComments(force) { const open = (typeof force === "boolean") ? force : !state.commentsOpen; if (open) openComments(); else closeComments(); }
function flashComments() { const b = $("btnComments"); b.classList.add("has", "flash"); if (api && api.flash_frame) api.flash_frame(true); }
async function loadNotes(keepSel) {
  if (!$("cmtlist")) return;
  if (!api || !api.read_notes || !state.path) { state.notesModel = { threads: [], quarantine: [] }; state._notesSig = "none"; state._notesLoadedFor = state.path; _notesDirty = false; if (!keepSel) state.selThread = null; renderComments(); return; }
  try {
    const r = await api.read_notes(state.path);
    if (r && r.missing) state.notesModel = { threads: [], quarantine: [] };
    else if (r && r.text != null) state.notesModel = window.SAMNotes.parse(r.text);
    else if (r && r.error) blog("notes read error " + r.error);
  } catch (e) { blog("notes load fail " + (e && e.message)); }
  try { const st = await api.stat_notes(state.path); state._notesSig = st ? (st.mtimeMs + ":" + st.size) : "none"; } catch (e) {}
  state._notesLoadedFor = state.path;
  _notesDirty = false;   // fresh from disk == clean
  if (!keepSel) state.selThread = null;
  renderComments();
}
let _notesDirty = false;   // comments changed in memory but not yet written — they ride with the next document save
function markNotesDirty() { _notesDirty = true; setDirty(true); }   // a comment edit dirties the DOCUMENT; Ctrl+S then writes .md + .md.notes together
async function saveNotes() {
  if (!api || !api.write_notes || !state.path) return;
  // serialize a FILTERED COPY (drop empty in-progress drafts from the file) without mutating the live model —
  // otherwise a Ctrl+S mid-comment would delete the draft you're still typing
  const model = { threads: (state.notesModel.threads || []).filter((t) => (t.messages && t.messages.length) || !t._draft), quarantine: state.notesModel.quarantine };
  try {
    const r = await api.write_notes(state.path, window.SAMNotes.serialize(model));
    if (r && r.error) { await samAlert("Could not save comments:\n" + r.error); return; }
    const st = await api.stat_notes(state.path); if (st) state._notesSig = st.mtimeMs + ":" + st.size;
  } catch (e) { blog("notes save fail " + (e && e.message)); }
}
function parseSearch(q) {
  const f = { author: "", is: "", terms: [], phrases: [] }; const re = /(\w+):(\S+)|"([^"]+)"|(\S+)/g; let m;
  while ((m = re.exec(q || "")) !== null) {
    if (m[1]) { const k = m[1].toLowerCase(), v = m[2].toLowerCase(); if (k === "author") f.author = v; else if (k === "is") f.is = v; else f.terms.push((m[1] + ":" + m[2]).toLowerCase()); }
    else if (m[3]) f.phrases.push(m[3].toLowerCase());
    else if (m[4]) f.terms.push(m[4].toLowerCase());
  }
  return f;
}
function threadMatches(t, f) {
  const text = ((t.messages || []).map((mm) => mm.author + " " + mm.body).join("\n") + " " + ((t.anchor && t.anchor.exact) || "")).toLowerCase();
  if (f.is === "open" && t.status !== "open") return false;
  if (f.is === "resolved" && t.status !== "resolved") return false;
  if (f.is === "deleted" && t.status !== "deleted") return false;
  if (f.author && !(t.messages || []).some((mm) => mm.author.toLowerCase().includes(f.author))) return false;
  for (const p of f.phrases) if (text.indexOf(p) < 0) return false;
  for (const w of f.terms) if (text.indexOf(w) < 0) return false;
  return true;
}
function visibleThreads() {   // open/resolved always (resolved greyed); deleted shows greyed for ~5s then hides (kept in file), or via is:deleted
  const f = parseSearch($("cmtSearch") ? $("cmtSearch").value : "");
  const now = Date.now();
  return (state.notesModel.threads || []).filter((t) => {
    if (!threadMatches(t, f)) return false;
    if (t.status === "deleted" && f.is !== "deleted" && !(t._delAt && now - t._delAt < 5000)) return false;
    return true;
  });
}
function updateCounts() {
  const all = state.notesModel.threads || [], vis = visibleThreads();
  const open = all.filter((t) => t.status === "open" && t.messages && t.messages.length).length;
  const resolved = all.filter((t) => t.status === "resolved").length;
  const deleted = all.filter((t) => t.status === "deleted").length;
  const i = vis.findIndex((t) => t.id === state.selThread), pad = (n) => String(n).padStart(2, "0");
  $("cmtCounts").textContent = pad(i >= 0 ? i + 1 : 0) + " / " + pad(open) + " / " + pad(resolved) + " / " + pad(deleted);
  $("btnComments").classList.toggle("has", open > 0);
  $("btnComments").querySelector(".badge").textContent = open;
  const sn = $("stCommentsN"); if (sn) sn.textContent = open;                                  // status-bar counter
  const ss = $("stComments"); if (ss) ss.title = open + " open · " + resolved + " resolved · " + deleted + " deleted";
}
let threadNum = {};
function assignThreadNumbers() {   // number open threads by document position (top -> bottom) for the badges
  threadNum = {};
  const open = activeThreads().map((t) => ({ t, r: (t.anchor && t.anchor.exact) ? window.SAMNotes.relocate(t, editor.value) : null }));
  open.sort((a, b) => ((a.r ? a.r.start : 1e9) - (b.r ? b.r.start : 1e9)));
  open.forEach((o, i) => { threadNum[o.t.id] = i + 1; });
}
function renderComments() {
  const list = $("cmtlist"); if (!list) return;
  // preserve an in-progress comment box (text + caret + focus) so a re-render (poll, 5s delete-sweep,
  // reload) can NEVER eat what you're typing
  let keep = null;
  const af = document.activeElement;
  if (af && af.tagName === "TEXTAREA" && list.contains(af)) { const c = af.closest(".cmt"); if (c) keep = { id: c.dataset.id, val: af.value, s: af.selectionStart, e: af.selectionEnd }; }
  assignThreadNumbers();
  updateCounts();
  const vis = visibleThreads();
  list.innerHTML = "";
  if (!vis.length) {
    list.innerHTML = '<div class="empty">' + ((state.notesModel.threads || []).length ? "No comments match the search." : "No comments yet.<br>Select text (raw view), then press +.") + "</div>";
  } else {
    vis.forEach((t) => list.appendChild(renderThread(t)));
  }
  if (keep && keep.id) {
    const c = list.querySelector('.cmt[data-id="' + keep.id + '"]'), ta = c && c.querySelector("textarea");
    if (ta) { ta.value = keep.val; ta.focus(); try { ta.setSelectionRange(keep.s, keep.e); } catch (_) {} }
  }
  renderCommentHighlights();
}
function renderThread(t) {
  const card = document.createElement("div");
  card.className = "cmt st-" + t.status + (t.id === state.selThread ? " sel" : ""); card.dataset.id = t.id;
  const range = (t.anchor && t.anchor.exact) ? window.SAMNotes.relocate(t, editor.value) : null;
  const q = document.createElement("div");
  q.className = "quote" + (t.anchor && t.anchor.exact && !range ? " orphan" : "");
  const base = (t.anchor && t.anchor.exact) ? (range ? "“" + t.anchor.exact.slice(0, 120) + "”" : "⚠ anchor lost: “" + t.anchor.exact.slice(0, 80) + "”") : "(document note)";
  q.textContent = (threadNum[t.id] ? "#" + threadNum[t.id] + "  " : "") + base;
  q.onclick = () => selectThread(t.id);
  card.appendChild(q);
  const msgs = document.createElement("div"); msgs.className = "msgs";
  (t.messages || []).forEach((m) => {
    const d = document.createElement("div"); d.className = "msg";
    d.innerHTML = '<span class="who"></span><span class="when"></span><div class="body"></div>';
    d.querySelector(".who").textContent = m.author;
    d.querySelector(".when").textContent = fmtTime(m.time);
    d.querySelector(".body").textContent = m.body;
    msgs.appendChild(d);
  });
  card.appendChild(msgs);
  const acts = document.createElement("div"); acts.className = "acts";
  if (t.status === "open") {
    const add = document.createElement("div"); add.className = "addrow";
    const ta = document.createElement("textarea"); ta.placeholder = (t.messages && t.messages.length) ? "Reply…" : "Comment…";
    const send = document.createElement("button"); send.className = "send"; send.textContent = "➤"; send.title = "Send (Enter)";
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(t.id, ta); } });
    ta.addEventListener("focus", _kickFocus);   // any comment field (draft or reply) -> ensure keystrokes route to it
    send.onclick = () => doSend(t.id, ta);
    add.appendChild(ta); add.appendChild(send); card.appendChild(add);
    const rb = document.createElement("button"); rb.textContent = "Resolve"; rb.onclick = () => setThreadStatus(t.id, "resolved");
    const db = document.createElement("button"); db.className = "danger"; db.textContent = "Delete"; db.onclick = () => setThreadStatus(t.id, "deleted");
    acts.appendChild(rb); acts.appendChild(db);
  } else {
    const rb = document.createElement("button"); rb.textContent = (t.status === "deleted") ? "Undo" : "Reopen";
    if (t.status === "deleted") rb.className = "undo";
    rb.onclick = () => setThreadStatus(t.id, "open");
    acts.appendChild(rb);
  }
  card.appendChild(acts);
  card.addEventListener("click", (e) => { if (!e.target.closest("button, textarea")) selectThread(t.id); });
  return card;
}
function _kickFocus() { try { if (api && api.kick_focus) api.kick_focus(); } catch (e) {} }   // rebind Chromium's input client to the focused comment field (see main.js kick_focus)
function focusDraft(id) {
  const card = $("cmtlist").querySelector('.cmt[data-id="' + id + '"]'); if (!card) return;
  const ta = card.querySelector("textarea"); if (!ta) return;
  try { const a = document.activeElement; if (a === editor || a === preview) a.blur(); } catch (e) {}   // end the contenteditable editing session first
  ta.focus(); card.scrollIntoView({ block: "nearest" }); _kickFocus();
}
async function addDraft() {
  if (!state.path) { await samAlert("Save the document first — comments are stored beside the file as <name>.md.notes."); return; }
  if (state.mode !== "raw") setMode("raw");
  const s = editor.selectionStart, e = editor.selectionEnd;
  if (s === e) { await samAlert("Select the text you want to comment on, then press +."); return; }
  const anchor = window.SAMNotes.makeAnchor(editor.value, s, e);
  try { const w = window.getSelection(); if (w) w.removeAllRanges(); } catch (_) {}   // drop the editor's selection so the contenteditable can't pull focus back
  if (!state.commentsOpen) await openComments();                 // load notes BEFORE adding the draft (so reload can't wipe it)
  else if (state._notesLoadedFor !== state.path) await loadNotes();
  const t = { id: window.SAMNotes.newId(), status: "open", anchor, messages: [], _draft: true };
  state.notesModel.threads.unshift(t); state.selThread = t.id;
  renderComments();
  const focusIt = () => focusDraft(t.id);                        // win over any async refocus (panel open / window resize)
  requestAnimationFrame(focusIt); setTimeout(focusIt, 0); setTimeout(focusIt, 140);
}
async function doSend(id, ta) {
  const t = findThread(id); if (!t) return;
  const text = (ta.value || "").trim(); if (!text) return;
  const author = (($("cmtName").value || "").trim()) || state.commentAuthor || defaultAuthor();
  if (author !== state.commentAuthor) { state.commentAuthor = author; persist({ commentAuthor: author }); }
  t.messages.push({ author, time: nowISO(), body: text }); delete t._draft; ta.value = "";
  markNotesDirty(); renderComments(); selectThread(id); requestAnimationFrame(() => focusDraft(id));   // writes to disk on the next document save, not now
}
let _delSweep = null;
async function setThreadStatus(id, status) {                          // single delete/resolve/undo path (selected or not -> same rule)
  const t = findThread(id); if (!t) return;
  t.status = status; t.meta = (status === "open") ? "" : (status + " " + nowISO());   // soft, in place, no dialog
  if (status === "deleted") { t._delAt = Date.now(); if (_delSweep) clearTimeout(_delSweep); _delSweep = setTimeout(renderComments, 5200); }   // greyed + Undo for 5s, then hides (kept in file)
  else delete t._delAt;
  state.selThread = id;
  markNotesDirty(); renderComments();
}
function selectThread(id) {
  state.selThread = id;
  document.querySelectorAll("#cmtlist .cmt").forEach((c) => c.classList.toggle("sel", c.dataset.id === id));
  const t = findThread(id);
  if (t) {
    const range = (t.anchor && t.anchor.exact) ? window.SAMNotes.relocate(t, editor.value) : null;
    if (range) {
      if (state.mode === "raw") { editor.focus(); editor.setSelectionRange(range.start, range.end); scrollEditorTo(range.start); }
      else { const mk = preview.querySelector('mark.cmthl[data-id="' + id + '"]'); if (mk && mk.scrollIntoView) mk.scrollIntoView({ block: "center" }); }
    }
  }
  document.querySelectorAll("#preview mark.cmthl").forEach((m) => m.classList.toggle("sel", m.dataset.id === id));
  highlightRaw();
  updateCounts();
}
function navComment(dir) {
  const vis = visibleThreads(); if (!vis.length) return;
  let i = vis.findIndex((t) => t.id === state.selThread);
  i = (i < 0) ? (dir > 0 ? 0 : vis.length - 1) : (i + dir + vis.length) % vis.length;
  selectThread(vis[i].id);
}
function renderCommentHighlights() { highlightPreview(); highlightRaw(); }
/* Comment boxes in the raw view are drawn on a separate overlay layer (#rawboxes), NOT injected into the
   editor. For each thread we build a DOM Range from its char offsets and read range.getClientRects() — one
   rect per WRAPPED line, straight from real layout — then draw an absolute box div per rect. The editor stays
   pristine plain text (caret / custom-undo / find code untouched), and boxes are wrap-correct by construction:
   no innerHTML rebuild = no offset/caret/reflow race = no "slips one line down". highlightRaw() recomputes the
   anchors (after a text change); drawRawBoxes() just repaints from the cache (scroll / resize / zoom). */
let _rawBoxAnchors = [];   // cached {id, n, start, end} so scroll/resize redraws cheaply (no re-relocate)
function highlightRaw() {
  _rawBoxAnchors = [];
  const layer = $("rawboxes"); if (!layer) return;
  if (state.mode !== "raw" || !state.commentsOpen || !editor.isConnected) { layer.textContent = ""; return; }
  const text = editor.value;
  activeThreads().forEach((t) => {
    if (!(t.anchor && t.anchor.exact)) return;
    const r = window.SAMNotes.relocate(t, text); if (!r) return;          // null -> orphan (shown in panel, no box)
    _rawBoxAnchors.push({ id: t.id, n: threadNum[t.id] || "", start: r.start, end: r.end });
  });
  drawRawBoxes();
}
// Nudge overlapping number badges apart so the digits stay readable. items: [{el, x, y}] = the badge's
// top-right anchor; badges that collide get pushed straight down (via the --noy CSS var) in ~16px steps.
function _deOverlapBadges(items) {
  if (!items || items.length < 2) return;
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [], BW = 22, BH = 16;
  items.forEach((it) => {
    let oy = 0, tries = 0;
    while (tries < 10 && placed.some((p) => Math.abs(it.x - p.x) < BW && Math.abs((it.y + oy) - p.y) < BH)) { oy += BH; tries++; }
    if (oy) it.el.style.setProperty("--noy", oy + "px");
    placed.push({ x: it.x, y: it.y + oy });
  });
}
function drawRawBoxes() {
  const layer = $("rawboxes"); if (!layer) return;
  if (state.mode !== "raw" || !state.commentsOpen) { layer.textContent = ""; return; }
  const erect = editor.getBoundingClientRect(), top = erect.top, bot = erect.bottom;
  const frag = document.createDocumentFragment(), badges = [];
  _rawBoxAnchors.forEach((a) => {
    const A = _edLocate(a.start), B = _edLocate(a.end);
    let rects; try { const rg = document.createRange(); rg.setStart(A.node, A.offset); rg.setEnd(B.node, B.offset); rects = rg.getClientRects(); } catch (e) { return; }
    const sel = (a.id === state.selThread); let badged = false;
    for (let i = 0; i < rects.length; i++) {
      const rc = rects[i];
      if (rc.width < 0.5 || rc.height < 0.5) continue;                    // skip zero-width caret rects at line ends
      if (rc.bottom <= top + 1 || rc.top >= bot - 1) continue;            // cull rects scrolled out of the editor viewport
      const box = document.createElement("div");
      box.className = "cbox" + (sel ? " sel" : "");
      box.dataset.id = a.id;
      const x = rc.left - erect.left, y = rc.top - erect.top;
      if (a.n && !badged) { box.dataset.n = a.n; badged = true; badges.push({ el: box, x: x + rc.width, y: y }); }   // badge on the first VISIBLE fragment
      box.style.cssText = "left:" + x + "px;top:" + y + "px;width:" + rc.width + "px;height:" + rc.height + "px";
      frag.appendChild(box);
    }
  });
  _deOverlapBadges(badges);              // de-collide the number badges before they go in
  layer.textContent = "";
  layer.appendChild(frag);
}
let _boxRAF = 0;
function scheduleDrawBoxes() { if (_boxRAF) return; _boxRAF = requestAnimationFrame(() => { _boxRAF = 0; drawRawBoxes(); }); }
editor.addEventListener("scroll", scheduleDrawBoxes);
if (window.ResizeObserver) { try { new ResizeObserver(scheduleDrawBoxes).observe(editor); } catch (e) { window.addEventListener("resize", scheduleDrawBoxes); } }
else window.addEventListener("resize", scheduleDrawBoxes);
// Rendered-view badge de-overlap — mirror the raw path: measure the rendered marks and re-run on every
// layout change (the inline ::after badges only have valid geometry after the preview has laid out, and the
// preview reflows on panel-resize / window-resize / zoom). Reset --noy first so a badge that no longer
// collides returns home.
function dePreviewBadges() {
  if (!preview || state.mode !== "rich" || !state.commentsOpen) return;
  const badged = preview.querySelectorAll("mark.cmthl[data-n]");
  badged.forEach((mk) => mk.style.removeProperty("--noy"));
  const marks = [];
  badged.forEach((mk) => { const r = mk.getBoundingClientRect(); if (r.width || r.height) marks.push({ el: mk, x: r.right, y: r.top }); });
  _deOverlapBadges(marks);
}
let _preBoxRAF = 0;
function scheduleDePreview() { if (_preBoxRAF) return; _preBoxRAF = requestAnimationFrame(() => { _preBoxRAF = 0; dePreviewBadges(); }); }
preview.addEventListener("scroll", scheduleDePreview);
if (window.ResizeObserver) { try { new ResizeObserver(scheduleDePreview).observe(preview); } catch (e) { window.addEventListener("resize", scheduleDePreview); } }
/* Rendered-view highlights. The raw-markdown quote (with #, `, *, links…) won't appear verbatim in the
   rendered text, and a quote can span several block elements. So: strip the quote to plain text, search the
   preview's concatenated text (text nodes joined by "\n" so \s+ can bridge block boundaries), pick the
   occurrence whose preceding text best matches the anchor's prefix (disambiguates duplicates like "convert"
   appearing in both a heading and the body), then wrap each spanned text-node segment in a <mark>. */
function _escRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function plainOfMd(s) {
  return (s || "")
    .replace(/`([^`]*)`/g, "$1")                       // inline code -> its text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")          // image -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")           // link -> link text
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")          // ATX heading marks
    .replace(/^[ \t]*>[ \t]?/gm, "")                   // blockquote marks
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")   // list markers
    .replace(/[*_~]{1,3}/g, "")                        // emphasis / strong / strike marks
    .replace(/\s+/g, " ")
    .trim();
}
function highlightPreview() {
  if (!preview) return;
  preview.querySelectorAll("mark.cmthl").forEach((m) => { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); if (p.normalize) p.normalize(); });
  if (state.mode !== "rich" || !state.commentsOpen) return;
  activeThreads().forEach((t) => { if (t.anchor && t.anchor.exact) placePreviewMark(t); });
  scheduleDePreview();                    // de-collide number badges after the preview has laid out (deferred + re-run on reflow)
}
function placePreviewMark(t) {
  const nodes = [], starts = []; let full = "";
  const w = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null); let n;
  while ((n = w.nextNode())) {
    if (n.parentElement && n.parentElement.closest("mark.cmthl")) continue;
    starts.push(full.length); nodes.push(n); full += n.nodeValue + "\n";   // "\n" lets a match bridge separate block elements
  }
  const key = plainOfMd(t.anchor.exact);
  const words = key.split(/\s+/).filter(Boolean).map(_escRx);
  if (!words.length || key.length < 2) return;
  let rx; try { rx = new RegExp(words.join("\\s+"), "gi"); } catch (e) { return; }
  const pfxTail = plainOfMd(t.anchor.prefix || "").slice(-14).toLowerCase();
  let best = null, m;
  while ((m = rx.exec(full))) {
    const pre = full.slice(Math.max(0, m.index - 48), m.index).replace(/\s+/g, " ").toLowerCase();
    const score = pfxTail ? (pre.indexOf(pfxTail) >= 0 ? 0 : 1) : 0;     // prefer the occurrence preceded by the anchor's prefix
    if (!best || score < best.score) best = { s: m.index, e: m.index + m[0].length, score };
    if (best && best.score === 0) break;
    if (rx.lastIndex === m.index) rx.lastIndex++;
  }
  if (!best) return;
  const num = threadNum[t.id], segs = [];
  for (let i = 0; i < nodes.length; i++) {
    const ns = starts[i], ne = ns + nodes[i].nodeValue.length;
    const a = Math.max(best.s, ns), b = Math.min(best.e, ne);
    if (a < b) segs.push({ node: nodes[i], s: a - ns, e: b - ns });
  }
  segs.forEach((sg, i) => {
    try {
      const r = document.createRange(); r.setStart(sg.node, sg.s); r.setEnd(sg.node, sg.e);
      const mk = document.createElement("mark"); mk.className = "cmthl" + (t.id === state.selThread ? " sel" : "");
      mk.dataset.id = t.id; if (num && i === 0) mk.dataset.n = num;          // number badge on the first segment only
      mk.addEventListener("click", (ev) => { ev.stopPropagation(); selectThread(t.id); });
      r.surroundContents(mk);
    } catch (e) {}
  });
}
async function checkNotes() {
  if (!state.commentsOpen || !api || !state.path || !api.stat_notes) return;
  if (_notesDirty) return;   // unsaved local comments -> don't reload from disk (would discard them)
  let st = null; try { st = await api.stat_notes(state.path); } catch (e) { return; }
  const sig = st ? (st.mtimeMs + ":" + st.size) : "none";
  if (sig === state._notesSig) return;
  const before = countMessages(state.notesModel);
  await loadNotes(true);
  if (countMessages(state.notesModel) > before) flashComments();
}
function pollTick() { checkExternal(); checkNotes(); }
function initSplitter() {
  const sp = $("splitter"); if (!sp) return;
  let drag = null;
  sp.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, w: $("comments").getBoundingClientRect().width }; try { sp.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  sp.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const total = $("content").clientWidth || window.innerWidth;
    const w = Math.min(total * 0.72, Math.max(total * 0.15, drag.w - (e.clientX - drag.x)));
    $("comments").style.flex = "0 0 " + Math.round(w) + "px"; renderCommentHighlights();
  });
  sp.addEventListener("pointerup", () => { if (!drag) return; const total = $("content").clientWidth || window.innerWidth; state.commentsWidth = $("comments").getBoundingClientRect().width / total; persist({ commentsWidth: state.commentsWidth }); drag = null; });
}
function initV09() {
  $("findNext").onclick = findNext; $("findClose").onclick = closeFind;
  $("replOne").onclick = replaceOne; $("replAll").onclick = replaceAll;
  $("findIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findNext(); } });
  $("replIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } });
  $("closeSave").onclick = async () => { hideCloseDlg(); await doSave(); if (!state.dirty && api) api.force_close(); };
  $("closeDont").onclick = () => { hideCloseDlg(); if (api) api.force_close(); };
  $("closeCancel").onclick = hideCloseDlg;
  $("btnComments").onclick = () => toggleComments();
  $("stComments").onclick = () => toggleComments();
  const sw = $("ontopTrans");
  if (sw) sw.addEventListener("click", (e) => { e.stopPropagation(); state.transWhenUnfocused = !state.transWhenUnfocused; sw.classList.toggle("on", state.transWhenUnfocused); persist({ transWhenUnfocused: state.transWhenUnfocused }); if (api && api.set_opacity) api.set_opacity(1); });
  $("cmtAdd").onclick = addDraft;
  $("cmtPrev").onclick = () => navComment(-1);
  $("cmtNext").onclick = () => navComment(1);
  let stt = null; $("cmtSearch").addEventListener("input", () => { clearTimeout(stt); stt = setTimeout(renderComments, 150); });
  $("cmtName").addEventListener("change", () => { state.commentAuthor = ($("cmtName").value || "").trim(); persist({ commentAuthor: state.commentAuthor }); });
  initSplitter(); initWindowDrag();
  if (api && api.onConfirmClose) api.onConfirmClose(showCloseDlg);
}

/* ---------- boot ---------- */
function boot() {
  setupTurndown();
  applyTheme();
  editor.value = "";                 // content decided in startApp (file / instructions / blank)
  setMode("raw");
  updateTitle(); updateCursor(); updateChecks();
  buildRibbon(); setupKeyButtons(); rebuildDispatch();
  initV09();
  reflowBar(); requestAnimationFrame(reflowBar);   // again after fonts/layout settle
  editor.focus();
}
// Electron: window.api is exposed by preload BEFORE any page script runs (async
// IPC, no injection race), and the libs load via plain <script> tags. So just
// build the UI on DOMContentLoaded and pull settings + startup file from the bridge.
let _booted = false;
function startApp() {
  if (_booted) return; _booted = true;
  api = window.sam || null;
  boot();
  blog("ui built");
  if (api && api.onSettingsReset) api.onSettingsReset(() => { loadSettings(); blog("settings reset -> reloaded"); });   // item 8: live refresh, keep doc open
  if (api) {
    (async () => {
      try {
        await getInfo();                                   // populate appInfo.user for the comment-author default
        await loadSettings(); blog("settings loaded");
        const f = await api.get_startup_file();
        if (f && f.content !== undefined && !f.error) { loadDoc(f.path, f.content); noteRecent(f.path); }
        else { editor.value = state.showInstructions ? SAMPLE : ""; rawUndoReset(); setDirty(false); if (state.mode === "rich") render(); updatePristine(); }   // A8: instructions or blank
        updateTitle(); blog("startup complete");
        if (document.hasFocus() && !_pollTimer) _pollTimer = setInterval(pollTick, 1500);   // poll: external file + notes
      } catch (e) { blog("startup error: " + (e && e.message || e)); }
    })();
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startApp);
else startApp();
