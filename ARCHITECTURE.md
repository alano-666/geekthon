# 产品技术架构文档

> 项目工作目录：`~/geekthon/`  
> 本文档描述「桌宠 + 健康看板 + 记账本 + 日历 + AI Agent」一体化系统的完整技术实现。

---

## 一、系统全景

```
┌─────────────────────────────────────────────────────────────────────┐
│                          数据源层                                    │
│  Apple Health  微信读书  屏幕时间  iCloud日历  用户手动输入           │
└────────────────────────┬────────────────────────────────────────────┘
                         │ scripts/sync-real-data.ts (60s轮询)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       规则引擎层  :4100                              │
│         mock/server.ts — 原始信号 → 归一化分值 → 宠物状态            │
└────────┬───────────────────────────────────┬────────────────────────┘
         │ GET /scores/today (5s)            │ MCP stdio
         ▼                                  ▼
┌─────────────────┐              ┌──────────────────────────────────┐
│  桌宠 (Tauri)   │              │   Hermes Agent  :8642            │
│  pet/src/main.ts│◄─── mirror──►│   模型: DeepSeek deepseek-chat   │
│  动画/气泡/推送  │              │   MCP: scores + world 两个服务   │
└────────┬────────┘              └──────────┬───────────────────────┘
         │                                  │
         ▼                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                         用户界面层                                   │
│  桌宠窗口  飞书DM  健康看板  记账本:3457  Todo日历:3456  CLI         │
└────────────────────────────────────────────────────────────────────┘
```

---

## 二、模块详解

### Module 1：数据源接入层

| 数据类型 | 原始来源 | 接入方式 | 落点 |
|---|---|---|---|
| 步数 / 静息心率 / 运动 | Apple Health | iOS快捷指令定时导出 → JSON | `~/Documents/黑客松/data/processed/today-health-latest.json` |
| 阅读时长 | 微信读书 | `weread` CLI（已鉴权）调用 `readdata summary --json` | 实时调用，不落盘 |
| 屏幕时间 / 前台App | macOS frontmost采样 | 定时脚本采样前台进程 | `~/Documents/黑客松/data/processed/screen-time-latest.json` |
| 日历事件 | iCloud / CalDAV协议 | todo-calendar server `:3456` 拉取并提供REST | `GET /calendar/today` |
| 财务收支 | 用户手动 / Agent记账 | 网页表单 + `finance_add_record` MCP工具 | `finance-tracker/data.json` |
| Todo任务 | 用户手动 | 网页操作 + 可选iCloud同步 | `todo-calendar/todos.json` |
| 天气 | Open-Meteo API | world-server.ts 实时HTTP请求（免key） | 不落盘，实时查询 |

**数据同步入口：**

```
scripts/sync-real-data.ts
  └── 每 SYNC_INTERVAL_MS（默认60s）循环一次
      ├── 读 screen-time-latest.json → payload.screenHr
      ├── 读 today-health-latest.json → payload.steps / workoutDone / healthAnomaly
      ├── 调 weread CLI → payload.readingMin
      └── POST http://localhost:4100/scores/today → 写入规则引擎
```

---

### Module 2：规则引擎与状态映射层

**载体：** `mock/server.ts`，端口 `:4100`

#### 2.1 原始信号归一化（0 → 1）

```
steps       → exercise.value = clamp(steps / GOAL_STEPS, 0, 1)     GOAL_STEPS=8000
readingMin  → reading.value  = clamp(min / GOAL_READING_MIN, 0, 1) GOAL_READING_MIN=30
screenHr    → screen.value   = clamp(1 - (hr / SCREEN_BUDGET_HR) * 0.5, 0, 1)  SCREEN_BUDGET_HR=4
                               (越少越好；超过8h → 0)
```

#### 2.2 宠物状态机（7态，优先链 first-match wins）

