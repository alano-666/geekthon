import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// stdout is reserved exclusively for the JSON-RPC stream the MCP client parses.
// A single stray write to stdout — ours or a dependency's console.log — corrupts
// the framing and drops the connection. Pin console.log to stderr so it can never
// pollute the protocol. All of our own logging already uses console.error.
console.log = console.error;

const MOCK_BASE = 'http://localhost:4100';

const server = new McpServer({ name: 'scores-mcp', version: '1.0.0' });

// ── tools ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'get_today_scores',
  {
    description:
      "Returns today's Scores snapshot from the data layer. " +
      'Shape: { date: "YYYY-MM-DD", exercise: { value: 0–1, goalMet: bool }, ' +
      'reading: { value: 0–1, goalMet: bool }, ' +
      'petState: "thriving"|"good"|"slacking"|"resting", updatedAt: ISO8601 }. ' +
      "Call this when the user asks about today's exercise or reading progress, " +
      "the pet's current state, or whether daily goals were met.",
    // Read-only: this tool only queries data, never mutates it.
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async () => {
    try {
      const res = await fetch(`${MOCK_BASE}/scores/today`);
      if (!res.ok) {
        return {
          content: [{ type: 'text' as const, text: `Data source error: HTTP ${res.status}` }],
          isError: true,
        };
      }
      const data = await res.json();
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Cannot reach mock server at ${MOCK_BASE}: ${err}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'get_scores_range',
  {
    description:
      'Returns an array of Scores objects for the given date range, sorted ascending by date. ' +
      'Use this for trend analysis, weekly summaries, or questions like "how did I do this week?". ' +
      'Each item has the same shape as get_today_scores.',
    inputSchema: {
      start: z.string().describe('Start date in YYYY-MM-DD format (inclusive)'),
      end: z.string().describe('End date in YYYY-MM-DD format (inclusive)'),
    },
    // Read-only: this tool only queries data, never mutates it.
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ start, end }) => {
    try {
      const url = `${MOCK_BASE}/scores/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        return {
          content: [{ type: 'text' as const, text: `Data source error: HTTP ${res.status} – ${body}` }],
          isError: true,
        };
      }
      const data = await res.json();
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Cannot reach mock server at ${MOCK_BASE}: ${err}` }],
        isError: true,
      };
    }
  },
);

// ── finance tools ─────────────────────────────────────────────────────────────

const FINANCE_BASE = 'http://localhost:3457/api/finance';
const EXP_CATS = ['餐饮','购物','交通','娱乐','住房','医疗','教育','其他'];
const INC_CATS = ['工资','兼职','投资收益','红包','其他收入'];
const ASSET_TYPES = ['活钱管理','稳健理财','长期投资','风险投资'];

