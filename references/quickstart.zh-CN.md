# Retro Music Toolkit：从零运行

这是一个可独立运行的 Skill 工程。核心输入是可版本管理的 JSON 音乐工程，输出是 WAV、渲染报告和可继续编辑的乐谱。

## 1. 目录与定位

- `SKILL.md`：AI 的创作流程与工具使用说明。
- `scripts/runtime/`：TypeScript 工程、CLI、Schema、测试、示例和网页试听器。
- `references/`：工程文档、作曲操作手册和用户提供的三份背景教程。
- `assets/demos/`：已渲染示例曲、工程与报告（交付 ZIP 中提供）。

当前版本支持固定速度、4 或 8 为拍号分母的节拍、跨小节延音（`hold`）、clip 裁剪、swing、humanize、调性与和弦标记、和声诊断、伴奏/琶音生成、动机算子、采样鼓组、局部修改、片段/独奏/循环渲染与 PCM16 WAV。暂不支持 tempo map、MIDI 导入导出、原生主机格式、完整芯片仿真和自动听觉审美评估。

## 2. 安装并生成第一首

需要 Node.js 22+、npm，以及可以下载 npm 依赖和 Playwright Chromium 的网络。浏览器只在渲染机器安装一次，不随 ZIP 分发。

```bash
cd retro-music/scripts/runtime
npm ci
npm run browser:install
npm run build
npm test
npm run test:audio
npm run test:web
npm run demo
```

解压目录名称可能不同；先定位 `SKILL.md`，再进入其下 `scripts/runtime`。macOS、Linux、Windows 三平台均可运行；CI 会在三平台分别执行类型检查、构建与单元测试。Linux 若缺少浏览器系统库，可参考 Playwright 官方安装文档执行系统依赖安装；该操作可能需要系统管理员权限。也可指定已安装且兼容的浏览器：

```bash
RETRO_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium npm run demo
```

`npm run demo` 会生成：

- `output/pixel-trail.wav`
- `output/pixel-trail.wav.report.json`
- `output/pixel-trail.wav.score.json`

已有文件默认受到保护。再次执行可换输出路径，或使用 `npm run music -- render examples/pixel-trail.json --out output/pixel-trail.wav --force`。

下载包里的预渲染 WAV 可以直接试听，不需要安装任何依赖。音乐优秀与否仍要由真实试听和使用场景判断。

## 3. 命令行

开发阶段用 `npm run music -- COMMAND`，构建后用 `node dist/cli.js COMMAND`。两者语义相同。

```bash
node dist/cli.js instruments
node dist/cli.js validate examples/pixel-trail.json
node dist/cli.js compile examples/pixel-trail.json --out output/events.json
node dist/cli.js render examples/pixel-trail.json --out output/full.wav
node dist/cli.js render examples/pixel-trail.json --solo lead,bass --out output/sketch.wav
node dist/cli.js render examples/neon-overpass.json --from 8 --to 16 --mode one-shot --out output/phrase.wav
node dist/cli.js render examples/lantern-harbor.json --seam --out output/seam.wav
node dist/cli.js analyze output/full.wav
node dist/cli.js patch examples/pixel-trail.json --patch examples/variation.patch.json --out output/pixel-v2.json
node dist/cli.js render output/pixel-v2.json --out output/pixel-v2.wav
```

所有结果/错误均为 JSON，成功返回退出码 0，错误返回 1；`--help` 输出帮助文本。`validate` 会做完整编译，包括复音检查。`compile` 输出展开后的整数 tick 事件。

`--solo` 是逗号分隔的真实轨道 ID，不是乐器名称。`--from/--to` 是零起点的四分音符拍数；输出包含 `export.tailSeconds`。例如 120 BPM 下从第 8 拍到第 16 拍，音乐部分 4 秒，再加默认 2 秒尾音。loop 模式只允许完整工程；片段试听应指定 one-shot。

`--seam` 生成末 4 拍接开头 4 拍；短于 4 拍的工程使用整轮。它是接缝检查片段，不是最终循环文件。

## 4. TypeScript API

从本项目 `src/index.ts` 开发，或构建后导入 `dist/index.js`。导出的函数不依赖某个 Agent 平台：

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { compileScore, renderScore, patchScore } from './dist/index.js';

const input = JSON.parse(await readFile('examples/pixel-trail.json', 'utf8'));
const compiled = compileScore(input);
console.log(compiled.events.length, compiled.diagnostics);