```
petState ∈ { thriving | good | slacking | resting | angry | eyestrain | sick }

优先级（由高到低）：
  1. isNight (22:00–06:00 北京时间)         → resting
  2. exercise + reading + screen 全 goalMet → thriving
  3. 北京时间 < 15:00                       → 强制 good（不触发负面状态）
  4. healthAnomaly (静息HR >100 or <40)     → sick
  5. exercise.value < 0.25                  → angry
  6. screen.value ≤ 0.30                   → eyestrain
  7. 至少一项 goalMet                       → good
  8. 兜底                                   → slacking
```

#### 2.3 数据存储

```typescript
rawStore: Map<string, RawDay>  // key = "YYYY-MM-DD"，纯内存，重启清零
// sync每分钟刷新，桌宠每5s轮询读取
```

#### 2.4 成就系统

```
achievements = ["steps_goal", "workout_done", "reading_goal", "reading_2h"]
桌宠轮询时 diff 新增成就 → 触发庆祝动画 + Hermes 主动喊话
```

---

### Module 3：AI 对话层（Hermes + DeepSeek）

#### 3.1 主模型配置

```yaml
# ~/.hermes/config.yaml
model:
  provider: openai-api
  default: deepseek-chat
  base_url: https://api.deepseek.com/v1
  # API key 在 ~/.hermes/.env
```

#### 3.2 三路对话入口（共享同一 session）

```
飞书 DM ─────────────────────────────────────────────────┐
                                                         │ X-Hermes-Session-Key
桌宠气泡 → POST :8642/v1/chat/completions               ├─ = ou_7914fc617e3e293bd81e48ad010191a5
          Header: X-Hermes-Session-Key = <feishu_openid>│  (Feishu DM open_id)
                                                         │
hermes CLI (hermes chat -q "...") ──────────────────────┘
```

session key 统一为 Feishu open_id，三端上下文完全共享。

#### 3.3 Persona 动态注入

每次 Hermes 请求构建：

```typescript
messages = [
  { role: "system", content: PERSONA_BASE + MOOD_TONE[petState] },
  ...chatHistory.slice(-MAX_HISTORY),   // 最近 8 条
  { role: "user", content: question },
]
```

7种情绪调制：

```
thriving  → 欢快炫耀模式
good      → 正常温柔猫咪
slacking  → 碎碎念催促
resting   → 安静夜晚语气
angry     → 毒舌火力全开催动
eyestrain → 担忧眼睛关怀
sick      → 蔫蔫担心语气
```

#### 3.4 主动推送（Proactive Nudge）

```typescript
// pet/src/main.ts
const proactiveDone = new Set<string>()   // 每天每种状态只推一次

if 状态变为负面 && !proactiveDone.has(state) {
  askHermes(proactivePrompt(state))       // Hermes 主动生成一条话
  proactiveDone.add(state)
}
```

#### 3.5 Mirror 机制（桌宠 ↔ 飞书连续性）

```
桌宠对话 → POST :4100/mirror { q, r }
         → execFile(hermes_bin, ['send', '--to', 'feishu'])
         → 飞书收到同一条消息
         → 飞书侧上下文完整
```

---

### Module 4：MCP 工具链

Hermes 以 **stdio子进程** 拉起两个 MCP server，工具名前缀化：

#### 4.1 scores MCP（`mcp/server.ts`）→ `mcp_scores_*`

| 工具名 | 类型 | 说明 |
|---|---|---|
| `get_today_scores` | 只读 | 今日运动/阅读/屏幕评分 + petState |
| `get_scores_range` | 只读 | 日期范围趋势数据 |
| `finance_get_summary` | 只读 | 当月收支快照（收支/盈余/储蓄率/预算） |
| `finance_add_record` | 写入 | **核心记账工具**，写 data.json |
| `finance_list_records` | 只读 | 流水明细列表 |
| `finance_delete_record` | 危险 | 删除流水（不可撤销） |
| `finance_get_assets` | 只读 | 理财账户列表及分组 |
| `finance_add_asset` | 写入 | 新增理财账户 |
| `finance_update_asset` | 写入 | 更新账户余额/名称 |
| `finance_get_budget` | 只读 | 月预算查询 |
| `finance_set_budget` | 写入 | 设置月预算 |

