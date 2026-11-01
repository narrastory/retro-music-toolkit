# 原创试听选集制作记录

试听页的三首曲子设定在同一个地下世界里，各自展示工具的一种声音能力。旋律、和声、分段与配器全部在 `scripts/runtime/scripts/compose-showcase.mjs` 中逐音符写出，用 Schema 1.3 编译，再用 Tone.js 离线渲染。页面上的创作提示词保存在 `docs/music.json`。

| 曲目 | 展示的能力 | 结构与声音设计 |
| --- | --- | --- |
| 苔光集市 / Mossglow Market | `orchestra` 采样包 | F 大调，100 BPM，4/4，40 小节 / 96 秒。长笛主题；单簧管先写引导音对位，再现时在主题下方平行六度。拨弦低音、竖琴流动八分音、马林巴反拍双音；D 小调中段由弦乐唱长线。 |
| 晶脉潜流 / Crystal Undercurrent | `subtractive` 引擎与自动化 | E 小调，120 BPM，4/4，48 小节 / 96 秒。analog-pad 铺满全曲，靠 brightness 自动化讲述段落；十六分拨弦琶音、带八度跳跃的切分贝斯、带上滑音和延迟颤音的主奏；钢琴间奏后是八小节小军鼓渐密的蓄力，最后加入低八度脉冲波对位。 |
| 熔芯守卫 / Molten Core Warden | NES 硬件模式 | D 小调，160 BPM，4/4，44 小节 / 66 秒。`authenticity: "hardware"`，严格四通道：12.5% 占空比主旋律、25% 占空比和声（单声部琶音模拟和弦）、三角波八度低音、噪声鼓；句尾向下弯音，第二阶段放慢鼓点、主旋律改长音宽颤音。 |

三首都按发行母带处理：主总线开启真峰值限幅（−1.5 dBFS），集成响度约 −16 LUFS。每次编排后都用 `diagnose` 检查，修正了低音与和弦冲突、音区拥挤、强拍非和弦音等问题。剩余的平行五度提示来自芯片曲中旋律与八度低音的有意设计。

《苔光集市》使用 VSCO 2 CE / VCSL（CC0）与 Gogodze Phu Vol II 鼓组（CC BY 4.0）；《晶脉潜流》使用 Salamander 钢琴（CC BY 3.0）与同一鼓组；《熔芯守卫》全部为原创合成音色。页面每首下方列出署名，完整出处见 `NOTICE.md` 与各音源包的 `SOURCES.json`。

## 从源头重建

在 `scripts/runtime` 下安装依赖并构建，然后运行：

```powershell
node scripts/compose-showcase.mjs
node scripts/render-showcase.mjs
node --test tests/showcase.integration.mjs
```

需要 Chromium（或用 `RETRO_CHROMIUM_EXECUTABLE` 指定）以及 PATH 中的 ffmpeg。渲染较密集的循环曲目较慢：WebAudio 会在整个离线渲染期间处理所有已排程的音符节点，三首合计约需 10–15 分钟。渲染超时按曲长自动放宽，也可用 `RETRO_RENDER_TIMEOUT_MS` 覆盖。

## 页面

`docs/index.html` 的背景是 `docs/scene.js` 实时绘制的俯视像素洞穴：凸起的石墙、苔藓地面、火把、矿脉和中央的核心，光照按像素分档。播放某首曲子时，洞穴切换到该曲的地貌配色，核心按曲子的速度随拍脉动；开启“减少动态效果”时只绘制静态画面。

## 验证边界

自动检查覆盖乐谱可编译性、音频非静音、无非有限采样、无削波、真峰值余量、循环边界指标、时长与文件哈希一致性。网页检查实际播放三个 MP3，并验证切歌互斥、暂停、拖动、段落跳转、循环开关、提示词复制、扫描线偏好、洞穴画布绘制，以及 320–1280 像素宽度布局。

这些检查不代表人耳审听，也不评价旋律质量或耐听度。
