# 数据契约（v2）

> 本文件是各开发阶段之间的「接缝」。mock 与真实数据只要最终产出形状一致，换数据源时前端零改动。
> **契约变更必须先改本文件 + `types/contract.ts`（+ 同步 PROJECT.md §3），再改实现。**
> v2 变更：新增 `screen` 指标、`achievements` 成就；`petState` 从 4 个扩到 **7 个**（加 `angry`/`eyestrain`/`sick`）。

---

## 1. 核心原则

**判定靠规则，表达靠模型。**

- `petState` 永远由规则算出；大模型只读数据、翻译成人话，**绝不参与状态判定**。
- 客观数据走 MCP，不走 Hermes 记忆。Hermes 记忆只用于对话偏好/背景，不存客观数据。
- 前端永远不推导 `petState`，只做 **状态→动画** 映射。
- 桌宠表现分两层：**持续心情**（`petState`，待机循环）+ **一次性庆祝**（`achievements` 新增项触发的撒花）。

---

## 2. 数据类型

机器约束见 `types/contract.ts`，以下为说明。

### PetState（7 个 · 持续心情）

| petState | 含义 | 触发（见 §3） |
|---|---|---|
| `thriving` | 元气满满 | 运动+阅读达标且屏幕未超标 |
| `good` | 一般满足 | 至少一项达标 |
| `slacking` | 蔫/摆烂 | 整体平庸、都没达标 |
| `resting` | 睡觉 | 夜间(≥22:00) 或 无数据 |
| `angry` | 生气催动 | 运动量过低（硬线） |
| `eyestrain` | 迷糊 | 屏幕严重超标（硬线） |
| `sick` | 生病 | 健康指标明显异常 |

### MetricScore（极性已对齐：value 越高越健康）

| 字段 | 类型 | 说明 |
|---|---|---|
| `value` | number | 0.0–1.0 归一化**健康度**，达标=1.0、截断到 1.0 |
| `goalMet` | boolean | `value >= 1.0` 即为 true |

> 越多越好的指标（运动/阅读）：`value = 进度/目标`。
> 越少越好的指标（屏幕）：评分服务**反转**——在预算内→接近 1.0，越超→越低。前端拿到的永远是「越高越健康」。

### Scores

| 字段 | 类型 | 说明 |
|---|---|---|
| `date` | string | `"YYYY-MM-DD"` |
| `exercise` | MetricScore | 运动（越多越好） |
| `reading` | MetricScore | 阅读（越多越好） |
| `screen` | MetricScore? | 屏幕时长（越少越好，已反转为健康度）。过渡期可选，接入屏幕源后应始终给出 |
| `petState` | PetState | 由规则算好 |
| `achievements` | string[]? | 今日已达成成就 key（累计），前端 diff 出新增播庆祝 |
| `updatedAt` | string | ISO 8601 |

---

## 3. PetState 状态规则（v2）

判定输入：`exercise`、`reading`、`screen`、是否夜间/无数据、是否健康异常。**从上往下，命中即止：**

| # | 条件 | petState |
|---|---|---|
| 1 | 健康指标明显异常 | `sick` |
| 2 | 无数据 或 夜间（本地 ≥ 22:00） | `resting` |
| 3 | 运动量过低（硬线，默认 `exercise.value < 0.25`，约 步数 < 2000） | `angry` |
| 4 | 屏幕严重超标（硬线，默认 `screen.value <= 0.3`，约 ≥ 8h） | `eyestrain` |
| 5 | `exercise.goalMet && reading.goalMet && screen.goalMet` | `thriving` |
| 6 | `exercise.goalMet || reading.goalMet` | `good` |
| 7 | 其余 | `slacking` |

**goalMet 规则：`goalMet = (value >= 1.0)`。**

**默认阈值（均可调，写在评分服务里）：**
- 运动日目标：步数 8000 / 活动 30min（`exercise.value = 实际/目标`）
- 运动「过低」硬线：`exercise.value < 0.25`
- 屏幕健康预算：≤ 4h（`screen.goalMet`）；「严重超标」硬线：`screen.value <= 0.3`（约 ≥ 8h）
- 阅读日目标：用于 `reading.goalMet`（如 ≥ 30min；2h 触发 `reading_2h` 成就）

此规则归属「评分服务」（MVP 阶段实现在 mock 生成器内），**不属于前端、不属于 Hermes**。`petState` 不得随机、不得调大模型。

> `screen` 缺省（过渡期）时：第 4 条不触发，第 5 条的 `screen.goalMet` 视为 true（不因缺数据误判）。

---

## 4. 成就庆祝（achievements）

- `achievements` 是**当天累计**已达成的 key 列表。
- 前端每次轮询和上一次 diff，**新增的 key** 各播一次 `celebrate`（撒花）+ 对应气泡，当天不重复。
- 建议 key：`exercise_goal`（运动达标）、`steps_goal`（步数达标）、`workout_done`（完成一次运动）、`reading_2h`（阅读满 2h）。开放扩展。
- 成就是**叠加在持续心情之上的一次性弹层**，放完回到当前 `petState`。

---

## 5. 异常处理（两类，别混）

| 类型 | 含义 | 表现 | 归属 |
|---|---|---|---|
| **健康异常** | 数据有效，但健康指标明显不对劲 | `petState = sick`（持续） | 评分服务（规则 §3 第 1 条） |
| **数据异常** | 数据缺失/不符契约/不可能值（负数、屏幕>24h、跳变） | 前端显示 `alert`（疑惑）一次性 + 看板标记 | 前端/校验层，**不是 petState** |

> 「健康异常」的判定信号**待定（TBD）**：A) 接 HealthKit 体征（心率/睡眠/血氧…）超健康区间——需新增数据源；B) 先用现有源极端模式近似。默认先留接口、不误触发。

---

## 6. MCP 工具签名（不变）

| 工具 | 参数 | 返回 |
|---|---|---|
| `get_today_scores` | （无） | 当天的 `Scores` 对象 |
| `get_scores_range` | `start`, `end`（`"YYYY-MM-DD"`） | `Scores[]`，按日期升序 |

签名跨阶段不变；MVP 返回 mock，Phase 2 改查 SQLite。

---

## 7. 样本

见 `mock/scores.sample.json`。

> **实现待跟进**（本轮只更新契约定义）：mock 评分规则落地到 v2（screen + 7 状态 + 成就）、屏幕数据源接入、桌宠精灵换 16 行图集（见 `docs/sprite-brief.md`）。
