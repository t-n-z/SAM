"use strict";
// SAM - Simple As Markdown. Electron main process (replaces the pywebview app.py).
// Async IPC bridge => no synchronous evaluate_js injection => no startup deadlock.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const APP_NAME = "SAM";
const GITHUB_URL = "https://github.com/t-n-z/SAM";
const COFFEE_URL = "";              // TBD

// ---- devlogger mode: `--devlogger` flag OR an exe named devlogger*.exe runs the
//      file-tailing logger instead of the app (so a renamed copy of the exe = logger) ----
// portable build extracts to a temp SAM.exe, but sets PORTABLE_EXECUTABLE_FILE to
// the launched exe's real path -> check that so a devlogger.exe copy works both ways.
const _exeName = path.basename(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath).toLowerCase();
const runAsLogger = process.argv.includes("--devlogger") || _exeName.startsWith("devlogger");
if (runAsLogger) {
  require("./devlogger").run(app);
} else {
  runApp();
}

// ---------- diagnostic logging: FILE-based, NO socket/port (local file only) ----------
// SAM logs ONLY when "armed" by a sentinel file the devlogger drops. No network
// surface whatsoever. devlogger tails the file live.
function sentinelPath() { return path.join(app.getPath("userData"), "devlog.on"); }
function logFilePath() { return path.join(app.getPath("userData"), "logs", "sam.log"); }
let logStream = null;
function setupLogging() {
  try {
    if (!fs.existsSync(sentinelPath())) return;   // not armed -> zero logging, no disk writes
    fs.mkdirSync(path.dirname(logFilePath()), { recursive: true });
    const f = logFilePath();
    try { if (fs.existsSync(f) && fs.statSync(f).size > 2_000_000) fs.renameSync(f, f + ".1"); } catch (e) {}
    logStream = fs.createWriteStream(f, { flags: "a" });
    log("=== SAM v" + app.getVersion() + " start pid=" + process.pid + " ===");
  } catch (e) { logStream = null; }
}
function log(msg) {
  if (logStream) { try { logStream.write(new Date().toISOString() + " " + msg + "\n"); } catch (e) {} }
}

