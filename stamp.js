// Recording-date detection and VCR-style stamp (ASS subtitle) generation.
// Pure functions: no DOM, no ffmpeg — easy to test.

/** Find a byte pattern in a Uint8Array. */
function indexOf(bytes, pattern, from = 0) {
  const first = pattern[0];
  const last = bytes.length - pattern.length;
  outer: for (let i = from; i <= last; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function validParts(y, mo, d, h, mi, s) {
  return y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 &&
    h <= 23 && mi <= 59 && s <= 59;
}

/**
 * Sony standard-definition .MPG (MPEG-2 PS): the camcorder writes an
 * "ARI_DATA" private-stream pack about every half second. 7 bytes at
 * +160 from the tag hold a bit-packed local date/time:
 * year(12) month(4) day(5) hour(5) minute(6) second(6), low bits = seconds.
 */
function parseSonyARI(bytes) {
  const at = indexOf(bytes, ascii("ARI_DATA"));
  if (at < 0 || at + 167 > bytes.length) return null;
  let v = 0n;
  for (let i = 0; i < 7; i++) v = (v << 8n) | BigInt(bytes[at + 160 + i]);
  const f = (shift, bits) => Number((v >> BigInt(shift)) & ((1n << BigInt(bits)) - 1n));
  const s = f(0, 6), mi = f(6, 6), h = f(12, 5), d = f(17, 5), mo = f(22, 4), y = f(26, 12);
  if (!validParts(y, mo, d, h, mi, s)) return null;
  return { y, mo, d, h, mi, s, source: "camcorder data (MPG)" };
}

/**
 * Sony/Panasonic AVCHD .MTS: H.264 SEI user data with the "MDPM" tag.
 * Entries are 5 bytes: tag + 4 data bytes (BCD).
 * 0x18 = [timezone, year-hi, year-lo, month], 0x19 = [day, hour, min, sec].
 */
function parseMDPM(bytes) {
  const bcd = (b) => (b >> 4) * 10 + (b & 0x0f);
  let at = indexOf(bytes, ascii("MDPM"));
  while (at >= 0) {
    const count = bytes[at + 4];
    let date = null, time = null;
    for (let k = 0; k < count; k++) {
      const p = at + 5 + k * 5;
      if (p + 5 > bytes.length) break;
      if (bytes[p] === 0x18) date = bytes.subarray(p + 1, p + 5);
      if (bytes[p] === 0x19) time = bytes.subarray(p + 1, p + 5);
    }
    if (date && time) {
      const y = bcd(date[1]) * 100 + bcd(date[2]), mo = bcd(date[3]);
      const d = bcd(time[0]), h = bcd(time[1]), mi = bcd(time[2]), s = bcd(time[3]);
      if (validParts(y, mo, d, h, mi, s)) return { y, mo, d, h, mi, s, source: "camcorder data (MTS)" };
    }
    at = indexOf(bytes, ascii("MDPM"), at + 4);
  }
  return null;
}

/** Returns {date: Date (local wall-clock), source} — never null. */
export function detectRecordingDate(headBytes, fallbackMs) {
  const p = parseSonyARI(headBytes) || parseMDPM(headBytes);
  if (p) return { date: new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s), source: p.source };
  return { date: new Date(fallbackMs), source: "file date (check it)" };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function stampText(dt, showSeconds) {
  const h12 = dt.getHours() % 12 || 12;
  const ampm = dt.getHours() < 12 ? "AM" : "PM";
  const mm = String(dt.getMinutes()).padStart(2, "0");
  const ss = String(dt.getSeconds()).padStart(2, "0");
  const time = `${String(h12).padStart(2, " ")}:${mm}${showSeconds ? ":" + ss : ""} ${ampm}`;
  const date = `${MONTHS[dt.getMonth()]}.${String(dt.getDate()).padStart(2, " ")} ${dt.getFullYear()}`;
  // \h = hard space so libass keeps the leading pad; \N = line break
  return `${time}\\N${date}`.replace(/ /g, "\\h");
}

function assTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * Build the ASS subtitle file.
 * opts: { start: Date, duration: seconds, position: "left"|"right",
 *         showSeconds: bool, firstSecondsOnly: number|0 }
 */
export function buildStampASS({ start, duration, position = "left", showSeconds = true, firstSecondsOnly = 0 }) {
  const align = position === "right" ? 3 : 1; // numpad layout: 1 = bottom-left, 3 = bottom-right
  const end = firstSecondsOnly ? Math.min(duration, firstSecondsOnly) : duration;
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 854",
    "PlayResY: 480",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: VCR,VCR OSD Mono,34,&H00F4F4F4,&H00F4F4F4,&H00101010,&H80000000,0,0,0,0,100,100,1,0,1,1.2,2,${align},46,46,30,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  // Seconds are counted from the clip's first frame.
  for (let t = 0; t < end; t++) {
    const dt = new Date(start.getTime() + t * 1000);
    lines.push(`Dialogue: 0,${assTime(t)},${assTime(Math.min(t + 1, end))},VCR,,0,0,0,,{\\blur0.4}${stampText(dt, showSeconds)}`);
  }
  return lines.join("\n") + "\n";
}
