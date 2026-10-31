"use strict";
async function initShowcase() {
  const response = await fetch("music.json");
  if (!response.ok) throw new Error("曲目清单加载失败");
  const tracks = await response.json();

  const announcement = document.querySelector("#announcement");
  const collection = document.querySelector("#tracks");
  collection.replaceChildren();
  const clock = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  tracks.forEach((track) => {
    const article = document.createElement("article");
    article.className = "track";
    article.setAttribute("aria-labelledby", `${track.id}-title`);
    article.innerHTML = `<div class="track-index" aria-hidden="true">${String(tracks.indexOf(track) + 1).padStart(2, "0")}<span>♫</span></div>
    <div class="track-body"><div class="track-top"><div><p class="setting">${track.setting}</p><h3 id="${track.id}-title">${track.title}</h3><span class="english">${track.english}</span></div><span class="tag">${track.style}</span></div>
    <p class="description">${track.description}</p><p class="metadata">${clock(track.duration)} · ${track.tempo} BPM · ${track.meter} · ${track.bars} 小节 · ${track.key}</p>
    <audio preload="none" src="audio/${track.id}.mp3" aria-label="${track.title}"></audio>
    <div class="transport"><button class="play" aria-label="播放${track.title}">▶ 播放</button><input class="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="${track.title}播放进度"><span class="time">0:00 / ${clock(track.duration)}</span><button class="loop" aria-pressed="false" aria-label="循环播放${track.title}">↻ 循环</button></div>
    <p class="audio-error" role="status" hidden></p>
    <div class="structure" aria-label="乐曲段落">${track.sections.map((label, i) => `<span><b>${clock((track.duration * i) / 4)}</b> ${label}</span>`).join("")}</div>
    <div class="features">${track.features.map((feature) => `<span>${feature}</span>`).join("")}</div>
    <div class="prompt"><div class="prompt-head"><h4>创作 Prompt</h4><button class="copy" aria-label="复制${track.title}创作提示词">复制提示词</button></div><p>${track.prompt}</p><small>本次原创创作的主要提示词；逐音符编写乐谱，再经本工具离线渲染。</small></div>
    <div class="downloads"><a href="audio/${track.id}.wav" download>下载 WAV ↓</a><a href="scores/${track.id}.json" download>下载乐谱 ↓</a><a href="reports/${track.id}.json">渲染报告 ↗</a></div></div>`;
    collection.append(article);
    const audio = article.querySelector("audio");
    const play = article.querySelector(".play");
    const seek = article.querySelector(".seek");
    const time = article.querySelector(".time");
    const error = article.querySelector(".audio-error");
    const update = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      time.textContent = `${clock(audio.currentTime)} / ${duration ? clock(duration) : clock(track.duration)}`;
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
    ["timeupdate", "loadedmetadata", "durationchange", "ended"].forEach(
      (event) => audio.addEventListener(event, update),
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
}
initShowcase().catch((error) => {
  document.querySelector("#tracks").textContent =
    "音乐清单暂时无法加载，请刷新页面重试。";
  console.error(error);
});