// ---------- settings (userData/settings.json) ----------
function settingsPath() { return path.join(app.getPath("userData"), "settings.json"); }
const KEY_ACTIONS = new Set([
  "file.new","file.open","file.save","file.saveas","file.close","file.exit",
  "edit.undo","edit.redo","edit.cut","edit.copy","edit.paste","edit.selectall","edit.copypath","edit.copydir","edit.explorer","edit.find","edit.replace",
  "view.markdown","view.ontop","view.highvis","view.bg","view.status","view.wrap","view.instructions","view.comments",
  "fmt.bold","fmt.italic","fmt.strike","fmt.headingup","fmt.headingdown","fmt.code","fmt.codeblock",
  "fmt.quote","fmt.ul","fmt.ol","fmt.task","fmt.link","fmt.image","fmt.table","fmt.hr",
]);
const HEX = /^#[0-9a-fA-F]{6}$/, FKEY = /^F([1-9]|1[0-2])$/, MODS = new Set(["Ctrl","Alt","Shift"]);
function validCombo(c) {
  if (c === "") return true;
  if (typeof c !== "string") return false;
  const parts = c.split("+"); if (parts.length < 1 || parts.length > 3) return false;
  const main = parts.filter((p) => !MODS.has(p)); if (main.length !== 1) return false;
  if (parts.length === 1) return FKEY.test(main[0]);
  return true;
}
function validateSettings(d) {
  const out = {}; let changed = false;
  if (typeof d.bg === "string" && HEX.test(d.bg)) out.bg = d.bg; else if ("bg" in d) changed = true;
  for (const k of ["highvis", "statusbar", "wordwrap", "askedDefault", "showInstructions", "matchCase", "wrapAround", "commentsOpen", "showResolved", "transWhenUnfocused"]) { if (typeof d[k] === "boolean") out[k] = d[k]; else if (k in d) changed = true; }
  if (Array.isArray(d.recents)) { const c = d.recents.filter((x) => typeof x === "string").slice(0, 12); out.recents = c; if (c.length !== d.recents.length) changed = true; } else if ("recents" in d) changed = true;
  if (Array.isArray(d.dontAskReload)) { const c = d.dontAskReload.filter((x) => typeof x === "string").slice(0, 1000); out.dontAskReload = c; if (c.length !== d.dontAskReload.length) changed = true; } else if ("dontAskReload" in d) changed = true;
  if (typeof d.commentAuthor === "string") out.commentAuthor = d.commentAuthor.slice(0, 80); else if ("commentAuthor" in d) changed = true;
  if (typeof d.commentsWidth === "number" && isFinite(d.commentsWidth)) out.commentsWidth = Math.min(0.85, Math.max(0.15, d.commentsWidth)); else if ("commentsWidth" in d) changed = true;
  if (typeof d.fontScale === "number" && isFinite(d.fontScale)) out.fontScale = Math.min(3, Math.max(0.6, d.fontScale)); else if ("fontScale" in d) changed = true;
  if (d.viewModes && typeof d.viewModes === "object" && !Array.isArray(d.viewModes)) { const vm = {}; let n = 0; for (const [k, v] of Object.entries(d.viewModes)) { if (n < 200 && typeof k === "string" && (v === "raw" || v === "rich")) { vm[k] = v; n++; } else changed = true; } out.viewModes = vm; } else if ("viewModes" in d) changed = true;
  if (d.keybinds && typeof d.keybinds === "object" && !Array.isArray(d.keybinds)) { const ck = {}; for (const [a, c] of Object.entries(d.keybinds)) { if (KEY_ACTIONS.has(a) && validCombo(c)) ck[a] = c; else changed = true; } out.keybinds = ck; } else if ("keybinds" in d) changed = true;
  for (const k of Object.keys(d)) if (!["bg","highvis","statusbar","wordwrap","askedDefault","showInstructions","matchCase","wrapAround","commentsOpen","showResolved","transWhenUnfocused","commentAuthor","commentsWidth","fontScale","viewModes","recents","dontAskReload","keybinds"].includes(k)) changed = true;
  return { cleaned: out, changed };
}
function prepareSettings() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return;
  let raw; try { raw = fs.readFileSync(p, "utf8"); } catch (e) { return; }
  let data = null; try { data = JSON.parse(raw); } catch (e) { data = null; }
  const backup = () => { try { const d = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15); fs.writeFileSync(p + "." + d + ".bak", raw); } catch (e) {} };
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    const r = dialog.showMessageBoxSync({ type: "error", buttons: ["Reset to defaults", "Exit & open folder"], defaultId: 0, cancelId: 1, title: APP_NAME + " - settings problem",
      message: "Your settings file is corrupt and could not be read.", detail: "Reset keeps a backup of the old file. Exit opens the folder so you can fix it yourself." });
    if (r === 0) { backup(); try { fs.writeFileSync(p, "{}"); } catch (e) {} }
    else { shell.openPath(path.dirname(p)); app.exit(0); }
    return;
  }
  const { cleaned, changed } = validateSettings(data);
  if (changed) { backup(); try { fs.writeFileSync(p, JSON.stringify(cleaned, null, 2)); } catch (e) {} }
}
function loadSettings() { try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")) || {}; } catch (e) { return {}; } }
function saveSettings(patch) { const s = loadSettings(); if (patch && typeof patch === "object") Object.assign(s, patch); try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (e) {} return s; }
function addRecent(p) { const s = loadSettings(); let r = s.recents || []; const full = path.resolve(p); r = r.filter((x) => x.toLowerCase() !== full.toLowerCase()); r.unshift(full); s.recents = r.slice(0, 12); try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (e) {} return s.recents; }

// ---------- default-app association (item 13: best-effort, OSes block silent default) ----------
function setAsDefault() {
  try {
    if (process.platform === "win32") shell.openExternal("ms-settings:defaultapps");
    else if (process.platform === "linux") require("child_process").exec("xdg-mime default SAM.desktop text/markdown", () => {});
    else if (process.platform === "darwin") shell.openExternal("x-apple.systempreferences:com.apple.preference");
  } catch (e) {}
}
let _askedThisRun = false;
function maybeAskDefault(win, force) {
  const s = loadSettings();
  if ((s.askedDefault && !force) || (_askedThisRun && !force)) return;
  _askedThisRun = true;
  const r = dialog.showMessageBoxSync(win || null, {
    type: "question", buttons: ["Yes, set default", "Not now"], defaultId: 0, cancelId: 1,
    title: APP_NAME, message: "Make " + APP_NAME + " your default .md viewer?",
    detail: "On Yes, " + APP_NAME + " opens your OS default-apps settings so you can confirm. You can change this anytime.",
  });
  saveSettings({ askedDefault: true });
  if (r === 0) setAsDefault();
}

// ---------- files ----------
function readFileSafe(p) { try { return { path: p, content: fs.readFileSync(p, "utf8") }; } catch (e) { return { path: p, error: String(e.message || e) }; } }
function startupFileFromArgv(argv) {
  for (let i = argv.length - 1; i >= 1; i--) { const a = argv[i]; if (a && !a.startsWith("-") && fs.existsSync(a) && fs.statSync(a).isFile()) return path.resolve(a); }
  return null;
}
const OPEN_FILTERS = [{ name: "Markdown / text", extensions: ["md", "markdown", "mdown", "txt"] }, { name: "All files", extensions: ["*"] }];
const SAVE_FILTERS = [{ name: "Markdown", extensions: ["md"] }, { name: "All files", extensions: ["*"] }];

// ---------- windows ----------
function winOf(e) { return BrowserWindow.fromWebContents(e.sender); }
// Write-IPC containment: the renderer may only WRITE to paths the user actually reached this session
// (open/save dialog, startup arg, or a file it opened/dropped). Collapses the "save anywhere" primitive a
// DOMPurify bypass could abuse for persistence. `.notes`/`.bak`/`.tmp` siblings map back to their base file.
const approvedPaths = new Set();
function approvePath(p) { try { if (p) approvedPaths.add(path.resolve(String(p)).toLowerCase()); } catch (e) {} }
function pathAllowed(p) {
  try {
    let r = path.resolve(String(p)).toLowerCase();
    for (let i = 0; i < 3; i++) { if (approvedPaths.has(r)) return true; const s = r.replace(/\.(notes|bak|tmp)$/i, ""); if (s === r) break; r = s; }
    return false;
  } catch (e) { return false; }
}
// Themed-dialog bridge: ask the renderer to show its in-app modal and await the choice. All file logic
// (reload / reset / delete-notes) stays here in main; only the dialog UI moves to the renderer so it
// matches the dark theme. spec: {title, message, detail, buttons:[{label,primary,danger}], checkbox, defaultId, cancelId}.
let _askSeq = 0; const _askPending = {};
function askThemed(win, spec) {
  const fallback = { response: (spec && spec.cancelId != null) ? spec.cancelId : -1, checkboxChecked: false };
  if (!win || win.isDestroyed() || !win.webContents) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const id = ++_askSeq; _askPending[id] = resolve;
    try { win.webContents.send("ask-dialog", id, spec); } catch (e) { delete _askPending[id]; resolve(fallback); }
  });
}
ipcMain.on("ask-dialog-reply", (e, id, result) => { const r = _askPending[id]; if (r) { delete _askPending[id]; r(result || {}); } });
function createWindow(startupFile) {
  const win = new BrowserWindow({
    width: 1000, height: 725, minWidth: 225, minHeight: 240,
    frame: false, backgroundColor: "#1e1e1e", show: false, title: APP_NAME,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win._startupFile = startupFile || null; win._dirty = false; win._pristine = false; win._forceClose = false;
  if (startupFile) approvePath(startupFile);
  win.loadFile(path.join(__dirname, "web", "ui.html"));
  win.once("ready-to-show", () => { win.show(); win.focus(); win.moveTop(); });   // focus(): a frameless window opened via file-assoc/2nd-instance can render WITHOUT keyboard focus on Windows
  win.on("close", (ev) => {
    if (win._dirty && !win._forceClose) { ev.preventDefault(); try { win.webContents.send("confirm-close"); } catch (e) {} }   // A3: renderer shows themed Save / Don't Save / Cancel
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());                 // A1: a dropped file must not navigate the window
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("console-message", (e, level, message, line, sourceId) => { log("console[" + level + "] " + message + " @" + (sourceId || "").split("/").pop() + ":" + line); });
  win.webContents.on("render-process-gone", (e, d) => log("RENDER-GONE " + JSON.stringify(d)));
  win.on("unresponsive", () => log("WINDOW UNRESPONSIVE"));
  if (startupFile) {   // A11: a real file replaces any leftover pristine intro/blank window
    for (const other of BrowserWindow.getAllWindows()) {
      if (other !== win && other._pristine) { try { other._forceClose = true; other.close(); } catch (e) {} }
    }
  }
  log("window opened startup=" + (startupFile || "none") + " -> windows=" + BrowserWindow.getAllWindows().length);
  return win;
}

function runApp() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on("second-instance", (e, argv) => { createWindow(startupFileFromArgv(argv)); });

  process.on("uncaughtException", (err) => log("UNCAUGHT " + (err && err.stack || err)));

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);          // we use the in-page menu bar
    setupLogging();
    prepareSettings();
    wireIpc();
    // Content-Security-Policy as a response header (not <meta> — survives injected content + covers the
    // file:// load). The only second layer behind DOMPurify: no inline scripts/eval, no network exfil,
    // no plugins. img https: kept so markdown image URLs still render.
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: Object.assign({}, details.responseHeaders, {
        "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"],
      }) });
    });
    const w0 = createWindow(startupFileFromArgv(process.argv));
    w0.once("show", () => maybeAskDefault(w0, false));
  });
  app.on("window-all-closed", () => app.quit());
}

