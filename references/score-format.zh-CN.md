# 乐谱格式与修改协议 v1.3

精确字段以 `scripts/runtime/schema/score.schema.json` 为准；运行 `node dist/cli.js schema` 可重新输出，`npm run schema -- --force` 可直接覆盖。本规范采用严格对象，未知字段会报错，避免 AI 拼错参数却被静默忽略。

`"1.0"`、`"1.1"`、`"1.2"`、`"1.3"` 四种 `schemaVersion` 都被接受。新工程写 `"1.3"`；旧谱无需迁移。

## 1. 顶层字段

| 字段 | 含义 |
| --- | --- |
| schemaVersion | `"1.0"` / `"1.1"` / `"1.2"` / `"1.3"` |
| title | 作品标题 |
| profile | `nes-inspired` / `genesis-inspired` / `snes-inspired` |
| tempo | 固定 BPM，范围 30–300 |
| meter | `[分子, 分母]`，分母支持 4 或 8 |
| lengthBeats | 工程总拍数，始终以四分音符为一拍 |
| seed | 0–4294967295 整数，默认 1 |
| key | 可选，`{ tonic: "C", mode: "major" \| "minor" }`，自 1.2 起 |
| harmony | 和弦标记，自 1.2 起参与诊断与伴奏生成 |
| sections | 段落注释：id、at、lengthBeats、可选 label / energy |
| tracks | 轨道、patterns 与 clips |
| mixer | 总线增益、共享延迟拍长、反馈、返回电平 |
| export | 采样率、PCM16、播放模式、尾音、预热、抖动、限幅 |

`meter`、`sections`、`harmony`、`key` 都不改变声音本身。`profile` 只影响资源预算检查，不是音色档位。

在 4/4 中，一小节为 4 拍；在 6/8 中，一小节为 3 个四分音符拍。所有位置均从 0 开始，不使用 Tone 的小节:拍:十六分字符串。

时间编译为 PPQ=960 的整数 tick。普通四分、八分、十六分与三连音都能精确表示；不能表示的时间会报 `TIME_GRID`。`gate` 为无量纲比例，其产生的松键位置取最近 tick，最少 1 tick。

### 1.1 key 与 harmony

```json
"key": { "tonic": "A", "mode": "minor" },
"harmony": [
  { "at": 0, "chord": "Am" },
  { "at": 8, "chord": "F", "lengthBeats": 4 },
  { "at": 12, "chord": "G" }
]
```

- `key` 只供诊断使用（调外音、音阶级移调），不改变合成或调音。tonic 接受 `C`、`F#`、`Bb` 等。
- `harmony` 支持 `C`、`Am`、`Fmaj7`、`G7`、`Dm7`、`Bdim`、`Gsus4`、`Cadd9`、`C/E`（斜杠低音）等常见写法，解析失败会报 `CHORD_PARSE` 并列出支持列表。
- 省略 `lengthBeats` 时，和弦持续到下一个标记或工程结尾；与下一个标记重叠会报 `HARMONY_BOUNDS`/`HARMONY_DUPLICATE`。
- 和弦标记本身不生成音符。要得到伴奏，用 `harmonize`；要从已有和弦音生成琶音，用 `arpeggiate`。

## 2. 轨道

```json
{
  "id": "lead",
  "role": "melody",
  "instrument": "pulse-lead-soft",
  "gainDb": -6,
  "pan": 0,
  "send": 0,
  "maxVoices": 1,
  "voicePolicy": "cut",
  "swing": 0,
  "swingUnit": 0.5,
  "humanize": { "timingBeats": 0.01, "velocity": 0.05 },
  "controls": { "brightness": 0.5, "pluckiness": 0.5 },
  "patterns": {},
  "clips": []
}
```

