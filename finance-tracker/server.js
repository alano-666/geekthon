'use strict'
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url')

const PORT  = 3457
const ROOT  = __dirname
const DATA  = path.join(ROOT, 'data.json')
const MIME  = { '.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.ico':'image/x-icon','.png':'image/png','.svg':'image/svg+xml' }

const INC_CATS = ['工资','兼职','投资收益','红包','其他收入']
const EXP_CATS = ['餐饮','购物','交通','娱乐','住房','医疗','教育','其他']
const ATYPES   = ['活钱管理','稳健理财','长期投资','风险投资']

/* ── helpers ── */
function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function curMonth(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function sum(a){ return a.reduce((t,x)=>t+(+x.amount||0), 0) }
function empty(){ return { incCats:[...INC_CATS], expCats:[...EXP_CATS], months:{}, budgets:{}, finances:[] } }
function norm(d){
  return {
    incCats: Array.isArray(d.incCats)&&d.incCats.length ? d.incCats : [...INC_CATS],
    expCats: Array.isArray(d.expCats)&&d.expCats.length ? d.expCats : [...EXP_CATS],
    months:  d.months  && typeof d.months  === 'object' ? d.months  : {},
    budgets: d.budgets && typeof d.budgets === 'object' ? d.budgets : {},
    finances: Array.isArray(d.finances) ? d.finances : [],
  }
}
function loadData(){ try { return norm(JSON.parse(fs.readFileSync(DATA,'utf8'))) } catch { return empty() } }
function saveData(o){ fs.writeFileSync(DATA, JSON.stringify(o,null,2), 'utf8') }
function ensureMonth(data, mk){ if(!data.months[mk]) data.months[mk]={income:[],expense:[]}; return data.months[mk] }
function ensureBudget(data, mk){ if(!data.budgets[mk]) data.budgets[mk]={monthly:0}; return data.budgets[mk] }

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}
function json(res, data, code=200){ res.writeHead(code,{'Content-Type':'application/json'}); res.end(JSON.stringify(data)) }
function bodyJSON(req){ return new Promise((ok,err)=>{ let s=''; req.on('data',d=>s+=d); req.on('end',()=>{ try{ok(JSON.parse(s))}catch{err(new Error('bad json'))} }); req.on('error',err) }) }

