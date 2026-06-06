# Hermes AOS —— Agent Operating System 设计 (v0.1)

> 长期陪伴型 Agent「Hermes」的整体架构。各模块（Pet 状态系统、阅读/复盘系统、健康、记账、Todo…）完成后统一接入此基础设施。
> 本文是设计蓝图，不含代码。所有结构按「Hermes 原生能力 vs 我们自建」落地，避免空想。

---

## 0. 设计原则 & 落地映射

**五条原则**
1. **判定靠规则，表达靠模型**：客观状态（petState、是否达标、是否异常）由确定性规则算；模型只做理解、检索、表达、规划。
2. **数据是单一事实源（UUS）**：所有子系统读写同一份「统一用户状态」；Agent 不各存各的事实。
3. **本地优先 + 冷热分离**：真相源（冷）本地/私有 Git；派生索引（热）SQLite。**真实 PII 不上公开仓库**。
4. **上下文按需装配**：每轮只加载「与意图相关 + 高价值」的上下文，受 token 预算约束。
5. **主动有度**：主动打扰经过优先级 + 冷却 + 安静时段治理，宁少勿扰。

**Hermes 原生（直接用，不自建）**
- 对话主循环、工具调用（MCP client）、内置记忆、云模型后端、**OpenAI 兼容 API（:8642）**、**gateway/cron 调度**。

**我们自建（围绕 Hermes）**
- UUS 数据层（冷 Git + 热 SQLite）+ 各域 **MCP server**（数据接口）+ **评分服务**（规则→Scores 契约）+ **Trigger/Event 服务 + 主动治理器**（sidecar）+ **Reflection/Planner 定时任务**（调度触发的模型提示）+ **桌宠客户端**（Tauri，化身 + 主动出口）。

> 关键认知：下面的「子 Agent」不都是独立 LLM 进程。有的是 **Hermes 的角色提示（role）**（Dialogue/Reflection/Planner），有的是**确定性服务/MCP**（Pet 评分、Data Sync、Trigger）。Hermes 是编排者。

---

## 1. 系统架构图（4 层 + 角色）

