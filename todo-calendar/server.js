'use strict'
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')

const app = express()
const PORT = process.env.PORT || 3456
const STATE_FILE = path.join(__dirname, '.sync-state.json')

app.use(cors())
app.use(express.json())
app.use(express.static(__dirname))

// ── Persistent state ───────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
  catch { return {} }
}
function saveState(patch) {
  const s = loadState()
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...s, ...patch }, null, 2))
}

// ── Status ─────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const s = loadState()
  res.json({
    google: { connected: !!(s.googleTokens && process.env.GOOGLE_CLIENT_ID) },
    caldav: { connected: !!(s.caldavUser && s.caldavPass && s.caldavCalUrl) }
  })
})

// ── Google Calendar ────────────────────────────────────────────────
function makeOAuth2() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `http://localhost:${PORT}/api/google/callback`
  )
}

async function getAuthClient() {
  const s = loadState()
  if (!s.googleTokens) throw new Error('Google not connected')
  const auth = makeOAuth2()
  auth.setCredentials(s.googleTokens)
  auth.on('tokens', tokens => {
    if (tokens.access_token) saveState({ googleTokens: { ...loadState().googleTokens, ...tokens } })
  })
  return auth
}

app.get('/api/google/auth-url', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(400).json({ error: '未配置 GOOGLE_CLIENT_ID，请先编辑 .env 文件' })
  }
  const url = makeOAuth2().generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent'
  })
  res.json({ url })
})

app.get('/api/google/callback', async (req, res) => {
  try {
    const auth = makeOAuth2()
    const { tokens } = await auth.getToken(req.query.code)
    saveState({ googleTokens: tokens })
    res.send(`<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:60px;color:#1e293b">
      <div style="font-size:52px;margin-bottom:16px">✅</div>
      <h2 style="font-weight:700">Google Calendar 已连接</h2>
      <p style="color:#64748b;margin-top:8px">可以关闭此窗口</p>
      <script>window.opener&&window.opener.postMessage('google-connected','*');setTimeout(()=>window.close(),1500)</script>
    </body></html>`)
  } catch (e) {
    res.status(400).send('连接失败: ' + e.message)
  }
})