/* ── HTTP server ── */
http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true)
  const p      = parsed.pathname
  cors(res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  /* ── ping ── */
  if (p === '/api/finance/ping') return json(res, { ok: true })

  /* ── full data (browser app) ── */
  if (p === '/api/finance/data') {
    if (req.method === 'GET') return json(res, loadData())
    if (req.method === 'POST') {
      try { const d = await bodyJSON(req); saveData(norm(d)); return json(res, { ok: true }) }
      catch (e) { return json(res, { error: e.message }, 400) }
    }
  }

  /* ── monthly summary ── */
  if (p === '/api/finance/summary') {
    const month = parsed.query.month || curMonth()
    const data  = loadData()
    const m     = data.months[month] || { income:[], expense:[] }
    const inc   = sum(m.income), exp = sum(m.expense), sur = inc - exp
    const bud   = data.budgets[month] || { monthly:0 }
    const byExpCat = m.expense.reduce((acc,x)=>{ acc[x.cat]=(acc[x.cat]||0)+(+x.amount||0); return acc }, {})
    const topExp   = Object.entries(byExpCat).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([cat,amt])=>({cat,amt}))
    return json(res, {
      month,
      income:  inc,
      expense: exp,
      surplus: sur,
      savingRate: inc > 0 ? Math.round(sur/inc*1000)/10 : 0,
      budget: {
        monthly:   bud.monthly,
        spent:     exp,
        remaining: bud.monthly ? bud.monthly - exp : null,
        usedPct:   bud.monthly ? Math.round(exp/bud.monthly*100) : null,
      },
      recordCount: { total: m.income.length + m.expense.length, income: m.income.length, expense: m.expense.length },
      topExpenseCategories: topExp,
      totalAssets: sum(data.finances),
    })
  }

  /* ── list records ── */
  if (p === '/api/finance/records' && req.method === 'GET') {
    const data  = loadData()
    const month = parsed.query.month || curMonth()
    const type  = parsed.query.type   // 'income' | 'expense' | omit for all
    const m     = data.months[month] || { income:[], expense:[] }
    let records = []
    if (!type || type === 'expense') records.push(...m.expense.map(x=>({...x, type:'expense'})))
    if (!type || type === 'income')  records.push(...m.income.map(x=>({...x, type:'income'})))
    records.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    return json(res, { month, records })
  }

  /* ── add record ── */
  if (p === '/api/finance/record' && req.method === 'POST') {
    try {
      const b    = await bodyJSON(req)
      const type = b.type === 'income' ? 'income' : 'expense'
      const amt  = +b.amount
      if (!isFinite(amt) || amt <= 0) return json(res, { error: '金额必须是正数' }, 400)
      const data = loadData()
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : todayStr()
      const month = date.slice(0, 7)
      const defaultCat = type === 'income' ? data.incCats[0] : data.expCats[0]
      const cat  = b.cat || defaultCat
      const rec  = { id: uid(), cat, amount: amt, note: String(b.note||'').slice(0,60), date }
      ensureMonth(data, month)[type].push(rec)
      saveData(data)
      return json(res, { ok: true, record: { ...rec, type }, month })
    } catch (e) { return json(res, { error: e.message }, 400) }
  }

  /* ── delete record ── */
  const delRec = /^\/api\/finance\/record\/([a-z0-9]+)$/i.exec(p)
  if (delRec && req.method === 'DELETE') {
    const id   = delRec[1]
    const data = loadData()
    let found  = false
    Object.values(data.months).forEach(m => {
      ['income','expense'].forEach(t => {
        const before = m[t].length
        m[t] = m[t].filter(x => x.id !== id)
        if (m[t].length < before) found = true
      })
    })
    if (!found) return json(res, { error: '记录不存在' }, 404)
    saveData(data)
    return json(res, { ok: true })
  }

  /* ── assets list / add ── */
  if (p === '/api/finance/assets') {
    const data = loadData()
    if (req.method === 'GET') {
      const byType = {}
      ATYPES.forEach(t => { byType[t] = { total: sum(data.finances.filter(x=>x.cat===t)), accounts: data.finances.filter(x=>x.cat===t) } })
      return json(res, { total: sum(data.finances), accounts: data.finances, byType })
    }
    if (req.method === 'POST') {
      try {
        const b   = await bodyJSON(req)
        const amt = +b.amount
        if (!isFinite(amt) || amt <= 0) return json(res, { error: '金额必须是正数' }, 400)
        const cat   = ATYPES.includes(b.cat) ? b.cat : ATYPES[0]
        const asset = { id: uid(), cat, name: String(b.name||'未命名').slice(0,30), amount: amt }
        data.finances.push(asset)
        saveData(data)
        return json(res, { ok: true, asset })
      } catch (e) { return json(res, { error: e.message }, 400) }
    }
  }

  /* ── asset update / delete ── */
  const assetM = /^\/api\/finance\/assets\/([a-z0-9]+)$/i.exec(p)
  if (assetM) {
    const id   = assetM[1]
    const data = loadData()
    const idx  = data.finances.findIndex(x => x.id === id)
    if (idx === -1) return json(res, { error: '账户不存在' }, 404)
    if (req.method === 'PATCH') {
      try {
        const b = await bodyJSON(req)
        if (b.amount !== undefined) { const a = +b.amount; if (!isFinite(a)||a<0) return json(res,{error:'invalid amount'},400); data.finances[idx].amount = a }
        if (b.name)                 data.finances[idx].name = String(b.name).slice(0,30)
        if (b.cat && ATYPES.includes(b.cat)) data.finances[idx].cat = b.cat
        saveData(data)
        return json(res, { ok: true, asset: data.finances[idx] })
      } catch (e) { return json(res, { error: e.message }, 400) }
    }
    if (req.method === 'DELETE') {
      const removed = data.finances[idx]
      data.finances.splice(idx, 1)
      saveData(data)
      return json(res, { ok: true, removed })
    }
  }

  /* ── budget ── */
  if (p === '/api/finance/budget') {
    const data = loadData()
    if (req.method === 'GET') {
      const month = parsed.query.month || curMonth()
      const bud   = data.budgets[month] || { monthly: 0 }
      const exp   = sum((data.months[month]||{expense:[]}).expense)
      return json(res, { month, monthly: bud.monthly, spent: exp, remaining: bud.monthly ? bud.monthly - exp : null })
    }
    if (req.method === 'POST') {
      try {
        const b   = await bodyJSON(req)
        const month = /^\d{4}-\d{2}$/.test(b.month) ? b.month : curMonth()
        const amt = +b.monthly
        if (!isFinite(amt) || amt < 0) return json(res, { error: '金额不合法' }, 400)
        ensureBudget(data, month).monthly = amt
        saveData(data)
        return json(res, { ok: true, month, monthly: amt })
      } catch (e) { return json(res, { error: e.message }, 400) }
    }
  }

  /* ── static files ── */
  let fp = path.join(ROOT, p === '/' ? '/index.html' : p)
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return }
  fs.readFile(fp, (err, d) => {
    if (err) { res.writeHead(404); res.end('404 Not Found'); return }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' })
    res.end(d)
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n✅  记账本服务器 → http://localhost:${PORT}`)
  console.log(`\n   Agent API: http://localhost:${PORT}/api/finance/`)
  console.log(`     GET  /api/finance/summary         当月收支快照`)
  console.log(`     GET  /api/finance/records         流水列表`)
  console.log(`     POST /api/finance/record          新增一条流水`)
  console.log(`     DEL  /api/finance/record/:id      删除流水`)
  console.log(`     GET  /api/finance/assets          资产账户`)
  console.log(`     POST /api/finance/assets          新增资产账户`)
  console.log(`     PATCH/DEL /api/finance/assets/:id 更新/删除账户`)
  console.log(`     GET/POST  /api/finance/budget     月预算`)
  console.log('\n   Ctrl+C 停止\n')
})