```
┌──────────────────────────────────────────────────────────────────────┐
│ ① 化身层 Embodiment —— 桌宠 (Tauri + codex-pets-react)                  │
│    心情/能量动画 · 气泡(主动出口) · 对话输入 · 「打开工作台」入口         │
└─────────▲────────────────────────────────────────────┬────────────────┘
          │ 主动消息 / 当前状态                           │ 用户对话
┌─────────┴────────────────────────────────────────────▼────────────────┐
│ ② Agent 核心 —— Hermes (云模型 + 工具调用 + 记忆 + cron)                 │
│   角色(roles，同一编排下):                                              │
│   ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌────────┐ ┌──────────────┐    │
│   │Dialogue │ │Reflection│ │ Planner │ │  Pet   │ │ Memory(检索/写)│    │
│   └────┬────┘ └────┬─────┘ └────┬────┘ └───┬────┘ └──────┬───────┘    │
│        │   ▲ Context Assembly Pipeline      │ persona 调制 │            │
│        └───┴──────────────┬─────────────────┴─────────────┘            │
└───────────────────────────│──────────────────────────▲────────────────┘
          MCP 工具调用(读/写) │                  事件/主动触发 │
┌───────────────────────────▼──────────────────────────┴────────────────┐
│ ③ MCP 层 —— 统一工具接口（意图明确，不暴露裸 SQL）                       │
│   scores/health · reading · finance · todo/goals · memory · profile     │
└───────────────────────────┬──────────────────────────▲────────────────┘
                  读/写       │                    watch  │ 事件
┌───────────────────────────▼──────────────────────────┴────────────────┐
│ ④ 数据层 —— Unified User State (UUS)                                     │
│   冷: 私有 Git/文件(真相源·事件日志)  ┃  热: SQLite(时序/索引/快照)        │
│   评分服务(规则→petState/achievements)  ┃  Reflection 产物(摘要/画像)      │
│   ▲ ingest                                              ▲ watch          │
│   │ Data Sync 连接器                                     │               │
│   微信读书CLI · 健康导出(HealthKit) · 运动 · 手动(记账/Todo)   Trigger/Event 服务 + 主动治理器 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Agent Layer：6 个子 Agent

| 子 Agent | 职责 | 实现方式 | 触发时机 |
|---|---|---|---|
| **Dialogue** | 理解用户输入、装配上下文、调工具、用 Pet 人格表达 | Hermes 主循环 + 系统提示(注入 persona) | 用户每轮 / 主动消息 |
| **Memory** | 三层记忆读写、检索(RAG)、晋升/遗忘 | Memory MCP(读写/检索) + 夜间蒸馏任务 | 每轮(读) / 定时(写、蒸馏) |
| **Reflection** | 日/周复盘：摘要、蒸馏中→长记忆、更新画像、重算成长 | cron 触发的模型提示(读 UUS 写 Memory/Profile) | 每日 22:30 / 每周日 |
| **Planner** | 目标(年/季)分解、进度跟踪、下一步建议、长期激励 | todo/goals MCP + Reflection 驱动的规划提示 | 周复盘 / 用户问目标 / 截止临近 |
| **Pet** | UUS→心情/能量/成长/技能/性格；驱动化身；产出 persona 调制参数 | 评分服务(规则) + pet_state 存储 + 桌宠客户端 | 数据变化 / 每轮(给 persona) |
| **Data Sync** | 外部数据 ingest 进 UUS（标准化为事件+时序） | 各连接器(CLI/导出/手动) + 各域 MCP | 定时同步 / 手动录入 |

**协作（一句话）**：Data Sync 把世界写进 UUS → 评分服务/Pet 把状态算出来 → Trigger 监视 UUS 发事件 → Hermes(Dialogue) 在「用户来话」或「主动事件」时，经 Context Pipeline 取 Memory+UUS+Pet 状态 → 模型表达 → 桌宠呈现；Reflection 夜里把今天沉淀进记忆与画像，反哺明天的上下文与 Pet 成长。

---

## 3. 数据流图（4 条主流）

```
(A) 摄取流 Ingest
  外部源 ──Data Sync──► 事件日志(冷,append-only) ──► 时序/快照(热) ──► 评分服务 ──► Scores(petState/achievements)
                                                                                   └──► 桌宠

(B) 反应流 Reactive (用户对话)
  用户消息 ─► 意图识别 ─► Context Pipeline ─►(Memory检索 + UUS今日摘要 + Pet状态/persona)─► 模型(+MCP工具) ─► 回复
                                                                                          └─► 写短期记忆/会话日志

(C) 主动流 Proactive (定时/数据变化)
  cron/变更 ─► Trigger Engine(规则) ─► 候选事件 ─► 治理器(优先级+冷却+安静时段) ─► 通过 ─► Hermes 组织措辞 ─► 桌宠气泡/通知 ─► proactive_log

(D) 沉淀流 Reflection (夜间/每周)
  当日事件+会话 ─► 日摘要 ─► 中期记忆;  每周 ─► 蒸馏长期记忆 + 更新画像 + 重算目标进度/Pet成长;  衰减/遗忘低价值条目
