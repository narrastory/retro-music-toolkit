"use strict";
const bindAudio = (audio) =>
  audio.addEventListener("play", () =>
    document.querySelectorAll("audio").forEach((other) => {
      if (other !== audio) other.pause();
    }),
  );
document.querySelectorAll("audio").forEach(bindAudio);
async function loadInstruments() {
  const response = await fetch("instrument-catalog.json");
  if (!response.ok) throw new Error("音色目录加载失败");
  const catalog = await response.json();
  const target = document.querySelector("#catalog");
  target.replaceChildren();
  for (const [index, entry] of catalog.entries.entries()) {
    const license =
      entry.license === "CC0-1.0"
        ? "https://creativecommons.org/publicdomain/zero/1.0/"
        : `https://creativecommons.org/licenses/by/${entry.license === "CC-BY-3.0" ? "3.0" : "4.0"}/`;
    const article = document.createElement("article");
    article.className = "track";
    article.innerHTML = `<div class="track-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</div><div><div class="track-top"><h3>${entry.title}</h3><span class="tag">${entry.pack} / ${entry.license}</span></div><p class="description">${entry.description}</p><audio controls preload="none" src="audio/${entry.file}.mp3" style="width:100%" aria-label="${entry.title}试听"></audio><p class="downloads"><a download href="audio/${entry.file}.wav">下载 WAV</a><a download href="scores/${entry.file}.json">下载乐谱</a><a href="reports/${entry.file}.json">报告</a></p><p class="description" style="font-size:11px">${entry.credit}<br><a href="${entry.source}">素材来源 ↗</a> · <a href="${license}">完整许可 ↗</a><br>改动：单声道 32 kHz、裁剪与淡出、按根音/鼓件校准增益、精选力度与轮换映射。包含原素材的再分发需保留适用署名和许可说明。</p></div>`;
    target.append(article);
    bindAudio(article.querySelector("audio"));
  }
}
loadInstruments().catch((error) => {
  document.querySelector("#catalog").textContent =
    "音色清单暂时无法加载，请刷新页面重试。";
  console.error(error);
});
