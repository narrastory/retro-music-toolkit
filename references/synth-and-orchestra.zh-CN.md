# 1.3 扩展：减法合成引擎与管弦/打击乐音色

这两项面向“现代复古”配乐：减法合成补上模拟合成器 pad、lead、bass、pluck 这类声音（《蔚蓝》《三角符文》一类的电子层）；`orchestra` 包补上弦乐、木管、圆号、竖琴和马林巴等原声乐器（《星露谷物语》《传说之下》一类的配器）。新增内容都是可选的，旧乐谱的渲染结果不变。

## 减法合成引擎 `subtractive`

信号链：振荡器（可叠加多个失谐声部）→ 带独立包络的滤波器 → 振幅包络；另有一个自由运行的 LFO，可以同时调制音高、滤波器和音量。

内置 4 个预设（`node dist/cli.js instruments` 可查看）：

| ID | 用途 | 要点 |
| --- | --- | --- |
| `analog-pad` | 和声铺底 | 5 声部锯齿波、慢速滤波器渐开、0.25 Hz 滤波器漂移 |
| `analog-lead` | 旋律 | 3 声部方波、快速滤波器起音；长音可配合乐谱的 vibrato |
| `analog-bass` | 低音 | 单声部锯齿波、带共振的拨弦式滤波器包络 |
| `analog-pluck` | 琶音、固定音型 | 2 声部锯齿波，滤波器在约 0.2 秒内闭合 |

轨道的 `controls.brightness`（0–1）会把截止频率在 ±1 个八度内移动，默认 0.5 时不变。

自定义乐器写在 `instrumentDefinitions` 中，`subtractive` 字段只能用于 `engine: "subtractive"`，各项都有默认值：

```json
{
  "id": "my-pad",
  "engine": "subtractive",
  "role": "harmony",
  "range": [36, 84],
  "attack": 0.3,
  "release": 1.0,
  "description": "Slow pad",
  "synthesis": { "sustain": 0.8, "volumeDb": -14 },
  "subtractive": {
    "oscillator": "sawtooth",
    "unison": { "voices": 5, "detuneCents": 18 },
    "filter": {
      "type": "lowpass", "cutoffHz": 700, "resonance": 0.8, "rolloff": -24,
      "envelopeOctaves": 1.6, "attack": 0.6, "decay": 1.4, "sustain": 0.45, "release": 1.2
    },
    "lfo": { "rateHz": 0.25, "filterOctaves": 0.35 }
  }
}
```

- `oscillator`：`sawtooth` / `square` / `triangle` / `sine`。
- `unison.voices` 为 1–7，`detuneCents` 是所有声部总的失谐宽度。
- `filter.envelopeOctaves` 表示滤波器包络能把截止频率推高多少个八度；滤波器包络的 ADSR 与振幅包络相互独立。
- `lfo.pitchCents`、`lfo.filterOctaves`、`lfo.amplitude` 默认都是 0（关闭）。`amplitude: 0.3` 表示音量在 0.7–1 之间起伏。LFO 从时间 0 开始运行，渲染结果是确定的。

## 管弦与打击乐包 `orchestra`（CC0）

10 件乐器，全部来自 Versilian Studios 的 CC0 素材库：VSCO 2 Community Edition 与 VCSL（固定到具体 commit）。

| ID | 乐器 | 音域 | 说明 |
| --- | --- | --- | --- |
| `orch-strings` | 弦乐合奏 | C2–E6 | 低音区用大提琴声部，中音区中提琴，高音区小提琴；循环长音 |
| `orch-pizzicato` | 弦乐拨奏 | C2–E6 | 两次轮换，适合固定音型 |
| `orch-flute` | 长笛 | C4–C7 | 无揉音；循环长音 |
| `orch-clarinet` | 单簧管 | D3–G6 | 实际音高；循环长音 |
| `orch-horn` | 圆号 | C2–E♭4 | 循环长音；素材在 C4 与 D5 之间没有长音，所以音域到 E♭4 为止 |
| `orch-harp` | 竖琴 | C2–C7 | 自然衰减 |
| `orch-marimba` | 马林巴 | F2–C7 | 两个力度层，带力度交叉淡化 |
| `orch-vibraphone` | 颤音琴 | F3–F6 | 软槌，余音较长 |
| `orch-ocarina` | 陶笛 | G4–D♯6 | 循环长音 |
| `orch-harpsichord` | 羽管键琴 | C2–B5 | 8′ 音栓 |

```bash
node dist/cli.js instrument-packs --pack orchestra
node dist/cli.js import-pack song.json --pack orchestra --instrument orch-strings,orch-flute,orch-harp --out song.json
```

整包约 16.6 MB / 143 个采样。单个乐谱的采样上限是 800 万声道帧，所以不要一次导入整包；常见的五件组合（弦乐、拨奏、长笛、竖琴、马林巴）放在一个乐谱里没有问题。

### 生成与校验

`scripts/prepare-orchestra.mjs` 只下载清单中列出的源文件（缓存在 `.cache/orchestra`），并对每个采样做以下处理：

- 用 `src/pitch.ts` 校验实际音高与登记的根音是否一致，八度不符直接中止。两个库的这些采样都比文件名高一个八度（竖琴除外），每个文件都只有一种偏移能通过校验。VSCO 中名为 `F#5` 的单簧管文件实测是 F5，已按实际音高登记。
- `tuningCents` 取实测平均值。长音乐器在循环段测量，因为吹奏和拉奏乐器在音头之后会有音高漂移。
- 长音乐器用 `src/loop.ts` 寻找循环点：循环长度取整数个基频周期，起点在 ±0.1 秒内搜索，使两段淡化区域的相关性最高。相关性低于 0.7 的循环（主要是带揉弦的合奏弦乐）改用等功率淡化。

`tests/orchestra.test.ts` 检查每个循环接缝的跳变不超过循环内部正常的相邻采样变化；`tests/orchestra.audio.integration.ts` 渲染 6 秒长音，检查跨越多次循环时没有音量坑，音高偏差也在 20 音分以内。

## 采样循环交叉淡化（修复）

`loopCrossfadeFrames` 之前只是登记在 schema 里，渲染时并没有生效，所以循环点是硬拼接的。现在加载缓冲区时会把淡化直接烤进采样：循环结尾最后 n 帧逐渐混合成循环起点之前的 n 帧，跳回起点时波形是连续的。新增可选字段 `loopCrossfadeShape`：`linear`（默认，适合相位对齐的循环）或 `equal-power`（适合不相关的素材）。starter 包的竖笛原本就设置了 128 帧淡化，现在这个设置会真正生效。
