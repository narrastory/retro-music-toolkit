# 原创试听选集制作记录

本轮完整替换上一版三首试听曲，使用全新旋律、乐句和配器重新渲染；不改名复用旧音频。
三首均为 Schema 1.3 工程，使用本工具的编译器与 Tone.js 离线渲染器。
主创作提示词保存在 `docs/music.json`，与网页展示一致。

| 曲目 | 用途 | 结构与声音设计 |
| --- | --- | --- |
| 雨后小径 / After the Rain | 田园探索 | G 大调，96 BPM，4/4，40 小节 / 100 秒。竖笛主题、吉他双音、钢琴应答，8/12/8/12 小节分段。 |
| 窗灯未眠 / The Lit Window | 室内叙事 | D 大调，108 BPM，3/4，48 小节 / 80 秒。十二小节长句、无鼓钢琴、低音与轻柔和声，中段转向小调色彩。 |
| 铜色天际 / Copper Sky | 野外冒险 | D 小调，120 BPM，4/4，40 小节 / 80 秒。圆润 FM 主奏、短奏吉他与贝斯、克制鼓组，中途撤掉节奏层后回归。 |

编写时侧重可辨识动机、句尾留白、配器交接和熟悉主题的变化回归，避免所有声部持续满拍。弱拍旋律轻于强拍，段落中的减少与增加均写入源乐谱。
参考游戏仅提供场景配器和动机发展的思路，没有引用其旋律、录音或音色资产。
小调属和弦的升 C 属于有意的和声设计；诊断启发式不能作为审美评分。

三首均含 Salamander 钢琴（Alexander Holm；调音映射 Markus Fiedler，CC BY 3.0）；《雨后小径》《铜色天际》另含 Gogodze Phu Vol II 鼓组（Karoryfer Lecolds，CC BY 4.0）。band 与 VCSL 录音为 CC0。页面每首下方列出署名，完整改动与出处见 `NOTICE.md` 及各音源包的 `SOURCES.json`。

## 从源头重建

在 `scripts/runtime` 下，安装依赖并构建之后运行：

```powershell
node scripts/compose-showcase.mjs
$env:RETRO_CHROMIUM_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/render-showcase.mjs
node --test tests/showcase.integration.mjs
```

非 Windows 系统可以省略环境变量并使用 Playwright Chromium。MP3 编码需要 PATH 中有 ffmpeg。
创作脚本包含明确写出的旋律乐句、和弦与分段安排，并通过本库编译验证，不调用音乐生成服务。
渲染脚本输出 WAV、192 kbps MP3、带源文件及音频 SHA-256 的渲染报告、和声与编排诊断。
WAV 不经过额外响度归一化；电平调整直接写入乐谱混音参数。

## 验证边界

自动检查覆盖乐谱可编译性、音频非静音、无非有限采样、无削波、真峰值余量、循环边界指标、时长与文件哈希一致性。
网页检查实际播放三个 MP3，并验证切歌互斥、暂停、进度拖动、循环开关、提示词复制、CRT 偏好保存及 320–1280 像素宽度布局。
本轮没有可用的主观听审工具；这些检查不表示已进行人耳审听，也不构成对旋律质量或长期耐听度的评价。

上一版三首的 MP3、WAV、乐谱和报告，以及独立音色/混响展示页面及其专用素材已移除。其他开发示例与测试夹具继续保留，避免破坏与本轮选集无关的工具文档和测试。