```

---

## 4. 统一数据模型（UUS）

**冷热分离**：冷 = 私有 Git/文件，append-only 事件日志 = 真相源；热 = SQLite，时序/索引/快照（可由冷重建）。沿用契约思想：换数据源时上层零改。

### 核心表（字段为设计，非建表语句）

| 表 | 关键字段 | 层 | 说明 |
|---|---|---|---|
| `events` | id, ts, domain, type, payload(json), source, dedupe_key | 冷(真相) | 一切行为的 append-only 日志 |
| `metrics_daily` | date, domain, metric, value, goal, goalMet | 热(时序) | 每日聚合，喂评分服务 |
| `scores_daily` | date, exercise, reading, screen, petState, achievements[], updatedAt | 热(派生) | **= 数据契约 Scores**（见 docs/CONTRACT.md） |
| `goals` | id, horizon(year/quarter), title, metric, target, progress, status | 热 | 年/季目标 |
| `todos` | id, title, project, due, priority, status | 热 | 任务 |
| `finance_tx` | id, ts, type(income/expense), amount, category, note | 热(时序) | 记账 |
| `reading_*` | books(shelf,progress) / sessions(min,ts) / highlights / notes / reviews | 热 | 微信读书 |
| `health_*` | steps/sleep/hr/weight(时序) / workouts(run,bike,gym) | 热(时序) | 健康+运动 |
| `messages` | id, session_id, role, content, ts | 热 | 短期会话 |
| `daily_summary` / `weekly_summary` | date, text, salient(json) | 热 | Reflection 产物(中期) |
| `memory_notes` | id, text, type, salience, ts, last_access, embedding, source_ref | 热+向量 | 长期语义 + RAG |
| `user_profile` | identity, persona_traits, habits, preferences, important_events | 热(单例) | 长期画像 |
| `pet_state` | mood, energy, growth_level, xp, skills(json), personality(json), last_interaction | 热 | Pet 人格状态 |
| `proactive_log` | event_id, delivered_ts, channel, ack, snoozed_until | 热 | 冷却/治理状态 |

### 四个 Schema（点名要的）
- **Event Schema** = `events`：`{id, ts, domain, type, severity?, payload, source, dedupe_key}`。所有域统一成事件。
- **Time-series Schema** = `metrics_daily` + `health_*`/`finance_tx`：`{ts|date, key, value}` 形态，便于趋势/异常检测。
- **User Profile Schema** = `user_profile` + `goals`：稳定身份/习惯/偏好/重要事件/目标。
- **Unified User State** = 以上之并，并对外暴露一个 **「今日快照」物化视图**（`today_snapshot`：petState + 各域当日要点 + 活动目标），供 Context Pipeline 低成本读取。

---

## 5. 记忆架构（三层）

```
┌ 短期 Working ──────────────────────────────────────────┐
│ 内容: 当前会话 + 最近 N 轮  │ 存: messages/会话buffer    │
│ TTL: 会话~当天             │ 形态: 原文 verbatim         │
└───────────────┬──────────────── 夜间 Reflection 摘要 ───┘
┌ 中期 Episodic ▼────────────────────────────────────────┐
│ 内容: 日/周摘要 + 显著事件 + 行为时序  │ 存: *_summary/events│
│ 跨度: 数周                 │ 形态: 摘要 + 结构化           │
└───────────────┬──────────────── 周/月 蒸馏 ────────────┘
┌ 长期 Semantic ▼────────────────────────────────────────┐
│ 内容: 用户画像(身份/习惯/偏好/目标/里程碑) + 语义笔记(向量)│
│ 跨度: 数月~数年            │ 形态: 结构化画像 + RAG 可检索  │
└────────────────────────────────────────────────────────┘
```

| 决策 | 规则 |
|---|---|
| **长期保存** | 身份事实、稳定偏好/习惯、目标、里程碑/重要事件、反复出现的模式、用户明确"记住" |
| **定期遗忘** | 闲聊、瞬时状态、已被摘要覆盖的日级细节、低显著且久未访问条目（时间衰减 × 访问频率） |
| **提炼成画像** | 反复行为→习惯；多次表达→偏好；成就/挫折→轨迹；目标+进度→规划输入 |

**写入策略**：每条候选记忆打 `salience = 重要性 × 新近 × 重复度`；高→长期 `memory_notes`/画像，中→中期摘要，低→只留短期随会话过期。Reflection 负责晋升/降级/衰减。

---

## 6. Context Assembly Pipeline

**目标**：用户来一句话，决定「装哪些上下文」，受 token 预算约束。**绝不全量加载。**

```
用户消息
  │
①意图&线索: 分类(reading/health/finance/todo/goal/chitchat/meta) + 抽实体/时间词   (规则或轻模型)
  │
②候选收集 (每个"上下文提供者"给候选块):
   ├ 会话: 最近 N 轮                         (always)
   ├ 今日快照: today_snapshot + petState      (always, 小)
   ├ 目标: 活动中的 年/季目标                 (small)
   ├ 近期行为: 按意图取域(阅读/运动/消费/Todo) (intent-gated)
   ├ 长期画像: persona/习惯/偏好              (small, always)
   └ 长期语义: RAG over memory_notes/划线笔记  (top-k by 相似度)
  │
③打分: priority = 类型基权 × 相关度(对意图) × 新近 × salience
  │
