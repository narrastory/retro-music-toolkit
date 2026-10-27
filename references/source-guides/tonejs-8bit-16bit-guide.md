# 用 Tone.js 制作 8Bit 与 16Bit 音乐

> **来源与版权**：本文由工具包使用者提供，作为背景教程随 `references/` 一并分发，用于阅读参考。
> 其著作权归原作者所有，**不适用本工程根目录 MIT 许可证**。若需再分发、摘编或商用，请先确认原作者授权。
> 工具包的代码与 Schema 文档以根目录 `LICENSE` 为准。
> 面向有经验的 Web 开发者与具有作曲基础的读者。  
> 文档核对日期：2026-10-27。  
> 示例基线：**Tone.js 15.1.22**，TypeScript，浏览器 Web Audio。  
> 目标：从乐谱事件、音色设计到循环播放与 WAV 导出，搭建可维护的复古音乐制作工作流。

## 阅读说明与版本边界

本文不展开 JavaScript、工程搭建、和弦和节拍的入门解释，而集中处理 Tone.js 的时间模型、音频图、复古音色与工程边界。

核对时，npm 的 `latest` 标签对应 `15.1.22`；`next` 对应开发版本，不应仅比较版本号大小来选择。安装时固定稳定版，并提交 lockfile。今后复现时，可用 `npm view tone dist-tags --json` 再确认标签。[1][2]

本文采用 `Tone.getTransport()`、`Tone.getDestination()`、`.toDestination()` 等当前写法。旧 Wiki 可能出现 `Tone.Transport`、`.toMaster()` 等历史接口；阅读时以固定版本 API 和安装包类型定义为准。不要将 r11、r13、14.x、15.x 示例直接混拼。

这是**风格制作教程**，不是 NES APU、YM2612 或 S-DSP 的位精确仿真教程。示例能制作复古音乐，但不会输出 NSF、SPC 或 VGM，也不会生成能直接在原机运行的音乐驱动。

## 目录

1. 建立正确的制作目标
2. 工程初始化与第一声
3. 时间模型与调度
4. 8Bit 音色设计
5. 8Bit 编曲与声部预算
6. 16Bit 路线一：FM
7. 16Bit 路线二：采样
8. 共享乐谱与渲染架构
9. 完整项目：三种音色模式
10. 混音、循环与导出
11. 应用集成与性能
12. 常见问题与练习
13. 官方资料索引与验证说明

---

## 1. 建立正确的制作目标

### 1.1 不要把风格等同于位深

| 目标 | 应该优先控制的东西 |
| --- | --- |
| NES 启发的 8Bit 风格 | 少量声部、脉冲波与三角波、噪声节奏、音符门长、琶音 |
| Mega Drive 启发的 16Bit 风格 | FM 音色、瞬态、调制包络、低音与节奏组织 |
| SNES 启发的 16Bit 风格 | 短采样、音域分区、包络、持续音循环与空间处理 |
| 低保真效果 | 降位深、降采样率、失真；这是独立的制作维度 |

在 44.1 kHz、16 位 WAV 中保存 8Bit 风格作品完全合理。给普通钢琴录音加 BitCrusher，得到的是一种效果处理，不能替代复古编曲与声音设计。

### 1.2 Tone.js 在系统中承担什么

可以把音乐程序拆为四层：

- **Score**：时间、音高、时值、力度、轨道、演奏参数。
- **Instrument**：合成器或采样器，将事件变成声音。
- **Mixer**：轨道增益、声像、发送效果、总线。
- **Renderer**：实时播放或离线渲染。

Tone.js 提供后面几层的许多积木，但不会自动把一个乐谱变成优秀作品。[3]

---

## 2. 工程初始化与第一声

### 2.1 最小工程

下面使用最直接的文件结构，完整项目见第 9 章。需要受当前 Vite 支持的 Node.js 版本。

```bash
mkdir retro-tone
cd retro-tone
npm init -y
npm install --save-exact tone@15.1.22
npm install --save-dev typescript vite
```

在 `package.json` 中增加：

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "check": "tsc --noEmit",
    "build": "tsc --noEmit && vite build"
  }
}
```

这是需要合并的字段，不是让你删除现有 dependencies。使用本地 HTTP 服务，不要直接双击 HTML 以 `file://` 运行。

### 2.2 解锁音频

在项目模块中：

```ts
import * as Tone from "tone";

const synth = new Tone.Synth({
  oscillator: { type: "square" },
  envelope: {
    attack: 0.002,
    decay: 0.08,
    sustain: 0.4,
    release: 0.02,
  },
  volume: -15,
}).toDestination();

// 页面需要存在 #play 按钮。
document.querySelector("#play")!.addEventListener("click", async () => {
  await Tone.start();
  synth.triggerAttackRelease("A4", "8n", Tone.now(), 0.75);
});
```

`Tone.start()` 应放在用户点击等手势内。不要先等待下载再尝试首次解锁。离开组件或不再使用时调用 `synth.dispose()`。

`Synth` 基本上是振荡器加振幅包络；默认是单音合成器。和弦需要 `PolySynth` 分配多个声部，而不是向单音 `Synth` 塞入音高数组。[4][5]

---

## 3. 时间模型与调度

### 3.1 分清三种时间

| 时间 | 示例 | 用途 |
| --- | --- | --- |
| 音频上下文时间 | 调度回调中的 `time` | 最终传给音符、包络、参数自动化 |
| Transport 位置 | `"2:1:0"`、事件的拍位置 | 乐曲结构、循环、暂停与恢复 |
| UI / JS 时间 | `requestAnimationFrame`、定时器 | 更新界面、回收资源 |

Transport 回调可能提前执行，以便将声音排入音频时间线。**回调执行的 JS 时刻不等于声音实际发生的时刻**。因此：

```ts
const transport = Tone.getTransport();
transport.bpm.value = 132;

const id = transport.schedule(time => {
  synth.triggerAttackRelease("A4", "16n", time, 0.8);
}, "0:0:0");

// 如需移除此事件：transport.clear(id);
transport.start("+0.05");
```

