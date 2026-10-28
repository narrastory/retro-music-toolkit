# 验证记录：1.1.0

日期：2026-10-27。环境：macOS（Darwin 25.4.0）、Node.js 24.22.0、Tone.js 15.1.22、Playwright 1.56.1 / Chromium Headless Shell。

## 自动化检查

共 **115 项测试**，全部通过：

- **90 项单元 / CLI 测试**（`npm test`）
- **23 项真实浏览器音频测试**（`npm run test:audio`）
- **2 项网页集成测试**（`npm run test:web`）

`npm run test:all` 依次执行以上三组。

1.0 新增覆盖：

- 鼓轨不参与声部抢占：同拍 kick/snare/hat 全部发声，无零长度事件。
- 默认 `voicePolicy: "cut"`；`RELEASE_OVERLAP` 与 `VOICE_OVERLAP` 分别触发。
- `hold` 跨 pattern 边界延音；越界未声明 `hold` 时返回可用修复建议。
- clip `lengthBeats` 裁剪。
- swing 只位移反拍；humanize 同种子完全可复现。
- 和声诊断（非和弦音、调外音）、按拍号推导诊断窗口。
- 动机算子只改选区、不改源 pattern；级进移调缺 `key` 时报 `NO_KEY`。
- `harmonize` 按和弦标记生成三声部；无标记时报 `NO_HARMONY`。
- `arpeggiate` 展开已有和弦音。
- `quantize` 吸附且不越过 pattern 边界。
- `patch` 变更日志（path + before/after）。
- 段落重叠在 validate 阶段报 `SECTION_OVERLAP`。
- 采样音区覆盖问题由 validate 报告，而非编译中途抛错。
- 采样鼓组缺少 asset 时报 `SAMPLE_REFERENCE`。
- **提交的 `schema/score.schema.json` 与运行时 Zod 定义逐字节一致**（新增回归测试）。

1.1 新增覆盖：

- 单声部琶音把同拍和弦合并为一个声部（32 步、1 个 voice、零 VOICE_STEAL），并验证 `up` / `down` 顺序。
- `authenticity` 默认值与被编译结果照抄。
- 循环收束诊断：非属→主的收束触发 warning，G7→C 不触发，one-shot 不检查。
- `describeScore` 输出音区、密度、峰点与段落变化。
- 钢琴卷帘包含音符、小节线、图例，鼓轨独立成行。
- 报告 HTML 转义标题中的脚本标签。

## 信号测量

`analyze` / `render` 报告新增：

| 指标 | 方法 | 校验 |
| --- | --- | --- |
| `truePeakDbfs` | 4× 多相 sinc 过采样 | 1 kHz 正弦 0.9 幅度读出 0.9000；8/12/16 kHz 均正确检出采样间过冲 |
| `loudnessLufs` | BS.1770-4，400 ms 块 / 75% 重叠 / 绝对+相对门限，**在能量域门限与平均** | 1 kHz -20 dBFS 立体声读出 -20.0 LUFS；单声道 -23.0 |
| dither | 确定性 TPDF | 同 seed 输出一致 |
| limiter | 前瞻最小值 + 释放平滑 | 报告触发样本数与最大衰减 |

## 兼容性

- Schema 1.0–1.3 全部可编译。仓库内 9 份历史示例（含 `assets/demos/` 中的 `*.score.json`）逐一验证通过，零 error。
- 破坏性变更见 `v1.1-guide.zh-CN.md` 第 9 节（默认 `voicePolicy`、鼓轨声部语义、`patchScore` 返回签名）。

## 1.1 的音色验证

同一段四音旋律分别在 modern / hardware 模式下渲染，用一阶差分能量比（高频占比）作为客观指标：

| 模式 | 高频占比 | RMS |
| --- | ---: | ---: |
| modern | 0.2562 | 0.0409 |
| hardware | 0.3680 | 0.0426 |

SNES 回声开关对能量分布的影响（单音 + 2 秒尾音）：关闭时中段/尾段能量为 0，开启后中段 0.00785、尾段 0.00120。这只证明回声接进了信号链，不代表听感合适。

## 范围

未进行主观听音、跨操作系统验证、游戏引擎实装、严格芯片仿真、LUFS 之外的母带评估。信号正确、样本边界小和周期差小不能单独证明音乐优秀或循环在音乐上自然。

旧的 0.2 / 0.3 示例与试听库若随包保留，其报告标记各自版本，作为历史参考。