④Token 预算分配(见下) + 贪心填充(必带项先占, 余量按分数填)
  │
⑤压缩: 用预算化摘要替原文, 截断长块
  │
⑥拼装 → 模型
```

**Context Selection Strategy**

- **优先级机制**：分「必带(floor)」与「尽力(best-effort)」。必带 = 系统/persona + 最近几轮 + 今日快照（即使预算紧也保）；其余按 ③ 的分数竞争。
- **Token 预算分配**（示例，总 ~12k 上下文）：

  | 区块 | 配比 | 下限/上限 |
  |---|---|---|
  | 系统 + Pet persona | ~10% | 固定 |
  | 最近会话 | ~25% | 下限保最近 3–5 轮 |
  | 今日快照 + 状态 | ~10% | 小而必带 |
  | 目标(年/季) | ~10% | 上限封顶 |
  | 意图相关近期行为 | ~25% | 按分数填 |
  | 长期 RAG | ~20% | 填满余量 |

- **Memory Retrieval**：混合检索 = 结构化查询(UUS 按域/时间) + 向量 RAG(memory_notes、阅读划线/笔记) + 新近加权。
- **RAG 方案**：query 向量化 → 在 `memory_notes`(+阅读笔记) ANN 召回 → rerank(相似度×salience×新近) → top-k → 带来源引用注入。后续可加「问题改写/多跳」。

---

## 7. 主动对话系统（Event System）

```
数据变化/定时 ─► Trigger Engine(规则集) ─► 候选事件 ─► 主动治理器 Governor ─► (通过)Hermes 措辞 ─► 桌宠/通知
                                                  │过滤: 优先级·冷却·安静时段·去重·DND
                                                  └► proactive_log(记录, 支撑冷却)