- `role` 支持 melody、bass、harmony、arp、drums、texture，只作角色声明；与预设角色不一致会给出 info 级 `ROLE_MISMATCH`。
- `maxVoices` 1–16，按同轨同时发声的实际尾音分配逻辑声部。鼓轨忽略此项（每次击打都是独立 one-shot）。
- `voicePolicy` 默认 `cut`：超出声部时抢占最早开始的旧音并给 info 诊断。设为 `error` 则直接拒绝编译。release 尾音重叠与真正的按音冲突使用不同错误码（`RELEASE_OVERLAP` vs `VOICE_OVERLAP`），修复提示也不同。
- `swing` 0–1，`swingUnit` 默认 0.5（八分音符）。`swing: 1` 把每对音符中的第二个推到 2/3 拍位置，重拍不动。位移在编译期完成，因此 `compile` 输出的 tick 已包含摆动。
- `humanize` 的时序与力度抖动由 `seed + 轨道 + clip + 重复序号 + 事件 ID` 派生，同种子必然同结果。
- `brightness` 控制轨道低通截止频率；FM 中同时改变调制指数。
- `pluckiness` 改变音符衰减时间。
- 音色推荐音域以 MIDI 数字显示。超出推荐范围是 warning，超出 MIDI 0–127 是 error。
- NES 风格声明声部预算是脉冲 2、三角 1、鼓 1；SNES 风格声明总预算 8。预算检查是近似警告，不是硬件认证。

## 3. Pattern 与事件

```json
{
  "lengthBeats": 4,
  "events": [
    { "id": "theme-n1", "kind": "note", "at": 0, "pitch": "E5", "duration": 1 },
    { "id": "theme-n2", "kind": "note", "at": 1, "pitch": "G5", "duration": 4, "hold": true }
  ]
}
```

note 支持科学音高如 C4、F#5、Bb3；八度支持 0–8，但变换后的最终 MIDI 必须在 0–127 内。默认 gate=.85、velocity=.75。

**跨小节延音：`hold: true`。** 名义音长可以超出 pattern 边界，此时音符持续到同轨下一个事件（或 pattern 结尾）再松键。这是 1.2 新增能力，用来写真正跨小节的旋律长音。

```json
{ "id": "n", "kind": "note", "at": 2, "pitch": "C5", "duration": 2, "hold": true }
```

不设 `hold` 的音符若超出 pattern 边界会报 `EVENT_BOUNDS`，并在 `suggestion` 中给出 `{ hold: true, maxDuration }`。

可选颤音：

```json
"vibrato": { "depthCents": 12, "rateHz": 5.5, "delayBeats": 0.5 }
```

鼓事件：

```json
{ "id": "drum-h1", "kind": "hit", "at": 0, "sound": "kick", "detuneCents": 0 }
```

`sound` 支持 kick、snare、hat、openhat、tom、crash、rim、clap。`detuneCents` 可按次微调音高（尤其适合 tom / kick）。鼓不使用 `duration`，其时长由音色决定。

## 4. Clip

```json
{ "id": "lead-a2", "pattern": "theme", "at": 16, "repeats": 2, "lengthBeats": 6, "transpose": 0, "velocityScale": 0.9, "mute": false }
```

- `repeats` 重复整段 pattern，包括尾部休止。
- `lengthBeats`（1.2 新增）只播放前若干拍，用于从长 pattern 中裁出片段，避免为每个变体复制 pattern。
- `transpose` 是半音整数；`velocityScale` 相乘后截到 0–1；`mute` 的 clip 不产生事件。

一个三音和弦用三个同一 `at` 的 note 表达，需要把该轨 `maxVoices` 设为 3。

## 5. ID 与局部修改

所有 section、track、clip 和源 event 的 ID 在工程内全局唯一；pattern 名字仅在轨道内唯一。展开事件 ID 为 `clipId/repeatIndex/sourceEventId`。错误包含展开 ID，按 sourceId 可回到谱子源事件。

`patch` 接受 `{ "baseHash": "可选的 SHA-256", "operations": [...] }`。baseHash 是原始输入文件字节的 SHA-256，与 validate 返回的 sourceHash 相同。

| op | 定位字段 | 修改内容 |
| --- | --- | --- |
| set-note | trackId、pattern、eventId | at、pitch、duration、gate、velocity、hold、vibrato、articulation、expression |
| set-hit | trackId、pattern、eventId | at、sound、velocity、detuneCents |
| set-clip | trackId、clipId | pattern、at、repeats、lengthBeats、transpose、velocityScale、mute |
| set-track | trackId | role、instrument、gainDb、pan、send、maxVoices、voicePolicy、swing、swingUnit、humanize、controls、automation |
| set-section | sectionId | label、energy、at、lengthBeats |
| set-harmony | 无 | 整组 harmony，或在某个拍点插入单个标记 |
| set-song | 无 | title、tempo、meter、mixer、export、seed、key、profile |
| clone-pattern | trackId、pattern、newPattern | 克隆 pattern，源音符 ID 增加新 pattern 名前缀 |
| insert-events / delete-events | trackId、pattern | 批量插入或删除事件 |
| clone-pattern-for-clip | trackId、clipId、newPattern | 复制并只重定向该 clip |
| transpose-phrase | trackId、pattern、fromBeat、toBeat | 按音高起始点选区移调 |
| scale-rhythm | trackId、pattern、factor | 缩放节奏与所有依附的时长字段 |
| quantize | trackId、pattern、grid、strength | 量化到网格，`strength` 0–1 部分量化，可只处理音符 |
| rename-pattern / delete-pattern | trackId、pattern | 重命名（同步改引用）／删除（要求无引用） |
| duplicate-section | sectionId、newSectionId、at | 复制段落内全部 clip 与和弦标记 |

