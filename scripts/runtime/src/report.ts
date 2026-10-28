import {
  beatsPerBar,
  pitchName,
  type CompiledScore,
  type Score,
} from "./model.js";
import { chordAt, chordWindows } from "./harmony.js";
import { preset } from "./instruments.js";
import { diagnoseScore } from "./diagnostics.js";
import { analyzeChannels } from "./analysis.js";
import { decodeWav } from "./wav.js";

const escape = (s: unknown) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Stable per-track colour, derived from the track ID. */
export function trackColour(trackId: string, index: number): string {
  let h = 0;
  for (const c of trackId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = (h + index * 47) % 360;
  return `hsl(${hue} 65% 62%)`;
}

export type RollOptions = {
  /** Pixels per beat. */
  pixelsPerBeat?: number;
  /** Row height in pixels. */
  rowHeight?: number;
  /** Only render this beat range. */
  fromBeat?: number;
  toBeat?: number;
  height?: number;
};

/**
 * Piano-roll SVG of the compiled events. Rendered as SVG text so it can be
 * embedded in a report, opened directly in a browser, or inspected by a model
 * that reads markup. Drum tracks get one row per piece instead of pitch rows.
 */
export function renderPianoRoll(
  compiled: CompiledScore,
  options: RollOptions = {},
): string {
  const s = compiled.score;
  const ppb = options.pixelsPerBeat ?? 48;
  const rowHeight = options.rowHeight ?? 9;
  const from = options.fromBeat ?? 0;
  const to = options.toBeat ?? s.lengthBeats;
  const barBeats = beatsPerBar(s.meter);
  const span = Math.max(0.0001, to - from);
  const width = Math.max(320, Math.round(span * ppb) + 96);
  const events = compiled.events.filter(
    (e) =>
      e.velocity > 0 &&
      e.tick / compiled.ppq >= from &&
      e.tick / compiled.ppq < to,
  );

  const tonal = events.filter((e) => e.kind === "note" && e.midi !== undefined);
  const drumTracks = s.tracks.filter(
    (t) => preset(t.instrument, s).engine === "drums",
  );
  const drumSounds = [
    "crash",
    "openhat",
    "hat",
    "rim",
    "clap",
    "tom",
    "snare",
    "kick",
  ] as const;

  const minMidi = tonal.length ? Math.min(...tonal.map((e) => e.midi!)) : 48;
  const maxMidi = tonal.length ? Math.max(...tonal.map((e) => e.midi!)) : 72;
  const pitchRows = Math.max(1, maxMidi - minMidi + 1);
  const drumRows = drumTracks.length ? drumSounds.length : 0;
  const rows = pitchRows + drumRows + (drumRows ? 2 : 0);
  const height = options.height ?? Math.max(140, rows * rowHeight + 56);
  const top = 34;

  const x = (beat: number) => 80 + ((beat - from) / span) * (width - 96);
  const yPitch = (m: number) => top + (maxMidi - m) * rowHeight;
  const drumOffset = top + pitchRows * rowHeight + (drumRows ? 10 : 0);
  const yDrum = (sound: string) =>
    drumOffset +
    drumSounds.indexOf(sound as (typeof drumSounds)[number]) * rowHeight;

  const trackIndex = new Map(s.tracks.map((t, i) => [t.id, i]));
  const parts: string[] = [];

  // Row shading: black keys darker, like a conventional roll.
  for (let m = minMidi; m <= maxMidi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const black = [1, 3, 6, 8, 10].includes(pc);
    if (!black) continue;
    parts.push(
      `<rect x="72" y="${yPitch(m)}" width="${width - 80}" height="${rowHeight}" fill="#ffffff08"/>`,
    );
    void pc;
  }
  // Pitch labels on C and A rows only, to stay legible.
  for (let m = minMidi; m <= maxMidi; m++) {
    if (m % 12 !== 0) continue;
    parts.push(
      `<text x="66" y="${yPitch(m) + rowHeight - 1}" text-anchor="end" class="lbl">${escape(pitchName(m))}</text>`,
    );
  }

  // Bar lines and bar numbers.
  for (
    let beat = Math.ceil(from / barBeats) * barBeats;
    beat <= to;
    beat += barBeats
  ) {
    const px = x(beat);
    parts.push(
      `<line x1="${px}" y1="${top}" x2="${px}" y2="${height - 20}" stroke="#ffffff22" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${px + 3}" y="${top - 8}" class="bar">${Math.floor(beat / barBeats) + 1}</text>`,
    );
  }

  // Section bands.
  for (const section of s.sections) {
    const sx = x(Math.max(section.at, from));
    const sw = x(Math.min(section.at + section.lengthBeats, to)) - sx;
    if (sw <= 0) continue;
    parts.push(
      `<rect x="${sx}" y="${top - 20}" width="${sw}" height="12" fill="#8ef0cb22" rx="2"/>`,
      `<text x="${sx + 4}" y="${top - 10}" class="sec">${escape(section.label ?? section.id)}</text>`,
    );
  }

  // Harmony labels.
  const windows = chordWindows(s);
  for (const w of windows) {
    if (w.until <= from || w.at >= to) continue;
    const hx = x(Math.max(w.at, from));
    parts.push(
      `<text x="${hx + 2}" y="${top - 24}" class="chord">${escape(w.symbol)}</text>`,
    );
  }

  // Notes.
  for (const e of events) {
    const idx = trackIndex.get(e.trackId) ?? 0;
    const colour = trackColour(e.trackId, idx);
    const startBeat = e.tick / compiled.ppq;
    const endBeat = Math.max(e.keyEndTick, e.tick) / compiled.ppq;
    const w = Math.max(1.5, x(endBeat) - x(startBeat) - 0.5);
    const opacity = 0.35 + e.velocity * 0.6;
    if (e.kind === "note" && e.midi !== undefined)
      parts.push(
        `<rect x="${x(startBeat)}" y="${yPitch(e.midi)}" width="${w}" height="${rowHeight - 1.5}" rx="1.5" fill="${colour}" fill-opacity="${opacity.toFixed(2)}"><title>${escape(e.trackId)} ${escape(pitchName(e.midi))} @${startBeat.toFixed(2)}</title></rect>`,
      );
    else if (e.kind === "hit")
      parts.push(
        `<rect x="${x(startBeat)}" y="${yDrum(e.sound!)}" width="${Math.max(2, w)}" height="${rowHeight - 1.5}" rx="1.5" fill="${colour}" fill-opacity="${opacity.toFixed(2)}"><title>${escape(e.trackId)} ${escape(e.sound)} @${startBeat.toFixed(2)}</title></rect>`,
      );
  }

  // Drum row labels.
  if (drumRows)
    for (const sound of drumSounds)
      parts.push(
        `<text x="66" y="${yDrum(sound) + rowHeight - 1}" text-anchor="end" class="lbl">${escape(sound)}</text>`,
      );

  // Legend.
  const legend = s.tracks
    .map(
      (t, i) =>
        `<g><rect x="${88 + i * 104}" y="${height - 14}" width="9" height="9" rx="2" fill="${trackColour(t.id, i)}"/><text x="${100 + i * 104}" y="${height - 6}" class="lbl">${escape(t.id)}</text></g>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">
<style>.lbl{fill:#93a4bd;font-size:9px}.bar{fill:#7d8ea6;font-size:9px}.sec{fill:#8ef0cb;font-size:9px;font-weight:600}.chord{fill:#ffd479;font-size:10px;font-weight:600}</style>
<rect width="${width}" height="${height}" fill="#111725"/>
<rect x="72" y="${top}" width="${width - 80}" height="${rows * rowHeight}" fill="#0d1320"/>
${parts.join("\n")}
${legend}
</svg>`;
}

/**
 * Compact textual description of the music, intended as model-readable context.
 * Adds up what the numbers cannot: register motion, density, where the peak is,
 * and how each section differs from its predecessor.
 */
export function describeScore(compiled: CompiledScore): string {
  const s = compiled.score;
  const barBeats = beatsPerBar(s.meter);
  const ppq = compiled.ppq;
  const lines: string[] = [];
  const bars = Math.round(s.lengthBeats / barBeats);

  lines.push(
    `# ${s.title}`,
    `${s.profile}, ${s.authenticity} voice, ${s.tempo} BPM, ${s.meter[0]}/${s.meter[1]}, ${bars} bars (${s.lengthBeats} beats), ` +
      `${s.export.mode} export${s.key ? `, key ${s.key.tonic} ${s.key.mode}` : ", no declared key"}`,
  );

  const windows = chordWindows(s);
  if (windows.length) {
    const progression = windows.map((w) => `${w.symbol}@${w.at}`).join(" → ");
    lines.push(`Harmony: ${progression}`);
  }

  for (const t of s.tracks) {
    const evs = compiled.events.filter(
      (e) => e.trackId === t.id && e.velocity > 0,
    );
    if (!evs.length) {
      lines.push(`- ${t.id} (${t.instrument}): silent`);
      continue;
    }
    const p = preset(t.instrument, s);
    if (p.engine === "drums") {
      const counts: Record<string, number> = {};
      for (const e of evs) counts[e.sound!] = (counts[e.sound!] ?? 0) + 1;
      const perBar = (evs.length / s.lengthBeats) * barBeats;
      lines.push(
        `- ${t.id} (drums): ${evs.length} hits, ${perBar.toFixed(1)}/bar — ` +
          Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k}×${v}`)
            .join(", "),
      );
      continue;
    }
    const notes = evs.filter((e) => e.midi !== undefined);
    const midis = notes.map((e) => e.midi!);
    const lo = Math.min(...midis),
      hi = Math.max(...midis);
    const peak = notes.reduce((a, b) => (b.midi! > a.midi! ? b : a), notes[0]!);
    const density = (notes.length / s.lengthBeats) * barBeats;
    const stepwise = notes
      .slice(1)
      .filter((e, i) => Math.abs(e.midi! - notes[i]!.midi!) <= 2).length;
    lines.push(
      `- ${t.id} (${t.instrument}, ${t.role}): ${notes.length} notes, ${density.toFixed(1)}/bar, ` +
        `range ${pitchName(lo)}–${pitchName(hi)}, peak ${pitchName(peak.midi!)} at beat ${(peak.tick / ppq).toFixed(2)}, ` +
        `${Math.round((stepwise / Math.max(1, notes.length - 1)) * 100)}% stepwise motion`,
    );
  }

  // Section-by-section change summary.
  if (s.sections.length) {
    lines.push("Sections:");
    const stats = s.sections
      .map((section) => {
        const evs = compiled.events.filter(
          (e) =>
            e.velocity > 0 &&
            e.tick / ppq >= section.at &&
            e.tick / ppq < section.at + section.lengthBeats,
        );
        const notes = evs.filter((e) => e.midi !== undefined);
        const midis = notes.map((e) => e.midi!);
        return {
          id: section.id,
          label: section.label,
          at: section.at,
          density: evs.length / section.lengthBeats,
          median: midis.length
            ? midis.slice().sort((a, b) => a - b)[Math.floor(midis.length / 2)]!
            : null,
          tracks: [...new Set(evs.map((e) => e.trackId))],
        };
      })
      .sort((a, b) => a.at - b.at);
    for (const [i, st] of stats.entries()) {
      const prev = stats[i - 1];
      const tags: string[] = [];
      if (prev) {
        if (
          Math.abs(st.density - prev.density) / Math.max(0.001, prev.density) >
          0.2
        )
          tags.push(st.density > prev.density ? "denser" : "sparser");
        if (
          st.median !== null &&
          prev.median !== null &&
          Math.abs(st.median - prev.median) >= 3
        )
          tags.push(
            st.median > prev.median ? "higher register" : "lower register",
          );
        const added = st.tracks.filter((t) => !prev.tracks.includes(t));
        const dropped = prev.tracks.filter((t) => !st.tracks.includes(t));
        if (added.length) tags.push(`adds ${added.join("+")}`);
        if (dropped.length) tags.push(`drops ${dropped.join("+")}`);
        if (!tags.length) tags.push("similar to previous");
      } else tags.push("opening");
      lines.push(
        `  ${st.id}: bar ${Math.floor(st.at / barBeats) + 1}, ${st.density.toFixed(2)} events/beat` +
          (st.median !== null ? `, median ${pitchName(st.median)}` : "") +
          ` — ${tags.join(", ")}`,
      );
    }
  }

  const findings = diagnoseScore(compiled.score).findings;
  if (findings.length) {
    lines.push("Findings:");
    for (const f of findings.slice(0, 24))
      lines.push(
        `  [${f.severity}] ${f.rule} bar ${f.bar} (${f.fromBeat.toFixed(2)}–${f.toBeat.toFixed(2)}): ${f.message}`,
      );
  } else lines.push("Findings: none");
  return lines.join("\n");
}

/**
 * Self-contained HTML report: piano roll, note/diagnostic text and, when a
 * render is supplied, its signal summary. No external requests, so it can be
 * opened from disk.
 */
export function buildReportHtml(
  compiled: CompiledScore,
  audio?: Uint8Array,
): string {
  const analysis = audio
    ? analyzeChannels(decodeWav(audio).channels, decodeWav(audio).sampleRate)
    : undefined;
  const roll = renderPianoRoll(compiled);
  const description = describeScore(compiled);
  const diagnostics = compiled.diagnostics;
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warnCount = diagnostics.filter((d) => d.severity === "warning").length;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(compiled.score.title)} · Retro Music Report</title>
<style>
body{max-width:1100px;margin:32px auto;padding:0 20px;background:#0b101a;color:#dce7ff;font:15px/1.65 system-ui}
h1{color:#8ef0cb;font-size:22px;margin-bottom:4px}
h2{color:#8ef0cb;font-size:15px;margin:28px 0 10px;letter-spacing:.04em;text-transform:uppercase}
.roll{overflow-x:auto;border:1px solid #22304a;border-radius:10px}
pre{background:#131c2b;padding:16px;border-radius:10px;overflow-x:auto;font-size:13px;line-height:1.6}
table{border-collapse:collapse;font-size:14px}td,th{padding:4px 14px 4px 0;text-align:left;border-bottom:1px solid #22304a}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;margin-right:6px}
.err{background:#5a1f28;color:#ffb3bd}.warn{background:#4d3d12;color:#ffdf8a}.info{background:#1d3040;color:#9fd0ff}
.muted{color:#7d8ea6;font-size:13px}
</style>
<h1>${escape(compiled.score.title)}</h1>
<p class="muted">${escape(compiled.score.profile)} · ${compiled.score.tempo} BPM · ${compiled.score.schemaVersion} · ${compiled.events.length} events · ${errorCount} errors, ${warnCount} warnings</p>
<h2>Piano roll</h2><div class="roll">${roll}</div>
<h2>Structure</h2><pre>${escape(description)}</pre>
${
  analysis
    ? `<h2>Signal</h2><table>
<tr><th>Peak</th><td>${analysis.peakDbfs?.toFixed(2) ?? "—"} dBFS</td><th>True peak</th><td>${analysis.truePeakDbfs?.toFixed(2) ?? "—"} dBFS</td></tr>
<tr><th>RMS</th><td>${analysis.rmsDbfs?.toFixed(2) ?? "—"} dBFS</td><th>Loudness</th><td>${analysis.loudnessLufs ?? "—"} LUFS</td></tr>
<tr><th>Clipped</th><td>${analysis.clippedSamples}</td><th>Boundary jump</th><td>${analysis.boundaryJump.toFixed(5)}</td></tr>
</table>`
    : ""
}
<h2>Diagnostics</h2><pre>${escape(
    diagnostics.length
      ? diagnostics
          .slice(0, 120)
          .map((d) => `[${d.severity}] ${d.code}: ${d.message}`)
          .join("\n")
      : "none",
  )}</pre>
<p class="muted">Measurements are signal-level. They do not prove the music is good, nor that a loop sounds natural.</p>
</html>`;
}

export type { Score };