不要在回调中省略 `time` 再重新调用 `Tone.now()`，否则会丢掉已有调度的准确时间。`setInterval` 不应该承担音符触发的主时钟。[6]

### 3.2 时间记号

- `"4n"`：四分音符。
- `"8n"`：八分音符。
- `"16n"`：十六分音符。
- `"8t"`：八分音符三连音。
- `"1m"`：一小节，受拍号影响。
- `"2:1:0"`：从零计数的第 2 小节、第 1 拍、第 0 个十六分位置。
- `"+0.1"`：相对时间；只在接受这种语义的调度接口中使用。
- 数字：许多 Time 参数中的数字表示秒，不是拍。

尤其注意：`transport.schedule(fn, 4)` 是位于 Transport 第 4 秒的事件，不是第 4 拍。项目可以统一存储四分音符拍数，再由渲染层转换。

### 3.3 Part 与 Sequence 怎么选

`Part` 适合包含任意起点和长度的乐谱事件：

```ts
const part = new Tone.Part((time, event) => {
  synth.triggerAttackRelease(event.note, event.duration, time, event.velocity);
}, [
  { time: "0:0:0", note: "A4", duration: "8n", velocity: 0.8 },
  { time: "0:1:0", note: "C5", duration: "16n", velocity: 0.6 },
]);
part.start(0);
// 不再使用时：part.dispose();
```

`Sequence` 更适合规则网格，例如十六步鼓机。二者都是调度抽象，不是音色。[7][8]

### 3.4 BPM 改变的两个层次

以拍或 tick 表示的事件位置可以随 Transport BPM 改变。提前转换成秒并存储的事件，不再具有同样的拍语义。

本教程完整案例采用**固定 BPM → 编译成秒**，便于让实时和离线模式共享逻辑。若你要支持变速、tempo map，应保存拍位置，实时层用 tick / Transport 音乐时间调度，离线层再对 tempo map 积分得到秒数。不要把示例中的 BPM 做成可随意拖动的滑块后，期待所有秒数自动重算。

---

## 4. 8Bit 音色设计

### 4.1 从三个角色开始

先创建一条主奏、一条低音和一条噪声节奏，再加入第二条脉冲声部。限制声音数量，能迫使编曲中的音高、节奏、音区互相让位。

这是一种 NES 启发的制作约束；Web Audio 不会替你执行原机的通道数、定时器分辨率或混音规律。

### 4.2 脉冲波：先掌握包络，再改变宽度

```ts
const lead = new Tone.Synth({
  oscillator: { type: "pulse", width: 0 },
  envelope: {
    attack: 0.002,
    decay: 0.06,
    sustain: 0.55,
    release: 0.02,
  },
  volume: -12,
}).toDestination();
```

`width: 0` 对应对称方波。**Tone.js 的 width 不是直接填写 0～1 占空比的字段**；不要把 `0.25` 当作“25% duty”。可以先试听 `-0.5`、`0`、`0.5` 的差异，但若要匹配硬件占空比档位，应核对底层实现并做波形测量。[9][10]

需要对宽度做自动化时，推荐显式使用 `PulseOscillator` 和 `AmplitudeEnvelope`：

```ts
const amp = new Tone.AmplitudeEnvelope({
  attack: 0.002, decay: 0.05, sustain: 0.5, release: 0.02,
}).toDestination();
const pulse = new Tone.PulseOscillator({ frequency: 440, width: 0 });
pulse.connect(amp);
pulse.start();

// 在用户手势解锁后执行：
const at = Tone.now() + 0.05;
pulse.width.setValueAtTime(-0.5, at);
pulse.width.linearRampToValueAtTime(0.5, at + 0.4);
amp.triggerAttackRelease(0.45, at, 0.7);
```

它适合展示 PWM 的声音变化；连续 PWM 不是所有老声音芯片都具备的行为。此处使用持续运行的振荡器，改变音高时用 `pulse.frequency.setValueAtTime(...)`，不必每个音符重新创建节点。不再使用时分别释放两个节点。

### 4.3 包络与门长决定“像不像在演奏”

| 角色 | 可尝试的起点，单位秒 | 意图 |
| --- | --- | --- |
| 主奏 | A 0.002 / D 0.06 / S 0.55 / R 0.02 | 起音明确，尾部干净 |
| 琶音 | A 0.002 / D 0.035 / S 0.15 / R 0.012 | 紧凑、弱化持续部分 |
| 低音 | A 0.003 / D 0.06 / S 0.8 / R 0.025 | 稳定支撑 |

这些是现代合成器上的试听起点，不是芯片寄存器参数。`sustain` 是电平比例，其余三项是时间。

如果两音起点相隔 0.25 秒，第一音 gate 可以是 0.17 秒，留出空隙。`triggerAttackRelease` 的 duration 是 attack 到 release 触发之间的间隔，不代表包含 release 后的总声音长度。[11]

### 4.4 三角波低音

使用 `Synth` 的 `triangle` 波形，优先让低音线条明确。不要为了“厚”叠加多层低频，再靠总线限幅补救。

通用三角振荡器不会自动复现 NES 三角声道的阶梯形波、音量控制方式等特性。先接受它是一种风格近似。

### 4.5 噪声鼓与接口差异

```ts
const drum = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
  volume: -18,
}).toDestination();

drum.triggerAttackRelease(0.05, Tone.now(), 0.5);
```

`NoiseSynth.triggerAttackRelease(duration, time, velocity)` **没有 note 参数**。将 `"C2"` 填进去是接口用错。[12]

短噪声适合 hi-hat，较长噪声配合滤波可以设计 snare。需要更有低频冲击的 kick，可使用短三角波或正弦波，配合快速向下的音高包络；但要将它计入声部预算。白噪声也不等同于原机 LFSR 噪声。

### 4.6 滑音、颤音、音高自动化

