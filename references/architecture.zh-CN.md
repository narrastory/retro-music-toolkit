# 工程架构与扩展路线

## 数据流

JSON → Zod 结构校验 → 引用/时间/边界/采样/和声校验 → pattern/clip 展开（含 swing、humanize、hold、裁剪）→ 整数 tick 事件 → 声部分配与循环边界检查 → Tone.js 离线合成 → 限幅/抖动/PCM 分析 → PCM16 WAV。

## 模块

| 文件 | 职责 |
| --- | --- |
| `model.ts` | Zod Schema、类型、PPQ、音高转换、`ToolkitError`、`ScoreError` |
| `compiler.ts` | 语义检查、展开、swing/humanize、`hold`、clip 裁剪、声部分配、循环边界 |
| `score-validation.ts` | 需要音色/素材层的检查：采样区域、鼓组、自动化、表达式 |
| `harmony.ts` | 和弦解析、调性、和声诊断规则 |
| `motif.ts` | 动机算子（模进/倒影/逆行/时值/力度/装饰） |
| `voicing.ts` | 和弦排列（close/open/drop2/root-position）与琶音展开 |
| `composition.ts` | 编曲骨架、变奏、回答放置、`motif`/`harmonize`/`arpeggiate` 编排 |
| `editing.ts` | 稳定 ID 编辑操作、`allIds`/`freshId` |
| `patch.ts` | 无默认值污染的深合并、原子事务、变更日志 |
| `diagnostics.ts` | 编曲启发式、按拍号推导窗口、汇总和声发现 |
| `instruments.ts` | 预设目录、鼓件时长与音高 |
| `instrument-model.ts` | 音色/采样/鼓组 Schema、采样解码 |
| `instrument-pack.ts` | 本地 WAV 打包为工程内 Base64 资源 |
| `synthesis.ts` | 程序化采样、八种合成鼓、Tone 缓冲包装 |
| `browser-engine.ts` | Tone.js 构图、调度、周期预热、裁切、接缝、交叉淡化 |
| `renderer.ts` | Node → Playwright Chromium 桥接 |
| `dsp.ts` | TPDF 抖动、前瞻峰值限幅、循环交叉淡化、确定性 PRNG |
| `analysis.ts` | 峰值/真峰值/RMS/LUFS/直流/削波/边界症状、周期比较 |
| `normalization.ts` | RMS 匹配、峰值限制 |
| `compare.ts` | 等响 A/B 拼接导出 |
| `wav.ts` | PCM16/24/32、float32 解码；`smpl` 块读写；PCM16 编码 |
| `audition.ts` / `audition-export.ts` | 标准试听谱、试听页、待人工填写的听感记录 |
| `version.ts` | 版本、Schema 版本、引擎描述的唯一来源 |
| `cli.ts` | 文件/stdio 读写、命令路由、输出保护、结构化错误 |
| `web-app.ts` | 浏览器界面：载入、渲染、试听、下载、诊断 |

Node 渲染时用 esbuild 内存打包 `browser-engine`，注入 `about:blank`，再传入序列化的编译结果。每次渲染使用独立浏览器实例，因此不会与其他任务共享 Tone 默认上下文。

## 关键设计

**鼓与旋律的声部语义不同。** 旋律轨按 `maxVoices` 分配逻辑声部，超过时按 `voicePolicy` 抢占或报错。鼓轨完全不参与声部分配：每次击打是独立 one-shot，重叠由混音与真峰值检查兜底。旧版把两者混用，导致同拍鼓互相抢断。

**release 尾音与按音冲突分开报告。** 编译器区分 `RELEASE_OVERLAP`（前一个音已松键，只是尾音还在）与 `VOICE_OVERLAP`（前一个音仍在按住）。前者是常见且无害的，后者才需要调整。

**时间变换在编译期完成。** swing 与 humanize 都作用于整数 tick，因此循环长度、循环边界冲突、诊断窗口都基于实际发声时间，播放器不需要任何时间拉伸。

**可复现性。** 鼓素材由 `seed + 轨道 ID + 鼓件` 派生；humanize 抖动由 `seed + 轨道 + clip + 重复序号 + 事件 ID` 派生；`arpeggiate` 的 random 由 `seed + 起始拍` 派生。不要在运行中调用 `Math.random`。浏览器 DSP、振荡器相位、浮点数和版本差异仍可能影响逐样本结果，不能宣称跨平台 bit-exact。

**测量分三层。** 样本峰值用于发现削波；真峰值（4× 多相 sinc）用于判断播放器是否会过载；积分响度（BS.1770-4）用于比较响度。三者用途不同，报告里分别给出。

## 循环

完整循环周期向最近整数帧对齐；各周期从该帧边界开始，避免累计小数帧漂移。渲染 `warmupCycles + 1` 轮，截取最后一轮，并对比前一轮差异。反馈延迟是否充分稳定需要看参数和实际信号。

可选的 `--loop-crossfade` 在边界做等功率交叉淡化。它隐藏咔哒声，但报告里的 `boundaryJump` / `cycleDifferenceRms` 仍然基于未淡化的信号，因此不能用淡化来掩盖音乐上没有收束的问题。

## 后续优先级

1. tempo map / 渐快渐慢：需要明确的 beat→seconds 积分映射。
2. MIDI 导入导出：作为前端/后端，不改变核心模型。
3. MML / 简写记谱：编译到当前 Schema 的规范化模型。
4. 跨和弦的声部进行优化（当前 `harmonize` 只做排列）。
5. 更高效的 BufferSource 复用，降低长曲内存开销。
6. 包装 MCP 或宿主函数工具，复用现有 API。
7. 原生芯片格式时，新增成熟仿真/驱动后端与独立硬件验证。

## 核对资料

- https://github.com/Tonejs/Tone.js
- https://tonejs.github.io/docs/15.1.22/classes/FMSynth.html
- https://tonejs.github.io/docs/15.1.22/classes/ToneBufferSource.html
- https://playwright.dev/docs/browsers
- https://zod.dev/json-schema
- ITU-R BS.1770-4（积分响度与真峰值算法）
- MIDI Sample Dump Standard 的 `smpl` 块布局

依赖接口的构建检查以锁定的实际 npm 包为准。本工程没有用「通过类型检查」替代实际音频渲染验证。

## 版本演进

- **0.2**：试听校准、局部编辑、可关闭的编曲诊断、干湿分离的循环检查。
- **0.3**：独立音色定义、内嵌多音区 WAV、连奏/滑音/弯音、轨道自动化、编曲骨架、受约束的主题变奏、回答放置。
- **1.0**：跨小节 `hold`、clip 裁剪、swing/humanize、`key` 与和弦标记、和声诊断、`motif`/`harmonize`/`arpeggiate`、八种鼓件与采样鼓组、真峰值与 LUFS、抖动与限幅、A/B 对比、stdio 与 `--compact`、`patch` 变更日志。

历史细节见 `v0.2-guide.zh-CN.md` 与 `v0.3-guide.zh-CN.md`。
