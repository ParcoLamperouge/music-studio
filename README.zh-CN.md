# Estudio

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md)

音乐应用：每首歌的完整内容，集中在一处。逐词歌词（以及 Spotify 正在播放的歌曲，独立运行）、分离分轨、下方带歌词的乐谱、和弦、钢琴卷帘（piano roll）与视频 edits，共享同一条任务队列。
Tauri v2 (Rust) + Svelte；edits 编辑器来自 Lyric Edits（React + Remotion）。

它取代了 **Letras**、**StemLab** 和 **Lyric Edits**（已弃用）：它们的引擎都在内部（`engine/letras.py` 和
`engine/stemlab.py`，分别复制自各自仓库的 816a154 和 f5262dc），由 `engine/hub.py` 统一串联。它沿用它们原有的
数据目录（歌词、分离歌曲、模型、edits），因此无需迁移任何数据；桌面歌词面板（`eww/scripts/lyrics.sh`）也照旧
从原来的位置读取歌词。

## 质量高者为准

- **每首歌一份音频**：Letras 的 `audio/<clave>.wav`。StemLab 对同一个文件做分离（硬链接，不复制），并以 Letras
  的 clave 作为 id，因此分轨和歌词始终基于同一段音频。
- **人声**：StemLab 的（BS-RoFormer 全质量）> Letras 的快速版（2 遍，fp16）。如果歌曲已经分离，同步歌词不会再
  触发分离；如果之后才分离，其人声会替换快速版。
- **乐谱歌词**：用 Letras 的（Whisper large-v3 + 强制对齐，Genius 文本或手工修正，含偏移量），而不是 Whisper
  turbo。修正歌词即修正乐谱（构建乐谱时重新分配，不用 AI）。从人声提取音符时，若歌词缺失会自动查找并同步。
- **节拍**：Beat This!（CPJKU，ISMIR 2024）直接作用于混音，无需分离：节拍与小节首拍（节拍器强调真正的第 1 拍，
  并能识别 6/8；librosa 会测错速度，也不懂拍号）。CPU，约 5 秒。
- **和弦**：lv-chordia（Jiang et al.，ISMIR 2019；约 170 种和弦含转位，Billboard 上约 81 % 准确率）作用于音频：
  GPU，约 15 秒，不需要分轨或音符。和弦就绪前，先根据音符给出临时和弦。
- **音符**：快速版用 basic-pitch（CPU，数秒），精确版用 MuScriptor（Kyutai，2026；GPU，每轨数分钟；其测试中多
  乐器 F1 为 48，YourMT3+ 为 22），每轨带各自乐器。由「默认音符」设置或每轨的「精确」按钮选择。MuScriptor 需要
  在 Hugging Face 上接受其许可（非商业），并执行一次 `engine/.venv/bin/hf auth login`。
- **音频与歌词同版本**：歌词时间轴来自 Spotify（LRCLIB…），而音频来自 YouTube，可能是另一个版本（带前奏的 MV）。
  首次同步时，Whisper 测量偏移并移动音频（剪掉前奏或补静音），所有从音频派生的内容（人声、节拍、和弦、音符、
  分轨、edits 的裁剪）一并移动：歌词不动，因此 Spotify 和桌面端保持不变。已处理过的歌曲可在「歌词」标签页点
  「检查」，或批量执行「检查音频版本」。
- **分轨相加即整首歌**：不做 audio-separator 的逐轨响度归一化，两个模型都没归入某一轨的内容（和声、处理过的
  人声、效果）进入「其他」。
- **不留半成品**：分离先在单独目录中构建，完成后才移动到位；旧的半成品会从头重做（分轨完整但缺 `meta.json`：
  不用 GPU 重做 `meta.json`）。Letras 的缓存以原子方式写入，损坏的直接丢弃。在 StemLab 中手工分离的歌曲
  （「dna」）会在标题与时长一致时自动与 Letras 的关联。

## 队列

- **GPU，一次一件事**（RX 6600 的 8 GB 显存放不下两个模型；7700 XT，gfx1101，无需调整即可运行），由单一进程
  （`hub.py worker`）处理，歌曲之间保留上一个已加载的模型：Whisper、编译好的分离器和 MuScriptor 不重新加载。
  在已就绪的步骤中，优先执行使用当前已加载模型的那一个：一批任务里先做完所有分离，再做所有 Whisper……它使用
  与 Letras 和 StemLab 相同的 GPU 锁（它们的 prefetch 等待，或它等待），GPU 空闲 15 秒后释放显存。
