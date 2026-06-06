# 数据契约（全期冻结）

> 本文件是三个开发阶段之间的「接缝」。mock 与真实数据只要最终产出形状一致，换数据源时前端零改动。
> **契约一旦冻结即不可更改；如需变更，必须先改本文件再改代码。**

---

## 1. 核心原则

**判定靠规则，表达靠模型。**

- `petState` 永远由规则算出；大模型只读数据、翻译成人话，**绝不参与状态判定**。
- 客观数据走 MCP，不走 Hermes 记忆。「今天动了多少」这类事实始终从 MCP 实时查；Hermes 记忆只用于对话里的偏好/背景，不保证、不存客观数据。
- 前端永远不推导 `petState`，只做 **状态→动画** 的映射。

---

## 2. 数据类型

机器约束见 `types/contract.ts`，以下为规则说明。

### PetState

```
"thriving" | "good" | "slacking" | "resting"
```

### MetricScore

| 字段 | 类型 | 说明 |
|---|---|---|
| `value` | number | 0.0–1.0 归一化达标进度（达标=1.0，超出截断到 1.0） |
| `goalMet` | boolean | `value >= 1.0` 即为 true |

### Scores

| 字段 | 类型 | 说明 |
|---|---|---|
| `date` | string | 格式 `"YYYY-MM-DD"` |
| `exercise` | MetricScore | 运动达标情况 |
| `reading` | MetricScore | 阅读达标情况 |
| `petState` | PetState | 由规则算好直接给前端 |
| `updatedAt` | string | ISO 8601 |

---

## 3. PetState 状态规则（冻结）

判定输入：`exercise.goalMet`、`reading.goalMet`、是否夜间/无数据。**从上往下，命中即止：**

| 条件 | petState |
|---|---|
| 无数据 或 夜间 | `resting` |
| exercise 且 reading 都达标 | `thriving` |
| 二者之一达标 | `good` |
| 二者都未达标 | `slacking` |

**goalMet 规则：`goalMet = (value >= 1.0)`**

此规则归属「评分服务」（MVP 阶段实现在 mock 生成器内），**不属于前端、不属于 Hermes**。`petState` 不得随机生成，不得调用任何大模型。

---

## 4. MCP 工具签名（冻结）

| 工具 | 参数 | 返回 |
|---|---|---|
| `get_today_scores` | （无） | 当天的 `Scores` 对象 |
| `get_scores_range` | `start`, `end`（`"YYYY-MM-DD"` 字符串） | `Scores[]`，按日期升序 |

MVP 阶段这两个工具背后返回 mock 数据；Phase 2 改为查 SQLite，签名不变。给模型的是意图明确的工具，不暴露裸 SQL。

---

## 5. 样本数据

见 `mock/scores.sample.json`。
