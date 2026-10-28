<div align="center">

**简体中文** · [English](README.en.md)

<img src="assets/logo.svg" width="96" alt="Retro Music Toolkit">

# Retro Music Toolkit

### 给 AI 用的 8bit / 16bit 游戏音乐工作台

写乐谱，不是抽卡。每一颗音符都由你决定，每一次导出都可复现。

[![version 1.1.0](https://img.shields.io/badge/version-1.1.0-d6293a?style=flat-square)](#快速开始) [![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#快速开始) [![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](scripts/runtime) [![MIT](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE) [![100% offline](https://img.shields.io/badge/100%25-offline-2f855a?style=flat-square)](#为什么它适合-ai-agent) [![44.1 / 48 kHz WAV](https://img.shields.io/badge/output-44.1%20%2F%2048%20kHz%20WAV-6b7280?style=flat-square)](#交付)

[快速开始](#快速开始) · [能力](#能力) · [试听](#看一眼实际输出) · [技术细节](#技术细节) · [路线](#路线)

<code>git clone https://github.com/narrastory/retro-music-toolkit.git</code><br>
<code>cd retro-music-toolkit/scripts/runtime &amp;&amp; npm ci &amp;&amp; npm run build</code>

</div>

<p align="center">
  <img src="assets/hero.svg" width="1040" alt="示意图：左侧是 score.json 乐谱，中间是确定性编译器与离线渲染器，右侧是 starfall-fm.wav 的钢琴卷帘、波形和渲染指标（−21.59 LUFS、−6.18 dBFS 真峰值、1,411,200 帧、0 削波）。">
</p>

---

## 一句话

把「写一首 NES 风格的探索曲」拆成**可编辑、可校验、可复现的 JSON 乐谱**，再用本地渲染器输出 44.1 kHz WAV。

它不猜你想要什么。它只负责把你写下的东西，**准确地、按 8/16bit 的方式**发出来。

## 为什么不直接把需求丢给音乐生成大模型

先把差别说清楚：

| | 音乐生成大模型 | Retro Music Toolkit |
| --- | --- | --- |
| **控制粒度** | 一段文字 → 一段音频，改一个音符要重抽 | 每个音符、每个力度、每个 gate 都是字段 |
| **可复现** | 同一提示词两次结果不同 | 同一份 JSON + 同一 seed = 同一份音频 |
| **可修订** | 只能重新生成，之前的好句子一起没了 | `patch` 定点改第 3 小节第二个音，其余不动 |
| **可审查** | 拿到 WAV，不知道它为什么这么写 | 拿到乐谱与诊断，能指出哪里和声冲突 |
| **版权** | 训练数据来源不可追溯 | 全部音色程序生成，零第三方素材 |
| **部署** | 需要 GPU / API Key / 账号 | 一台普通电脑，Node.js，离线 |
| **成本** | 按次计费 | 零，跑多少次都一样 |

音乐大模型擅长**从零给一个灵感**；这个工具擅长**把灵感做成能进游戏、能改、能过审的成品**。两者不冲突，但后者才是实际交付时会用到的那一个。

## 为什么它适合 AI Agent

这是设计前提，不是事后补的。

- **纯本地、无 API**：不需要任何模型服务、密钥或账号。整条工具链是 Zod + Tone.js + Playwright，本机跑完。
- **JSON 进，JSON 出**：每条命令返回结构化结果；错误带 `code`，可以程序化分支，而不是让 Agent 去正则匹配报错文本。
- **exit code 有意义**：`0` 成功、`1` 工具错误、`2` 乐谱不合法。
- **省 token**：支持 `stdin` / `stdout`、`--compact` 单行 JSON、`--bars 9-16` 按小节取片段，不必把整份工程反复喂回去。
- **能自我检查**：`validate` 的报错直接附带修复建议（例如"把这个音改成 `hold: true`，最大时长 1 拍"）；`patch` 返回逐项 diff，Agent 改完能自证改对了什么。
- **不假装听过**：诊断只给可核验的结构与信号事实，工具本身不声称"这首歌好听"。

```bash
cat song.json | node dist/cli.js validate - --compact
```

## 能力

从写谱到交付，四件事都在同一条本地工具链里。

### 写
- **跨小节延音**（`hold`）与 **clip 裁剪**——不用为了一个长音把整个 pattern 拉长。
- **动机发展**：模进（半音或级进）、倒影、逆行、时值增减、力度曲线、装饰音，只改选区，源主题不动。
- **和声驱动编曲**：写明 `key` 与和弦进行，`harmonize` 生成伴奏，`arpeggiate` 生成琶音。
- **swing / humanize**：由 seed 决定，摇摆感可复现，不是随机漂移。

### 听出问题
- **和声诊断**：强拍非和弦音、低音冲突、平行五度/八度、未解决大跳、调外音、半音碰撞。
- **循环收束**：末句是否真的接回首句，而不是"重新开始"。
- **编曲诊断**：旋律呼吸、音区拥挤、踩镲密度、段落对比。
- **两层反馈**：`describe` 输出可推理的文字结构，`roll` / `report` 输出钢琴卷帘与 HTML 报告。AI 不必"听见"也能读到结构。

### 发声
- **NES / Genesis / SNES 三种风格**，11 个内置音色，支持自定义音色与内嵌 WAV 多音区采样。
- **`authenticity: "hardware"`**：去掉安全低通，把脉冲占空比锁到真实的 12.5 / 25 / 50%，音量量化到 16 级。
- **单声部和弦轮换**：三音和弦只占**一个** voice——芯片音乐就是这么伪造和弦的。
- **SNES 八抽头 FIR 回声**：真机的标志性尾音。
- **八种鼓件**，可替换为采样鼓组。

### 交付
- 44.1k / 48k PCM16 WAV，loop 与 one-shot 两种模式。
- 真峰值（4× 多相 sinc 过采样）与 BS.1770-4 响度测量。
- 可选 TPDF 抖动、前瞻峰值限幅、循环边界等功率交叉淡化。
- `compare` 把两版等响拼接成一个 A/B 文件。

## 看一眼实际输出

先看 `describe` 的文字结构，再看渲染报告里的测量值。

```text
$ node dist/cli.js describe examples/v3-starfall-fm.json

# Starfall Causeway
genesis-inspired, modern voice, 120 BPM, 4/4, 16 bars (64 beats), loop export
- lead (fm-celestial-lead, melody): 60 notes, 3.8/bar, range B4–C6,
  peak C6 at beat 38.00, 37% stepwise motion
- bass (fm-bass-round, bass): 64 notes, 4.0/bar, range F2–D3, peak D3 at beat 40.00
- drums (drums): 128 hits, 8.0/bar — hat×64, kick×32, snare×32
Sections:
  A-1: bar 1, 5.13 events/beat, median E4 — opening
  B-9: bar 9, 4.75 events/beat, median D4 — similar to previous
```

渲染报告里的真实数字（Starfall Causeway 的 FM 版）：

| 指标 | 值 |
| --- | --- |
| 时长 / 帧数 | 32.000 s / 1 411 200 |
| 集成响度 | −21.59 LUFS |
| 真峰值 | −6.18 dBFS |
| 削波 / 非有限样本 | 0 / 0 |

> [!TIP]
> 直接试听：[FM 版](assets/demos/starfall-fm.wav) / [同主题采样改编](assets/demos/starfall-sample.wav)

## 快速开始

> [!NOTE]
> 需要 Node.js 22+。首次安装要联网下载依赖与 Chromium，之后**全程离线**。

```bash
git clone https://github.com/narrastory/retro-music-toolkit.git
cd retro-music-toolkit/scripts/runtime
npm ci
npm run browser:install     # 仅渲染需要；纯编译/诊断不需要 Chromium
npm run build
```

生成第一首：

```bash
node dist/cli.js example --out minimal.json     # 一份约 40 行的最小可运行乐谱
node dist/cli.js validate minimal.json
node dist/cli.js render minimal.json --out minimal.wav
```

改一点，再导出：

```bash
node dist/cli.js diagnose minimal.json          # 编排与和声问题
node dist/cli.js patch minimal.json --patch changes.json --out v2.json
node dist/cli.js render v2.json --out v2.wav --dither
node dist/cli.js compare minimal.wav v2.wav --out ab.wav
```

完整流程见 [快速开始](references/quickstart.zh-CN.md)、[1.1 指南](references/v1.1-guide.zh-CN.md)、[乐谱格式](references/score-format.zh-CN.md)。

## 它不做什么

诚实地说明边界，比夸大能力更有用：

> [!IMPORTANT]
> **不自动作曲，也不是芯片仿真。** 它不会替你想旋律；`hardware` 模式是听感近似，不宣称 2A03 / YM2612 / BRR 位精确。

- **不做主观审美判断**。诊断只说"这里可能有和声冲突"，不说"这里不好听"。
- **暂不含简写记谱、MIDI、tempo map、MCP server**（见[路线](#路线)）。
- **没有主观听审记录**。仓库里的示例都只做过信号层面验证，不是"我们觉得很好听"。

## 技术细节

实现细节默认收起，展开可看架构、命令和库用法。

<details>
<summary>架构与实现</summary>

**数据流**：JSON → Zod 严格校验 → 语义 / 采样 / 和声检查 → pattern·clip 展开（含 swing、humanize、hold、裁剪、单声部和弦轮换）→ 整数 tick 事件 → 声部分配 → Tone.js 离线合成 → 限幅 / 抖动 / 分析 → PCM16 WAV。

**关键模块**

| 文件 | 职责 |
| --- | --- |
| `model.ts` | Zod Schema、PPQ = 960、音高转换、结构化错误 |
| `compiler.ts` | 展开、时间变换、和弦轮换、声部分配、循环边界 |
| `harmony.ts` | 和弦解析、调性、和声与循环诊断 |
| `motif.ts` / `voicing.ts` | 动机算子、和弦排列与琶音 |
| `browser-engine.ts` | Tone.js 构图与调度、预热、裁切、接缝 |
| `renderer.ts` | Node → Chromium 桥接 |
| `analysis.ts` | 真峰值、LUFS、削波、边界症状 |
| `report.ts` | 钢琴卷帘 SVG、文字描述、HTML 报告 |

**设计取舍**

- **整数 tick，不是浮点秒**。所有时间变换在编译期完成，因此循环长度、声部冲突、诊断窗口都基于实际发声时间。
- **鼓与旋律的声部语义不同**。旋律按 `maxVoices` 分配、可抢占；鼓是独立 one-shot，不占声部。
- **release 尾音与按音冲突分开报告**。前者常见且无害，后者才需要改。
- **可复现性**：鼓噪声、humanize 抖动、random 琶音全部由 seed 派生，禁止运行期 `Math.random`。浏览器 DSP 差异仍可能导致逐样本不一致，不宣称 bit-exact。

**统计**：约 7 500 行 TypeScript；运行时依赖 4 个（`tone`、`zod`、`playwright`、`esbuild`）；115 项自动化测试（90 单元 + 23 真实音频 + 2 网页）。

</details>

<details>
<summary>命令一览</summary>

```text
instruments                    列出音色与推荐音域
validate SCORE.json            完整编译检查
compile SCORE.json --out F     展开后的整数 tick 事件
diagnose SCORE.json            编排 + 和声 + 循环诊断
render SCORE.json --out S.wav  离线渲染
patch SCORE.json --patch P     定点修改，返回变更日志
arrange CONFIG.json            生成编曲骨架
motif / harmonize / arpeggiate 动机发展、伴奏、琶音
vary / answer                  变奏与回答声部
import-instrument              打包本地 WAV 为工程内音色
report / describe / roll       可视化与文字结构
audition                       生成音色试听库
compare A.wav B.wav            等响 A/B 导出
analyze AUDIO.wav              测量任意 WAV
schema / example / version
```

渲染选项：`--solo` `--mode` `--bars` `--from/--to` `--seam` `--effects` `--match-rms` `--loop-diagnostics` `--loop-crossfade` `--dither` `--limiter`

全局：`--force` `--compact` `--stdout` `--help`

</details>

<details>
<summary>作为库使用</summary>

```ts
import { readFile } from "node:fs/promises";
import {
  compileScore,
  renderScore,
  patchScoreWithReport,
} from "./scripts/runtime/dist/index.js";

const input = JSON.parse(await readFile("song.json", "utf8"));
const compiled = compileScore(input);
console.log(compiled.events.length, compiled.diagnostics);

const { score, report } = patchScoreWithReport(input, {
  operations: [{ op: "set-track", trackId: "arp", set: { gainDb: -18 } }],
});
console.log(report.changes); // 逐项 before / after

const { wav } = await renderScore(score, { solo: ["lead", "bass"] });
```

</details>

<details>
<summary>Agent 集成</summary>

`SKILL.md` 是给 Agent 看的入口文档，包含完整创作流程、约束与交付标准。宿主只需要能执行 shell：

| 工具意图 | 实现 |
| --- | --- |
| 列出音色 | `INSTRUMENTS` / `cli instruments` |
| 校验乐谱 | `compileScore` / `cli validate` |
| 渲染 | `renderScore` / `cli render` |
| 修改 | `patchScoreWithReport` / `cli patch` |
| 分析音频 | `decodeWav` + `analyzeChannels` / `cli analyze` |

目前没有随包提供 MCP server；直接用 CLI 或函数调用已能形成完整闭环。

</details>

## 路线

- tempo map / 渐快渐慢
- MIDI 导入导出
- MML / 简写记谱前端
- 跨和弦的声部进行优化
- MCP server
- 更省内存的采样调度

欢迎在 Issue 里说明你真正需要的场景。

---

## 致谢与许可

- 代码与 Schema 文档：[MIT](LICENSE)
- `references/source-guides/` 中的三份背景教程由使用者提供，版权归原作者，不适用 MIT。
- 依赖：Tone.js、Zod、Playwright、esbuild，各自遵循其许可证。
- 内置音色与鼓素材**全部程序生成**，不含任何商业游戏音色或扒带素材。

<div align="center">
<br>
<sub>8bit 的限制不是缺点，是风格。把限制用对，就是编曲。</sub>
</div>
