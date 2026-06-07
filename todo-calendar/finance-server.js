'use strict'
/**
 * 记账本本地服务器 — 数据持久化到 finance-data.json
 * 启动：node finance-server.js
 * 访问：http://localhost:3457/finance-tracker.html
 */
const http = require('http')
const fs   = require('fs')
const path = require('path')
const url  = require('url')

const PORT      = 3457
const DATA_FILE = path.join(__dirname, 'finance-data.json')
const STATIC    = __dirname   // 静态文件根目录

/* ── MIME map ── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
}

/* ── Data helpers ── */
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }
  catch { return {} }
}
function saveData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8')
}

/* ── CORS headers ── */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

/* ── Collect body ── */
function body(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', d => raw += d)
    req.on('end', () => { try { resolve(JSON.parse(raw)) } catch { reject(new Error('bad json')) } })
    req.on('error', reject)
  })
}

/* ── Server ── */
const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url)
  const pathname = parsed.pathname

  cors(res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  /* API routes */
  if (pathname === '/api/finance/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (pathname === '/api/finance/data') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(loadData()))
      return
    }
    if (req.method === 'POST') {
      body(req)
        .then(data => {
          saveData(data)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        })
        .catch(err => {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        })
      return
    }
  }

  /* Static file server */
  let filePath = path.join(STATIC, pathname === '/' ? '/finance-tracker.html' : pathname)
  // 安全：防止路径穿越
  if (!filePath.startsWith(STATIC)) { res.writeHead(403); res.end(); return }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // 尝试 index.html fallback
      fs.readFile(path.join(STATIC, 'finance-tracker.html'), (err2, d2) => {
        if (err2) { res.writeHead(404); res.end('404 Not Found'); return }
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(d2)
      })
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n✅  记账本本地服务器已启动`)
  console.log(`\n   🌐  http://localhost:${PORT}/finance-tracker.html`)
  console.log(`\n   💾  数据文件：${DATA_FILE}`)
  console.log('\n   按 Ctrl+C 停止服务器\n')
})