// Upsert a single todo as a Google Calendar event
app.post('/api/google/event', async (req, res) => {
  try {
    const auth = await getAuthClient()
    const cal = google.calendar({ version: 'v3', auth })
    const { date, todo } = req.body
    const colors = { P0: '11', P1: '6', P2: '1' }
    const body = {
      summary: `[${todo.priority}] ${todo.content}`,
      start: { date },
      end: { date },
      colorId: colors[todo.priority] || '1',
      extendedProperties: {
        private: { _todoId: todo.id, _todoPriority: todo.priority, _todoDone: String(todo.done) }
      }
    }
    let event
    if (todo.gcalId) {
      try {
        event = await cal.events.update({ calendarId: 'primary', eventId: todo.gcalId, requestBody: body })
      } catch (e) {
        if (e.code === 404 || e.code === 410) {
          event = await cal.events.insert({ calendarId: 'primary', requestBody: body })
        } else throw e
      }
    } else {
      event = await cal.events.insert({ calendarId: 'primary', requestBody: body })
    }
    res.json({ gcalId: event.data.id })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/google/event/:id', async (req, res) => {
  try {
    const auth = await getAuthClient()
    const cal = google.calendar({ version: 'v3', auth })
    await cal.events.delete({ calendarId: 'primary', eventId: req.params.id })
    res.json({ ok: true })
  } catch (e) {
    if (e.code === 404 || e.code === 410) return res.json({ ok: true })
    res.status(500).json({ error: e.message })
  }
})

// Pull our todo events from Google Calendar (identified by _todoId extended prop)
app.get('/api/google/events', async (req, res) => {
  try {
    const auth = await getAuthClient()
    const cal = google.calendar({ version: 'v3', auth })
    const { year, month } = req.query
    const timeMin = new Date(+year, +month - 1, 1).toISOString()
    const timeMax = new Date(+year, +month, 0, 23, 59, 59).toISOString()
    const r = await cal.events.list({
      calendarId: 'primary',
      timeMin, timeMax,
      singleEvents: true,
      privateExtendedProperty: ['_todoId']
    })
    res.json({
      events: (r.data.items || []).map(e => ({
        gcalId: e.id,
        summary: e.summary || '',
        date: e.start?.date,
        props: e.extendedProperties?.private || {}
      }))
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── iCloud CalDAV ──────────────────────────────────────────────────
function makeICS(date, todo, icalId) {
  const dt = date.replace(/-/g, '')
  const d = new Date(date)
  d.setDate(d.getDate() + 1)
  const dtNext = d.toISOString().slice(0, 10).replace(/-/g, '')
  const pMap = { P0: 1, P1: 5, P2: 9 }
  // Escape special iCal characters in summary
  const summary = todo.content.replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Todo-Calendar//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + icalId,
    'DTSTART;VALUE=DATE:' + dt,
    'DTEND;VALUE=DATE:' + dtNext,
    'SUMMARY:[' + todo.priority + '] ' + summary,
    'STATUS:' + (todo.done ? 'COMPLETED' : 'CONFIRMED'),
    'PRIORITY:' + (pMap[todo.priority] || 9),
    'X-TODO-ID:' + todo.id,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n')
}

function parseICS(str) {
  const r = {}
  ;(str || '').replace(/\r\n[ \t]/g, '').split(/\r\n|\n/).forEach(line => {
    const m = line.match(/^([^:]+):(.*)$/)
    if (m) r[m[1].trim()] = m[2].trim()
  })
  return r
}

// Connect iCloud via CalDAV (uses tsdav for discovery)
app.post('/api/caldav/connect', async (req, res) => {
  const { username, password } = req.body
  try {
    const { createDAVClient } = require('tsdav')
    const client = await createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: { username, password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav'
    })
    const cals = await client.fetchCalendars()
    if (!cals.length) throw new Error('未找到任何日历')
    // Prefer a calendar that isn't reminders
    const defCal = cals.find(c => !/remind/i.test(c.url) && !/task/i.test(c.url)) || cals[0]
    const calUrl = defCal.url.endsWith('/') ? defCal.url : defCal.url + '/'
    saveState({
      caldavUser: username,
      caldavPass: password,
      caldavCalUrl: calUrl,
      caldavCals: cals.map(c => ({ url: c.url, name: c.displayName || c.url }))
    })
    res.json({ ok: true, calendars: cals.map(c => ({ url: c.url, name: c.displayName || c.url })) })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// Upsert a todo as a CalDAV VEVENT via raw PUT (avoids etag dance)
app.post('/api/caldav/event', async (req, res) => {
  const s = loadState()
  if (!s.caldavCalUrl) return res.status(401).json({ error: 'iCloud not connected' })
  try {
    const { date, todo } = req.body
    const icalId = todo.icalId || ('todo-' + todo.id)
    const icsData = makeICS(date, todo, icalId)
    const url = s.caldavCalUrl + icalId + '.ics'
    const auth = 'Basic ' + Buffer.from(s.caldavUser + ':' + s.caldavPass).toString('base64')
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Authorization': auth },
      body: icsData
    })
    if (!r.ok && r.status !== 201 && r.status !== 204 && r.status !== 207) {
      throw new Error(`CalDAV PUT failed ${r.status}`)
    }
    res.json({ icalId })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/caldav/event/:icalId', async (req, res) => {
  const s = loadState()
  if (!s.caldavCalUrl) return res.status(401).json({ error: 'iCloud not connected' })
  try {
    const url = s.caldavCalUrl + req.params.icalId + '.ics'
    const auth = 'Basic ' + Buffer.from(s.caldavUser + ':' + s.caldavPass).toString('base64')
    await fetch(url, { method: 'DELETE', headers: { 'Authorization': auth } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Pull our todo events from iCloud for a month
app.get('/api/caldav/events', async (req, res) => {
  const s = loadState()
  if (!s.caldavCalUrl) return res.status(401).json({ error: 'iCloud not connected' })
  try {
    const { createDAVClient } = require('tsdav')
    const client = await createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: { username: s.caldavUser, password: s.caldavPass },
      authMethod: 'Basic',
      defaultAccountType: 'caldav'
    })
    const cals = await client.fetchCalendars()
    const cal = cals.find(c => c.url === s.caldavCalUrl || c.url + '/' === s.caldavCalUrl) || cals[0]
    const { year, month } = req.query
    const objects = await client.fetchCalendarObjects({
      calendar: cal,
      timeRange: {
        start: new Date(+year, +month - 1, 1).toISOString(),
        end: new Date(+year, +month, 0, 23, 59, 59).toISOString()
      }
    })
    const events = objects.map(o => {
      const p = parseICS(o.data)
      const rawDate = p['DTSTART;VALUE=DATE'] || p['DTSTART'] || ''
      const date = rawDate.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
      return { icalId: p['UID'], date, summary: p['SUMMARY'] || '', todoId: p['X-TODO-ID'], done: p['STATUS'] === 'COMPLETED', priority: p['PRIORITY'] }
    }).filter(e => e.todoId)
    res.json({ events })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, () => {
  console.log(`\n✅  Todo Calendar Sync Server`)
  console.log(`    http://localhost:${PORT}/todo-calendar.html\n`)
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.log('⚠️  GOOGLE_CLIENT_ID not set — copy .env.example → .env and fill in credentials\n')
  }
})
