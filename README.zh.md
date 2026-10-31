<div align="center">

**简体中文** · [English](README.md)

<img src="assets/logo.svg" width="96" alt="Retro Music Toolkit">

# Retro Music Toolkit

### 给 AI 用的 8bit / 16bit 游戏音乐工作台

**完全本地，零 API。同一份乐谱，永远导出同一段音频。**

[![100% offline](https://img.shields.io/badge/100%25-offline-2f855a?style=flat-square)](#它替你做什么) [![no API key](https://img.shields.io/badge/API%20key-not%20needed-2f855a?style=flat-square)](#它替你做什么) [![reproducible](https://img.shields.io/badge/output-reproducible-ef3b4c?style=flat-square)](#它替你做什么) [![135 tests](https://img.shields.io/badge/tests-135%20passing-339933?style=flat-square)](#技术细节) [![macOS · Linux · Windows](https://img.shields.io/badge/macOS%20·%20Linux%20·%20Windows-supported-6b7280?style=flat-square)](#快速开始) [![MIT](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)

[🎧 在线试听](https://narrastory.github.io/retro-music-toolkit/) · [快速开始](#快速开始) · [和音乐大模型的区别](#和音乐生成大模型有什么不同) · [技术细节](#技术细节)

</div>

<p align="center">
  <img src="assets/hero.svg" width="1040" alt="JSON 乐谱经确定性编译器与离线渲染器，输出钢琴卷帘、波形与渲染指标">
</p>

```bash
git clone https://github.com/narrastory/retro-music-toolkit.git
cd retro-music-toolkit/scripts/runtime && npm ci && npm run build
node dist/cli.js example --out song.json && node dist/cli.js render song.json --out song.wav
```

---

## 它替你做什么

**🔒 完全本地，不需要任何模型或账号**\
没有 API Key，没有 GPU，没有云端调用，没有按次计费。装好依赖之后断网也能跑。你的乐谱和音频从不离开本机。

**🔁 结果可复现**\
同一份 JSON 加同一个 seed，今天导出、明年导出、换一台电脑导出，都是同一段音频。鼓噪声、人性化抖动、随机琶音全部由 seed 决定，你可以把乐谱提交进 Git，像管代码一样管音乐。

**✏️ 改一个音，不用重来**\
第 9 小节的低音不对？`patch` 只改那一个音，其余全部原样保留，并返回逐项变更记录。不会因为改了一处，就把之前满意的段落一起丢掉。

**🩺 写错了会告诉你哪里错**\
强拍上的非和弦音、低音与和弦冲突、平行五度、没解决的大跳、循环接缝没回到主和弦——诊断会给出小节号和音符 ID，有的还直接附上修复值。

> [!TIP]
> 想先听听效果？👉 **[在线试听页](https://narrastory.github.io/retro-music-toolkit/)**（3 首全新原创：田园探索、室内钢琴与轻快冒险）
> 所有示例都由仓库里的 JSON 乐谱离线渲染，声音合成不调用音乐生成服务。

---

## 60 秒看到效果

```bash
node dist/cli.js example --out song.json     # 一份约 40 行、可直接运行的乐谱
node dist/cli.js render song.json --out song.wav
node dist/cli.js describe song.json          # 用文字读出这首曲子的结构
```

`describe` 输出的是 AI 可以直接推理的结构摘要，不需要“听见”：

```text
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

渲染报告的实测数据（Starfall Causeway，FM 版）：

| 时长 | 集成响度 | 真峰值 | 削波样本 |
| :---: | :---: | :---: | :---: |
| 32.0 s | −21.59 LUFS | −6.18 dBFS | 0 |

---

## 和音乐生成大模型有什么不同

两者解决的不是同一个问题。

| | 音乐生成大模型 | Retro Music Toolkit |
| --- | --- | --- |
| **输入** | 一段文字描述 | 一份 JSON 乐谱 |
| **运行环境** | 云端 API / 本地 GPU | 一台普通电脑，离线 |
| **成本** | 按次计费 | 零 |
| **复现** | 同一提示词，每次结果不同 | 同一乐谱，每次结果相同 |
| **修改** | 重新生成整段 | 定点改一个音 |
| **可解释** | 只拿到音频 | 拿到乐谱和诊断 |
| **素材来源** | 训练数据不可追溯 | 程序合成 + 来源明确的 CC0 / CC BY 采样 |

**大模型擅长从零给你一个灵感；这个工具擅长把灵感变成能进游戏、能改、能复现的成品。** 如果你已经有旋律构思，或者你在构建一个需要稳定输出的 AI Agent，后者才是你会每天用到的那个。

---

## 它适合谁

| ✅ 适合 | ❌ 不适合 |
| --- | --- |
| 构建作曲 / 游戏开发类 **AI Agent**，需要稳定、可校验的工具调用 | 只想输入一句话就拿到一首完整歌曲 |
| **独立游戏开发者**，需要可循环、可反复修改的 BGM | 需要人声、真实乐器录音或现代流行制作 |
| 需要**离线**、**无外部依赖**、**版权干净**的环境 | 需要严格位精确的芯片仿真（NSF / VGM 回放） |
| 想把音乐当代码管理：版本控制、代码审查、CI | 不想接触任何结构化数据 |

> [!IMPORTANT]
> **它不会替你作曲。** 旋律由你（或你的 Agent）给出，它负责校验、约束、发声和反馈。`hardware` 模式是听感近似，不是 2A03 / YM2612 / BRR 的位精确仿真。示例只做过信号层面验证，没有主观听审——好不好听，请你自己判断。

---

## 能力

<table>
<tr>
<td width="50%" valign="top">

**✍️ 写**
- 跨小节延音（`hold`）与 clip 裁剪
- 动机发展：模进、倒影、逆行、增减值、装饰音
- 和声驱动：`harmonize` 生成伴奏，`arpeggiate` 生成琶音
- swing / humanize，由 seed 决定，可复现

</td>
<td width="50%" valign="top">

**🩺 诊断**
- 和声：非和弦音、低音冲突、平行五/八度、调外音
- 循环：末句是否真正回到首句
- 编曲：旋律呼吸、音区拥挤、踩镲密度、段落对比
- `describe` 文字结构，`roll` / `report` 钢琴卷帘

</td>
</tr>
<tr>
<td valign="top">

**🔊 发声**
- NES / Genesis / SNES 三种风格，11 个程序音色 + 10 件采样乐器
- `hardware` 模式：无滤波脉冲、三档占空比、16 级音量
- 单声部和弦轮换：三音和弦只占一个声部
- SNES 八抽头 FIR 回声，8 种鼓件 + 采样鼓组

</td>
<td valign="top">

**📦 交付**
- 44.1 / 48 kHz PCM16 WAV，loop 与 one-shot
- 真峰值（4× 过采样）与 BS.1770-4 响度
- 可选抖动、峰值限幅、循环交叉淡化
- `compare` 等响 A/B 导出

</td>
</tr>
</table>

### 为 AI Agent 设计

- **JSON 进，JSON 出**：所有命令返回结构化结果，错误带机器可读的 `code`
- **有意义的退出码**：`0` 成功，`1` 工具错误，`2` 乐谱不合法
- **省 token**：支持 stdin / stdout、`--compact`、`--bars 9-16` 按小节取片段
- **能自证**：校验错误附带修复值，`patch` 返回逐项 diff

```bash
cat song.json | node dist/cli.js validate - --compact
```

---

## 1.3：常用音色扩充

新增电贝斯、短奏贝斯、干净吉他、短奏吉他、钢琴和基础鼓组，三个包合计约 4.4 MB。支持 MIDI 力度分层、由 seed 控制的轮换采样，以及按包选择导入。素材分 CC0 / CC BY 3.0 / CC BY 4.0 保存，使用时保留适用的署名与许可。

[1.3 使用指南](references/v1.3-guide.zh-CN.md)

## 1.2：采样乐器与混响

新增约 1.9 MB 的 CC0 入门音色包：竖笛、钢琴、卡林巴和钟琴，12 个根音采样。支持按乐器导入、SHA-256 校验、可移植内嵌工程，以及独立发送的确定性立体声混响。原有乐谱默认保持干声兼容。

[1.2 使用指南](references/v1.2-guide.zh-CN.md)

## 快速开始

> [!NOTE]
> 需要 Node.js 22+。**macOS、Linux、Windows 均受支持**（CI 三平台逐次验证）。首次安装需要联网下载依赖与 Chromium，之后**全程离线**。

```bash
git clone https://github.com/narrastory/retro-music-toolkit.git
cd retro-music-toolkit/scripts/runtime
npm ci
npm run browser:install     # 仅渲染需要；纯编译/诊断不需要 Chromium
npm run build               # 同时给 CLI 补上可执行位（Windows 上自动跳过）
```

写、查、改、导出：

```bash
node dist/cli.js example --out song.json      # 生成一份最小可运行乐谱
node dist/cli.js validate song.json           # 完整编译检查
node dist/cli.js diagnose song.json           # 编排与和声问题
node dist/cli.js render song.json --out v1.wav

node dist/cli.js patch song.json --patch changes.json --out v2.json
node dist/cli.js render v2.json --out v2.wav --dither
node dist/cli.js compare v1.wav v2.wav --out ab.wav   # 两版等响对比
```

完整文档：[快速开始](references/quickstart.zh-CN.md) · [1.1 指南](references/v1.1-guide.zh-CN.md) · [乐谱格式](references/score-format.zh-CN.md) · [Agent 入口 SKILL.md](SKILL.md)

---

## 技术细节

<details>
<summary><b>架构与实现</b></summary>

**数据流**：JSON → Zod 严格校验 → 语义 / 采样 / 和声检查 → pattern·clip 展开（含 swing、humanize、hold、裁剪、单声部和弦轮换）→ 整数 tick 事件 → 声部分配 → Tone.js 离线合成 → 限幅 / 抖动 / 分析 → PCM16 WAV。

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
- **可复现性**：鼓噪声、humanize、random 琶音全部由 seed 派生，禁止运行期 `Math.random`。浏览器 DSP 差异仍可能导致逐样本不一致，不宣称 bit-exact。

**统计**：约 7 500 行 TypeScript；运行时依赖 4 个（`tone`、`zod`、`playwright`、`esbuild`）；135 项自动化测试（105 单元 + 28 真实音频 + 2 网页），另有试听页专项检查。

</details>

<details>
<summary><b>命令一览</b></summary>

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
<summary><b>作为库使用</b></summary>

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
<summary><b>Agent 集成</b></summary>

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

---

## 路线

- tempo map / 渐快渐慢
- MIDI 导入导出
- MML / 简写记谱前端
- 跨和弦的声部进行优化
- MCP server
- 更省内存的采样调度

欢迎在 Issue 里说明你真正需要的场景。

## 致谢与许可

- 代码与 Schema 文档：[MIT](LICENSE)
- 背景教程与生成音频：见 [NOTICE.md](NOTICE.md)。`references/source-guides/` 中的三份教程由使用者提供，版权归原作者，不适用 MIT。
- 依赖：Tone.js、Zod、Playwright、esbuild，各自遵循其许可证。
- 原有 11 个预设使用程序声音；新增入门包使用 **CC0 VCSL 录音**，随包附许可和来源哈希。不含商业游戏音色或扒带素材。

<div align="center">
<br>
<sub>8bit 的限制不是缺点，是风格。把限制用对，就是编曲。</sub>
</div>
