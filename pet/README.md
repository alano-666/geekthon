# 桌面宠物（Tauri · 极简版）

一个独立的 macOS 桌面小宠物，替代了原来的 AIRI 方案。透明、置顶、可拖动；表情随你的 `petState` 变化；点一下能聊天。

- **不用浏览器**，是个真正的桌面 app（Tauri，体积小）。
- **形象**：目前是占位小猫（`public/cats/*.svg`），4 个状态各一张。换成 Hello Kitty 只需替换这 4 个文件（见下）。
- **数据 / 对话**都复用前面的后端：mock(`:4100`)、Hermes(`:8642` OpenAI 兼容端点 + scores MCP)。数据契约(§3)没变。

## 它做什么

| 行为 | 说明 |
|---|---|
| 表情随状态变 | 每 5s `GET :4100/scores/today`，按 `petState` 换表情图 |
| 状态变化自动冒泡 | 状态一变就冒一句话（如「今天还没达标，加把劲～」） |
| 点击聊天 | 点宠物 → 冒出输入框 → 回车发给 Hermes → 回复显示在气泡里 |
| 拖动 | 按住宠物拖动可在桌面上移动 |

`petState → 表情` 映射（在 `src/main.ts` 顶部，随便改）：

| petState | 文件 | 表情 |
|---|---|---|
| `thriving` | `public/cats/thriving.svg` | 超开心（两项达标） |
| `good` | `public/cats/good.svg` | 满足（达标其一） |
| `slacking` | `public/cats/slacking.svg` | 沮丧（都没达标） |
| `resting` | `public/cats/resting.svg` | 睡觉（夜间/无数据） |

> 判定靠规则：`petState` 由评分服务（mock 端）按 `docs/CONTRACT.md §3.3` 算好，宠物只做 状态→图片 映射，不自己推导、不调大模型。

## 运行（在你的 Mac 上）

**前置**：装好 Rust（本机已装）。

1. **起后端**（另开两个终端）：
   ```sh
   cd /Users/zhangjiahui/geekthon && npm run mock      # :4100
   hermes gateway                                       # :8642（需先在 ~/.hermes/.env 开 API server，见下）
   ```
2. **起宠物**：
   ```sh
   cd /Users/zhangjiahui/geekthon/pet && pnpm tauri dev
   ```
   窗口是透明无边框的小猫，拖到你喜欢的位置。

### Hermes 那边要开 API server（聊天功能需要）

在 `~/.hermes/.env` 加：
```dotenv
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev      # 要和 src/main.ts 里的 HERMES_KEY 一致
```
然后 `hermes gateway` 启动（API server 随它起在 :8642）。

> 本宠物的网络请求走 Tauri 的 http 插件（Rust 侧），**没有浏览器 CORS 问题** —— 所以 Hermes 这边不需要配 `API_SERVER_CORS_ORIGINS`。允许访问的地址在 `src-tauri/capabilities/default.json` 里白名单（`:4100`、`:8642`）。

## 验收演示

- **桌宠跟状态变**（宠物在跑、mock 在跑时）：
  ```sh
  curl -X POST http://localhost:4100/scores/today -H "Content-Type: application/json" -d '{"exercise":{"value":0.3},"reading":{"value":0.2}}'   # → slacking → 小猫变沮丧 + 冒泡
  curl -X POST http://localhost:4100/scores/today -H "Content-Type: application/json" -d '{"exercise":{"value":1.0},"reading":{"value":1.0}}'   # → thriving → 小猫变超开心
  ```
- **对话来自 Hermes**：点小猫 → 输入「我今天运动达标了吗？」→ 气泡里出现 Hermes 的回答（经 scores MCP 取数）。

## 换成 Hello Kitty（之后）

把 `public/cats/` 里的 4 个文件换成你的 Hello Kitty 图，文件名保持 `thriving / good / slacking / resting` 即可。若用 `.png`/`.gif`，同时把 `src/main.ts` 里 `setPet()` 拼的 `.svg` 改成对应扩展名。其余代码不用动。

## 打包成 .app（可选）
```sh
pnpm tauri build      # 产出 src-tauri/target/release/bundle 下的 .app / .dmg
```

## 结构
```
pet/
  index.html            宠物 DOM（猫 + 气泡 + 输入框）
  src/main.ts           轮询、状态→表情、自动冒泡、点击聊天、拖动
  src/styles.css        透明窗口 + 气泡样式
  public/cats/*.svg     4 个状态的占位小猫（替换为 Hello Kitty）
  src-tauri/
    tauri.conf.json     透明 / 无边框 / 置顶 / 小窗口
    capabilities/default.json  http 插件白名单（:4100 / :8642）
    src/lib.rs          注册 http 插件
```