const changed = patchScore(input, {
  operations: [
    { op: 'set-track', trackId: 'arp', set: { gainDb: -18 } }
  ]
});
const { wav, report } = await renderScore(changed, { solo: ['lead', 'bass'] });
await writeFile('sketch.wav', wav);
console.log(report);
```

新增功能入口见 [v0.2-guide.zh-CN.md](v0.2-guide.zh-CN.md)。

`validateScore` 检查结构和语义；`compileScore` 还检查实际声部冲突，失败抛出含 `diagnostics` 的 `ScoreError`。`renderScore` 会先编译，成功后返回 `{ wav, report, score }`，不自行写磁盘。API 调用者负责保存与命名。

## 5. 网页试听

```bash
npm run build
python3 -m http.server 8080 --directory web
```

打开 http://localhost:8080 ，上传 examples 内的 JSON，点击编译与渲染，试听或下载 WAV。网页直接运行同一编译器和 Tone.js 渲染逻辑，不向外部服务上传乐谱。不建议通过 `file://` 打开 ES module。

## 6. 接入 AI / Skill

将整个 `retro-music` 文件夹放入支持本地 Skill 的宿主目录，并确保宿主能执行 Node.js 命令。不同宿主的安装路径和工具权限不同，以其文档为准。仅复制 `SKILL.md` 不足以运行工具；必须保留 scripts、references 等资源。

最小 Agent 工具映射：

| Agent 工具名 | 实现 |
| --- | --- |
| list_instruments | `INSTRUMENTS` 或 CLI instruments |
| validate_score | `compileScore` 或 CLI validate |
| render_score | `renderScore` 或 CLI render |
| analyze_audio | `decodeWav` + `analyzeChannels` 或 CLI analyze |
| patch_score | `patchScore` 或 CLI patch |
| export_project | CLI render 同时保存 WAV、score、report |

当前版本没有附带 MCP server；直接通过 shell 或函数工具调用已能形成完整闭环。后续可包装现有 API，无需修改音乐模型。

给 AI 的提示示例：

> 使用 retro-music 为像素冒险游戏写一首原创 16 小节探索配乐，132 BPM，NES 启发风格，可以循环。先写主旋律和低音，验证后再补伴奏和鼓。保存 JSON、最终 WAV 与报告。如果无法听音频，请明确只做了结构与信号检查。

## 7. 依赖、素材与复现

- Tone.js 固定 15.1.22；Playwright 固定 1.56.1；完整依赖由 package-lock.json 锁定。
- 所有内置采样和鼓素材均由程序生成，不含商业游戏音色或抓取的原游戏素材。
- `seed` 控制程序噪声素材；这不保证跨浏览器、系统或版本的逐字节一致。
- ZIP 不含 node_modules 和浏览器二进制，使用 npm ci 安装。
- 自编代码采用 MIT 许可；用户提供的参考教程保持原文来源，不将其版权自动改为 MIT。第三方依赖遵循各自许可。

详细验证范围和示例信号数据见 [validation-report.zh-CN.md](validation-report.zh-CN.md)。

## 8. 第二版常用命令

```bash
node dist/cli.js audition --out output/auditions
node dist/cli.js diagnose examples/pixel-trail.json --out output/findings.json
node dist/cli.js diagnose examples/pixel-trail.json --rules examples/diagnostic-rules.json
node dist/cli.js patch examples/pixel-trail.json --patch examples/v2-variation.patch.json --out output/v2.json
node dist/cli.js render output/v2.json --out output/v2.wav
node dist/cli.js render examples/lantern-harbor.json --loop-diagnostics --out output/loop-check.wav
node dist/cli.js render examples/neon-overpass.json --match-rms -24 --out output/comparison.wav
```

试听目录的 index.html 可直接用浏览器打开；其 WAV 使用相对路径。主编辑器仍建议由本地 HTTP 服务提供。所有输出默认不覆盖；换目录或显式使用 --force。

## 9. 1.0 入口

详见 [v1.1-guide.zh-CN.md](v1.1-guide.zh-CN.md)。Schema 1.0–1.3 继续支持，新工程写 `"1.3"`。

```bash
# 最小可用乐谱（约 40 行），比完整示例更适合作为起点
node dist/cli.js example --out output/minimal.json

# 和弦 → 伴奏 / 琶音
node dist/cli.js harmonize output/minimal.json --config examples/harmonize-config.json --out output/with-harmony.json
node dist/cli.js arpeggiate output/minimal.json --config examples/arpeggio-config.json --out output/with-arp.json

# 动机发展
node dist/cli.js motif output/minimal.json --config examples/motif-config.json --out output/developed.json

# 修订（返回逐项变更日志）与 A/B 导出
node dist/cli.js patch output/minimal.json --patch changes.json --out output/v2.json
node dist/cli.js compare output/v1.wav output/v2.wav --out output/ab.wav

# 从 stdin 读、往 stdout 写；按小节渲染
cat output/minimal.json | node dist/cli.js validate -
node dist/cli.js render output/minimal.json --bars 1-2 --mode one-shot --out output/phrase.wav
```

原预设的独立 JSON 位于 src/instrument-data。用户音色建议嵌入工程，而不是修改全局注册表。