对单音合成器可以在音符触发后控制 `frequency` 或 `detune`：

```ts
const at = Tone.now() + 0.05;
lead.triggerAttackRelease("A4", 0.35, at, 0.8);
lead.detune.setValueAtTime(-100, at);
lead.detune.linearRampToValueAtTime(0, at + 0.04);
```

这会在起音处形成一个半音的上滑。对同一个单音 voice 的自动化会影响后续声音，因此每个新音都应初始化必要参数，不能让上一音的状态泄漏。

---

## 5. 8Bit 编曲与声部预算

### 5.1 先限制为四个逻辑声部

| 声部 | 任务 | 常见冲突 |
| --- | --- | --- |
| Pulse 1 | 主旋律 | 被同音区伴奏盖住 |
| Pulse 2 | 琶音、回答句、对位 | 音符太密，占满所有空隙 |
| Triangle | 低音 | 与额外 kick 抢低频或抢声道 |
| Noise | 打击乐 | hat 与 snare 无限制叠加 |

这是练习约束，不包括所有扩展芯片配置。严格复现时还要考虑 DPCM、硬件规则与真实混音。

### 5.2 琶音有两种不同用法

- **伴奏型琶音**：将和弦音分解成八分或十六分节奏。
- **高速轮换音高**：更密集地轮换和弦音，形成复古的和声暗示。

先用 16 分音符建立清晰律动，再试 32 分或更快。高速并不自动更好听；太快时会变成粗糙的调制质感。单音声部的 gate 加 release 应尽量短于相邻音的间隔。

### 5.3 做一段循环的推荐顺序

1. 只写主旋律，让两小节动机能够独立成立。
2. 加低音，明确和声与推进感。
3. 加节奏，区分重拍、反拍与过门。
4. 加第二脉冲声部，优先补主旋律的空白。
5. 第二个四小节改变节奏或末尾音型。
6. 单独试听最后两拍接开头两拍。

如果必须把所有轨道都开得很响才觉得丰富，先检查音区与节奏组织。混音不应该承担所有编曲问题。

---

## 6. 16Bit 路线一：FM

### 6.1 Tone.FMSynth 的定位

`FMSynth` 是载波与调制器组成的基础 FM voice，可以通过频率比、调制指数和两套包络做出鲜明的电子音色。[13]

**它不是完整 YM2612 仿真。** 不能因为用了 FM，就声称已经获得了 Mega Drive 的芯片行为；多算子算法、反馈、包络量化、通道结构等需要额外实现。

### 6.2 一个 FM 主奏起点

```ts
const fm = new Tone.FMSynth({
  harmonicity: 2,
  modulationIndex: 3,
  oscillator: { type: "sine" },
  modulation: { type: "sine" },
  envelope: {
    attack: 0.003, decay: 0.25, sustain: 0.25, release: 0.12,
  },
  modulationEnvelope: {
    attack: 0.002, decay: 0.12, sustain: 0.1, release: 0.08,
  },
  volume: -12,
}).toDestination();
```

试听时一次只改一个维度：

| 参数 | 调整策略 |
| --- | --- |
| `harmonicity` | 从 1、2、3 开始，听频谱与音高感，再探索非整数比 |
| `modulationIndex` | 从低到高，观察明亮、粗糙程度的变化 |
| `modulationEnvelope.decay` | 缩短可让起音亮、持续部分更柔和 |
| `envelope.release` | 决定尾音长度与声部拥挤程度 |

上述听感是调音方向，不是固定映射。参数之间会互相影响，变化也并非总是单调。

### 6.3 FM 和弦与复音

```ts
const keys = new Tone.PolySynth(Tone.FMSynth, {
  harmonicity: 1,
  modulationIndex: 1.5,
  envelope: { attack: 0.003, decay: 0.5, sustain: 0.1, release: 0.3 },
  modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.1 },
}).toDestination();
keys.maxPolyphony = 6;
keys.volume.value = -18;
keys.triggerAttackRelease(["A3", "C4", "E4"], 0.5, Tone.now(), 0.6);
```

`maxPolyphony` 是上限；不要假定达到上限时一定会按你希望的策略偷音。重要旋律应该保留独立 voice。`PolySynth` 负责 voice 管理，本身不是另一种合成算法。[5]

---

## 7. 16Bit 路线二：采样

### 7.1 Sampler 与 Player

| 组件 | 优先用途 |
| --- | --- |
| `Sampler` | 映射根音采样，按音符变调演奏，内建复音 |
| `Player` | 播放片段、鼓采样、已有循环，可控制循环区间与播放速率 |

`Sampler` 可以用附近的根音录音补齐音高，但大幅变调会改变瞬态、时长与音色。它不是自动保留时长的高质量 time-stretch。[14][15]

### 7.2 加载自己的乐器采样

假设项目里有：

```text
public/
  samples/
    pluck-C3.wav
    pluck-C4.wav
    pluck-C5.wav
```

```ts
const pluck = new Tone.Sampler({
  urls: {
    C3: "pluck-C3.wav",
    C4: "pluck-C4.wav",
    C5: "pluck-C5.wav",
  },
  baseUrl: "/samples/",
  attack: 0.002,
  release: 0.08,
  volume: -12,
}).toDestination();

await Tone.loaded();
pluck.triggerAttackRelease(["A3", "C4", "E4"], 0.4, Tone.now(), 0.65);
```

这些文件需要你自行提供；不是 Tone.js 安装包附带的乐器。跨域加载需要资源服务器允许 CORS，且要处理加载失败。资源许可证与 Tone.js 代码许可证分别核查。

### 7.3 靠什么形成短采样时代的质感

建议从这些制作选择入手：

- 使用短而有辨识度的采样，避免给所有声音加载很长的现代多麦录音。
- 控制根音覆盖范围，保留适度变调质感。
- 简化力度层与奏法，但保留乐句中的力度变化。
- 对持续音设置合理循环点，而不是让短文件播完后突然静音。
- 少量共享空间效果，让声音处于同一个场景。
- 明确复音预算，尤其注意长 release 与和弦叠加。