function wireIpc() {
  ipcMain.handle("get_startup_file", (e) => { const w = winOf(e); return (w && w._startupFile && fs.existsSync(w._startupFile)) ? readFileSafe(w._startupFile) : null; });
  ipcMain.handle("open_dialog", async (e) => {
    const w = winOf(e); const r = await dialog.showOpenDialog(w, { properties: ["openFile"], filters: OPEN_FILTERS });
    if (r.canceled || !r.filePaths.length) return null; approvePath(r.filePaths[0]); return readFileSafe(r.filePaths[0]);
  });
  ipcMain.handle("read_path", (e, p) => { if (p && fs.existsSync(p)) { approvePath(p); return readFileSafe(p); } return { path: p, error: "File not found" }; });
  ipcMain.handle("save", (e, p, content) => { if (!pathAllowed(p)) return { error: "Refused: path not opened/saved via a dialog this session." }; try { const tmp = p + ".tmp"; fs.writeFileSync(tmp, content); fs.renameSync(tmp, p); return { path: p }; } catch (err) { return { error: String(err.message || err) }; } });
  ipcMain.handle("save_dialog", async (e, content, suggested) => {
    const w = winOf(e); const r = await dialog.showSaveDialog(w, { defaultPath: suggested || "untitled.md", filters: SAVE_FILTERS });
    if (r.canceled || !r.filePath) return null; approvePath(r.filePath); try { const tmp = r.filePath + ".tmp"; fs.writeFileSync(tmp, content); fs.renameSync(tmp, r.filePath); return { path: r.filePath }; } catch (err) { return { error: String(err.message || err) }; }
  });
  ipcMain.handle("set_title", (e, t) => { const w = winOf(e); if (w) w.setTitle(t); return true; });
  ipcMain.handle("set_dirty", (e, d) => { const w = winOf(e); if (w) w._dirty = !!d; return true; });
  ipcMain.handle("set_on_top", (e, on) => { const w = winOf(e); if (w) w.setAlwaysOnTop(!!on); return true; });
  ipcMain.handle("new_window", (e, p) => { createWindow(p ? path.resolve(p) : null); return true; });
  ipcMain.handle("close_window", (e) => { const w = winOf(e); if (w) w.close(); return true; });
  ipcMain.handle("exit_app", () => { app.quit(); return true; });
  ipcMain.handle("minimize", (e) => { const w = winOf(e); if (w) w.minimize(); return true; });
  ipcMain.handle("toggle_maximize", (e) => { const w = winOf(e); if (w) { w.isMaximized() ? w.unmaximize() : w.maximize(); } return true; });
  ipcMain.handle("load_settings", () => loadSettings());
  ipcMain.handle("save_settings", (e, patch) => saveSettings(patch));
  ipcMain.handle("add_recent", (e, p) => addRecent(p));
  ipcMain.handle("clear_recents", () => saveSettings({ recents: [] }));
  ipcMain.handle("app_info", () => ({ title: APP_NAME, version: app.getVersion(), github: GITHUB_URL, coffee: COFFEE_URL, user: "" }));   // do NOT leak the OS login name into the shareable .md.notes; author defaults to "Me"
  ipcMain.handle("open_external", (e, url) => { if (typeof url === "string" && /^https?:\/\//.test(url)) { shell.openExternal(url); return true; } return false; });
  ipcMain.handle("restore", (e) => { const w = winOf(e); if (w) { if (w.isMinimized()) w.restore(); else if (w.isMaximized()) w.unmaximize(); } return true; });
  ipcMain.handle("open_in_explorer", (e, p) => { try { if (p && fs.existsSync(p)) { shell.showItemInFolder(path.resolve(p)); return true; } } catch (err) {} return false; });
  ipcMain.handle("set_default", () => { saveSettings({ askedDefault: true }); setAsDefault(); return true; });
  ipcMain.handle("reset_settings", async (e) => {
    const w = winOf(e);
    const r = await askThemed(w, { title: "Reset settings?", message: "Reset all settings to defaults?",
      detail: "Background, high-visibility, status bar, word wrap, key bindings, recent files and per-file reload choices are cleared. Open documents stay open.",
      buttons: [{ label: "Reset", danger: true }, { label: "Cancel", primary: true }], defaultId: 1, cancelId: 1 });
    if (r.response !== 0) return false;
    try { fs.writeFileSync(settingsPath(), "{}"); } catch (err) {}
    for (const win of BrowserWindow.getAllWindows()) { try { win.webContents.send("settings-reset"); } catch (err) {} }
    maybeAskDefault(w, true);
    return true;
  });
  ipcMain.handle("stat_path", (e, p) => { try { const st = fs.statSync(p); return { mtimeMs: st.mtimeMs, size: st.size }; } catch (err) { return null; } });
  ipcMain.handle("confirm_reload", async (e, name, dirty) => {
    const w = winOf(e);
    const r = await askThemed(w, {
      title: (name || "This file") + " changed on disk",
      message: (name || "This file") + " has been modified outside " + APP_NAME + ".",
      detail: dirty ? "Reload will discard your unsaved changes in this window." : "Reload to load the new version from disk.",
      buttons: [{ label: "Reload", primary: true }, { label: "Keep mine" }],
      checkbox: "Don't ask again for this file", defaultId: 0, cancelId: 1 });
    return { response: r.response, checkbox: r.checkboxChecked };
  });
  ipcMain.handle("add_dont_ask_reload", (e, p) => {
    const s = loadSettings(); let arr = Array.isArray(s.dontAskReload) ? s.dontAskReload : [];
    const full = path.resolve(p);
    if (!arr.some((x) => String(x).toLowerCase() === full.toLowerCase())) arr.unshift(full);
    s.dontAskReload = arr.slice(0, 1000);
    try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (err) {}
    return s.dontAskReload;
  });
  ipcMain.handle("read_binary", (e, p) => { try { const b = fs.readFileSync(p); return { path: p, b64: b.toString("base64") }; } catch (err) { return { path: p, error: String(err.message || err) }; } });
  ipcMain.handle("flash_frame", (e, on) => { const w = winOf(e); if (w) w.flashFrame(!!on); return true; });
  ipcMain.handle("read_notes", (e, p) => { const np = p + ".notes"; try { if (!fs.existsSync(np)) return { missing: true }; return { text: fs.readFileSync(np, "utf8") }; } catch (err) { return { error: String(err.message || err) }; } });
  ipcMain.handle("write_notes", (e, p, text) => { if (!pathAllowed(p)) return { error: "Refused: notes path not approved this session." }; const np = p + ".notes"; try { if (fs.existsSync(np)) { try { fs.copyFileSync(np, np + ".bak"); } catch (_) {} } const tmp = np + ".tmp"; fs.writeFileSync(tmp, text); fs.renameSync(tmp, np); return { ok: true, path: np }; } catch (err) { return { error: String(err.message || err) }; } });
  ipcMain.handle("stat_notes", (e, p) => { try { const st = fs.statSync(p + ".notes"); return { mtimeMs: st.mtimeMs, size: st.size }; } catch (err) { return null; } });
  ipcMain.handle("handle_saved_notes", async (e, p, prevPath) => {   // saving over a file that already has a .notes from a previous version
    try {
      const np = p + ".notes";
      if (!fs.existsSync(np)) return { none: true };
      if (prevPath && path.resolve(prevPath) === path.resolve(p)) return { same: true };   // it's this doc's own notes — leave it
      const w = winOf(e);
      const r = await askThemed(w, { title: "Existing comments found", message: path.basename(np) + " already exists.",
        detail: "It holds comments for the file you just saved over. Keep them (they may not line up with the new content), or delete them?",
        buttons: [{ label: "Keep comments", primary: true }, { label: "Delete comments", danger: true }], defaultId: 0, cancelId: 0 });
      if (r.response === 1) { try { fs.copyFileSync(np, np + ".bak"); } catch (_) {} try { fs.unlinkSync(np); } catch (_) {} return { deleted: true }; }
      return { kept: true };
    } catch (err) { return { error: String(err.message || err) }; }
  });
  ipcMain.handle("get_bounds", (e) => { const w = winOf(e); return w ? w.getBounds() : null; });
  ipcMain.handle("set_position", (e, x, y) => { const w = winOf(e); if (w && !w.isMaximized()) w.setPosition(Math.round(x), Math.round(y)); return true; });
  ipcMain.handle("set_min_size", (e, mw, mh) => { const w = winOf(e); if (w) { mw = Math.round(mw); mh = Math.round(mh); w.setMinimumSize(mw, mh); const b = w.getBounds(); if (!w.isMaximized() && b.width < mw) w.setBounds({ x: b.x, y: b.y, width: mw, height: b.height }); } return true; });
  ipcMain.handle("set_opacity", (e, v) => { const w = winOf(e); if (w) w.setOpacity(Math.max(0.2, Math.min(1, Number(v) || 1))); return true; });
  ipcMain.handle("force_close", (e) => { const w = winOf(e); if (w) { w._forceClose = true; w.close(); } return true; });
  ipcMain.handle("set_pristine", (e, v) => { const w = winOf(e); if (w) w._pristine = !!v; return true; });
  // rebind the text-input client to the current DOM activeElement: programmatic focus from the contenteditable
  // editor to a comment textarea leaves Chromium routing keystrokes to the editor (caret shows but can't type)
  // until a widget-level focus change. webContents.focus() forces that rebind without an OS blur/refocus flicker.
  ipcMain.handle("kick_focus", (e) => { const w = winOf(e); if (w) { try { w.webContents.focus(); } catch (_) {} } return true; });
  ipcMain.on("jslog", (e, level, msg) => log("JS[" + level + "] " + String(msg).slice(0, 800)));
}
