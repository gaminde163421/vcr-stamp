import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { detectRecordingDate, buildStampASS } from "./stamp.js";

const $ = (id) => document.getElementById(id);
const ffmpeg = new FFmpeg();
let engineReady = false;
let busy = false;
let items = []; // { file, start: Date, source, el, ... }
let lastLog = "";

ffmpeg.on("log", ({ message }) => { lastLog = message; });

// ---------- engine ----------
async function loadEngine() {
  const base = new URL("./", location.href);
  try {
    await ffmpeg.load({
      coreURL: new URL("vendor/core/ffmpeg-core.js", base).href,
      wasmURL: new URL("vendor/core/ffmpeg-core.wasm", base).href,
    });
    const font = new Uint8Array(await (await fetch("fonts/VCR_OSD_MONO.woff")).arrayBuffer());
    await ffmpeg.createDir("/fonts");
    await ffmpeg.writeFile("/fonts/VCR_OSD_MONO.woff", font);
    await ffmpeg.createDir("/work");
    await ffmpeg.createDir("/in");
    engineReady = true;
    $("engine").textContent = "Video engine ready.";
  } catch (e) {
    $("engine").innerHTML = `<span class="err">Couldn't load the video engine: ${e.message || e}</span>`;
  }
  refreshButton();
}

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fromLocalInput = (s) => {
  const [date, time = "00:00:00"] = s.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, se = 0] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, se);
};
const mb = (b) => (b / 1048576).toFixed(1) + " MB";
const baseName = (n) => n.replace(/\.[^.]+$/, "");
const fmtTime = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

function refreshButton() {
  const pending = items.some((it) => !it.done);
  $("go").disabled = !engineReady || busy || !pending;
  $("go").textContent = busy ? "Converting…" : engineReady ? "Convert" : "Waiting for video engine…";
}

// ---------- file selection ----------
$("files").addEventListener("change", async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = "";
  for (const file of files) {
    const head = new Uint8Array(await file.slice(0, 4 * 1048576).arrayBuffer());
    const { date, source } = detectRecordingDate(head, file.lastModified);
    const it = { file, start: date, source, done: false };
    it.el = document.createElement("div");
    it.el.className = "file";
    it.el.innerHTML = `
      <div class="name"></div>
      <div class="meta"></div>
      <label class="note">Recording started
        <input type="datetime-local" step="1">
      </label>
      <div class="bar"><i></i></div>
      <div class="status">Ready</div>
      <div class="out"></div>`;
    it.el.querySelector(".name").textContent = file.name;
    it.el.querySelector(".meta").textContent = `${mb(file.size)} · date from ${source}`;
    const inp = it.el.querySelector("input");
    inp.value = toLocalInput(date);
    inp.addEventListener("change", () => { if (inp.value) it.start = fromLocalInput(inp.value); });
    $("list").appendChild(it.el);
    items.push(it);
  }
  $("listCard").hidden = items.length === 0;
  refreshButton();
});

// ---------- conversion ----------
async function getDuration(path) {
  try {
    await ffmpeg.ffprobe(["-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path, "-o", "/work/dur.txt"]);
    const txt = new TextDecoder().decode(await ffmpeg.readFile("/work/dur.txt"));
    const d = parseFloat(txt);
    if (d > 0) return d;
  } catch { /* fall through */ }
  // Fallback: read "Duration: HH:MM:SS.xx" from ffmpeg's log.
  let found = 0;
  const grab = ({ message }) => {
    const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(message);
    if (m) found = +m[1] * 3600 + +m[2] * 60 + +m[3];
  };
  ffmpeg.on("log", grab);
  try { await ffmpeg.exec(["-hide_banner", "-i", path]); } catch {}
  ffmpeg.off("log", grab);
  return found || 3600;
}

async function convert(it) {
  const st = it.el.querySelector(".status");
  const bar = it.el.querySelector(".bar i");
  const opts = {
    position: $("position").value,
    showSeconds: $("seconds").value === "1",
    firstSecondsOnly: Number($("span").value),
  };
  const quality = $("quality").value === "better" ? ["-preset", "veryfast", "-crf", "20"] : ["-preset", "superfast", "-crf", "22"];
  const inPath = `/in/${it.file.name}`;
  const outPath = `/work/out.mp4`;

  st.textContent = "Reading clip…";
  await ffmpeg.mount("WORKERFS", { files: [it.file] }, "/in");
  try {
    const duration = await getDuration(inPath);
    const ass = buildStampASS({ start: it.start, duration, ...opts });
    await ffmpeg.writeFile("/work/stamp.ass", ass);

    const onProgress = ({ time }) => {
      const sec = time / 1e6;
      const pct = Math.max(0, Math.min(100, (sec / duration) * 100));
      bar.style.width = pct.toFixed(1) + "%";
      st.textContent = `Converting… ${fmtTime(sec)} / ${fmtTime(duration)}`;
    };
    ffmpeg.on("progress", onProgress);
    const vf = [
      "yadif=deint=interlaced",
      "scale=trunc(ih*dar/2)*2:ih",   // camcorder pixels aren't square: fix aspect
      "setsar=1",
      "scale=-2:min(ih\\,720)",        // cap at 720p so phones stay quick
      "setpts=PTS-STARTPTS",
      "subtitles=/work/stamp.ass:fontsdir=/fonts",
    ].join(",");
    const code = await ffmpeg.exec([
      "-hide_banner", "-i", inPath,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", vf,
      "-af", "aresample=async=1,asetpts=PTS-STARTPTS",
      "-c:v", "libx264", ...quality, "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ac", "2", "-b:a", "160k",
      "-movflags", "+faststart", "-y", outPath,
    ]);
    ffmpeg.off("progress", onProgress);
    if (code !== 0) throw new Error(lastLog || `ffmpeg exited with code ${code}`);

    const data = await ffmpeg.readFile(outPath);
    await ffmpeg.deleteFile(outPath);
    const name = baseName(it.file.name) + ".mp4";
    const outFile = new File([data.buffer], name, { type: "video/mp4" });
    const url = URL.createObjectURL(outFile);
    bar.style.width = "100%";
    st.textContent = `Done · ${mb(outFile.size)}`;
    showResult(it, outFile, url);
    it.done = true;
  } finally {
    await ffmpeg.unmount("/in").catch(() => {});
  }
}

function showResult(it, file, url) {
  const out = it.el.querySelector(".out");
  out.innerHTML = `<video controls playsinline preload="metadata"></video><div class="actions"></div>`;
  out.querySelector("video").src = url;
  const actions = out.querySelector(".actions");

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    const share = document.createElement("button");
    share.className = "secondary";
    share.textContent = "Save to Photos / Share";
    share.addEventListener("click", async () => {
      try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
    });
    actions.appendChild(share);
  }
  const a = document.createElement("a");
  a.className = "btn";
  a.href = url;
  a.download = file.name;
  a.textContent = "Download MP4";
  actions.appendChild(a);
}

$("go").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  refreshButton();
  for (const it of items) {
    if (it.done) continue;
    try {
      await convert(it);
    } catch (e) {
      it.el.querySelector(".status").innerHTML = `<span class="err">Failed: ${String(e.message || e).slice(0, 300)}</span>`;
    }
  }
  busy = false;
  refreshButton();
});

refreshButton();
loadEngine();