```

**Trigger Engine**：规则评估器，cron(如每 15min) + 数据变更触发；每条规则 = UUS/时序上的条件 → 产候选事件(含建议措辞意图)。

**事件目录（示例）**

| 域 | 事件 | 条件示例 | severity |
|---|---|---|---|
| 阅读 | reading.none_today / streak_break | 今日 0 阅读 / 连续 N 天中断 | notice |
| 健康 | health.sleep_drop | 近 3 日睡眠均值下降 > 阈值 | important |
| 运动 | exercise.low / high_burn | 长期偏低 / 单日消耗异常高 | notice/important |
| 财务 | finance.spend_anomaly | 本周支出 > 基线 × k | important |
| Todo | todo.deadline_near / project_idle | 重要项 < 24h / 长期项 N 天无进展 | important/info |
| Pet | pet.state_change(angry/eyestrain/sick) | petState 变化 | info→important |
| 成就/目标 | achievement.unlocked / goal.milestone | 新成就 / 目标过节点 | info |

**Event Schema**：`{id, type, severity(info|notice|important|urgent), source, ts, payload, dedupe_key}`。

**Notification Priority**：`渠道 = f(severity, 用户情境, 新颖度)`
- 静默（只改 Pet 心情）← info
- 被动（Pet 气泡）← notice/important
- 主动（系统通知）← urgent 或 用户当前在看桌宠
- 安静时段/专注/DND → 降级或压到次日。

**Cooldown / 治理器**（防打扰核心）
- 每类型冷却（如阅读提醒 ≤ 1/日）；全局每日主动预算（≤ K 条）。
- 安静时段（如 22:00–9:00 仅紧急）；ack/snooze 抑制重复；同 dedupe_key 合并。
- 仅高 severity 才允许升级渠道；其余宁可只用 Pet 心情默默表达。

---

## 8. Pet 系统 × Agent（化身不是装饰）

### 数据 → Pet 属性 映射

| Pet 属性 | 来源(UUS) | 时间尺度 | 作用 |
|---|---|---|---|
| **心情 Mood** | 今日 `petState`（运动/阅读/屏幕/健康规则） | 当天 | 选待机动画(thriving/good/slacking/angry/eyestrain/sick/resting) |
| **能量 Energy** | 当日收支：运动↑ 睡眠↑ / 屏幕过度↓ 久坐↓ | 当天/小时 | 动画活跃度、是否蹦跳 |
| **成长 Growth/XP** | 长期：连续达标、成就累计 | 数周+ | 升级、解锁 |
| **技能 Skills** | 里程碑解锁（如阅读 7 日流→读书动作） | 阶段 | 新动画/能力 |
| **性格 Personality** | 长期模式漂移（常运动→活泼；爱读→书卷气） | 数月 | 默认待机风格 + Hermes 语气底色 |

> 心情=短期情绪、能量=当日活力、成长/技能/性格=长期累积——三尺度分开，避免「今天没达标就抹掉所有成长」。

### Pet 状态 → Hermes 表达风格（persona 调制）

Pet Agent 产出一组**调制参数**（warmth/energy/concern/pushiness/length）注入 Dialogue 系统提示，让「Hermes 说话像 Pet 此刻的心情」：

| Pet 状态 | 语气 | 主动策略 |
|---|---|---|
| thriving/元气 | 上扬、俏皮、爱庆祝 | 多正反馈、可邀约更高目标 |
| good | 平和、鼓励 | 轻提醒 |
| slacking | 温和打趣、轻推 | 一句话点一下，不唠叨 |
| angry(运动过低) | 假装气鼓鼓、催促 | "起来动一动！"较直接 |
| eyestrain(屏幕过度) | 关切、建议休息 | 提议护眼/放下手机 |
| sick(健康异常) | 轻柔、低能量、担心 | 只关心、不施压、可建议就医 |
| resting/夜间 | 安静、简短 | 几乎不主动，除非紧急 |

---

## 9. Agent Workflow（4 个 loop）

**① 反应 loop（用户每轮）**
`消息 → 意图 → Context Pipeline → 模型(可调 MCP 工具取实时事实) → 回复 → 写短期记忆`

**② 主动 loop（cron/变更）**
`Trigger 评估 → 候选事件 → Governor(优先级/冷却/安静) → Hermes 措辞 → 桌宠气泡/通知 → 记 proactive_log`

**③ 沉淀 loop（每日 22:30 / 每周）**
`读当日事件+会话 → 日摘要(中期) → [周] 蒸馏长期记忆 + 更新画像 + 重算目标进度 & Pet 成长/技能 → 衰减遗忘`

**④ 摄取 loop（定时/手动）**
`连接器拉取/录入 → 标准化为事件 → 写冷日志 + 热时序 → 评分服务算 Scores → 刷新 Pet 心情`

> ②③④ 用 Hermes gateway 的 **cron** 调度；②③ 的"措辞/蒸馏"是调度触发的模型提示；④ 与评分是确定性服务。

---

## 10. 后续开发路线图

| 阶段 | 目标 | 交付 |
|---|---|---|
| **P0 地基** | UUS 落地 + 契约对齐 | SQLite 热库 + 事件日志(冷) + 评分服务实现 contract v2(7 状态/screen/成就) + scores MCP 升级 |
| **P1 化身闭环** | Pet 真正反映状态 | 桌宠接 UUS（心情/能量）+ 16 行图集 + 对话走 :8642 |
| **P2 记忆 + 上下文** | Hermes 会"记得" | 三层记忆表 + Memory MCP + Context Pipeline(意图/预算/RAG) + 夜间日摘要 |
| **P3 主动系统** | 不打扰的主动 | Trigger 引擎 + 事件目录 + 治理器(冷却/安静) + Pet 气泡出口 |
| **P4 多源融合** | 接入真实数据 | Data Sync：微信读书 CLI、HealthKit 导出、记账/Todo 录入 → UUS |
| **P5 反思 + 规划** | 长期陪伴成形 | Reflection(周蒸馏/画像) + Planner(年/季目标分解/激励) + Pet 成长/技能/性格 |

---

### 附：与现有资产的衔接
- 数据契约（`docs/CONTRACT.md` / `types/contract.ts`）= UUS 的 `scores_daily` 形状，已是 v2。
- scores MCP server（`mcp/`）= MCP 层「scores/health」工具的雏形，扩展即可。
- Hermes（`hermes/RUN.md`）= Agent 核心，已配 :8642 API + scores MCP；后续把 reading/finance/todo/memory/profile 逐个挂成 MCP。
- 桌宠（`pet/` + `docs/sprite-brief.md`）= 化身层。