这些是风格方向，不是 SNES 硬件参数。降低音质不应成为唯一手段。

### 7.4 持续音循环：15.1.22 的重要边界

本文固定的 `Sampler` API 没有公开的每 voice 采样循环点配置。不要照搬开发分支里可能出现的 `loop` 等选项。

若需要循环持续音，可以使用 `Player` 的循环能力，或自己实现基于 AudioBufferSourceNode 的 voice：播放 attack → 进入 sustain loop → note-off 后释放。后者需要维护根音、播放速率、voice 分配与包络。

```ts
const sustain = new Tone.Player({
  url: "/samples/sustain-C4.wav",
  loop: true,
  loopStart: 0.12,
  loopEnd: 0.48,
  fadeIn: 0.005,
  fadeOut: 0.03,
}).toDestination();
await Tone.loaded();
const at = Tone.now() + 0.05;
sustain.start(at);
sustain.stop(at + 1);
```

循环区间仅是示意，必须根据实际采样设置；不存在“任意采样都适用”的通用循环点。`fadeIn/fadeOut` 也不等于自动完成循环接缝交叉淡化。[15]

### 7.5 鼓采样通常交给 Player

无需按音高演奏的鼓声可以按鼓型分配 `Player` / `Players`。快速重触发与重叠的需求，应明确测试；不要把一个持续循环的 Player 同时当成多个独立 voice 使用。

---

## 8. 共享乐谱与渲染架构

### 8.1 乐谱不要引用音频节点

建议的数据结构：

```ts
type NoteEvent = {
  beat: number;
  duration: number;
  note: string;
  velocity: number;
  track: "lead" | "arp" | "bass" | "drum";
};
```

音色预设与效果配置另存。这样同一份乐谱可以用于 8Bit、FM、采样模式，也可以独立导出 JSON。

完整案例固定为 4/4、132 BPM、8 小节，和声为 Am–F–C–G，重复一轮并改变结尾。秒数换算：

```ts
const seconds = (beats: number) => beats * 60 / BPM;
```

### 8.2 实时与离线共享什么

共享 `createRack(mode)` 和 `rack.play(event, time)`：

- 实时：Transport 回调提供精确 `time`。
- 离线：从乐谱直接计算绝对秒数。

离线渲染可以一次预先安排所有事件，不需要 JS 定时器，也不必强行启动离线 Transport。若使用离线 Transport，则必须启动**该离线上下文的** transport。[16]

### 8.3 复现边界

事件、音色参数与采样都固定时，仍不应承诺跨浏览器 bit-identical。通用噪声源、DSP 实现、采样率可能造成差异。

若需要导出可复现的噪声节奏，使用固定种子的 PRNG 预生成噪声缓冲，并作为资源保存；不要依赖每次运行都不同的随机输入。

---

## 9. 完整项目：同一首乐曲的三种模式

### 9.1 你将获得什么

- 8 小节 Am–F–C–G 循环。
- 四个逻辑轨道：主奏、琶音、低音、噪声鼓。
- 三种主奏模式：脉冲波、FM、短采样。
- 从头播放、停止、离线导出 44.1 kHz / 16 位立体声 WAV。
- 无需额外乐器素材；采样模式使用程序生成的拨弦采样。

**采样模式是对采样工作流的自包含演示，不是录音钢琴，也不是完整 SNES 音色库。** 三种模式共用伴奏，有意让你先听清主奏差异；正式作品应继续重做各风格的鼓、伴奏与空间设计。

复制下面所有文件到第 2 章创建的目录，执行 `npm run check`、`npm run dev`。本案例暂不实现暂停恢复、MIDI 输入、tempo map 或多工程混合。

目录如下：

```text
retro-tone/
  package.json
  tsconfig.json
  index.html
  main.ts
  score.ts
  engine.ts
  wav.ts
```

### 9.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noEmit": true, "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["*.ts"]
}

```

### 9.3 `index.html`

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Tone.js 复古音乐实验</title></head>
<body>
  <h1>Tone.js 8Bit / 16Bit</h1>
  <select id="mode">
    <option value="8bit">8Bit：脉冲波主奏</option>
    <option value="fm16">16Bit：FM 主奏</option>
    <option value="sample16">16Bit：短采样主奏</option>
  </select>
  <button id="play">从头循环播放</button>
  <button id="stop">停止</button>
  <button id="export">导出 WAV</button>
  <p id="status">准备就绪</p>
  <script type="module" src="/main.ts"></script>
</body>
</html>

```

### 9.4 `score.ts`

```ts
export type Mode = "8bit" | "fm16" | "sample16";
export type Track = "lead" | "arp" | "bass" | "drum";
export type NoteEvent = {
  beat: number;
  duration: number;
  note: string;
  velocity: number;
  track: Track;
};
export const BPM = 132;
export const BARS = 8;
export const TOTAL_BEATS = BARS * 4;
export const LOOP_SECONDS = TOTAL_BEATS * 60 / BPM;
export const seconds = (beats: number) => beats * 60 / BPM;

export function makeScore(): NoteEvent[] {
  const events: NoteEvent[] = [];
  const add = (track: Track, beat: number, note: string,
    duration: number, velocity = 0.7) => {
    events.push({ track, beat, note, duration, velocity });
  };
  const harmony = [
    { root: "A2", chord: ["A3", "C4", "E4"] },
    { root: "F2", chord: ["A3", "C4", "F4"] },
    { root: "C3", chord: ["G3", "C4", "E4"] },
    { root: "G2", chord: ["G3", "B3", "D4"] },
  ];
  const melodies = [
    ["E5", "A5", "G5", "E5", "C5", "E5"],
    ["C5", "F5", "E5", "C5", "A4", "C5"],
    ["G4", "C5", "E5", "G5", "E5", "C5"],
    ["D5", "G5", "F5", "D5", "B4", "G4"],
  ];
  const onsets = [0, 0.5, 1, 2, 2.5, 3];
  for (let bar = 0; bar < BARS; bar++) {
    const start = bar * 4;
    const h = harmony[bar % 4];
    const melody = [...melodies[bar % 4]];
    if (bar === 7) melody[5] = "B4"; // 属功能，回到开头 A 小调
    melody.forEach((note, i) => add("lead", start + onsets[i], note,
      i === 5 ? 0.65 : 0.32, i === 0 ? 0.85 : 0.7));
    for (let step = 0; step < 16; step++) {
      add("arp", start + step / 4, h.chord[step % 3], 0.17, 0.35);
    }
    for (let beat = 0; beat < 4; beat++) {
      add("bass", start + beat, h.root, 0.65, beat === 0 ? 0.85 : 0.65);
    }
    // 一个噪声声部；C2/E2 在此仅作为鼓型标签，不代表噪声音高。
    for (let step = 0; step < 8; step++) {
      add("drum", start + step / 2, step % 4 === 2 ? "C2" : "E2",
        step % 4 === 2 ? 0.12 : 0.035, step % 4 === 2 ? 0.65 : 0.25);
    }
  }
  return events.sort((a, b) => a.beat - b.beat);
}

```