set **只修改显式提供的字段，嵌套对象递归合并**。只修改 pitch 不会重置 gate/velocity；只修改 `mixer.feedback` 不会重置 `masterDb`。

`patch` 现在同时返回变更日志：`{ operationCount, changes: [{ index, op, path, detail }], truncated, summary, diagnostics }`。`path` 形如 `tracks[0].patterns.A.events[0].pitch`，`detail` 形如 `"C5" → "D5"`。API 侧用 `patchScoreWithReport()` 取得报告；`patchScore()` 保持只返回乐谱的旧签名。

patch 原子地作用在内存副本，完整编译成功后才返回；失败不修改原工程。CLI 要求新输出路径，默认不覆盖原文件。

## 6. 输出与信号约束

默认 44.1 kHz / PCM16 / 立体声。48 kHz 也支持。

- one-shot：输出音乐主体加 tailSeconds，默认 2 秒。
- loop：预热 warmupCycles 轮后截取下一整轮，默认预热 4 轮。
- 完整循环帧数为 `round(lengthBeats * 60 / tempo * sampleRate)`。
- 部分渲染先从工程零点建立全部此前状态，再裁切。

`export` 中的两个可选处理（默认关闭）：

```json
"export": {
  "dither": true,
  "limiter": { "enabled": true, "ceilingDbfs": -1, "lookaheadSeconds": 0.005 }
}
```

- `dither`：PCM16 量化前施加确定性 TPDF 抖动，适合安静尾音较多的曲子。
- `limiter`：前瞻峰值限幅，仅在需要固定峰值上限时启用；它不是母带压缩，报告会给出触发样本数与最大衰减。

分析报告现在包含：样本峰值、**真峰值（4× 多相 sinc 过采样，BS.1770 Annex 2 思路）**、RMS、**积分响度（BS.1770-4，400 ms 块、75% 重叠、绝对/相对门限）**、直流、削波与非有限样本数、边界跳变。

- 不做自动响度标准化（除非显式 `--match-rms`）、LUFS 归一化或母带处理。
- WAV 编码会把越界样本夹到 [-1,1]；请以 `truePeakDbfs` 而非 `peakDbfs` 判断是否安全。
- 不添加抖动时不做抖动；不支持 RF64 或 WAV 内嵌 loop 标记。循环帧数位于报告，游戏端需按此设置。
- `analyze` 还会报告输入 WAV 自带的 `smpl` 循环点与根音（如果存在）。

资源上限：32 轨、100,000 展开事件、每次渲染 500,000 周期展开事件、16,000,000 帧/声道及 120 秒渲染超时。

## 7. 采样与音色定义（1.1 起）

`instrumentDefinitions` + `sampleAssets` 让自定义音色随工程走。

- 采样区域字段：lowMidi/highMidi/rootMidi、assetId、tuningCents、gainDb、loopStartFrame/loopEndFrame、`loopCrossfadeFrames`（1.2 新增，用于隐藏循环点咔哒）。
- **采样鼓组**（1.2 新增）：`engine: "drums"` 的音色可以用 `drumKit.slots` 为每个 `sound` 指定独立采样、增益、调音与起始帧；未提供的鼓件回退到内置合成鼓，并在诊断中提示 `DRUM_SLOT_MISSING`。
- `import-instrument` 现在接受 PCM16 / PCM24 / PCM32 / float32 WAV，并会读取文件里的 `smpl` 块，自动填入根音与循环点（仍应人工确认）。
- 单个资产上限 768000 帧；工程总计 400 万声道帧。

详见 `v0.3-guide.zh-CN.md`。