finance工具统一转发至 `http://localhost:3457/api/finance/*`，3s超时。

#### 4.2 world MCP（`mcp/world-server.ts`）→ `mcp_world_*`

| 工具名 | 数据来源 | 说明 |
|---|---|---|
| `get_weather` | Open-Meteo API | 北京实时天气（免key），坐标 39.9042, 116.4074 |
| `get_reading_today` | `weread` CLI | 当日微信读书时长（分钟） |
| `get_screen_today` | processed JSON | 屏幕时长 + Top App |
| `get_health_today` | processed JSON | 步数/心率/运动/健康异常 |
| `get_calendar_today` | CalDAV → `:3456` | 今日日历事件列表 |

---

### Module 5：记忆系统

#### 5.1 短期记忆（桌宠端）

```typescript
// pet/src/main.ts
const chatHistory: ChatMsg[] = []  // 纯内存，重启清零
const MAX_HISTORY = 8              // 保留最近 4 轮对话（8条消息）

// 每次请求自动注入
messages: [systemPrompt, ...chatHistory.slice(-MAX_HISTORY), userMsg]
```

- 范围：当前桌宠进程生命周期内
- 飞书侧由 Hermes session 自行管理窗口大小

#### 5.2 长期记忆（Hermes 内置）

```
~/.hermes/memory/
  ├── 自动提炼（Hermes在每次对话后自动总结用户习惯、偏好）
  ├── 手动 /remember 命令写入
  └── 每次对话启动时注入 context（用户不感知）
```

| 记忆类型 | 存储位置 | 生命周期 |
|---|---|---|
| 会话上下文（短期） | 内存 `chatHistory[]` | 进程生命周期 |
| Hermes session（中期） | Hermes session store | 按session key持久化 |
| Hermes memory（长期） | `~/.hermes/memory/` | 永久，跨重启 |
| Claude Code 项目记忆 | `~/.claude/projects/.../memory/` | 永久，跨对话 |

---

### Module 6：数据存储详情

#### 6.1 文件结构

```
geekthon/
├── finance-tracker/
│   ├── data.json          ← 财务数据（核心持久化）
│   ├── index.html         ← 记账本单页应用
│   └── server.js          ← REST API 服务 :3457
├── todo-calendar/
│   ├── todos.json         ← Todo列表（含优先级/时间/回顾）
│   └── server.js          ← CalDAV + REST 服务 :3456
├── mcp/
│   ├── server.ts          ← scores MCP server（stdio）
│   └── world-server.ts    ← world MCP server（stdio）
├── mock/
│   └── server.ts          ← 规则引擎 + 评分 :4100（内存存储）
├── pet/
│   └── src/main.ts        ← Tauri桌宠核心逻辑
└── scripts/
    └── sync-real-data.ts  ← 数据同步循环（60s）

~/Documents/黑客松/data/processed/
├── today-health-latest.json   ← Apple Health 当日快照
└── screen-time-latest.json    ← 屏幕时间快照

~/.hermes/
├── config.yaml                ← Hermes配置（模型/MCP）
├── .env                       ← API密钥
└── memory/                    ← 长期记忆文件
```

#### 6.2 财务数据 Schema（`data.json`）

```json
{
  "months": {
    "2026-06": {
      "income":  [{ "id": "uid", "cat": "工资", "amount": 10000, "note": "", "date": "2026-06-01" }],
      "expense": [{ "id": "uid", "cat": "餐饮", "amount": 45,    "note": "午饭", "date": "2026-06-07" }]
    }
  },
  "budgets": {
    "2026-06": { "monthly": 9000 }
  },
  "finances": [
    { "id": "uid", "cat": "活钱管理", "name": "余额宝", "amount": 5000 }
  ],
  "incCats": ["工资","兼职","投资收益","红包","其他收入"],
  "expCats": ["餐饮","购物","交通","娱乐","住房","医疗","教育","其他"]
}
```