- **CPU**（basic-pitch 音符、节拍、对齐；`ESTUDIO_CPU_JOBS`，默认核心数/4）、**网络**（搜索、下载；4）和
  **渲染**（1）与 GPU 并行。
- **依赖关系**：「全部」= 分离 →（同时查找歌词）→ 用好人声同步 → 各乐器音符（CPU，与 GPU 上的 Whisper 并行）→
  歌词完成后的人声音符。已请求的歌词如果对应歌曲的分离还在队列中，会等它完成。
- 取消（杀死进程组：ffmpeg、yt-dlp……）、置顶、重试，均支持批量。队列保存在磁盘（`queue.json`），应用打开后
  继续；每一步先检查已有成果，不重复工作。

## 使用

- **菜单**：打开时可选「分析歌曲」（以下全部）、「演奏」、「会话」或「学习」（`1`…`4`；顶部的小房子返回）。
- **学习**：把已分离的歌曲变成钢琴改编谱（`arrange.ts`），1 级（入门：旋律为四分音符，左手弹根音）到 5 级
  （原曲听感）。右手：所选分轨的旋律（默认人声），干净并对齐到 Beat This! 的节拍；无旋律时用和弦。左手：由
  和弦生成（根音、根音+五度、连接良好的三和弦、低音+和弦）。可选移调到简单的调（此时歌曲只播放鼓）。播放时
  去掉你弹的部分，另一只手有合成引导音，支持等待模式、A–B 循环和正确率统计；可在钢琴卷帘或乐谱上练习（钢琴
  MusicXML，含 PDF）。
- **我的乐曲**（在学习中）：手写或导入的歌曲（MIDI；MusicXML `.musicxml`/`.xml`/`.mxl`），存于
  `piezas/<id>.json`，使用同样的等级（5 级即原样）。钢琴卷帘中的**编辑器**：用钢琴或键盘逐步输入（按住时音符
  停在光标处，松开后光标前进），或开节拍器实时录制（踏板延续松开的音）；每音力度（下方通道，「力度」控制，
  Alt+↑↓）；鼠标（点击放置，拖动移动或延长，右键删除）与键盘（方向键、Shift+方向键、Ctrl+↑↓ 八度、Tab 换手、
  Delete、Ctrl+Z/Y/A/C/X/V/Q、空格）；实时乐谱；导出 MIDI 和 MusicXML；可转为会话。MusicXML 支持反复、1./2.
  房子、D.C.、D.S.、Fine 和 Coda 展开。以慢速练习（50-100 %）：歌曲分轨变速不变调（FFmpeg + rubberband；每首歌
  每速度一次，存于 `$ESTUDIO_DATA/lento/`，每轨约 6 秒）。连接 MIDI 键盘时，练习还会判断力度：音符正确但过强
  或过弱时琴键显示黄色，并统计平均偏强/偏弱程度。在会话中：导入 MIDI/MusicXML 为会话，「在学习中练习」（会话
  作为乐曲）。引导音、会话和电脑键盘使用 Salamander Grand Piano 采样（`app/public/piano`，CC BY，2 MB）。
- **会话**：两个列表。歌曲：从曲库添加的带分轨歌曲（「＋ 添加歌曲」；列表存于 `sesiones/canciones.json`），按
  乐器（音量和 M/S，各自的钢琴卷帘，和弦与进行）。会话：在演奏中保存的，带歌曲的钢琴卷帘和走带控制（以合成
  钢琴发声）、调、最常出现的和弦与进行（点击=跳转）。「用 Claude 分析」（Opus 5.5，中等强度：按段落及其情绪、
  带音符与级数的和弦进行、错误分析）使用 Claude Code（`claude -p`，订阅版；不带工具和你的 hooks），在旁边生成
  `<sesión>.analisis.md`（约 1 分钟）。列表中的歌曲也可以，选择乐器（其音符、和弦和歌词；
  `sesiones/canciones/<canción>__<pistas>.analisis.md`）。Claude 收到的是 TOON（`toon.ts`：音符与和弦列表转成
  表格），不是 JSON。
- **演奏**：USB MIDI 键盘（`midir`，ALSA；插入即自动连接，取最后使用的或唯一的一个）。倒置的钢琴卷帘（弹奏时
  横条从琴键升起）、延音踏板、当前和弦及其级数和所弹内容的调（不用 AI，`live.ts` 配合 `harmony.ts` 的模板），
  通过 CC7 调键盘音量。没有钢琴时可用电脑键盘：A–Ñ 行为白键，W E T Y U O P 为黑键，Z/X 八度，空格踏板（连接
  钢琴时在钢琴上发声）。会话每 15 秒自动保存到 `$ESTUDIO_DATA/sesiones/<fecha>.mid`（任何地方都能播放）和
  `.json`（音符、名称、和弦和踏板，可交给 AI）。

