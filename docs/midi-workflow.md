# MIDI 优化工作流：节拍/小节展示与分段优化（方案与进度）

> 目标：把「优化MIDI」补齐成一个可验证的工作流。本文档是任务清单与进度记录；
> 引擎细节见 [midi-pipeline.md](midi-pipeline.md)，提交 `df2331c`。

## 目标工作流

1. 音频文件输入
2. 分轨 → 轨道是可播放的 MIDI（采样钢琴发声）
3. 界面直观展示 MIDI 的拍号（3/4、4/4…）与小节分割线（用户能判断节拍和小节分割是否准确）
4. 步骤 3 不准确时，用户能手动设置节拍
5. 整轨交给大模型优化小节分割（考虑成本，大模型只给出小节分割点）
6. 用户手动选择小节（一个或多个）交给大模型优化 MIDI，不能选任意时间段

## 总体结论（2026-10-25 评估）

- **步骤 1、2 已完成。**
- **步骤 3～6 合理、可执行**，架构上大部分已预留，其中步骤 6 的引擎与触发链路已存在，只差点选小节的交互。
- 小节划分逻辑（`Timeline`，`engine/beautify.py:125`）本就设计为多段 segments，文档明言「曲中换拍只需改 `from_beats` 一处」——步骤 5 的 LLM 分割点可直接映射到该结构。
- 建议实施顺序：**3 → 4 → 6 交互增强 → 5**（3 是视觉判断基础；4 补修正闭环；6 仅差交互；5 依赖 3/4 的确认界面且收益不确定性最大）。

## 待办任务

### 步骤 1～2：已完成 ✅

- [x] 音频输入（下载/导入，Letras 键统一）
- [x] 分轨（BS-RoFormer 6 轨）+ 每轨转写 roll（basic-pitch / MuScriptor），金色优化轨可用采样钢琴播放

### 步骤 3：拍号与小节分割线展示（2026-10-25 完成）

数据已齐：`beats.json`（`beats`/`downbeats`/`meter`，`engine/hub.py:1249`）→ 前端 `Detail.beatData`。小节线 = 从第一个强拍起每 `meter` 拍一条。落点：共享模块 `app/src/lib/beats.ts`（移植引擎规则）+ `Roll.svelte` + `MasterStrip.svelte` + `SongView.svelte`。

- [x] 3.1 在钢琴卷帘（`app/src/lib/Roll.svelte`）画小节分割线（强拍起、每 `meter` 拍一条竖线；已有和弦标记先例）——横线 + 左侧小节号（1 起）
- [x] 3.2 拍号显示：卷帘头部图例 / 歌曲头部 chip / 节拍器弹层，`meter=6` 规约为 `6/8`（`beats.ts meterLabel`）
- [x] 3.3 顶部歌曲条（MasterStrip）画小节刻度（拖 A–B 时对准小节）；轨上波形不画，避免噪声
- [x] 3.4 统一小节换算规则：新建 `app/src/lib/beats.ts`（`cleanBeats`/`firstDownbeat`/`barStarts`，与 `beautify.py` 的 `clean_beats`/`first_downbeat_index`/`extend_tail` 同规则同源 `beats.json`），`loopBars` 改用 `firstDownbeat`（众数相位，弃「第一个强拍」）；附 `beats.test.ts`（挂入 npm test）

验收：用户在卷帘中能对照小节线听/看，判断「第 N 小节是否从强拍开始」。✅ 测试全绿（`npm test` 全套 + `svelte-check` 0 错 0 警 + `tsc` edit 工程）；真机浏览器视觉核对待用户在 app 里确认。

### 步骤 4：手动设置节拍（2026-10-25 完成）

现状：节拍器弹层的手动 3/4/4/4 + 移动重音（`SongView.svelte`）只是本地 view state，引擎不知道。关键改动是**落盘共享**。

**设计决策**：不新增偏移字段，而是让 `meter_set` 直接**重写 `beats.json` 的 `downbeats`**（按新拍号 + 相位从拍点网格重建）并标记 `meterFrom: "manual"`——所有消费方（引擎量化、前端小节线、loopBars、节拍器重音）零改动即生效，单一事实源保持不变。重跑「Pulsos」会重新检测并覆盖手工修正（代码注释已说明）。

- [x] 4.1 `beats.json` 扩展：重写 `downbeats` + `meter` + `meterFrom: "manual"`（引擎命令 `meter_set(key, meter, shift)`，`hub.py`；网格重建 `beautify.py manual_grid`：相位投票 + 逐拍移动，重写后的网格投票稳定，可连续微调）
- [x] 4.2 手动设置 UI：节拍器弹层——拍号 Tabs（2/4、3/4、4/4、6/8，异常拍号自动补选项）+ `‹`/`›` 小节线前移/后移一拍；保存即写盘；`meterFrom === "manual"` 时显示「手动」标记
- [x] 4.3 引擎 `_timeline()` 与前端 `loopBars`/`barStarts` 都从 `beats.json` 读 → 单一事实源（步骤 3 的 `beats.ts` 已统一规则；`meter_set` 只动文件）
- [x] 4.4 下游失效处理：`beautify.py refresh_bars` 在 `midi_optimize`/`midi_patch` 写新轨时**按当前时间线重算**小节列并补齐 6 列（stem 源的 4 列段也归一）；选段过滤（`inside`/`outside`）改为始终重算不再信任存储列（`bar_of_row` 已删除）；`beautify_review` 分窗同样重算。旧轨的存储小节列不再被任何消费方使用

