"use strict";
// Track list for the listening page. Each track is a stone slab with its own
// biome; playing one hands the biome and tempo to the cave scene.
const BIOME = {
  "mossglow-market": "moss",
  "crystal-undercurrent": "crystal",
  "molten-core-warden": "lava",
};
// 12×12 pixel sigils, one per biome: lantern, crystal, flame.
const SIGILS = {
  moss: [
    "....####....",
    "...#....#...",
    "..########..",
    "..#.oooo.#..",
    "..#.oOOo.#..",
    "..#.oOOo.#..",
    "..#.oooo.#..",
    "..########..",
    "....#..#....",
    "...######...",
    "............",
    "............",
  ],
  crystal: [
    ".....O......",
    "....OOo.....",
    "....OOo..o..",
    "...OOOoo.oo.",
    "...OOOoo.oo.",
    "..OOOOooo.o.",
    "..OOOOooo...",
    "...OOOoo....",
    "....OOo.....",
    "..########..",
    ".##########.",
    "............",
  ],
  lava: [
    "......o.....",
    ".....oo.....",
    "....ooO..o..",
    "...ooOO.oo..",
    "..ooOOOooo..",
    "..oOOOOOOo..",
    ".ooOO##OOoo.",
    ".oOO####OOo.",
    ".oO######Oo.",
    "..########..",
    "...######...",
    "............",
  ],
};
function sigil(biome) {
  const cells = [];
  SIGILS[biome].forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c !== ".")
        cells.push(
          `<rect x="${x}" y="${y}" width="1" height="1" class="s-${c === "#" ? "frame" : c === "O" ? "hot" : "warm"}"/>`,
        );
    }),
  );
  return `<svg class="sigil" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges">${cells.join("")}</svg>`;
}
const KEY_NAMES = { major: "大调", minor: "小调" };
const keyName = (key) => {
  const [tonic, mode] = key.split(" ");
  return `${tonic.replace("b", "♭").replace("#", "♯")} ${KEY_NAMES[mode] ?? mode}`;
};
const clock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function initShowcase() {
  const response = await fetch("music.json");
  if (!response.ok) throw new Error("曲目清单加载失败");
  const tracks = await response.json();
  const announcement = document.querySelector("#announcement");
  const collection = document.querySelector("#tracks");
  collection.replaceChildren();
  const players = [];

  tracks.forEach((track) => {
    const biome = BIOME[track.id] ?? "moss";
    const seconds = (beat) => (beat * 60) / track.tempo;
    const article = document.createElement("article");
    article.className = `track biome-${biome}`;
    article.id = track.id;
    article.setAttribute("aria-labelledby", `${track.id}-title`);
    const markers = track.sectionBeats
      .map((beat, i) =>
        i
          ? `<i style="left:${(seconds(beat) / track.duration) * 100}%"></i>`
          : "",
      )
      .join("");
    article.innerHTML = `
      <div class="vein" aria-hidden="true"></div>
      <div class="track-head">
        ${sigil(biome)}
        <div>
          <p class="setting">${escapeHtml(track.setting)}</p>
          <h3 id="${track.id}-title">${escapeHtml(track.title)}</h3>
          <p class="english" lang="en">${escapeHtml(track.english)} <span>${escapeHtml(track.style)}</span></p>
        </div>
      </div>
      <p class="description">${escapeHtml(track.description)}</p>
      <audio preload="none" src="audio/${track.id}.mp3" aria-label="${escapeHtml(track.title)}"></audio>
      <div class="transport">
        <button class="play" type="button" aria-label="播放${escapeHtml(track.title)}"><span aria-hidden="true">▶</span></button>
        <div class="bar">
          <input class="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="${escapeHtml(track.title)}播放进度" />
          <div class="markers" aria-hidden="true">${markers}</div>
        </div>
        <span class="time">0:00 / ${clock(track.duration)}</span>
        <button class="loop" type="button" aria-pressed="false" aria-label="循环播放${escapeHtml(track.title)}">循环</button>
      </div>
      <p class="audio-error" role="status" hidden></p>
      <ol class="structure" aria-label="段落，点击跳转">
        ${track.sections
          .map(
            (label, i) =>
              `<li><button type="button" class="jump" data-at="${seconds(track.sectionBeats[i])}"><b>${clock(seconds(track.sectionBeats[i]))}</b>${escapeHtml(label)}</button></li>`,
          )
          .join("")}
      </ol>
      <div class="track-detail">
        <div>
          <h4>这首展示了</h4>
          <ul class="features">${track.features.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
        </div>
        <dl class="meta">
          <div><dt>时长</dt><dd>${clock(track.duration)}</dd></div>
          <div><dt>速度</dt><dd>${track.tempo} BPM</dd></div>
          <div><dt>拍号</dt><dd>${track.meter}</dd></div>
          <div><dt>调性</dt><dd>${keyName(track.key)}</dd></div>
          <div><dt>小节</dt><dd>${track.bars}</dd></div>
        </dl>
      </div>
      <details class="prompt">
        <summary>创作提示词</summary>
        <p>${escapeHtml(track.prompt)}</p>
        <div class="prompt-foot">
          <small>按这段要求逐音符写成乐谱，再由工具离线渲染。</small>
          <button class="copy" type="button" aria-label="复制${escapeHtml(track.title)}的创作提示词">复制提示词</button>
        </div>
      </details>
      <div class="downloads">
        <a href="audio/${track.id}.wav" download>下载 WAV</a>
        <a href="scores/${track.id}.json" download>下载乐谱</a>
        <a href="reports/${track.id}.json">渲染报告</a>
      </div>
      <details class="music-credits">
        <summary>音源署名</summary>
        <p>${track.credits.map(escapeHtml).join("<br />")}</p>
      </details>`;
    collection.append(article);

    const audio = article.querySelector("audio");
    const play = article.querySelector(".play");
    const seek = article.querySelector(".seek");
    const time = article.querySelector(".time");
    const error = article.querySelector(".audio-error");
    const duration = () =>
      Number.isFinite(audio.duration) ? audio.duration : track.duration;
    const update = () => {
      time.textContent = `${clock(audio.currentTime)} / ${clock(duration())}`;
      seek.value = (audio.currentTime / duration()) * 100;
      seek.style.setProperty("--progress", `${seek.value}%`);
      seek.setAttribute(
        "aria-valuetext",
        `${clock(audio.currentTime)}，共 ${clock(duration())}`,
      );
    };
    const start = async () => {
      for (const other of players) if (other !== audio) other.pause();
      error.hidden = true;
      try {
        await audio.play();
      } catch (reason) {
        if (reason.name === "AbortError") return;
        error.textContent = "暂时无法播放。请重试，或下载 WAV 试听。";
        error.hidden = false;
      }
    };
    players.push(audio);
    article.start = start;
    play.addEventListener("click", () =>
      audio.paused ? start() : audio.pause(),
    );
    audio.addEventListener("play", () => {
      article.classList.add("playing");
      play.innerHTML = '<span aria-hidden="true">❚❚</span>';
      play.setAttribute("aria-label", `暂停${track.title}`);
      window.caveScene?.play(biome, track.tempo, () => audio.currentTime);
    });
    audio.addEventListener("pause", () => {
      article.classList.remove("playing");
      play.innerHTML = '<span aria-hidden="true">▶</span>';
      play.setAttribute("aria-label", `播放${track.title}`);
      if (!players.some((a) => !a.paused)) window.caveScene?.rest();
    });
    ["timeupdate", "loadedmetadata", "durationchange", "ended"].forEach((e) =>
      audio.addEventListener(e, update),
    );
    audio.addEventListener("error", () => {
      error.textContent = "音频加载失败。请检查网络，或下载 WAV 试听。";
      error.hidden = false;
    });
    seek.addEventListener("input", () => {
      if (Number.isFinite(audio.duration))
        audio.currentTime = (seek.value / 100) * audio.duration;
      update();
    });
    for (const jump of article.querySelectorAll(".jump"))
      jump.addEventListener("click", async () => {
        const at = Number(jump.dataset.at);
        if (audio.paused) await start();
        audio.currentTime = at;
        update();
      });
    const loop = article.querySelector(".loop");
    loop.addEventListener("click", () => {
      audio.loop = !audio.loop;
      loop.setAttribute("aria-pressed", String(audio.loop));
    });
    const copy = article.querySelector(".copy");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(track.prompt);
        copy.textContent = "已复制";
        announcement.textContent = `已复制${track.title}的创作提示词`;
        setTimeout(() => (copy.textContent = "复制提示词"), 1800);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(article.querySelector(".prompt p"));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        copy.textContent = "已选中，请手动复制";
      }
    });
  });

  document.querySelector("#start-listening")?.addEventListener("click", () => {
    const first = collection.querySelector(".track");
    first?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    first?.start();
  });

  const crtToggle = document.querySelector("#crt-toggle");
  const setCrt = (enabled) => {
    document.body.classList.toggle("crt", enabled);
    crtToggle.setAttribute("aria-pressed", String(enabled));
    crtToggle.textContent = `扫描线：${enabled ? "开" : "关"}`;
  };
  try {
    if (localStorage.getItem("retro-crt") === "off") setCrt(false);
  } catch {
    /* Storage is optional. */
  }
  crtToggle.addEventListener("click", () => {
    const enabled = !document.body.classList.contains("crt");
    setCrt(enabled);
    try {
      localStorage.setItem("retro-crt", enabled ? "on" : "off");
    } catch {
      /* Storage is optional. */
    }
  });
}
initShowcase().catch((error) => {
  document.querySelector("#tracks").textContent =
    "曲目清单暂时无法加载，请刷新页面重试。";
  console.error(error);
});
