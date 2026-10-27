# 验证记录：1.0.0

日期：2026-10-27。环境：macOS（Darwin 25.4.0）、Node.js 24.22.0、Tone.js 15.1.22、Playwright 1.56.1 / Chromium Headless Shell。

## 自动化检查

共 **105 项测试**，全部通过：

- **80 项单元 / CLI 测试**（`npm test`）
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

## 信号测量

`analyze` / `render` 报告新增：

| 指标 | 方法 | 校验 |
| --- | --- | --- |
| `truePeakDbfs` | 4× 多相 sinc 过采样 | 1 kHz 正弦 0.9 幅度读出 0.9000；8/12/16 kHz 均正确检出采样间过冲 |
| `loudnessLufs` | BS.1770-4，400 ms 块 / 75% 重叠 / 绝对+相对门限 | 1 kHz -20 dBFS 立体声读出 -20.0 LUFS；单声道 -23.0 |
| dither | 确定性 TPDF | 同 seed 输出一致 |
| limiter | 前瞻最小值 + 释放平滑 | 报告触发样本数与最大衰减 |

## 兼容性

- Schema 1.0 / 1.1 / 1.2 全部可编译。仓库内 9 份历史示例（含 `assets/demos/` 中的 `*.score.json`）逐一验证通过，零 error。
- 破坏性变更见 `v1.0-guide.zh-CN.md` 第 9 节（默认 `voicePolicy`、鼓轨声部语义、`patchScore` 返回签名）。

## 范围

未进行主观听音、跨操作系统验证、游戏引擎实装、严格芯片仿真、LUFS 之外的母带评估。信号正确、样本边界小和周期差小不能单独证明音乐优秀或循环在音乐上自然。

旧的 0.2 / 0.3 示例与试听库若随包保留，其报告标记各自版本，作为历史参考。