验收：用户改 3/4 后，卷帘小节线、节拍器重音、选段换算、再优化的量化网格全部一致。✅ `test_hub.py` 新增 meter_set/refresh_bars 断言全过；前端全套测试 + `svelte-check` 0 错 0 警；`cargo check` 通过。真机验收待用户在 app 里操作确认。

### 步骤 5：整轨 LLM 优化小节分割（只要分割点）

架构已预留：LLM 输出表达为分段表 `[(起始拍索引, 每小节拍数), ...]`，映射到 `Timeline` segments，下游（量化/出谱）零改动。

- [ ] 5.1 定义 LLM 输入：拍级特征摘要（onset 密度、和弦变更点、强拍置信度），紧凑可控（几 KB）
- [ ] 5.2 新引擎命令（如 `bars_suggest`）：调 `llm.py`，产出分段表；**白名单校验**（单调递增、meter ∈ {2,3,4,6}、覆盖全曲、分段数上限）
- [ ] 5.3 定位为「建议」：UI 上与自动结果并排展示（依赖 3 的小节线渲染），**用户确认后**才写入 `beats.json`
- [ ] 5.4 `Timeline.from_beats` 支持从 `beats.json` 的 segments 构建多段（文档预留的单点改动）
- [ ] 5.5 接线：`plan()` action、Rust `run_cmd` 白名单、前端入口与 i18n（en/zh/es，parity 测试会拦）

已知边界（写进 prompt/预期管理）：
- LLM **看不到音频**，只能看特征摘要；价值在全局一致性判断（曲中换拍、半小节错位、相位漂移），不是听力；
- 小节线必须落在 Beat This! 的拍点网格上，模型本身漏拍/多拍时分割点修不了（`clean_beats` 已做补漏兜底）。

验收：一首换拍曲（如 4/4→3/4）能被正确分段，确认后量化与出谱的小节划分一致变化。

### 步骤 6：按小节选段交给 LLM 优化（大部分已实现）

引擎与触发链路已存在：`midi_optimize(key, src, from_bar, to_bar)` 选段重优化；`midi_patch` 选段 LLM 补丁（drop/vel/shift 白名单、产新轨、原轨不动），UI 由 ⇧ 拖 A–B → `loopBars` 换算成小节区间（`SongView.svelte:839-843`）。「不能选任意时间段」约束已天然满足。

- [x] 6.1 选段重优化引擎命令（`hub.py:987`）
- [x] 6.2 选段 LLM 补丁（`hub.py:1091`）+ 白名单校验 + 版本链
- [x] 6.3 A–B 拖拽 → 小节区间换算与触发按钮
- [ ] 6.4 交互增强（依赖 3.1）：卷帘内直接**点选/框选小节**（点小节号或拖过多条小节线）作为选段来源，替代「在歌曲条上拖时间再换算」的间接触感

验收：用户在卷帘点选第 5–8 小节 → 「交给 LLM」→ 新轨只变更该段，段外平移自源轨。

### 交叉项（随步骤推进）

- [x] X.1 小节推导逻辑收敛：同源 `beats.json` + 同一规则（引擎 `beautify.py` 的 Python 版、前端 `beats.ts` 的 TS 版互为镜像，`test_hub.py`/`beats.test.ts` 双侧锁行为）；`meter_set` 只写文件不动代码（步骤 3/4 完成）
- [x] X.2 `beats.json` 变更的下游失效：改为**消费时重算**（`refresh_bars`、选段过滤、`beautify_review` 都按当前时间线算），存储小节列仅作参考不再被消费；改拍后新产出的轨/谱/审查天然正确（步骤 4 完成）
- [ ] X.3 新命令全链路接线清单：`plan()` + Rust 白名单 + `ACTION_LABEL` + i18n 三语（`meter_set` 走直调已接线：COMMANDS + Rust OK 列表 + i18n；排队类新命令仍按此清单）
- [ ] X.4 每步完成后的验证：`engine` 测试（`test_hub.py`）、`npm test`、`npm run check`、`cargo check`；真实数据跑一首曲（老人與海）对照听

## 进度记录

| 日期 | 进度 |
| --- | --- |
| 2026-10-25 | 步骤 4 完成：引擎 `meter_set`（重写 downbeats + `meterFrom: "manual"`，COMMANDS + Rust 白名单）；节拍器弹层手动拍号 Tabs + ±一拍；下游失效改为消费时重算（`refresh_bars`，删 `bar_of_row`）。引擎/前端/cargo 全绿。真机验收待用户确认 |
| 2026-10-25 | 步骤 3 完成：新增 `app/src/lib/beats.ts`（引擎同规则）+ 测试；Roll 小节线与小节号、拍号（chip/图例/节拍器，6/8 规约）；MasterStrip 小节刻度；`loopBars` 换用共享相位算法。测试与 `svelte-check` 全绿。真机视觉核对待办 |
| 2026-10-25 | 方案评估完成（本文档）；1、2 已完成，6.1–6.3 已存在于提交 `df2331c`；3/4/5 及 6.4 未开工 |
