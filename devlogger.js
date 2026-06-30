"use strict";
// SAM devlogger - a SEPARATE process. Run it FIRST (`electron . --devlogger`, or
// devlogger.exe). It drops a sentinel file that ARMS SAM's logging, then tails
// SAM's log file live. No socket, no port - purely a local file in userData.
// SAM run without the devlogger (no sentinel) = zero logging, fully clean.
const path = require("path");
const fs = require("fs");

const DEVLOG_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#1b1b1b;color:#d0d0d0;font:12px Consolas,monospace}
#bar{position:sticky;top:0;padding:6px 10px;background:#2b2b2b;border-bottom:1px solid #444;display:flex;gap:12px;align-items:center}
#log{padding:8px 10px;white-space:pre-wrap;word-break:break-word}
.err{color:#ff7b72}.warn{color:#e3b341}.sys{color:#6aa0ff}
button{font:inherit;background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 10px;cursor:pointer}
</style></head><body>
<div id="bar"><b>SAM devlogger</b><span id="cnt">0</span><span id="file" style="opacity:.6"></span><button onclick="document.getElementById('log').innerHTML=''">Clear</button></div>
<div id="log"></div>
<script>
const { ipcRenderer } = require("electron");
const logEl = document.getElementById("log"), cnt = document.getElementById("cnt"); let n = 0;
ipcRenderer.on("file", (e, f) => { document.getElementById("file").textContent = f; });
ipcRenderer.on("line", (e, line) => {
  const d = document.createElement("div");
  if (/ERROR|UNCAUGHT|GONE|UNRESPONSIVE|console\\[2\\]/.test(line)) d.className = "err";
  else if (/WARN|console\\[1\\]/.test(line)) d.className = "warn";
  else if (/^\\[devlogger\\]|=== SAM/.test(line)) d.className = "sys";
  d.textContent = line; logEl.appendChild(d); n++; cnt.textContent = n + " lines";
  window.scrollTo(0, document.body.scrollHeight);
});
</script></body></html>`;

exports.run = function (app) {
  const { BrowserWindow } = require("electron");
  app.whenReady().then(() => {
    const userData = app.getPath("userData");
    const logDir = path.join(userData, "logs");
    try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
    const sentinel = path.join(userData, "devlog.on");
    const logFile = path.join(logDir, "sam.log");
    try { fs.writeFileSync(sentinel, String(Date.now())); } catch (e) {}   // ARM SAM's file logging

    const win = new BrowserWindow({ width: 780, height: 540, title: "SAM devlogger", backgroundColor: "#1b1b1b",
      webPreferences: { nodeIntegration: true, contextIsolation: false } });
    win.setMenu(null);
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(DEVLOG_HTML));
    const emit = (line) => { if (!win.isDestroyed()) win.webContents.send("line", line); };

    // Tail sam.log from its current end (NO socket) - show only new lines from here on.
    let offset = 0;
    try { offset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0; } catch (e) { offset = 0; }
    const timer = setInterval(() => {
      try {
        if (!fs.existsSync(logFile)) return;
        const sz = fs.statSync(logFile).size;
        if (sz < offset) offset = 0;                       // rotated/truncated
        if (sz > offset) {
          const fd = fs.openSync(logFile, "r");
          const buf = Buffer.alloc(sz - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset = sz;
          buf.toString("utf8").split("\n").forEach((l) => { if (l.length) emit(l); });
        }
      } catch (e) {}
    }, 300);

    win.webContents.on("did-finish-load", () => { win.webContents.send("file", logFile); emit("[devlogger] armed (sentinel set); tailing " + logFile); });

    const cleanup = () => { clearInterval(timer); try { fs.unlinkSync(sentinel); } catch (e) {} };  // disarm on exit
    app.on("before-quit", cleanup);
    app.on("window-all-closed", () => { cleanup(); app.quit(); });
  });
};