async function financeReq(path: string, method = 'GET', body?: object) {
  const res = await fetch(`${FINANCE_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000),
  });
  return res.json();
}

server.registerTool(
  'finance_get_summary',
  {
    description:
      '获取记账本当月（或指定月份）的财务快照：总收入、总支出、盈余、储蓄率、预算使用情况、支出TOP3分类、资产合计。' +
      '当用户问"我这个月花了多少"、"存款情况"、"预算还剩多少"时调用。',
    inputSchema: {
      month: z.string().optional().describe('月份，格式 YYYY-MM，默认当月'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ month }) => {
    try {
      const q = month ? `?month=${month}` : '';
      const data = await financeReq(`/summary${q}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

server.registerTool(
  'finance_add_record',
  {
    description:
      '新增一条收支流水记录到记账本。这是帮用户"记账"的核心工具。' +
      '支出类别：' + EXP_CATS.join('、') + '。' +
      '收入类别：' + INC_CATS.join('、') + '。' +
      '日期不填则默认今天。',
    inputSchema: {
      type:   z.enum(['expense', 'income']).describe('expense=支出  income=收入'),
      amount: z.number().positive().describe('金额，单位元，必须 > 0'),
      cat:    z.string().describe(`支出类别之一：${EXP_CATS.join('/')}；收入类别之一：${INC_CATS.join('/')}`),
      note:   z.string().optional().describe('备注，60字以内，描述消费内容'),
      date:   z.string().optional().describe('日期 YYYY-MM-DD，默认今天'),
    },
  },
  async ({ type, amount, cat, note, date }) => {
    try {
      const data = await financeReq('/record', 'POST', { type, amount, cat, note, date });
      if (data.ok) {
        const r = data.record;
        const sign = r.type === 'expense' ? '-' : '+';
        return { content: [{ type: 'text' as const, text: `✅ 已记录：${sign}¥${r.amount}【${r.cat}】${r.note ? ' ' + r.note : ''} (${r.date})` }] };
      }
      return { content: [{ type: 'text' as const, text: `记录失败: ${data.error}` }], isError: true };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

server.registerTool(
  'finance_list_records',
  {
    description: '查询指定月份的流水列表，可按类型筛选。用于回答"我这个月花了什么"、"最近几笔收入"等问题。',
    inputSchema: {
      month: z.string().optional().describe('YYYY-MM，默认当月'),
      type:  z.enum(['expense', 'income', 'all']).optional().describe('筛选类型，默认全部'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ month, type }) => {
    try {
      const q = new URLSearchParams();
      if (month) q.set('month', month);
      if (type && type !== 'all') q.set('type', type);
      const data = await financeReq(`/records?${q}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

server.registerTool(
  'finance_delete_record',
  {
    description: '删除一条流水记录。先用 finance_list_records 获取 id，再调用本工具删除。删除不可撤销，操作前请向用户确认。',
    inputSchema: {
      id: z.string().describe('要删除的记录 id'),
    },
    annotations: { destructiveHint: true },
  },
  async ({ id }) => {
    try {
      const data = await financeReq(`/record/${id}`, 'DELETE');
      return { content: [{ type: 'text' as const, text: data.ok ? '✅ 已删除' : `失败: ${data.error}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

server.registerTool(
  'finance_get_assets',
  {
    description: '查看理财账户（资产）列表，按类型分组：' + ASSET_TYPES.join('、') + '。用于回答"我现在有多少钱"、"资产配置"等。',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const data = await financeReq('/assets');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

server.registerTool(
  'finance_add_asset',
  {
    description: '新增一个理财账户，用于记录各类资产金额。账户类型：' + ASSET_TYPES.join('、') + '。',
    inputSchema: {
      cat:    z.enum(['活钱管理','稳健理财','长期投资','风险投资']).describe('账户类型'),
      name:   z.string().describe('账户名称，如"余额宝"、"工商银行定期"'),
      amount: z.number().positive().describe('当前金额（元）'),
    },
  },
  async ({ cat, name, amount }) => {
    try {
      const data = await financeReq('/assets', 'POST', { cat, name, amount });
      return { content: [{ type: 'text' as const, text: data.ok ? `✅ 已添加账户：${name}（${cat}）¥${amount}` : `失败: ${data.error}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

server.registerTool(
  'finance_update_asset',
  {
    description: '更新理财账户金额或名称。先用 finance_get_assets 获取 id，再调用本工具。适合每月更新账户余额。',
    inputSchema: {
      id:     z.string().describe('账户 id，从 finance_get_assets 获取'),
      amount: z.number().nonnegative().optional().describe('新金额（元）'),
      name:   z.string().optional().describe('新名称'),
    },
  },
  async ({ id, amount, name }) => {
    try {
      const data = await financeReq(`/assets/${id}`, 'PATCH', { amount, name });
      return { content: [{ type: 'text' as const, text: data.ok ? `✅ 已更新账户 ${data.asset?.name}` : `失败: ${data.error}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

server.registerTool(
  'finance_get_budget',
  {
    description: '查询当月（或指定月份）的预算设置和使用情况。',
    inputSchema: {
      month: z.string().optional().describe('YYYY-MM，默认当月'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ month }) => {
    try {
      const q = month ? `?month=${month}` : '';
      const data = await financeReq(`/budget${q}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

server.registerTool(
  'finance_set_budget',
  {
    description: '设置指定月份的总预算金额。用于"把这个月预算设为8000元"等指令。',
    inputSchema: {
      monthly: z.number().positive().describe('月预算金额（元）'),
      month:   z.string().optional().describe('YYYY-MM，默认当月'),
    },
  },
  async ({ monthly, month }) => {
    try {
      const data = await financeReq('/budget', 'POST', { monthly, month });
      return { content: [{ type: 'text' as const, text: data.ok ? `✅ 已设置 ${data.month} 预算为 ¥${data.monthly}` : `失败: ${data.error}` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `无法连接记账服务器: ${e}` }], isError: true };
    }
  },
);

// ── start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Scores MCP server running (stdio)');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
