# Retro Music Toolkit 1.0

面向 AI 的 TypeScript + Tone.js 8bit / 16bit 作曲工具包。输入是可版本管理的 JSON 乐谱，输出是 WAV、渲染报告和可继续编辑的工程。

1.0 的重点不是增加音色，而是让 AI 能写出**跨小节、有和声方向、有主题发展**的音乐，并且能自己发现最常见的和声错误。

## 先试听

- [Starfall Causeway · FM](assets/demos/starfall-fm.wav)
- [同主题采样改编](assets/demos/starfall-sample.wav)
- [自定义多音区音色试听台](assets/custom-audition/index.html)

## 1.0 能力

**作曲**
- `hold: true` 跨小节延音；clip 级 `lengthBeats` 裁剪，不再为每个变体复制 pattern。
- `swing` / `humanize`，均由 seed 决定，导出可复现。
- `motif` 动机算子：模进（半音或级进）、倒影、逆行、时值增减、力度曲线、装饰音。
- `key` + `harmony` 和弦标记；`harmonize` 生成伴奏轨，`arpeggiate` 生成琶音。

**和声诊断**
- 强拍非和弦音、低音冲突、斜杠和弦、平行五度/八度、未解决大跳、调外音、半音碰撞。
- 只在有 `harmony` / `key` 时运行；允许经过音与级进解决，减少误报。

**鼓**
- 修复：同一拍的鼓不再互相抢断（旧版会静默丢掉一个音）。
- 八种鼓件，支持采样鼓组（`drumKit`），未提供的鼓件回退到合成鼓并给出提示。

**导出与测量**
- 真峰值（4× 多相 sinc 过采样）与 BS.1770-4 积分响度。
- 可选 TPDF 抖动、前瞻峰值限幅、循环边界等功率交叉淡化。
- `compare` 把两版等响拼接成一个 A/B 文件。

**接入**
- 采样导入支持 PCM16/24/32 与 float32，并读取 `smpl` 块的根音与循环点。
- CLI 支持 stdin/stdout、`--bars`、`--compact`；`patch` 返回逐项变更日志。

## 从源码运行

需要 Node.js 22+：

```bash
cd scripts/runtime
npm ci
npm run browser:install
npm run build
npm test
```

生成第一首：

```bash
node dist/cli.js example --out minimal.json
node dist/cli.js validate minimal.json
node dist/cli.js render minimal.json --out minimal.wav
```

`render` 同时写出 `.report.json` 与 `.score.json`。输出默认不覆盖，重复执行请换文件名或加 `--force`。

## 常用流程

```bash
# 规划
node dist/cli.js arrange config.json --out skeleton.json

# 写作与检查
node dist/cli.js validate song.json
node dist/cli.js diagnose song.json --compact

# 伴奏与主题发展
node dist/cli.js harmonize song.json --config harm.json --out with-harmony.json
node dist/cli.js arpeggiate song.json --config arp.json --out with-arp.json
node dist/cli.js motif song.json --config motif.json --out developed.json

# 修订
node dist/cli.js patch song.json --patch changes.json --out v2.json

# 导出
node dist/cli.js render v2.json --out final.wav --dither
node dist/cli.js compare v1.wav final.wav --out ab.wav
```

## 文档

- [1.0 变更与新增能力](references/v1.0-guide.zh-CN.md)
- [乐谱格式 v1.2](references/score-format.zh-CN.md)
- [快速开始](references/quickstart.zh-CN.md)
- [AI 作曲手册](references/composition-playbook.zh-CN.md)
- [工程架构](references/architecture.zh-CN.md)
- [验证记录](references/validation-report.zh-CN.md)
- [Skill 入口](SKILL.md)
- 历史版本：[0.2](references/v0.2-guide.zh-CN.md) · [0.3](references/v0.3-guide.zh-CN.md)

## 依赖与素材

- Tone.js 15.1.22、Playwright 1.56.1，由 `package-lock.json` 锁定。
- 所有内置采样与鼓素材由程序生成，不含商业游戏音色或原游戏素材。
- 自编代码 MIT；`references/source-guides/` 为用户提供的背景教程，版权归原作者。

当前不包含：简写记谱（MML）、MIDI 导入导出、MCP server、tempo map、完整芯片仿真。
