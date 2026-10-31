"use strict";
const tracks = [
  {
    id: "pixel-trail",
    title: "像素小径",
    english: "Pixel Trail",
    style: "NES · pulse",
    scene: "trail",
    setting: "原野探索 / 轻快冒险",
    duration: "29.1 秒",
    tempo: 132,
    score: "pixel-trail",
    prompt:
      "为一款像素冒险游戏的原野关卡创作循环配乐，轻快、有探索感。使用 NES 风格的两路脉冲音色、三角低音与合成鼓，132 BPM，16 小节。让主旋律清楚易记，以 AABA 结构安排主题重复和对比，保留有限声部之间的空间，结尾自然衔接开头。",
    description:
      "脚下是草地，远方是还没打开的地图。两路脉冲与三角低音，勾勒轻快的冒险轮廓。",
  },
  {
    id: "starfall-fm",
    title: "星光栈道",
    english: "Starfall Causeway",
    style: "Genesis · FM",
    scene: "starfall",
    setting: "星空关卡 / 科幻探索",
    duration: "32.0 秒",
    tempo: 120,
    score: "v3-starfall-fm",
    prompt:
      "为一款 16bit 冒险游戏的星空栈道创作循环音乐，带着向未知前进的明亮感。采用 Genesis 风格的 FM 音色，120 BPM，16 小节。用清亮的主旋律建立主题，在第二句改变句尾，加入回答声部；以适量连奏、滑音与弯音增强表情，中段降低能量，再回到主题。",
    description:
      "沿着悬空栈道向星光深处走去。清亮的 FM 主奏，与回答声部一起描绘这段旅程。",
  },
  {
    id: "starfall-sample",
    title: "星光栈道 · 另一种回声",
    english: "Starfall Causeway — sample arrangement",
    style: "SNES · sampled",
    scene: "starfall",
    setting: "同主题改编 / 梦幻探索",
    duration: "35.6 秒",
    tempo: 120,
    score: "v3-starfall-sample",
    prompt:
      "将《星光栈道》改编为 SNES 风格的采样配乐，保留主题与段落关系，让相同旋律呈现另一种质感。使用原创双音区采样音色，保持 120 BPM 与 16 小节的主体结构，延续句尾变奏和回答声部，兼顾采样的延音与收尾空间，不使用商业游戏采样。",
    description:
      "同一段星空旅程，换一种声音讲述。采样版保留主题，让你比较两种音色下的风景。",
  },
  {
    id: "lantern-harbor",
    title: "灯火港湾",
    english: "Lantern Harbor",
    style: "SNES · sampled",
    scene: "harbor",
    setting: "港口城镇 / 休息与对话",
    duration: "38.4 秒",
    tempo: 100,
    score: "lantern-harbor",
    prompt:
      "为复古 RPG 中亮着灯的港口小镇创作温暖、舒缓的循环配乐，适合探索街巷和角色对话。采用 SNES 风格的采样音色，100 BPM，16 小节，以五轨编配组织主旋律、低音、和声、回答声部与节奏。加入弦乐和声，保持层次清晰，让旋律与回答交替出现，营造可以停留的归家感。",
    description:
      "船靠岸了，窗里的灯还亮着。弦乐和声与回答旋律，让冒险在这里稍作停顿。",
  },
];
const repo = "https://github.com/narrastory/retro-music-toolkit";
const raw =
  "https://raw.githubusercontent.com/narrastory/retro-music-toolkit/main";
