# Mock Scores 服务（v2 · 评分服务）

端口 **4100**，纯内存，无数据库。这是「评分服务」的 MVP 落地：**接收原始信号 → 按规则算出 contract v2 的 `Scores`**（归一化 `exercise/reading/screen` + 7 态 `petState` + `achievements`）。

## 启动
```sh
npm run mock          # 或 npx tsx mock/server.ts
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/scores/today` | 今天的 `Scores` 对象 |
| GET | `/scores/range?start=&end=` | 日期范围 `Scores[]`，升序 |
| POST | `/scores/today` | 喂**原始信号**，服务器重算整份 `Scores` |

### POST body（都可选，合并到当天；未传保持原值）
| 字段 | 类型 | 含义 |
|---|---|---|
| `steps` | number | 步数 → `exercise.value = steps/8000` |
| `readingMin` | number | 阅读分钟 → `reading.value = min/30` |
| `screenHr` | number | 屏幕小时 → `screen.value`（越少越健康，反转） |
| `workoutDone` | boolean | 完成一次运动（成就） |
| `healthAnomaly` | boolean | 健康指标异常 → `sick`（优先级最高，夜间也触发） |
| `forceState` | string\|null | **DEV 调试**：直接指定 petState（绕过规则，方便演示）；传 `null` 清除 |

> body 里的 `petState`/`metrics` 一律忽略——评分服务自己算。`petState` 永不随机、不调大模型。

## 阈值（在 `server.ts` 顶部，可调）
运动目标 8000 步、阅读目标 30 min、屏幕预算 4h；运动过低线 `exercise.value<0.25`（约 <2000 步）；屏幕严重 `screen.value≤0.30`；阅读 2h 成就 120 min；夜间 22:00–06:00。

## petState 规则（contract v2 §3.3，从上往下命中即止）
| # | 条件 | petState |
|---|---|---|
| 1 | `healthAnomaly` | `sick` |
| 2 | 夜间 / 无数据 | `resting` |
| 3 | 运动过低（`exercise.value<0.25`） | `angry` |
| 4 | 屏幕严重超标（`screen.value≤0.30`） | `eyestrain` |
| 5 | 运动+阅读+屏幕都达标 | `thriving` |
| 6 | 运动或阅读至少一项达标 | `good` |
| 7 | 其余 | `slacking` |

`goalMet = value >= 1.0`。

---

## curl 示例

```sh
# 看当前
curl http://localhost:4100/scores/today | jq

# —— 规则路径（白天才会显示 angry/eyestrain/… ；夜间一律 resting）——
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"steps":1500}'                 # 运动过低 → angry(白天)
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"screenHr":9}'                 # 屏幕超标 → eyestrain(白天)
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"steps":9000,"readingMin":40,"screenHr":1}'  # 全达标 → thriving(白天)
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"healthAnomaly":true}'          # → sick（夜间也触发）

# —— 成就（pet 会对新增项撒花）——
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"workoutDone":true}'            # +workout_done
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"readingMin":120}'             # +reading_goal +reading_2h

# —— DEV 演示：任意状态（夜间也能看，绕过规则）——
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"forceState":"thriving"}'
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"forceState":"angry"}'
curl -X POST :4100/scores/today -H 'Content-Type: application/json' -d '{"forceState":null}'             # 清除，回到规则

# 范围
curl "http://localhost:4100/scores/range?start=2026-06-01&end=2026-06-06" | jq
```

> 桌宠每 5s 轮询 `/scores/today`；POST 后 ~5s 内表情/状态就会跟着变。
