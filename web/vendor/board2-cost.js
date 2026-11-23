/* board2-cost.js — 0.14 S4 消耗视图（原型 parts/cost.html + cost.js 对齐）
 * token 仅来自 team-metrics 快照；缺失=「未采集」不显示 0；估算口径（非计费）· 快照非实时。
 */
(function () {
  'use strict'
  var charts = {}
  var last = null

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
  function badge(text, kind) { return '<span class="bd-badge bd-badge-' + (kind || 'muted') + '">' + esc(text) + '</span>' }
  function dispose(id) { var c = charts[id]; if (c) { try { c.dispose() } catch (e) {} delete charts[id] } var n = byId(id); if (n) n.innerHTML = '' }
  function chart(id, option) {
    var node = byId(id); if (!node || typeof window.echarts === 'undefined') return
    dispose(id); var c = window.echarts.init(node, null, { renderer: 'canvas' }); c.setOption(option); charts[id] = c
  }
  function chartNa(id, noteId, title, desc) {
    dispose(id)
    var node = byId(id); if (node) node.innerHTML = '<div class="bd-chart-na"><b>' + esc(title) + '</b><span>' + esc(desc) + '</span></div>'
    var note = byId(noteId); if (note) note.textContent = title + ' · ' + desc
  }
  function lineRoles(data) { var map = {}; ((data && data.lines) || []).forEach(function (l) { map[l.label] = l.role || l.title || l.label }); return map }
  function roleOf(map, line) { return map[line] || line }

  function renderOverview(metrics, data) {
    var kpis = byId('bd-cost-kpis'), badges = byId('bd-cost-badges'), stats = byId('bd-cost-stats')
    if (!kpis) return
    var t = metrics && metrics.tokens
    if (!t) {
      kpis.innerHTML = '<p class="bd-empty">' + na('team-metrics.json 缺失') + ' 需 team-metrics 快照；本页不显示 0。</p>'
      if (badges) badges.innerHTML = badge('未采集 · 需 team-metrics 快照') + badge('不显示 0') + '<span class="bd-pill">快照缺失 · 非实时</span>'
      if (stats) stats.innerHTML = ''
      return
    }
    var per = t.perDay || []
    var days = []
    per.forEach(function (r) { var day = r.date || r.day; if (day) days.push(day) })
    days.sort()
    var sampleDay = days.length ? days[days.length - 1] : (isNum(metrics.generatedAt) ? dayOf(metrics.generatedAt) : '未采集')
    var items = [
      { label: '今日', value: isNum(t.today) ? kfmt(t.today) : null, reason: 'tokens.today 未采集', hint: '采样日 ' + sampleDay + ' · 输出 ' + kfmt(t.todayOutput) },
      { label: '近 7 天', value: isNum(t.window) ? kfmt(t.window) : null, reason: 'tokens.window 未采集', hint: 'windowDays=' + (isNum(t.windowDays) ? t.windowDays : '未采集') + ' · 快照覆盖 ' + (days.length ? days.length + ' 天' : '未采集') },
      { label: '累计', value: isNum(t.total) ? kfmt(t.total) : null, reason: 'tokens.total 未采集', hint: 'samples=' + (isNum(t.samples) ? t.samples : '未采集') + ' · 采样间隔 ' + (isNum(t.sampleIntervalMs) ? Math.round(t.sampleIntervalMs / 1000) + 's' : '未采集') }
    ]
    kpis.innerHTML = items.map(function (it) {
      var val = it.value == null ? na(it.reason) : it.value
      return '<div class="bd-kpi"><div class="bd-kpi-label">' + esc(it.label) + '</div><div class="bd-kpi-value num">' + val + '</div><div class="bd-kpi-hint">' + esc(it.hint) + '</div></div>'
    }).join('')
    if (badges) {
      badges.innerHTML = badge('team-metrics 快照') + badge('快照时刻 ' + dt(metrics.generatedAt)) + badge('估算 · 非计费', 'warn') + badge('快照 · 非实时') + badge('时间窗 近 7 天 · 快照固定')
    }
    if (stats) {
      var pills = []
      function pill(label, n) {
        if (isNum(n)) pills.push('<span class="bd-pill" title="' + esc(fmtNum(n) + ' token') + '">' + esc(label) + ' ' + esc(kfmt(n)) + '</span>');
        else pills.push('<span class="bd-pill bd-pill-unavailable" title="未采集（team-metrics 缺字段，不显示 0）">' + esc(label) + ' 未采集</span>');
      }
      pill('输入', t.inputTokens); pill('缓存读', t.cacheReadTokens); pill('缓存写', t.cacheWriteTokens); pill('输出', t.outputTotal); pill('样本', t.samples)
      stats.innerHTML = pills.join('')
    }
  }

  function renderDayChart(metrics) {
    var t = metrics && metrics.tokens
    if (!t) { chartNa('bd-cost-chart-day', 'bd-cost-day-note', '未采集 · 需 team-metrics 快照', '按日 token 来自 team-metrics.json；文件缺失时接口 404，本图不显示 0'); return }
    var rows = [], outMap = {}
    ;(t.perDayOutput || []).forEach(function (r) { var d = r.date || r.day; if (d && isNum(r.tokens)) outMap[d] = r.tokens })
    ;(t.perDay || []).forEach(function (r) { var d = r.date || r.day; if (d && isNum(r.tokens)) rows.push({ day: d, v: r.tokens }) })
    rows.sort(function (a, b) { return a.day < b.day ? -1 : (a.day > b.day ? 1 : 0) })
    if (!rows.length) { chartNa('bd-cost-chart-day', 'bd-cost-day-note', '未采集 · tokens.perDay 为空', '按日 token 序列未采集；不显示 0'); return }
    var L2 = tone('--bd-l2', '#0B6E82'), L3 = tone('--bd-l3', '#7C4DFF'), border = tone('--bd-border-strong', '#C9C4BA'), muted = tone('--bd-text-muted', '#5A6169')
    var outVals = rows.map(function (r) { return isNum(outMap[r.day]) ? outMap[r.day] : null })
    chart('bd-cost-chart-day', {
      color: [L2, L3],
      tooltip: { trigger: 'axis', confine: true, formatter: function (ps) { if (!ps || !ps.length) return ''; var h = '<div><b>' + esc(ps[0].axisValue) + '</b></div>'; ps.forEach(function (x) { h += '<div>' + x.marker + esc(x.seriesName) + '：' + (isNum(x.value) ? fmtNum(x.value) + '（' + kfmt(x.value) + '）' : '未采集') + '</div>' }); return h } },
      legend: { top: 0, left: 'center', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12, color: muted } },
      grid: { left: 56, right: 16, top: 46, bottom: 30 },
      xAxis: { type: 'category', data: rows.map(function (r) { return r.day }), axisTick: { show: false }, axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted, fontSize: 12 } },
      yAxis: { type: 'value', splitLine: { show: false }, axisLabel: { color: muted, fontSize: 12, formatter: function (v) { return kfmt(v) } } },
      series: [
        { name: '总 token', type: 'line', data: rows.map(function (r) { return r.v }), symbolSize: 8, lineStyle: { width: 2 }, areaStyle: { opacity: 0.14 }, label: { show: rows.length <= 7, position: 'top', color: muted, fontSize: 11, formatter: function (x) { return kfmt(x.value) } } },
        { name: '输出 token', type: 'line', data: outVals, symbolSize: 7, lineStyle: { width: 1.5, type: 'dashed' }, label: { show: rows.length <= 7, position: 'top', color: muted, fontSize: 11, formatter: function (x) { return kfmt(x.value) } } }
      ]
    })
    var note = byId('bd-cost-day-note')
    if (note) { note.textContent = '估算 · 非计费 · 快照时刻 ' + dt(metrics.generatedAt) + ' · 口径：session 级累计采样（总 token=未缓存输入+输出+缓存读写；输出 token 单列）' + (rows.length === 1 ? ' · 快照仅 1 天（折线为单点）' : '') + ' · 快照 · 非实时 · 单位 1k=1,000 token'; if (t.basis) note.title = String(t.basis) }
  }

  function renderLineChart(metrics, data) {
    var t = metrics && metrics.tokens
    if (!t) { chartNa('bd-cost-chart-line', 'bd-cost-line-note', '未采集 · 需 team-metrics 快照', '按线 token 来自 team-metrics.json；文件缺失时接口 404，本图不显示 0'); return }
    var roles = lineRoles(data)
    var cats = [], vals = [], meta = [], seen = {}
    ;(t.byLine || []).forEach(function (l) {
      var v = isNum(l.today) ? l.today : (isNum(l.window) ? l.window : null)
      if (v == null) return
      seen[l.line] = true
      cats.push(roleOf(roles, l.line)); vals.push(Math.round(v / 100) / 10); meta.push({ line: l.line, raw: v, estimated: !isNum(l.today) })
    })
    if (!cats.length) { chartNa('bd-cost-chart-line', 'bd-cost-line-note', '未采集 · tokens.byLine 为空', '按线 token 未采集；不显示 0'); return }
    var L2 = tone('--bd-l2', '#0B6E82'), border = tone('--bd-border-strong', '#C9C4BA'), muted = tone('--bd-text-muted', '#5A6169')
    var rotate = window.innerWidth < 720 ? 32 : 0
    chart('bd-cost-chart-line', {
      color: [L2],
      legend: { top: 0, left: 'center', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12, color: muted } },
      tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, formatter: function (ps) { if (!ps || !ps.length) return ''; var mm = meta[ps[0].dataIndex] || {}; return '<div><b>' + esc(ps[0].axisValue) + '</b>（' + esc(mm.line || '') + '）</div><div>' + ps[0].marker + '今日 token：' + fmtNum(mm.raw) + '（' + kfmt(mm.raw) + '）</div><div>' + (mm.estimated ? 'today 缺失，回退 window（估算）' : '估算 · 非计费') + '</div>' } },
      grid: { left: 60, right: 12, top: 28, bottom: rotate ? 58 : 34 },
      xAxis: { type: 'category', data: cats, axisTick: { show: false }, axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted, fontSize: 12, interval: 0, rotate: rotate } },
      yAxis: { type: 'value', name: 'k token', minInterval: 1, nameTextStyle: { color: muted, fontSize: 12 }, splitLine: { show: false }, axisLabel: { color: muted, fontSize: 12 } },
      series: [{ name: '今日 token（k）', type: 'bar', data: vals, barMaxWidth: 36 }]
    })
    var missing = []
    ;((data && data.lines) || []).forEach(function (l) { if (!seen[l.label]) missing.push(roleOf(roles, l.label)) })
    var note = byId('bd-cost-line-note')
    if (note) { note.textContent = '估算 · 非计费 · 快照时刻 ' + dt(metrics.generatedAt) + ' · 口径：tokens.byLine[].today / 1000（k）· 快照 · 非实时' + (missing.length ? ' · 未采集线：' + missing.join('、') + '（metrics 无采样）' : ''); if (t.basis) note.title = String(t.basis) }
  }

  function renderSource(metrics) {
    var el = byId('bd-cost-source'); if (!el) return
    var t = metrics && metrics.tokens
    if (!t) { el.textContent = 'token 采样：未采集 · 需 team-metrics 快照（文件缺失时接口 404，不显示 0）· 成员级 token 不可得（Phase 2 · KNOWN_ISSUES D3）'; return }
    el.textContent = '快照来源 team-metrics.json · 快照时刻 ' + dt(metrics.generatedAt) + ' · 估算，非计费 · 快照 · 非实时 · 成员级 token 不可得（需 DSH 投影，Phase 2）· 单位 1k=1,000 token'
  }

  function renderAll(metrics, data) {
    last = { metrics: metrics, data: data }
    renderOverview(metrics, data)
    renderDayChart(metrics)
    renderLineChart(metrics, data)
    renderSource(metrics)
  }

  window.BD2Cost = {
    render: function (data) {
      fetch('/api/team-metrics', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .catch(function () { return null })
        .then(function (metrics) { renderAll(metrics, data) })
    },
    rerender: function () { if (last) renderAll(last.metrics, last.data) },
    resize: function () { Object.keys(charts).forEach(function (id) { try { charts[id].resize() } catch (e) {} }) }
  }
  window.addEventListener('resize', function () { window.BD2Cost.resize() })
})()