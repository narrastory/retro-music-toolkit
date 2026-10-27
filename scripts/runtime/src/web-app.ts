import { diagnoseScore } from "./diagnostics.js";
import { compileScore } from "./compiler.js";
import { renderInBrowser } from "./browser-engine.js";
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
let audioUrl: string | undefined;
$("#file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) $<HTMLTextAreaElement>("#score").value = await f.text();
});
$("#render").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("#render");
  button.disabled = true;
  $("#status").textContent = "编译与渲染中…";
  try {
    const data = JSON.parse($<HTMLTextAreaElement>("#score").value);
    const compiled = compileScore(data);
    const mode = $<HTMLSelectElement>("#mode").value as
      | ""
      | "loop"
      | "one-shot";
    const limiterOn = $<HTMLInputElement>("#limiter").checked;
    const crossfade = Number($<HTMLInputElement>("#crossfade").value) || 0;
    const result = await renderInBrowser(compiled, {
      effects: $<HTMLSelectElement>("#effects").value as "mix" | "dry" | "wet",
      ...(mode ? { mode } : {}),
      ...(crossfade > 0 ? { loopCrossfadeBeats: crossfade } : {}),
      ...(limiterOn ? { limiter: { ceilingDbfs: -1 } } : {}),
      normalization: $<HTMLInputElement>("#match").checked
        ? { targetRmsDbfs: -24 }
        : undefined,
    });
    const bytes = Uint8Array.from(atob(result.wavBase64), (c) =>
      c.charCodeAt(0),
    );
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    $<HTMLAudioElement>("#audio").src = audioUrl;
    const a = $<HTMLAnchorElement>("#download");
    a.href = audioUrl;
    a.download = "retro-music.wav";
    a.hidden = false;
    $("#status").textContent = JSON.stringify(
      { diagnostics: compiled.diagnostics, ...result.analysis },
      null,
      2,
    );
  } catch (e) {
    $("#status").textContent = e instanceof Error ? e.message : String(e);
    if (e && typeof e === "object" && "diagnostics" in e)
      $("#status").textContent += "\n" + JSON.stringify(e.diagnostics, null, 2);
  } finally {
    button.disabled = false;
  }
});

$("#diagnose").addEventListener("click", () => {
  try {
    $("#status").textContent = JSON.stringify(
      diagnoseScore(JSON.parse($<HTMLTextAreaElement>("#score").value)),
      null,
      2,
    );
  } catch (e) {
    $("#status").textContent = e instanceof Error ? e.message : String(e);
    if (e && typeof e === "object" && "diagnostics" in e)
      $("#status").textContent += "\n" + JSON.stringify(e.diagnostics, null, 2);
  }
});

$("#example").addEventListener("click", async () => {
  // Load the shipped minimal example so the page is usable without a file.
  const res = await fetch("example.json").catch(() => undefined);
  if (res?.ok) {
    $<HTMLTextAreaElement>("#score").value = await res.text();
    $("#status").textContent = "已载入最小示例。";
  } else {
    $("#status").textContent =
      "example.json 未随 web/ 一起部署；请手动载入 examples/ 中的乐谱。";
  }
});
