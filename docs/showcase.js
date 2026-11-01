"use strict";
// Listening page: five tracks as stone slabs, each with its own cave biome,
// in English (default) or Chinese. Switching language rewrites text in
// place, so a playing track keeps playing.
const ORDER = [
  "mossglow-market",
  "lamplit-tavern",
  "crystal-undercurrent",
  "molten-core-warden",
  "surface-again",
];
const BIOME = {
  "mossglow-market": "moss",
  "lamplit-tavern": "tavern",
  "crystal-undercurrent": "crystal",
  "molten-core-warden": "lava",
  "surface-again": "dawn",
};

const UI = {
  en: {
    pageTitle: "Retro Music Toolkit: five songs from below",
    metaDescription:
      "Five original game soundtracks rendered offline from JSON scores with Retro Music Toolkit. Listen, then download the full score.",
    skip: "Skip to the tracks",
    navLabel: "Main",
    navTracks: "Tracks",
    heroTitle: "Deep underground,<br />five songs are glowing.",
    heroIntro:
      "A market, a tavern, a crystal vein, a guardian and the way back to the surface. Five original game cues, every note written in a JSON score and rendered offline by Retro Music Toolkit.",
    heroButton: "Start with Mossglow Market",
    heroHint:
      "While a track plays, the cave behind the page takes on its landscape and the Core pulses on the beat.",
    collectionTitle: "Five veins, five sound worlds",
    collectionIntro:
      "One tool, five different sounds: sampled orchestra, swing band, subtractive synths, NES four-channel chip and a piano-led orchestral waltz. Each comes with its writing prompt, full score and render report.",
    loading: "Digging up the tracks…",
    takeTitle: "Take them into your game",
    takeUse:
      "All five may be used in personal and commercial projects. The score is plain JSON you can edit, re-orchestrate and render again with the same tool; render a WAV locally whenever you need delivery audio.",
    takeCredit:
      "Some tracks use attribution-licensed samples (piano CC BY 3.0, drums CC BY 4.0); keep the credits listed under each track when you publish. Molten Core Warden is pure synthesis and needs no credit.",
    takeLink: "Full sources and licenses",
    footerNote:
      "Melodies and arrangements are original; no melodies or samples from commercial games are used. The page ships MP3 previews; render WAV from the score when you need it.",
    footerLink: "Retro Music Toolkit on GitHub",
    langButton: "中文",
    langLabel: "切换到中文",
    scanlines: (on) => `Scanlines: ${on ? "on" : "off"}`,
    play: (t) => `Play ${t}`,
    pause: (t) => `Pause ${t}`,
    seek: (t) => `${t} playback position`,
    position: (now, total) => `${now} of ${total}`,
    loop: "Loop",
    loopLabel: (t) => `Loop ${t}`,
    sections: "Sections, select to jump",
    shows: "What this track shows",
    meta: ["Length", "Tempo", "Meter", "Key", "Bars"],
    mode: { major: "major", minor: "minor" },
    prompt: "Writing prompt",
    promptNote:
      "Written note by note from this brief, then rendered offline by the toolkit.",
    copy: "Copy prompt",
    copyLabel: (t) => `Copy the writing prompt for ${t}`,
    copied: "Copied",
    copiedAnnounce: (t) => `Copied the writing prompt for ${t}`,
    selectToCopy: "Selected; copy manually",
    score: "Download score",
    report: "Render report",
    credits: "Sample credits",
    playError: "Can't play right now. Try again.",
    loadError: "The audio didn't load. Check your connection and try again.",
    listError: "The track list didn't load. Refresh the page to try again.",
  },
  zh: {
    pageTitle: "Retro Music Toolkit：地底五首歌",
    metaDescription:
      "五首原创游戏配乐，全部由 Retro Music Toolkit 从 JSON 乐谱离线渲染。可试听，并下载完整乐谱。",
    skip: "跳到曲目",
    navLabel: "主导航",
    navTracks: "曲目",
    heroTitle: "地底深处，<br />有五首歌在发光。",
    heroIntro:
      "一座集市、一家酒馆、一条晶脉、一位守卫，还有回到地表的路。五首原创游戏配乐，每一个音符都写在 JSON 乐谱里，由 Retro Music Toolkit 在本机离线渲染。",
    heroButton: "从苔光集市听起",
    heroHint: "播放时，背景的洞穴会换成那首曲子的地貌，核心随节拍跳动。",
    collectionTitle: "五条矿脉，五种声音",
    collectionIntro:
      "同一个工具，五套完全不同的声音：采样管弦、摇摆乐队、减法合成、NES 四通道芯片，以及钢琴领奏的管弦圆舞曲。每首都附创作提示词、完整乐谱和渲染报告。",
    loading: "正在挖掘曲目…",
    takeTitle: "把它们带进你的游戏",
    takeUse:
      "五首曲子都可用于个人和商业项目。乐谱是普通 JSON，可以改旋律、换配器，再用同一个工具在本地重新渲染 WAV。",
    takeCredit:
      "部分曲目用到了署名许可的采样（钢琴 CC BY 3.0、鼓组 CC BY 4.0），发布时请保留每首曲目下方列出的署名。熔芯守卫全部是合成音色，无需署名。",
    takeLink: "查看完整出处与许可",
    footerNote:
      "旋律与编曲均为原创，不使用任何商业游戏的旋律或采样。页面提供 MP3 试听；需要交付时，用乐谱在本地渲染 WAV。",
    footerLink: "在 GitHub 上查看 Retro Music Toolkit",
    langButton: "EN",
    langLabel: "Switch to English",
    scanlines: (on) => `扫描线：${on ? "开" : "关"}`,
    play: (t) => `播放${t}`,
    pause: (t) => `暂停${t}`,
    seek: (t) => `${t}播放进度`,
    position: (now, total) => `${now}，共 ${total}`,
    loop: "循环",
    loopLabel: (t) => `循环播放${t}`,
    sections: "段落，点击跳转",
    shows: "这首展示了",
    meta: ["时长", "速度", "拍号", "调性", "小节"],
    mode: { major: "大调", minor: "小调" },
    prompt: "创作提示词",
    promptNote: "按这段要求逐音符写成乐谱，再由工具离线渲染。",
    copy: "复制提示词",
    copyLabel: (t) => `复制${t}的创作提示词`,
    copied: "已复制",
    copiedAnnounce: (t) => `已复制${t}的创作提示词`,
    selectToCopy: "已选中，请手动复制",
    score: "下载乐谱",
    report: "渲染报告",
    credits: "音源署名",
    playError: "暂时无法播放，请重试。",
    loadError: "音频加载失败，请检查网络后重试。",
    listError: "曲目清单暂时无法加载，请刷新页面重试。",
  },
};