const announcement = document.querySelector("#announcement");
const collection = document.querySelector("#tracks");
const clock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
tracks.forEach((track) => {
  const article = document.createElement("article");
  article.className = "track";
  article.setAttribute("aria-labelledby", `${track.id}-title`);
  article.innerHTML = `<figure class="cover"><img src="scenes/${track.scene}.svg" width="640" height="360" loading="lazy" alt=""><figcaption><span>${track.setting}</span><span>♫ ${track.tempo} BPM</span></figcaption></figure>
    <div class="track-body"><div class="track-top"><h3 id="${track.id}-title">${track.title}<span class="english">${track.english}</span></h3><span class="tag">${track.style}</span></div>
    <p class="description">${track.description}</p><p class="metadata">${track.duration} · 16 小节 · 循环配乐</p>
    <audio preload="none" src="audio/${track.id}.mp3" aria-label="${track.title}"></audio>
    <div class="transport"><button class="play" aria-label="播放${track.title}">▶ 播放</button><input class="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="${track.title}播放进度"><span class="time">0:00 / --:--</span><button class="loop" aria-pressed="false" aria-label="循环播放${track.title}">↻ 循环</button></div>
    <p class="audio-error" role="status" hidden></p>
    <div class="prompt"><div class="prompt-head"><h4>创作提示词 / Prompt</h4><button class="copy" aria-label="复制${track.title}创作提示词">复制提示词</button></div><p>${track.prompt}</p><small>根据现有乐谱与创作方向重新编写，非原始对话记录。</small></div>
    <div class="downloads"><a href="${raw}/assets/demos/${track.id}.wav" download>下载 WAV ↗</a><a href="${repo}/blob/main/scripts/runtime/examples/${track.score}.json">查看乐谱 ↗</a><a href="${repo}/blob/main/assets/demos/${track.id}.wav.report.json">渲染报告 ↗</a></div></div>`;
  collection.append(article);
  const audio = article.querySelector("audio");
  const play = article.querySelector(".play");
  const seek = article.querySelector(".seek");
  const time = article.querySelector(".time");
  const error = article.querySelector(".audio-error");
  const update = () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    time.textContent = `${clock(audio.currentTime)} / ${duration ? clock(duration) : "--:--"}`;
    seek.value = duration ? (audio.currentTime / duration) * 100 : 0;
    seek.setAttribute(
      "aria-valuetext",
      `${clock(audio.currentTime)}，共 ${duration ? clock(duration) : "尚未加载"}`,
    );
  };
  play.addEventListener("click", async () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    document.querySelectorAll("audio").forEach((other) => {
      if (other !== audio) other.pause();
    });
    error.hidden = true;
    try {
      await audio.play();
    } catch (reason) {
      if (reason.name === "AbortError") return;
      error.textContent = "暂时无法播放，请重试或下载 WAV 试听。";
      error.hidden = false;
    }
  });
  audio.addEventListener("play", () => {
    play.textContent = "Ⅱ 暂停";
    play.setAttribute("aria-label", `暂停${track.title}`);
  });
  audio.addEventListener("pause", () => {
    play.textContent = "▶ 播放";
    play.setAttribute("aria-label", `播放${track.title}`);
  });
  ["timeupdate", "loadedmetadata", "durationchange", "ended"].forEach((event) =>
    audio.addEventListener(event, update),
  );
  audio.addEventListener("error", () => {
    error.textContent = "音频加载失败，请检查网络或下载 WAV 试听。";
    error.hidden = false;
  });
  seek.addEventListener("input", () => {
    if (Number.isFinite(audio.duration))
      audio.currentTime = (seek.value / 100) * audio.duration;
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
      announcement.textContent = `${track.title}创作提示词已复制`;
      setTimeout(() => {
        copy.textContent = "复制提示词";
      }, 1800);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(article.querySelector(".prompt p"));
      selection.removeAllRanges();
      selection.addRange(range);
      announcement.textContent = "提示词已选中，请手动复制。";
      copy.textContent = "已选中，请复制";
    }
  });
});
const crtToggle = document.querySelector("#crt-toggle");
function setCrt(enabled) {
  document.body.classList.toggle("crt", enabled);
  crtToggle.setAttribute("aria-pressed", String(enabled));
  crtToggle.textContent = `CRT 效果：${enabled ? "开" : "关"}`;
}
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