### 9.5 `engine.ts`

```ts
import * as Tone from "tone";
import { type Mode, type NoteEvent, seconds } from "./score";

// 自行生成短拨弦采样，供教学使用；不是钢琴录音，也不是 SNES 仿真。
function makePluckSample(midi: number): Tone.ToneAudioBuffer {
  const sr = Tone.getContext().sampleRate;
  const data = new Float32Array(Math.floor(sr * 1.5));
  const f = 440 * 2 ** ((midi - 69) / 12);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const attack = Math.min(1, t / 0.003);
    let value = 0;
    for (let h = 1; h <= 8; h++) {
      if (f * h >= sr / 2) break;
      value += Math.sin(2 * Math.PI * f * h * t)
        * Math.exp(-t * (3 + h)) / (h * h);
    }
    data[i] = value * attack * 0.55;
  }
  // 尾端淡出，避免采样文件结束处突然截断。
  const fade = Math.floor(sr * 0.02);
  for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
  return Tone.ToneAudioBuffer.fromArray(data);
}

export function createRack(mode: Mode) {
  const owned: { dispose(): unknown }[] = [];
  function own<T extends { dispose(): unknown }>(node: T): T {
    owned.push(node);
    return node;
  }
  const limiter = own(new Tone.Limiter(-1)).toDestination();
  const master = own(new Tone.Gain(0.6)).connect(limiter);
  const leadBus = own(new Tone.Gain(1)).connect(master);
  const arpBus = own(new Tone.Gain(0.5)).connect(master);
  const bassBus = own(new Tone.Gain(0.85)).connect(master);
  const drumBus = own(new Tone.Gain(0.35)).connect(master);

  // 16 位风格才加入轻量空间感；这不是芯片硬件效果的精确复现。
  if (mode !== "8bit") {
    const delay = own(new Tone.FeedbackDelay({
      delayTime: 0.17, feedback: 0.2, wet: 1,
    }));
    const send = own(new Tone.Gain(0.12));
    leadBus.connect(send);
    send.connect(delay);
    delay.connect(master);
  }

  const lead = mode === "8bit"
    ? own(new Tone.Synth({
        oscillator: { type: "pulse", width: 0 },
        envelope: { attack: 0.002, decay: 0.06, sustain: 0.55, release: 0.02 },
        volume: -12,
      })).connect(leadBus)
    : mode === "fm16"
    ? own(new Tone.FMSynth({
        harmonicity: 2, modulationIndex: 3,
        oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.003, decay: 0.25, sustain: 0.25, release: 0.12 },
        modulationEnvelope: { attack: 0.002, decay: 0.12, sustain: 0.1, release: 0.08 },
        volume: -12,
      })).connect(leadBus)
    : (() => {
        const samples = {
          C4: own(makePluckSample(60)),
          C5: own(makePluckSample(72)),
          C6: own(makePluckSample(84)),
        };
        return own(new Tone.Sampler({
          urls: samples, attack: 0.002, release: 0.08, volume: -10,
        })).connect(leadBus);
      })();

  const arp = own(new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.002, decay: 0.035, sustain: 0.15, release: 0.012 },
    volume: -19,
  })).connect(arpBus);
  const bass = own(new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.003, decay: 0.06, sustain: 0.8, release: 0.025 },
    volume: -10,
  })).connect(bassBus);
  const noise = own(new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
    volume: -16,
  })).connect(drumBus);

  function play(event: NoteEvent, time: number) {
    const duration = seconds(event.duration);
    if (event.track === "drum") {
      // NoiseSynth 的第一个参数是时值，不是音高。
      noise.triggerAttackRelease(duration, time, event.velocity);
    } else {
      const instrument = event.track === "lead" ? lead
        : event.track === "arp" ? arp : bass;
      instrument.triggerAttackRelease(event.note, duration, time, event.velocity);
    }
  }

  function silence(time: number) {
    master.gain.cancelScheduledValues(time);
    master.gain.setValueAtTime(master.gain.value, time);
    master.gain.linearRampToValueAtTime(0, time + 0.02);
  }
  return {
    play, silence,
    dispose() {
      for (const node of owned.reverse()) node.dispose();
    },
  };
}

```

### 9.6 `wav.ts`

```ts
export function encodeWav16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  if (!channels.length || channels.some(c => c.length !== channels[0].length)) {
    throw new Error("声道不能为空，且长度必须一致");
  }
  const count = channels.length;
  const frames = channels[0].length;
  const dataBytes = frames * count * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < count; channel++) {
      const value = channels[channel][frame];
      const x = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      view.setInt16(at, Math.round(x < 0 ? x * 32768 : x * 32767), true);
      at += 2;
    }
  }
  return buffer;
}

export function downloadWav(channels: Float32Array[], sampleRate: number, name: string) {
  const blob = new Blob([encodeWav16(channels, sampleRate)], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  // 只负责资源回收，不用于音乐计时。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

```