// 12×12 pixel sigils: lantern, mug, crystal, flame, sunrise.
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
  tavern: [
    "............",
    "...oOoOo....",
    "..oOOOOOo...",
    "..########..",
    "..#oooooo###",
    "..#oOOOOo#.#",
    "..#oOOOOo#.#",
    "..#oOOOOo###",
    "..#oooooo#..",
    "..########..",
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
  dawn: [
    ".....o......",
    ".o...o...o..",
    "..o.....o...",
    "....OOO.....",
    "...OOOOO....",
    "oo.OOOOO.oo.",
    "..OOOOOOO...",
    "############",
    "#..##....##.",
    "....#..#....",
    ".#.......#..",
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
const clock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function storedLang() {
  try {
    return localStorage.getItem("retro-lang") === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

async function initShowcase() {
  let lang = storedLang();
  const response = await fetch("music.json");
  if (!response.ok) throw new Error(UI[lang].listError);
  const manifest = await response.json();
  const tracks = ORDER.map((id) => manifest.find((t) => t.id === id))
    .filter(Boolean)
    .concat(manifest.filter((t) => !ORDER.includes(t.id)));
  const announcement = document.querySelector("#announcement");
  const collection = document.querySelector("#tracks");
  collection.replaceChildren();
  const players = [];
  const localizers = [];

  for (const track of tracks) {
    const biome = BIOME[track.id] ?? "moss";
    const seconds = (beat) => (beat * 60) / track.tempo;
    // Chinese text lives at the top level of each entry, English in `en`.
    const text = () =>
      lang === "zh"
        ? track
        : {
            ...track,
            ...(track.en ?? {}),
            title: track.en?.title ?? track.english,
          };
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
          <p class="setting"></p>
          <h3 id="${track.id}-title"></h3>
          <p class="english"><span class="alt-title"></span><span class="tag"></span></p>
        </div>
      </div>
      <p class="description"></p>
      <audio preload="none" src="audio/${track.id}.mp3"></audio>
      <div class="transport">
        <button class="play" type="button"><span aria-hidden="true">▶</span></button>
        <div class="bar">
          <input class="seek" type="range" min="0" max="100" step="0.1" value="0" />
          <div class="markers" aria-hidden="true">${markers}</div>
        </div>
        <span class="time">0:00 / ${clock(track.duration)}</span>
        <button class="loop" type="button" aria-pressed="false"></button>
      </div>
      <p class="audio-error" role="status" hidden></p>
      <ol class="structure">
        ${track.sectionBeats
          .map(
            (beat) =>
              `<li><button type="button" class="jump" data-at="${seconds(beat)}"><b>${clock(seconds(beat))}</b><span></span></button></li>`,
          )
          .join("")}
      </ol>
      <div class="track-detail">
        <div>
          <h4></h4>
          <ul class="features"></ul>
        </div>
        <dl class="meta">
          <div><dt></dt><dd>${clock(track.duration)}</dd></div>
          <div><dt></dt><dd>${track.tempo} BPM</dd></div>
          <div><dt></dt><dd>${track.meter}</dd></div>
          <div><dt></dt><dd class="key"></dd></div>
          <div><dt></dt><dd>${track.bars}</dd></div>
        </dl>
      </div>
      <details class="prompt">
        <summary></summary>
        <p></p>
        <div class="prompt-foot">
          <small></small>
          <button class="copy" type="button"></button>
        </div>
      </details>
      <div class="downloads">
        <a class="dl-score" href="scores/${track.id}.json" download></a>
        <a class="dl-report" href="reports/${track.id}.json"></a>
      </div>
      <details class="music-credits">
        <summary></summary>
        <p lang="en"></p>
      </details>`;
    collection.append(article);

    const $ = (selector) => article.querySelector(selector);
    const audio = $("audio");
    const play = $(".play");
    const seek = $(".seek");
    const time = $(".time");
    const error = $(".audio-error");
    const loop = $(".loop");
    const copy = $(".copy");
    const duration = () =>
      Number.isFinite(audio.duration) ? audio.duration : track.duration;
    const update = () => {
      time.textContent = `${clock(audio.currentTime)} / ${clock(duration())}`;
      seek.value = (audio.currentTime / duration()) * 100;
      seek.style.setProperty("--progress", `${seek.value}%`);
      seek.setAttribute(
        "aria-valuetext",
        UI[lang].position(clock(audio.currentTime), clock(duration())),
      );
    };
    const labelPlay = () => {
      const t = text().title;
      play.innerHTML = `<span aria-hidden="true">${audio.paused ? "▶" : "❚❚"}</span>`;
      play.setAttribute(
        "aria-label",
        (audio.paused ? UI[lang].play : UI[lang].pause)(t),
      );
    };
    localizers.push(() => {
      const t = text();
      const ui = UI[lang];
      $(".setting").textContent = t.setting;
      $("h3").textContent = t.title;
      // The second line shows the title in the other language.
      const alt = $(".alt-title");
      alt.textContent = lang === "zh" ? track.english : track.title;
      alt.lang = lang === "zh" ? "en" : "zh-CN";
      $(".tag").textContent = t.style;
      $(".description").textContent = t.description;
      audio.setAttribute("aria-label", t.title);
      seek.setAttribute("aria-label", ui.seek(t.title));
      loop.textContent = ui.loop;
      loop.setAttribute("aria-label", ui.loopLabel(t.title));
      $(".structure").setAttribute("aria-label", ui.sections);
      article.querySelectorAll(".jump span").forEach((span, i) => {
        span.textContent = t.sections[i];
      });
      $("h4").textContent = ui.shows;
      $(".features").replaceChildren(
        ...t.features.map((f) =>
          Object.assign(document.createElement("li"), { textContent: f }),
        ),
      );
      article.querySelectorAll(".meta dt").forEach((dt, i) => {
        dt.textContent = ui.meta[i];
      });
      const [tonic, mode] = track.key.split(" ");
      $(".key").textContent =
        `${tonic.replace("b", "♭").replace("#", "♯")} ${ui.mode[mode] ?? mode}`;
      $(".prompt summary").textContent = ui.prompt;
      $(".prompt p").textContent = t.prompt;
      $(".prompt small").textContent = ui.promptNote;
      copy.textContent = ui.copy;
      copy.setAttribute("aria-label", ui.copyLabel(t.title));
      $(".dl-score").textContent = ui.score;
      $(".dl-report").textContent = ui.report;
      $(".music-credits summary").textContent = ui.credits;
      $(".music-credits p").innerHTML = track.credits
        .map((c) =>
          c.replace(
            /[&<>]/g,
            (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[x],
          ),
        )
        .join("<br />");
      labelPlay();
      update();
    });

    const start = async () => {
      for (const other of players) if (other !== audio) other.pause();
      error.hidden = true;
      try {
        await audio.play();
      } catch (reason) {
        if (reason.name === "AbortError") return;
        error.textContent = UI[lang].playError;
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
      labelPlay();
      window.caveScene?.play(biome, track.tempo, () => audio.currentTime);
    });
    audio.addEventListener("pause", () => {
      article.classList.remove("playing");
      labelPlay();
      if (!players.some((a) => !a.paused)) window.caveScene?.rest();
    });
    ["timeupdate", "loadedmetadata", "durationchange", "ended"].forEach((e) =>
      audio.addEventListener(e, update),
    );
    audio.addEventListener("error", () => {
      error.textContent = UI[lang].loadError;
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
    loop.addEventListener("click", () => {
      audio.loop = !audio.loop;
      loop.setAttribute("aria-pressed", String(audio.loop));
    });
    copy.addEventListener("click", async () => {
      const t = text();
      try {
        await navigator.clipboard.writeText(t.prompt);
        copy.textContent = UI[lang].copied;
        announcement.textContent = UI[lang].copiedAnnounce(t.title);
        setTimeout(() => (copy.textContent = UI[lang].copy), 1800);
      } catch {
        const range = document.createRange();
        range.selectNodeContents($(".prompt p"));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        copy.textContent = UI[lang].selectToCopy;
      }
    });
  }

  const crtToggle = document.querySelector("#crt-toggle");
  const langToggle = document.querySelector("#lang-toggle");
  const crtOn = () => document.body.classList.contains("crt");
  function applyLang(next) {
    lang = next;
    const ui = UI[lang];
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    for (const el of document.querySelectorAll("[data-i18n]"))
      el.textContent = ui[el.dataset.i18n];
    for (const el of document.querySelectorAll("[data-i18n-html]"))
      el.innerHTML = ui[el.dataset.i18nHtml];
    for (const el of document.querySelectorAll("[data-i18n-aria]"))
      el.setAttribute("aria-label", ui[el.dataset.i18nAria]);
    for (const el of document.querySelectorAll("[data-i18n-content]"))
      el.setAttribute("content", ui[el.dataset.i18nContent]);
    langToggle.textContent = ui.langButton;
    langToggle.lang = lang === "zh" ? "en" : "zh-CN";
    langToggle.setAttribute("aria-label", ui.langLabel);
    crtToggle.textContent = ui.scanlines(crtOn());
    for (const localize of localizers) localize();
  }
  langToggle.addEventListener("click", () => {
    const next = lang === "zh" ? "en" : "zh";
    applyLang(next);
    try {
      localStorage.setItem("retro-lang", next);
    } catch {
      /* Storage is optional. */
    }
    announcement.textContent =
      next === "zh" ? "已切换到中文" : "Switched to English";
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

  const setCrt = (enabled) => {
    document.body.classList.toggle("crt", enabled);
    crtToggle.setAttribute("aria-pressed", String(enabled));
    crtToggle.textContent = UI[lang].scanlines(enabled);
  };
  try {
    if (localStorage.getItem("retro-crt") === "off") setCrt(false);
  } catch {
    /* Storage is optional. */
  }
  crtToggle.addEventListener("click", () => {
    const enabled = !crtOn();
    setCrt(enabled);
    try {
      localStorage.setItem("retro-crt", enabled ? "on" : "off");
    } catch {
      /* Storage is optional. */
    }
  });
  applyLang(lang);
}
initShowcase().catch((error) => {
  document.querySelector("#tracks").textContent = UI[storedLang()].listError;
  console.error(error);
});
