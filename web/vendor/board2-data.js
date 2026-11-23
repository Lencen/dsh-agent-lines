/* board2-data.js — 0.14 S3 数据视图（原型 parts/data.html + data.js 对齐）
 * 口径：任务数=distinct taskRef；消息数单列；缺失=「未采集」不显示 0；token=session 级估算（非计费）。
 * 图表：/vendor/echarts.min.js；tooltip/legend/grid 与原型一致（有源才画）。
 */
(function () {
  'use strict'
  var winDays = 7
  var last = { data: null, metrics: null }
  var charts = {}

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function isNum(n) { return typeof n === 'number' && isFinite(n) }
  function fmtNum(n) { return isNum(n) ? Number(n).toLocaleString('zh-CN') : '未采集' }
  function kfmt(n) { if (!isNum(n)) return '未采集'; var v = Number(n); if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k'; return String(Math.round(v)) }
  function pad2(n) { return n < 10 ? '0' + n : '' + n }
  function dayOf(ms) { if (!isNum(ms)) return ''; var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
  function dt(ms) { if (!isNum(ms)) return '未采集'; var d = new Date(ms); return dayOf(ms) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) }
  function tone(name, fb) { try { var v = getComputedStyle(document.documentElement).getPropertyValue(name); v = (v || '').trim(); return v || fb } catch (e) { return fb } }
  function na(reason) { return '<span class="bd-unavailable" title="' + esc(reason || '字段未采集') + '">未采集</span>' }
  function byId(id) { return document.getElementById(id) }
  function lineRoles(data) { var map = {}; ((data && data.lines) || []).forEach(function (l) { map[l.label] = l.role || l.title || l.label }); return map }
  function roleOf(map, line) { return map[line] || line }
  function cutoffDay(ms) { if (!winDays) return null; var base = isNum(ms) ? ms : Date.now(); return dayOf(base - (winDays - 1) * 86400000) }
  function filterDays(rows, cutoff) { return cutoff ? rows.filter(function (r) { return r.day >= cutoff }) : rows }
  function dayLabel() { return winDays ? '近 ' + winDays + ' 天' : '全部' }

  function deriveTaskStates(lt) {
    var tasks = (lt && lt.byTaskRef) || []
    var out = { available: tasks.length > 0, done: 0, progress: 0, byLine: {} }
    tasks.forEach(function (t) {
      var states = t.byState || {}
      var inProgress = false
      for (var k in states) { if (k !== 'acked' && Number(states[k]) > 0) inProgress = true }
      if (inProgress) out.progress++; else out.done++
      ;(t.byLine || []).forEach(function (l) {
        var rec = out.byLine[l.line] || (out.byLine[l.line] = { done: 0, progress: 0 })
        if (inProgress) rec.progress++; else rec.done++
      })
    })
    return out
  }
  function lineOrder(lt, st) {
    var order = []
    function push(l) { if (l && order.indexOf(l) < 0) order.push(l) }
    ;((lt && lt.byLine) || []).forEach(function (l) { push(l.line) })
    for (var k in st.byLine) push(k)
    return order
  }
  function byLineMap(lt) { var map = {}; ((lt && lt.byLine) || []).forEach(function (l) { map[l.line] = l }); return map }

  function dispose(id) { var c = charts[id]; if (c) { try { c.dispose() } catch (e) {} delete charts[id] } var n = byId(id); if (n) n.innerHTML = '' }
  function chart(id, option) {
    var node = byId(id)
    if (!node || typeof window.echarts === 'undefined') return
    dispose(id)
    var c = window.echarts.init(node, null, { renderer: 'canvas' })
    c.setOption(option)
    charts[id] = c
    return c
  }
  function chartNa(id, noteId, title, desc) {
    dispose(id)
    var node = byId(id)
    if (node) node.innerHTML = '<div class="bd-chart-na"><b>' + esc(title) + '</b><span>' + esc(desc) + '</span></div>'
    var note = byId(noteId)
    if (note) note.textContent = title + ' · ' + desc
  }

  function renderKpi(data) {
    var root = byId('bd-data-kpi')
    if (!root) return
    var lt = data && data.lineTasks
    var taskAvail = !!(lt && isNum(lt.taskCount))
    var st = deriveTaskStates(lt)
    var linesAvail = !!(lt && lt.byLine && lt.byLine.length)
    var lineCount = 0
    var lineCountAvail = linesAvail
    if (linesAvail) lt.byLine.forEach(function (l) { if (!isNum(l.taskCount)) lineCountAvail = false; else if (l.taskCount > 0) lineCount++ })
    var items = [
      { label: '线任务', value: taskAvail ? fmtNum(lt.taskCount) : null, reason: 'lineTasks.taskCount 未采集', hint: '任务数（distinct taskRef）' },
      { label: '完成', value: st.available ? fmtNum(st.done) : null, reason: '缺 byTaskRef[].byState', hint: '按消息终态近似 · 非任务完成态' },
      { label: '进行中', value: st.available ? fmtNum(st.progress) : null, reason: '缺 byTaskRef[].byState', hint: '按消息终态近似 · 非任务完成态' },
      { label: '阻塞', value: null, reason: 'lineTasks 不提供 blocked 字段', hint: '未采集 · 不显示 0' },
      { label: '超时', value: null, reason: 'lineTasks 不提供 stale 字段', hint: '未采集 · 不显示 0' },
      { label: '参与线数', value: lineCountAvail ? fmtNum(lineCount) : null, reason: '缺 byLine[].taskCount', hint: 'byLine[].taskCount > 0 的 L2 线数' }
    ]
    root.innerHTML = items.map(function (it) {
      var val = it.value == null ? na(it.reason) : it.value
      return '<div class="bd-kpi"><div class="bd-kpi-label">' + esc(it.label) + '</div><div class="bd-kpi-value num">' + val + '</div><div class="bd-kpi-hint">' + esc(it.hint) + '</div></div>'
    }).join('')
  }
  function renderMsgLine(data) {
    var el = byId('bd-data-msgline'); if (!el) return
    var lt = data && data.lineTasks
    var total = lt && lt.total
    var all = data && data.messages && data.messages.total
    var html = '<span>消息 <b class="bd-num">' + (isNum(total) ? fmtNum(total) : na('lineTasks.total 未采集')) + '</b> 条（lineTasks.total）</span>'
    html += '<span>全部消息 <b class="bd-num">' + (isNum(all) ? fmtNum(all) : na('messages.total 未采集')) + '</b> 条（messages.total，含无线任务消息）</span>'
    el.innerHTML = html
  }

  function renderStack(data) {
    var id = 'bd-data-chart-stack'
    var note = byId('bd-data-stack-note')
    var badge = byId('bd-data-stack-badge')
    var lt = data && data.lineTasks
    var st = deriveTaskStates(lt)
    if (lt && isNum(lt.taskCount) && lt.taskCount === 0) {
      chartNa(id, 'bd-data-stack-note', '暂无按线任务', '快照内没有带 taskRef 的消息（任务数 0，真实空态）')
      if (badge) badge.hidden = true
      return
    }
    if (!lt || !isNum(lt.taskCount) || !st.available) {
      chartNa(id, 'bd-data-stack-note', '未采集 · 任务状态需 byTaskRef', '缺 taskCount 或 byTaskRef[].byState；不拿消息数充当任务数')
      if (badge) badge.hidden = false
      return
    }
    var roles = lineRoles(data)
    var map = byLineMap(lt)
    var order = lineOrder(lt, st)
    var cats = [], done = [], prog = [], meta = []
    order.forEach(function (line) {
      var rec = st.byLine[line]
      if (!rec || (rec.done + rec.progress) <= 0) return
      var l = map[line] || {}
      cats.push(roleOf(roles, line)); done.push(rec.done); prog.push(rec.progress)
      meta.push({ line: line, taskCount: isNum(l.taskCount) ? l.taskCount : null, total: isNum(l.total) ? l.total : null })
    })
    if (!cats.length) { chartNa(id, 'bd-data-stack-note', '未采集 · byLine[].taskCount 为空', '契约派生未返回按线任务数；不显示 0'); return }
    var C = { ok: tone('--bd-ok', '#1A7F37'), info: tone('--bd-info', '#0969DA'), border: tone('--bd-border-strong', '#C9C4BA'), muted: tone('--bd-text-muted', '#5A6169') }
    var rotate = window.innerWidth < 720 ? 32 : 0
    chart(id, {
      color: [C.ok, C.info],
      tooltip: {
        trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: function (ps) {
          if (!ps || !ps.length) return ''
          var m = meta[ps[0].dataIndex] || {}
          var html = '<div><b>' + esc(ps[0].axisValue) + '</b></div>'
          ps.forEach(function (x) { html += '<div>' + x.marker + esc(x.seriesName) + '：' + fmtNum(x.value) + ' 个任务</div>' })
          html += '<div>' + esc(m.line || '') + ' · 参与任务数 ' + (isNum(m.taskCount) ? fmtNum(m.taskCount) : '未采集') + ' · 消息 ' + (isNum(m.total) ? fmtNum(m.total) : '未采集') + ' 条</div>'
          return html
        }
      },
      legend: { top: 0, left: 'center', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12, color: C.muted } },
      grid: { left: 52, right: 16, top: 42, bottom: rotate ? 58 : 34 },
      xAxis: { type: 'category', data: cats, axisTick: { show: false }, axisLine: { lineStyle: { color: C.border } }, axisLabel: { color: C.muted, fontSize: 12, interval: 0, rotate: rotate } },
      yAxis: { type: 'value', name: '任务数', minInterval: 1, nameTextStyle: { color: C.muted, fontSize: 12 }, splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 12 } },
      series: [{ name: '完成', type: 'bar', stack: 'task', data: done, barMaxWidth: 36 }, { name: '进行中', type: 'bar', stack: 'task', data: prog, barMaxWidth: 36 }]
    })
    var sum = 0
    order.forEach(function (line) { var r = st.byLine[line]; if (r) sum += r.done + r.progress })
    if (note) note.textContent = '采样时刻 ' + dt(data && data.generatedAt) + ' · 任务状态口径：按消息终态近似 · 非任务完成态（acked=完成、仍有未确认=进行中，byTaskRef[].byState 归并） · 阻塞/超时：未采集 · 按线之和 ' + fmtNum(sum) + ' > 任务总数 ' + fmtNum(lt.taskCount) + '（任务可跨线）'
    if (badge) { badge.hidden = false; badge.textContent = '阻塞 / 超时：未采集' }
  }

  function renderMsgLineChart(data) {
    var id = 'bd-data-chart-msgline'
    var note = byId('bd-data-msgline-note')
    var lines = (data && data.lineTasks && data.lineTasks.byLine) || []
    if (!lines.length) { chartNa(id, 'bd-data-msgline-note', '未采集 · lineTasks.byLine 为空', '按线消息数未采集；不显示 0'); return }
    var roles = lineRoles(data)
    var cats = [], vals = [], meta = []
    lines.forEach(function (l) { if (!isNum(l.total) || l.total <= 0) return; cats.push(roleOf(roles, l.line)); vals.push(l.total); meta.push(l) })
    if (!cats.length) { chartNa(id, 'bd-data-msgline-note', '未采集 · byLine[].total 为空', '按线消息数未采集；不显示 0'); return }
    var L2 = tone('--bd-l2', '#0B6E82'), border = tone('--bd-border-strong', '#C9C4BA'), muted = tone('--bd-text-muted', '#5A6169')
    var rotate = window.innerWidth < 720 ? 32 : 0
    chart(id, {
      color: [L2],
      tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, formatter: function (ps) { if (!ps || !ps.length) return ''; var l = meta[ps[0].dataIndex] || {}; return '<div><b>' + esc(ps[0].axisValue) + '</b>（' + esc(l.line || '') + '）</div><div>' + ps[0].marker + '消息：' + fmtNum(ps[0].value) + ' 条</div>' } },
      grid: { left: 48, right: 12, top: 16, bottom: rotate ? 58 : 34 },
      xAxis: { type: 'category', data: cats, axisTick: { show: false }, axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted, fontSize: 12, interval: 0, rotate: rotate } },
      yAxis: { type: 'value', name: '条', minInterval: 1, nameTextStyle: { color: muted, fontSize: 12 }, splitLine: { show: false }, axisLabel: { color: muted, fontSize: 12 } },
      series: [{ name: '消息数（快照日累计）', type: 'bar', data: vals, barMaxWidth: 36 }]
    })
    if (note) note.textContent = '采样时刻 ' + dt(data && data.generatedAt) + ' · 按线累计（快照日） · 与「消息数 / 日」的 messages.total 口径不同'
  }

  function renderMsgDay(data) {
    var id = 'bd-data-chart-msgday'
    var rows = ((data && data.messages && data.messages.byDay) || []).map(function (r) { return { day: r.day, v: isNum(r.count) ? r.count : null } }).filter(function (r) { return r.day && r.v != null })
    rows.sort(function (a, b) { return a.day < b.day ? -1 : (a.day > b.day ? 1 : 0) })
    var cutoff = cutoffDay(data && data.generatedAt)
    var shown = filterDays(rows, cutoff)
    if (!shown.length) { chartNa(id, 'bd-data-msgday-note', '未采集 · 窗口内无按日数据', 'messages.byDay 为空或窗口内无数据；不显示 0'); return }
    var L2 = tone('--bd-l2', '#0B6E82'), border = tone('--bd-border-strong', '#C9C4BA'), muted = tone('--bd-text-muted', '#5A6169')
    chart(id, {
      color: [L2],
      tooltip: { trigger: 'axis', confine: true, formatter: function (ps) { if (!ps || !ps.length) return ''; return '<div><b>' + esc(ps[0].axisValue) + '</b></div><div>' + ps[0].marker + '全部消息：' + fmtNum(ps[0].value) + ' 条</div>' } },
      grid: { left: 52, right: 16, top: 24, bottom: 30 },
      xAxis: { type: 'category', data: shown.map(function (r) { return r.day }), axisTick: { show: false }, axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted, fontSize: 12 } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { show: false }, axisLabel: { color: muted, fontSize: 12 } },
      series: [{ name: '全部消息', type: 'line', data: shown.map(function (r) { return r.v }), symbolSize: 8, lineStyle: { width: 2 }, areaStyle: { opacity: 0.12 }, label: { show: shown.length <= 7, position: 'top', color: muted, fontSize: 11, formatter: function (p) { return fmtNum(p.value) } } }]
    })
    var note = byId('bd-data-msgday-note')
    if (note) note.textContent = '采样时刻 ' + dt(data && data.generatedAt) + ' · 口径：messages.byDay（全部消息，含无 taskRef 的消息） · 时间窗 ' + dayLabel() + '（窗口内 ' + shown.length + ' 天有数据）' + (shown.length === 1 ? ' · 仅 1 天（折线为单点）' : '')
  }

  function renderTokenDay(data, metrics) {
    var id = 'bd-data-chart-tokenday'
    var note = byId('bd-data-tokenday-note')
    var t = metrics && metrics.tokens
    if (!t) { chartNa(id, 'bd-data-tokenday-note', '未采集 · 需 team-metrics 快照', 'token 来自 team-metrics.json；文件缺失时接口 404，本图不显示 0'); return }
    var per = t.perDay || []
    var rows = [], outMap = {}
    ;(t.perDayOutput || []).forEach(function (r) { var d = r.date || r.day; if (d) outMap[d] = isNum(r.tokens) ? r.tokens : null })
    per.forEach(function (r) { var day = r.date || r.day; if (day && isNum(r.tokens)) rows.push({ day: day, v: r.tokens, out: outMap[day] == null ? null : outMap[day] }) })
    var cutoff = cutoffDay((data && data.generatedAt) || (metrics && metrics.generatedAt))
    var shown = filterDays(rows, cutoff)
    if (!shown.length) { chartNa(id, 'bd-data-tokenday-note', '未采集 · 窗口内无 token 采样', 'tokens.perDay 为空或窗口内无数据；不显示 0'); return }
    var border = tone('--bd-border-strong', '#C9C4BA'), muted = tone('--bd-text-muted', '#5A6169'), info = tone('--bd-info', '#0969DA'), ok = tone('--bd-ok', '#1A7F37')
    chart(id, {
      color: [info, ok],
      tooltip: { trigger: 'axis', confine: true, formatter: function (ps) { if (!ps || !ps.length) return ''; var h = '<div><b>' + esc(ps[0].axisValue) + '</b></div>'; ps.forEach(function (x) { h += '<div>' + x.marker + esc(x.seriesName) + '：' + kfmt(x.value) + '</div>' }); return h } },
      legend: { top: 0, left: 'center', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12, color: muted } },
      grid: { left: 56, right: 16, top: 46, bottom: 30 },
      xAxis: { type: 'category', data: shown.map(function (r) { return r.day }), axisTick: { show: false }, axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted, fontSize: 12 } },
      yAxis: { type: 'value', splitLine: { show: false }, axisLabel: { color: muted, fontSize: 12, formatter: function (v) { return kfmt(v) } } },
      series: [
        { name: '总 token', type: 'line', data: shown.map(function (r) { return r.v }), symbolSize: 8, lineStyle: { width: 2 }, areaStyle: { opacity: 0.14 }, label: { show: shown.length <= 7, position: 'top', color: muted, fontSize: 11, formatter: function (x) { return kfmt(x.value) } } },
        { name: '输出 token', type: 'line', data: shown.map(function (r) { return r.out }), symbolSize: 7, lineStyle: { width: 1.5, type: 'dashed' }, label: { show: shown.length <= 7, position: 'top', color: muted, fontSize: 11, formatter: function (x) { return kfmt(x.value) } } }
      ]
    })
    if (note) { note.textContent = '估算 · 非计费 · 快照时刻 ' + dt(metrics.generatedAt) + ' · 口径：session 级累计采样（总 token=未缓存输入+输出+缓存读写） · 时间窗 ' + dayLabel() + '（窗口内 ' + shown.length + ' 天有数据） · 快照 · 非实时'; if (t.basis) note.title = String(t.basis) }
  }

  function renderCostLine(data, metrics) {
    var id = 'bd-data-chart-costline'
    var note = byId('bd-data-costline-note')
    var t = metrics && metrics.tokens
    if (!t) { chartNa(id, 'bd-data-costline-note', '未采集 · 需 team-metrics 快照', '按线 token 来自 team-metrics.json；文件缺失时 404，本图不显示 0'); return }
    var roles = lineRoles(data)
    var cats = [], vals = [], meta = [], seen = {}
    ;(t.byLine || []).forEach(function (l) {
      var v = isNum(l.today) ? l.today : (isNum(l.window) ? l.window : null)
      if (v == null) return
      seen[l.line] = true
      cats.push(roleOf(roles, l.line)); vals.push(Math.round(v / 100) / 10); meta.push({ line: l.line, raw: v, estimated: !isNum(l.today) })
    })
    if (!cats.length) { chartNa(id, 'bd-data-costline-note', '未采集 · tokens.byLine 为空', '按线 token 未采集；不显示 0'); return }
    var L2 = tone('--bd-l2', '#0B6E82'), border = tone('--bd-border-strong', '#C9C4BA'), muted = tone('--bd-text-muted', '#5A6169')
    var rotate = window.innerWidth < 720 ? 32 : 0
    chart(id, {
      color: [L2],
      tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, formatter: function (ps) { if (!ps || !ps.length) return ''; var mm = meta[ps[0].dataIndex] || {}; return '<div><b>' + esc(ps[0].axisValue) + '</b>（' + esc(mm.line || '') + '）</div><div>' + ps[0].marker + '今日 token：' + fmtNum(mm.raw) + '（' + kfmt(mm.raw) + '）</div><div>' + (mm.estimated ? 'today 缺失，回退 window（估算）' : '估算 · 非计费') + '</div>' } },
      grid: { left: 60, right: 12, top: 16, bottom: rotate ? 58 : 34 },
      xAxis: { type: 'category', data: cats, axisTick: { show: false }, axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted, fontSize: 12, interval: 0, rotate: rotate } },
      yAxis: { type: 'value', name: 'k token', minInterval: 1, nameTextStyle: { color: muted, fontSize: 12 }, splitLine: { show: false }, axisLabel: { color: muted, fontSize: 12 } },
      series: [{ name: '今日 token（k）', type: 'bar', data: vals, barMaxWidth: 36 }]
    })
    var missing = []
    ;((data && data.lines) || []).forEach(function (l) { if (!seen[l.label]) missing.push(roleOf(roles, l.label)) })
    if (note) note.textContent = '估算 · 非计费 · 快照时刻 ' + dt(metrics.generatedAt) + ' · 口径：tokens.byLine[].today / 1000（k）· 快照 · 非实时' + (missing.length ? ' · 未采集线：' + missing.join('、') + '（metrics 无采样）' : '')
  }

  function updateWindowNote(data, metrics) {
    var el = byId('bd-data-window-note'); if (!el) return
    var cutoff = cutoffDay((data && data.generatedAt) || (metrics && metrics.generatedAt))
    var days = {}
    ;((data && data.messages && data.messages.byDay) || []).forEach(function (r) { if (r.day && (!cutoff || r.day >= cutoff)) days[r.day] = true })
    ;((metrics && metrics.tokens && metrics.tokens.perDay) || []).forEach(function (r) { var d = r.date || r.day; if (d && (!cutoff || d >= cutoff)) days[d] = true })
    var list = Object.keys(days).sort()
    el.textContent = '时间窗：' + dayLabel() + ' · 按日序列' + (list.length ? '窗口内 ' + list.length + ' 天有数据（' + list[0] + (list.length > 1 ? ' 起' : '') + '）' : '窗口内暂无按日数据') + ' · 按线累计与任务快照不受窗口影响'
  }
  function renderSource(data, metrics) {
    var el = byId('bd-data-source'); if (!el) return
    var liveAt = data && data.generatedAt
    var mAt = metrics && metrics.generatedAt
    var parts = ['数据时刻 ' + dt(liveAt) + '（live 快照）']
    if (isNum(mAt)) parts.push('token 采样时刻 ' + dt(mAt) + '（team-metrics 快照 · 非实时）'); else parts.push('token 采样时刻 未采集（team-metrics 快照缺失）')
    parts.push('口径：任务数=distinct taskRef；消息数单列；token=session 级估算（非计费）')
    parts.push('缺失字段显示「未采集」，不显示 0')
    el.textContent = parts.join(' · ')
  }
  function syncWindowButtons() {
    var btns = document.querySelectorAll('[data-bd-data-window]')
    for (var i = 0; i < btns.length; i++) { var v = Number(btns[i].getAttribute('data-bd-data-window')); btns[i].setAttribute('aria-pressed', v === winDays ? 'true' : 'false') }
  }
  function renderAll(data, metrics) {
    last.data = data; last.metrics = metrics
    updateWindowNote(data, metrics)
    renderKpi(data)
    renderMsgLine(data)
    renderStack(data)
    renderMsgLineChart(data)
    renderMsgDay(data)
    renderTokenDay(data, metrics)
    renderCostLine(data, metrics)
    renderSource(data, metrics)
    syncWindowButtons()
  }

  function initWindowChips() {
    document.addEventListener('click', function (e) {
      var n = e.target
      while (n && n.nodeType === 1 && !(n.getAttribute && n.getAttribute('data-bd-data-window'))) n = n.parentNode
      if (!n || n.nodeType !== 1) return
      var v = Number(n.getAttribute('data-bd-data-window'))
      if (!isFinite(v)) return
      winDays = v
      renderAll(last.data, last.metrics)
    })
  }

  window.BD2Data = {
    render: function (data) {
      fetch('/api/team-metrics', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .catch(function () { return null })
        .then(function (metrics) { renderAll(data, metrics) })
    },
    renderAll: function (data, metrics) { renderAll(data, metrics) },
    rerender: function () { if (last.data) renderAll(last.data, last.metrics) },
    resize: function () { Object.keys(charts).forEach(function (id) { try { charts[id].resize() } catch (e) {} }) }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWindowChips)
  else initWindowChips()
  window.addEventListener('resize', function () { window.BD2Data.resize() })
})()
