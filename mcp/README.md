# Scores MCP Server

stdio MCP server，暴露两个工具供 Hermes Agent 调用。依赖 mock 服务在 `:4100` 运行。

## 工具

| 工具名 | 参数 | 说明 |
|---|---|---|
| `get_today_scores` | 无 | 今天的 `Scores` 对象 |
| `get_scores_range` | `start`, `end`（`"YYYY-MM-DD"`） | 日期范围内的 `Scores[]`，升序 |

## 启动

**先启动 mock 服务（T1），再启动本服务：**

```sh
# 终端 1
npm run mock

# 终端 2（供调试用；正常由 Hermes 通过 stdio 拉起）
npx ts-node mcp/server.ts
```

## 用 MCP Inspector 验证

```sh
# 安装 inspector（一次性）
npm install -g @modelcontextprotocol/inspector

# 启动 inspector，连接本服务
npx @modelcontextprotocol/inspector npx ts-node mcp/server.ts
```

打开 Inspector UI 后：
1. 点 **Tools** → 确认列出 `get_today_scores` 和 `get_scores_range`
2. 调用 `get_today_scores` → 应返回今天的 JSON
3. 调用 `get_scores_range` with `start=2026-06-01 end=2026-06-06` → 应返回数组

## mcp.config 示例片段（挂到 Hermes）

Hermes Agent 使用标准 MCP JSON 配置，片段如下（路径改为实际绝对路径）：

```json
{
  "mcpServers": {
    "scores": {
      "command": "npx",
      "args": ["ts-node", "/ABSOLUTE/PATH/TO/geekthon/mcp/server.ts"]
    }
  }
}
```

或先编译再运行（更快）：

```json
{
  "mcpServers": {
    "scores": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/geekthon/dist/mcp/server.js"]
    }
  }
}
```

> Hermes 具体配置格式见 `hermes/RUN.md`（T3 产出）。
