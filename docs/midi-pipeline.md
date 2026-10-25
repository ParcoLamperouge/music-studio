# MIDI 优化 + 谱面美化：两段式工作流（设计说明）

> 本文档是提交 `midi: two-stage pipeline …` 的细节说明。第一版实现把「清洗量化」和「出谱排版」
> 揉在一个 beautify 命令里；本版按职责拆成两个独立环节，各有产物、各有 QA 方式。

## 背景：第一版为什么不可用

原 `notes_to_part`（stemlab）把转写音符按**恒定 BPM** 量化、写死 4/4、同拍音符压成单声部和弦：

- 真实演奏每拍 ±5% 的速度漂移（rubato），越往后越偏网格 → 满屏怪异时值；
- Beat This! 检出的真实拍点（beats.json：345 拍、强拍、3/4）完全没被用上；
- 不分手、无休止结构 → 排版必然混乱。

## 环节一：MIDI 优化（音轨级，产物可听）

**输入**：某个 stem 的转写 roll（basic-pitch），或另一条优化轨（版本链）。
**输出**：**新音轨** `piano.optN`（meta.json `tracks` 数组），roll 格式
`[起始秒, 结束秒, MIDI音高, 力度, 小节, 手]`（前端只读前 4 列，向后兼容）。

处理步骤（`engine/beautify.py`）：

1. 清洗：幽灵音（<75ms 且弱）、同音重叠截断、同拍半音簇按「力度×时长」取舍；
2. 量化到**真实拍点**的 16 分音符网格（拍点先去重补漏、尾部按末速延长处理 rubato）；
3. 分手：音高直方图找分割谷底（本曲 53/54 之间）+ 局部中位数再平衡；
4. 结果反算回秒（按真实拍点插值），保留小节号与手。

**QA 方式**：钢琴卷帘里金色轨（采样钢琴发声，M/S/音量独立），与原轨对照听。

### 整轨 / 选段

- `midi_optimize(key, src)`：整轨优化；
- `midi_optimize(key, src, from_bar, to_bar)`：A–B 选段（歌曲条上 ⇧ 拖拽出 loop，前端换算成
  小节区间）——段内重新优化、段外从源轨平移；**永远产出新轨**（版本链 `from` 字段记 lineage），
  源轨不动，可对比后删除。

### Timeline 抽象（换节拍预留）

`Timeline.from_beats(beats, downbeats, meter)`：本期从 beats.json 构建单一节拍段（**约定：
当前默认全曲统一节拍，不处理曲中换拍**）。但量化、小节划分、时值分解（`Rhythm` 按 2/3/4 拍
参数化）、出谱的 `<time>` 都走 Timeline API——**未来支持曲中换拍只需改 `from_beats` 一处**，
出谱端已按「每小节可变拍号」写 MusicXML（OSMD 原生支持渲染）。

## 环节二：谱面美化（出谱级，产物可看可印）

**输入**：某条优化轨（或 stem）的 roll。**输出**：`scores/<轨名>.score.musicxml` + `.score.meta.json`
（起始拍/拍号/调号，供光标跟随换算）。

`engrave()`：按 Timeline 划小节、规范时值分解（不跨节拍锚点）、跨小节连音线、按拍连杆、
调号（Krumhansl-Schmuckler 判定，本曲 E 小调 1♯）、小节内临时记号、♩=136。双谱表钢琴格式。

**渲染/导出**：应用内复用既有 OSMD + jsPDF 链路（Partitura 页签选优化轨 chip），
PDF 导出按钮直接可用；光标跟随用 `toBeat(真实拍点) − 起始拍`，rubato 不漂移。

**LLM 审查**（`beautify_review`）：按 4 小节窗摘要（密度/音域/半音簇/超短音）发给 LLM，
产出 markdown 报告（可疑段落 + 听音核对建议），写 `scores/<轨名>.review.md`，谱面下方折叠展示，
语言跟随界面设置。

## LLM 补丁（可选，段级）

`midi_patch(key, track, from_bar, to_bar)`：把选段音符 + 分小节摘要发给
**Ajustes → IA** 里配置的 OpenAI 兼容 API（`engine/llm.py`；DeepSeek/Kimi/GLM/OpenRouter/
本地 Ollama 均可；env `ESTUDIO_AI_URL/MODEL/KEY` 可覆盖），LLM 回 JSON 编辑指令，
**白名单校验**后应用：

- 只允许 `drop`（删音）/ `vel`（力度 0.05–1）/ `shift`（≤半格移动）；
- 必须命中区间内的真实音符（时间 ≤80ms、音高全等）；
- 最多 200 条指令，应用结果**写入新轨**，不覆写原轨。

> 设计取舍：不让 LLM 直接改写整份 MIDI——千级音符的稠密数值结构 LLM 会丢音错音；
> 规则引擎做主体、LLM 出补丁，可靠且可回退。

## 数据与迁移

- `meta.json` 新增 `tracks`：`{name: "piano.optN", kind: "midi", of, from, range, roll, score, version}`；
- `scores_from_disk` 统一维护存在性与 version（roll 文件 mtime），文件消失的轨自动剔除；
- 旧版 `beauty/beautyRoll` 字段**自动迁移**为 `piano.opt1`（复用已生成文件）；
- `track_delete` 删轨（文件 + 条目）；server 同步随歌曲文件夹走，无需改动。

## 接线

- 引擎命令：`midi_optimize` / `midi_patch` / `score_of` / `track_delete` / `ai_test` / `beautify_review`；
- 队列：`plan()` 增 action（CPU step）；Rust `run_cmd` 白名单同步；
- 前端：`Song.tracks`/`MidiTrack` 类型、混音台 MIDI 轨 lane（金色、密度波形、卷帘/再优化/
  选段优化/LLM 补丁/出谱/删除）、Partitura 优化轨 chip、设置面板「IA · LLM」section；
- 已知修复：MIDI 轨 M/S/音量必须在渲染前初始化（`bind:muted={undefined}` 会使整个音轨界面
  卸载——即「音轨界面加载不出来」的回归）。

## 使用动线

分轨完成 → 音轨轨头/Partitura 点「优化 MIDI」→ 新金色轨出现 → 卷帘对照试听（M 原轨听优化版）
→ 不满意的段落：歌曲条 ⇧ 拖出 A–B → 轨上「仅优化此选段」或「交给 LLM」→ 满意后「生成乐谱」
→ Partitura 看谱/导 PDF（+ 可选 LLM 审查）。

## 验证记录

- 引擎实跑：整轨优化 → 选段重优化（第 31–38 小节）→ 出谱（E 小调 118 小节）→ 删除 → 迁移，全通过；
- 小节时值校验：118 小节 × 24 单位，0 错误；
- 浏览器环境（vite + Tauri 垫片 + 真实数据）渲染音轨页：6 stem + 1 优化轨全部出现、0 运行时错误；
- `npm test`（含 en/zh 键值奇偶）、`npm run check`（svelte-check 0 错）、`cargo check` 全绿。