### 9.7 `main.ts`

```ts
import * as Tone from "tone";
import { createRack } from "./engine";
import { BPM, LOOP_SECONDS, makeScore, seconds, type Mode } from "./score";
import { downloadWav } from "./wav";

type Rack = ReturnType<typeof createRack>;
let liveRack: Rack | undefined;
let busy = false;
const score = makeScore();
const modeSelect = document.querySelector<HTMLSelectElement>("#mode")!;
const status = document.querySelector<HTMLElement>("#status")!;
const transport = Tone.getTransport();

async function stopPlayback() {
  transport.stop();
  transport.cancel(0); // 此独立示例拥有整个 Transport。
  transport.position = 0;
  if (liveRack) {
    const old = liveRack;
    liveRack = undefined;
    old.silence(Tone.now());
    // 等待 lookAhead 与静音渐变经过，再释放旧节点。
    await new Promise(resolve => setTimeout(resolve, 200));
    old.dispose();
  }
}

async function play(mode: Mode) {
  await stopPlayback();
  transport.bpm.value = BPM;
  transport.timeSignature = 4;
  const rack = createRack(mode);
  liveRack = rack;
  for (const event of score) {
    transport.schedule(time => rack.play(event, time), seconds(event.beat));
  }
  transport.loopStart = 0;
  transport.loopEnd = LOOP_SECONDS;
  transport.loop = true;
  transport.start("+0.05", 0);
}

async function exportWav(mode: Mode) {
  await stopPlayback();
  let rack: Rack | undefined;
  try {
    const result = await Tone.Offline(() => {
      rack = createRack(mode); // 节点必须在离线上下文中创建。
      for (const event of score) rack.play(event, seconds(event.beat));
    }, LOOP_SECONDS + 1.5, 2, 44100);
    const native = result.get();
    if (!native) throw new Error("离线渲染没有返回音频");
    try {
      const channels = Array.from({ length: native.numberOfChannels },
        (_, i) => native.getChannelData(i));
      downloadWav(channels, native.sampleRate, `tone-${mode}.wav`);
    } finally {
      result.dispose();
    }
  } finally {
    // 渲染完成后再释放；不要在 Offline 回调末尾立即 dispose。
    rack?.dispose();
  }
}

async function run(action: "play" | "stop" | "export") {
  if (busy) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.disabled = true);
  try {
    // 在点击回调进入后的第一个异步步骤解锁音频。
    await Tone.start();
    const mode = modeSelect.value as Mode;
    if (action === "play") await play(mode);
    else if (action === "stop") await stopPlayback();
    else await exportWav(mode);
    status.textContent = action === "play" ? `循环播放：${mode}`
      : action === "stop" ? "已停止" : "WAV 已导出（含尾音）";
  } catch (error) {
    status.textContent = String(error);
    console.error(error);
  } finally {
    busy = false;
    document.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.disabled = false);
  }
}
document.querySelector("#play")!.addEventListener("click", () => void run("play"));
document.querySelector("#stop")!.addEventListener("click", () => void run("stop"));
document.querySelector("#export")!.addEventListener("click", () => void run("export"));

```

### 9.8 如何扩展这个项目

优先做三项修改：

1. **改音符，保留音色**：验证编曲本身是否成立。
2. **保留乐谱，只改音色**：对比瞬态、频谱与 gate 的影响。
3. **重做不同模式的伴奏**：FM 模式给低音增加独立调制包络，采样模式用拨弦或弦乐伴奏替代方波。

采样模式使用的根音是 C4、C5、C6。程序用谐波叠加生成 1.5 秒拨弦声音，再交给 Sampler 变调播放。这里特意让“先生成资源”和“再演奏资源”成为两个阶段。实际工程可将生成资源缓存，不必每次切换模式重新创建。

示例噪声鼓通过持续时间与力度制造重音差别，音色本身比较简单。需要明显不同的 hat/snare 时，可加入不同滤波或不同采样，同时规定它们是否允许叠加。

### 9.9 生命周期为什么这样设计

每次开始播放前，先停止并清除上次 Transport 事件，再建立新的 rack。模式切换在下次点击播放时生效，而不是随 select 值变化直接替换正在发声的节点。

停止时进行 20 ms 总线淡出，并在等待 lookAhead 后释放节点。示例中的 200 ms 等待是为默认上下文配置做的简化资源管理；若你修改 `lookAhead`，应相应调整回收窗口。这个定时器不负责音乐节奏。

`transport.cancel(0)` 在本例成立，是因为应用独占 Transport。大型项目应保存自己创建的事件 ID 并分别 `clear`，不要清空其他模块的事件。若采用 Part，则直接管理自己的 Part 生命周期。

---

## 10. 混音、循环与导出

### 10.1 先处理声部关系，再加效果

主奏、琶音与低音至少在音区、节奏、音量三个维度中分开两个。方波中高频很丰富，伴奏即使电平不高，也可能遮住主旋律。

可采用：

- 主奏保持在中间或接近中间。
- 琶音降低电平，必要时适度偏置声像。
- 低音保持稳定；立体声宽度从其他声部获得。
- 噪声鼓减少尾音，避免持续占据高频。
- 效果器使用发送总线，共享空间，便于统一管理。

示例中 16 位模式使用固定 170 ms 的短 delay，而不是同步的 `"8n"`。这是明确的设计选择：固定 delay 不随 BPM 改变。改成音乐时值时，应保证实时与离线都在相同 tempo 设置下解析它。

### 10.2 增益与 Limiter

`Gain(0.5)` 的值是线性增益；`instrument.volume.value = -6` 的单位是 dB，不能混淆。