- **曲库**：三个应用的所有歌曲。筛选、搜索（`/`）、排序；复选框选择、Ctrl/Shift+点击或 Ctrl+A，批量操作（全部、
  歌词、分轨、音符、节拍、删除）。
- **添加**（`N`）：按歌手和曲名（同 Letras）、从 YouTube 和任何 yt-dlp 支持的网站，或文件（也可拖入窗口），
  并选择后续处理。
- **歌曲**：每个阶段的卡片（音频、歌词、分轨、音符、edits），显示实时任务和「全部执行」。标签页：歌词（逐词
  卡拉OK，Letras 编辑器 `E`，重新搜索，回到上一版，偏移量；「行内微调」不改动任何一行的起点，音频把每个词放到
  下一行之前；「从音频开始」不使用逐行时间：Whisper 识别你的文本并逐字母对齐；添加歌曲时则优先使用网络时间轴，
  同 Letras）、分轨（混音器、M/S、节拍器 `M`）、钢琴卷帘（显示当前和弦、下一个和弦和调）、乐谱（总谱，跟随
  播放，PDF）、和弦（无节奏歌本：「Mim7」标在其进入的词上方，前奏和间奏按小节；标注调和音阶；Do/C、简化、
  级数；由转录音符每两拍得出，不用 AI）和 Edits（按规则创建、用 Claude 或你的预设；打开 Lyric Edits 编辑器）。
- `空格` 播放，`←/→` 快进快退 5 秒，`1-5` 切换标签，`Q` 队列。

- **Spotify**（Letras 的功能）：正在播放的歌曲自动查找，若其歌词不带时间轴则自动同步，排在队列首位。顶部显示
  正在播放；在其「歌词」标签页中，这里不播放，歌词跟随 Spotify 的时钟，跳转到某行会同步移动。可在设置中关闭。
- **播放列表**（设置）：公开播放列表中的歌曲每 6 小时在后台同步（`estudio-prefetch.timer`，有游戏在运行时
  等待）；「立即处理」和重试失败项。
- **桌面**：在桌面上隐藏显示，仅器乐和音符，位于「歌词」标签页。
- **服务器**（设置 → 服务器；批量操作中有「与服务器同步」）：每首歌已处理的数据（音频、人声、分轨、Whisper、
  对齐、节拍、和弦、音符、歌词及其历史、edits 及其背景）保存在 `server/server.py`，另一台电脑可以直接下载而不
  必重新提取。同步是双向的：一边缺的从另一边取，两边都改过的文件以较新者为准。音频和分轨作为整体与其派生内容
  一起传输：如果一边有另一个音频（另一个版本，或对齐时被裁剪），较新的整体块胜出，不会出现例如用一个音频的
  Whisper 配另一个音频的情况。半成品分离不会上传。文件按内容寻址（sha256）：同一音频硬链接在两处只上传一次，
  下载后重新硬链接。

  ```sh
  python3 server/server.py                       # localhost:8765, 数据在 ./store (PORT, HOST, STORE)
  ```

  localhost 之外需要 `ESTUDIO_TOKEN`（应用内：设置 → 服务器 → Token）。不带 TLS：部署在云端时置于 HTTPS 代理
  之后（Caddy、Traefik……）。不用应用时：`ESTUDIO_REMOTE=host:port engine/.venv/bin/python
  engine/hub.py remote_sync <clave>`。

StemLab 的曲库目录没有迁移过来（这里有筛选和搜索）。

数据：沿用之前应用的数据（`LETRAS_DATA`、`STEMLAB_DATA`、`LYRIC_EDITS_DATA`，标准不变），自有数据在
`$ESTUDIO_DATA` 或 `~/.local/share/estudio`（`songs.json`：无歌词歌曲及带分轨的链接；`queue.json`；
`settings.json`；视图）。Python：`engine/.venv`（或 `ESTUDIO_PYTHON`）。

## 开发

```sh
cd engine && uv sync
cd ../app && npm install && npm run tauri dev     # 端口 1440
```

测试：`cd engine && .venv/bin/python test_hub.py`（以及 `test_letras.py`、`test_stemlab.py`、`test_remote.py`）、
`cd app && npm test && npm run check`、
`cd app/src-tauri && cargo test`。真实数据：`ESTUDIO_TEST="todo <clave>" cargo test real_job -- --ignored --nocapture`。
安装到启动器：`./install.sh`。
