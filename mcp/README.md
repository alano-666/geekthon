# Scores MCP Server

stdio MCP server，暴露两个工具供 Hermes Agent 调用。依赖 mock 服务在 `:4100` 运行。

## 工具

| 工具名 | 参数 | 说明 |
|---|---|---|
| `get_today_scores` | 无 | 今天的 `Scores` 对象 |
| `get_scores_range` | `start`, `end`（`"YYYY-MM-DD"`） | 日期范围内的 `Scores[]`，升序 |

## ⚠️ stdio 纪律（务必遵守）

本服务用 **stdio** 跟 MCP 客户端通信：**stdout 是 JSON-RPC 协议专用通道，任何一行非协议内容都会破坏帧、导致客户端断开**。因此：

- 所有日志一律走 **stderr**（`console.error`）。`mcp/server.ts` 顶部已把 `console.log` 钉到 stderr，依赖库的误用也不会污染 stdout。
- **不要用 `npm run` 启动本服务给 Inspector / Hermes 用** —— `npm` 会把 `> geekthon@1.0.0 mcp` 这类 banner 打到 **stdout**，直接污染协议流（这正是之前 Inspector 一连就 Disconnected、Notifications 被刷屏的根因）。
- **不要用 `ts-node` 给 Inspector / Hermes 用** —— 它每次启动要全量类型检查，冷启动 11–16s，会触发客户端连接超时。用 **`tsx`**（直接跑二进制，冷启动 ~1s）。
- 类型检查单独用 `npx tsc --noEmit` 跑，不放进运行时。

## 启动

**先启动 mock 服务（T1），再启动本服务。** 给人在终端里看可以用 `npm run`（banner 打在终端无所谓）：

```sh
# 终端 1 — mock 数据源
npm run mock

# 终端 2 — 手动跑本服务（仅供人看；给 Inspector/Hermes 用见下方直跑命令）
npm run mcp
```

给 **Inspector / Hermes** 用时，直接调 tsx 二进制（stdout 干净、秒级启动）：

```sh
./node_modules/.bin/tsx mcp/server.ts
# 与 cwd 无关的写法（绝对路径）：
/Users/zhangjiahui/geekthon/node_modules/.bin/tsx /Users/zhangjiahui/geekthon/mcp/server.ts
```

## 用 MCP Inspector 验证

```sh
# 启动 inspector（一次性安装 + 运行），直接把 tsx 二进制作为 server 命令：
npx @modelcontextprotocol/inspector ./node_modules/.bin/tsx mcp/server.ts
```

或在 Inspector UI 里手填（**STDIO** 传输）：

| 字段 | 值 |
|---|---|
| Transport Type | `STDIO` |
| Command | `/Users/zhangjiahui/geekthon/node_modules/.bin/tsx` |
| Arguments | `/Users/zhangjiahui/geekthon/mcp/server.ts` |

> 若从项目根目录启动 Inspector，也可用相对写法：Command `node_modules/.bin/tsx`，Arguments `mcp/server.ts`。
> 用绝对路径最稳，不受 Inspector 工作目录影响。

连上后：
1. 点 **Tools** → 确认列出 `get_today_scores` 和 `get_scores_range`
2. 调用 `get_today_scores` → 应返回今天的 JSON
3. 调用 `get_scores_range` with `start=2026-06-01 end=2026-06-06` → 应返回数组
4. 右侧 **Server Notifications** 应保持安静（本服务除响应 list/call 外不主动推任何通知）

> 记得先 `npm run mock` 起 :4100，否则工具调用会返回 “Cannot reach mock server”。

## mcp.config 示例片段（挂到 Hermes）

Hermes Agent 使用标准 MCP JSON 配置。路径改为你机器上的实际绝对路径：

```json
{
  "mcpServers": {
    "scores": {
      "command": "/Users/zhangjiahui/geekthon/node_modules/.bin/tsx",
      "args": ["/Users/zhangjiahui/geekthon/mcp/server.ts"]
    }
  }
}
```

> **不要在这里用 `npm`/`npx`/`ts-node`** —— 同样的 banner 污染 / 冷启动超时问题会让 Hermes 挂载失败。
> 追求生产级可先 `tsc` 编译到 `dist/` 再用 `node dist/mcp/server.js`（最快、零 TS 依赖）。
> Hermes 具体配置格式见 `hermes/RUN.md`（T3 产出）。