#### 6.3 健康数据 Schema（`today-health-latest.json`）

```json
{
  "date": "2026-06-07",
  "steps": 7823,
  "restingHR": 62,
  "workoutDone": true,
  "healthAnomaly": false,
  "caloriesBurned": 420
}
```

---

### Module 7：多端界面层

| 界面 | 技术 | 端口/路径 | 主要职责 |
|---|---|---|---|
| 桌宠 | Tauri + TS | 本地App | 情绪感知、气泡对话、主动推送 |
| 健康看板 | 静态HTML | `/dashboard.html` | 多维健康数据可视化 |
| 记账本 | 静态HTML + Node服务 | `:3457` | 收支记录、理财账户、图表 |
| Todo日历 | 静态HTML + Node服务 | `:3456` | 任务管理 + iCloud日历 |
| 飞书 | Hermes Feishu channel | DM | 主对话入口，长文回复，历史可查 |
| CLI | Hermes CLI | `hermes chat` | 直接命令行交互 |

---

### Module 8：服务启动清单

```bash
# 1. 记账本 + API
node /Users/zhangjiahui/geekthon/finance-tracker/server.js        # :3457

# 2. Todo日历 + CalDAV
node /Users/zhangjiahui/geekthon/todo-calendar/server.js           # :3456

# 3. 规则引擎（评分 + Mirror）
npx tsx /Users/zhangjiahui/geekthon/mock/server.ts                 # :4100

# 4. 数据同步循环（每60s推送实时信号）
npx tsx /Users/zhangjiahui/geekthon/scripts/sync-real-data.ts

# 5. MCP servers（由 Hermes 自动以 stdio 子进程拉起）
#    scores: npx tsx /Users/zhangjiahui/geekthon/mcp/server.ts
#    world:  npx tsx /Users/zhangjiahui/geekthon/mcp/world-server.ts

# 6. Hermes Agent（含 Feishu bot + API server）
hermes start   # 读取 ~/.hermes/config.yaml，拉起 MCP 子进程，监听 :8642

# 7. 桌宠
cd pet && npm run tauri dev
```

---

## 三、技术栈汇总

| 层级 | 技术选型 |
|---|---|
| 主语言 | TypeScript（后端/脚本/MCP），HTML+CSS+JS（前端） |
| 桌面框架 | Tauri（Rust壳 + Web前端） |
| AI主模型 | DeepSeek `deepseek-chat`（OpenAI兼容接口） |
| Agent框架 | Hermes（Nous Research），支持MCP工具、长期记忆、多渠道 |
| 工具协议 | MCP（Model Context Protocol），stdio传输 |
| 后端服务 | Node.js原生http模块（零依赖，轻量） |
| 数据格式 | JSON文件（本地持久化，无数据库） |
| 即时通讯 | 飞书/Lark（Bot API） |
| 健康数据 | Apple Health + iOS快捷指令 |
| 天气 | Open-Meteo（免key，REST） |
| 日历同步 | CalDAV（iCloud） |
| 阅读数据 | 微信读书 CLI（`weread`） |

---

## 四、关键设计决策

1. **Session Key = Feishu open_id**：让桌宠、飞书、CLI共享同一个Hermes上下文，无需用户重复说明背景。

2. **MCP挂在 scores server 上**：finance工具加入已有的`scores` MCP server，无需修改`~/.hermes/config.yaml`，Hermes自动拿到所有工具。

3. **规则引擎 < 15:00 锁定 good**：早晨强制非负状态，避免早起还没运动就被猫催骂，用户体验友好。

4. **数据全部存本地JSON**：无需数据库，启动零配置，数据所有权完全在用户本地，PII不出机器。

5. **Mirror 而非 Webhook**：桌宠主动调 `/mirror` 端点，由服务端执行 `hermes send --to feishu`，避免飞书侧需要公网地址。