示例先通过各轨道音量与总线增益保留余量，再用 `Limiter(-1)` 做保护。它不是响度标准化，也不是“保证所有采样点或 true peak 都满足交付规范”的完整母带流程。若导出后发现持续压限或低音抽动，先减轨道电平。[17]

### 10.3 实时循环不等于文件无缝循环

Transport 循环会继续保留合成器和效果器状态。独立文件从静音起点开始渲染，两者的首尾状态未必一致。

本案例导出一遍正文加 1.5 秒尾音，适合试听和交付草稿，**不是直接可无缝循环的素材文件**。

制作可循环素材的工作流：

1. 连续渲染至少三个周期，让 delay / reverb 建立近似稳定状态。
2. 从中间截取一个完整周期，不把额外尾音算进周期。
3. 按实际采样率计算裁切点，并确认周期是否对应整数采样数。
4. 检查边界附近的波形跳变及听感。
5. 必要时做短交叉淡化，并检查是否削弱下拍。
6. 在目标游戏引擎里反复循环试听。

音乐结构也要允许循环：末尾保留的悬念应能被开头接住。波形首尾平滑不能解决和声断裂。

### 10.4 Offline：优先用于正式文件导出

`Tone.Offline(callback, duration, channels, sampleRate)` 返回 `ToneAudioBuffer`。所有参与渲染的节点都应在 callback 内创建；回调支持异步操作，因此采样模式可以在回调内等待加载。[16]

外部采样的写法：

```ts
let sampler: Tone.Sampler | undefined;
const rendered = await Tone.Offline(async () => {
  sampler = new Tone.Sampler({
    urls: { C4: "/samples/pluck-C4.wav" },
    release: 0.1,
  }).toDestination();
  await Tone.loaded();
  sampler.triggerAttackRelease("E4", 0.4, 0, 0.7);
}, 2, 2, 44100);

// 使用 rendered；完成后再释放。
sampler?.dispose();
rendered.dispose();
```

不要用实时 rack 的节点参与离线渲染；不要在 Offline 回调结束时立即把节点全部 dispose。渲染发生在构图与调度之后。

Tone.js 的 Offline 实现会临时切换默认上下文。完整案例通过 busy 状态串行化导出与播放操作。大型应用也应避免在离线构图期间让其他异步任务意外创建音频节点。

### 10.5 WAV 编码器的范围

示例 `wav.ts` 将 Float32 样本编码为交错的 PCM16 WAV，写入 RIFF 头和声道信息。它不是 Tone.js 的内置 WAV 导出 API。

为了保持篇幅与依赖简单，示例不包含：

- 量化前 dithering。
- 广播 WAV 元数据、循环标记。
- 超大文件 RF64 支持。
- true-peak、LUFS 分析与母带处理。

普通短曲足够使用。对更正式的后期制作，可以增加 24 位或 Float32 WAV 导出，在最后交付环节再量化。

### 10.6 Recorder：适合记录现场，不是 Offline 的替代品

`Tone.Recorder` 包装 MediaRecorder。它不提供采样精度调度，也不会因为文件扩展名改为 `.wav` 就自动变成 WAV。实际容器与编码取决于 MIME 和浏览器支持。[18]

- 需要记录交互演奏过程：考虑 Recorder。
- 需要固定乐谱的可控时长和输出采样率：优先 Offline。
- 需要 WAV：使用明确的 WAV 编码器，不要只修改后缀。

### 10.7 FFmpeg 在这里做什么

导出的 WAV 可以交给 FFmpeg 转码或配视频。例如：

```bash
ffmpeg -i tone-8bit.wav -c:a libmp3lame -q:a 2 tone-8bit.mp3
```

不要为了作品名叫 8Bit 就把成品强制转换成 8 位 PCM。文件位深与目标音乐风格是两个维度。

---

## 11. 应用集成与性能

### 11.1 React / Vue

音频引擎放在独立 service 或实例里，UI 只发命令。不要在每次组件 render 时 `new Synth()`。

组件卸载时：

1. 移除该组件的 Transport 事件 / Part。
2. 停止相关播放与持续 voice。
3. 释放节点、Buffer、事件监听器。
4. 取消或标记尚未完成的资源加载，避免卸载后复建节点。

React 开发模式中的重复挂载会放大生命周期问题。不要通过关掉 Strict Mode 掩盖节点泄漏。

### 11.2 UI 同步

Transport 回调中执行音频调度。需要在实际发声时刻更新播放头或键盘高亮，可以使用 `Tone.getDraw().schedule(callback, time)`。[19]

```ts
transport.schedule(time => {
  synth.triggerAttackRelease("A4", 0.1, time);
  Tone.getDraw().schedule(() => {
    // 这里只更新 UI，不在这里触发音符。
  }, time);
}, 0);
```

### 11.3 音频线程与主线程

- 在开始播放前完成采样下载与乐谱编译。
- 不要为每个音符创建整个效果链。
- 合成器与效果器尽量复用，voice 数量明确。
- 不要在 Transport 回调内做大型 JSON 解析、DOM 布局或网络请求。
- 需要自定义逐样本 DSP 或芯片模拟时考虑 AudioWorklet；简单音序器通常不必先写 Worklet。

Tone.js 的 performance 文档可以帮助理解 lookAhead 与调度成本，但“调低延迟”不等于“无条件调低所有缓冲参数”。[20]

### 11.4 浏览器与 Node.js 分工

本教程的 `npm` 工程运行于浏览器；在 Node.js 里执行 `node main.ts` 不会自动获得浏览器的 AudioContext。

若要服务端批量渲染，可以让 Node.js 管理任务并驱动无头浏览器执行同一渲染逻辑，或明确选用兼容的音频上下文实现。应单独验证节点支持、采样解码与效果差异，不能因为 TypeScript 编译通过就假设能在服务端直接运行。

### 11.5 游戏中的自适应音乐

先按角色拆 stem：主奏、节奏、低音、氛围。进入战斗时切换段落或增加声部，不要重新初始化整个音频上下文。

切换尽量发生在小节边界，保留全局节拍。主题动机与和声结构应该允许组合。8Bit 风格尤其适合用“换一个声部的角色”制造变化，而不是不停叠加音轨。

---

## 12. 常见问题与练习

### 12.1 排错表

| 现象 | 优先排查 |
| --- | --- |
| 点击后没声音 | 用户手势中的 `Tone.start()`、路由连接、音量、采样加载错误 |
| 音符节奏不稳 | 是否使用 JS 定时器触发；是否传入回调的 `time` |
| 每次播放更响 | 重复节点、重复 Transport 事件、重复连接 |
| 停止后还响一段 | release / delay 尾音，或已经排入未来音频时间线的事件 |
| 离线导出静音 | 是否在 Offline 内创建节点；是否给了明确起点；是否等待采样 |
| 导出缺最后一段 | 渲染时长、最后 note-off 与效果尾音预算 |
| 噪声鼓报时间转换错误 | 是否误把 note 当成 NoiseSynth 的 duration |
| 音高对但采样不自然 | 根音标注错误、跨音区变调太大、采样自身音高不准 |
| 改 BPM 后节奏不对 | 乐谱是否提前编译成了秒；是否混用了不同时间单位 |
| 循环处有点击声 | 声音波形、包络、效果状态、音频文件裁切点 |
| 看似 16Bit 却像普通合成器 | 缺少风格化编曲、FM/采样设计或有意的资源约束 |

### 12.2 五个练习

**练习一：只改变包络。** 固定四个音和同一个脉冲波，分别做短促、持续、柔和三种演奏。观察“音色变化”不一定需要换波形。

**练习二：四声部限制。** 仅允许两条脉冲、一条三角、一条噪声。所有 gate 与 release 都计入实际占用。删除一个声部后，其余声部仍应能说明歌曲结构。

**练习三：FM 参数矩阵。** 固定旋律，组合 harmonicity 1/2/3 与 modulationIndex 0.5/2/5，导出九个短片段。每段标注听感，避免只看参数猜效果。

**练习四：采样分区。** 先用单个 C4 采样覆盖两个八度，再加入 C3/C5 根音。对比高低音区的瞬态与自然度。

**练习五：无缝循环。** 将示例改为多周期渲染，裁出中间周期。先移除效果，再逐个加回，定位接缝问题来自编曲、音源还是效果状态。

### 12.3 一首曲子的完成检查

- 主旋律是否有可辨认的动机与呼吸？
- 低音是否独立表达和声方向？
- 第二声部是否有自己的任务，而不是机械填满？
- 音色瞬态与音符密度是否匹配？
- 复音数量是否符合你设定的风格约束？
- 没有 BitCrusher 时，作品是否仍然具有目标风格？
- 最后一拍接第一拍，和声与节奏是否成立？
- 多次播放 / 停止是否会累加事件或节点？
- 导出文件是否包含正确长度、声道与尾音？

---

## 13. 官方资料索引与验证说明

### 13.1 官方资料

以下为本文核对的官方入口与版本文档。Wiki 的接口示例可能早于当前版本，固定版本类型定义具有更强的工程约束力。

1. [npm：tone 版本与 dist-tags](https://www.npmjs.com/package/tone?activeTab=versions)
2. [官方 GitHub 仓库](https://github.com/Tonejs/Tone.js)
3. [Tone.js 官网与基本示例](https://tonejs.github.io/)
4. [Synth 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/Synth.html)
5. [PolySynth 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/PolySynth.html)
6. [官方 Wiki：Transport](https://github.com/Tonejs/Tone.js/wiki/Transport)
7. [Part 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/Part.html)
8. [Sequence 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/Sequence.html)
9. [PulseOscillator 官方文档入口（15.0.4，可用的参考页）](https://tonejs.github.io/docs/15.0.4/classes/PulseOscillator.html)
10. [OmniOscillator 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/OmniOscillator.html)
11. [AmplitudeEnvelope 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/AmplitudeEnvelope.html)
12. [NoiseSynth 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/NoiseSynth.html)
13. [FMSynth 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/FMSynth.html)
14. [Sampler 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/Sampler.html)
15. [Player 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/Player.html)
16. [Offline 官方文档入口（15.0.4，可用的参考页）](https://tonejs.github.io/docs/15.0.4/functions/Offline.html)
17. [Limiter 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/Limiter.html)
18. [Recorder 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/Recorder.html)
19. [getDraw 15.1.22](https://tonejs.github.io/docs/15.1.22/functions/getDraw.html)
20. [官方 Wiki：Performance](https://github.com/Tonejs/Tone.js/wiki/Performance)
21. [官方采样器演示源码](https://github.com/Tonejs/Tone.js/blob/dev/examples/sampler.html)

部分 15.1.22 API 页面检索不可达时，本文采用同一官方站点可访问的较早 15.x 页面辅助解释，并以**实际安装的 15.1.22 类型定义**核对关键接口。没有将这些较早页面冒称为最新版本页面。

### 13.2 内容的性质

- API 用法、组件能力：参考官方文档与安装包类型定义。
- 音色参数、Am–F–C–G 乐谱、混音方案：本文设计的教学示例，不是官方预设或原机参数。
- 复古风格与硬件差异：用来限制实现承诺，本文未实现完整芯片仿真。
- 采样资源：完整案例自行生成，不依赖第三方音色下载。

### 13.3 验证范围

完整项目按 Tone.js 15.1.22 安装，执行了 TypeScript 严格类型检查与 Vite 生产构建。代码块从同一份通过检查的项目文件写入文档。

验证不等于主观音质评审。当前执行环境未完成浏览器声音试听，不能声称已在各浏览器验证播放效果或确认作品听感。使用时建议先在桌面 Chrome / Firefox 中验证三种模式、重复播放停止、WAV 导出及循环边界，再验证目标设备。

WAV 编码器的二进制字段、声道交错与数值边界另行通过程序检查；它仍是适合短曲教学的简化实现。
