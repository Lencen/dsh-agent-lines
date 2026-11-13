/* board2-core.js — 0.13 Board 2.0 前端核心（壳层 + 数据拉取 + 视图渲染入口） */
(function () {
  'use strict'
  var state = { view: 'overview', live: null, version: null, timer: null, loading: false }
  function $(s, r) { return (r || document).querySelector(s) }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)) }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  // 计划文本 → 步骤列表（支持 P1 xx / - a / 1) a / 单段视为 1 步）
  function parsePlan(raw) {
    var text = String(raw == null ? '' : raw).trim()
    if (!text) return []
    var lines = text.split(/\r?\n+/).map(function (l) { return l.trim() }).filter(Boolean)
    if (lines.length === 1) return [{ title: lines[0].slice(0, 40), desc: '' }]
    return lines.map(function (l) {
      var m = l.match(/^(?:[-*]\s*|(?:P|步骤)?\s*\d+[\.\)、:：]\s*)(.*)$/)
      var body = m ? m[1] : l
      var parts = body.split(/[：:]\s*/)
      return { title: (parts[0] || body).slice(0, 40), desc: parts.length > 1 ? parts.slice(1).join('：') : '' }
    })
  }
  function showError(msg) { var el = $('#bd-error'); if (!el) return; el.textContent = msg; el.hidden = false }
  function clearError() { var el = $('#bd-error'); if (el) { el.hidden = true; el.textContent = '' } }
  function setView(name) {
    state.view = name
    $$('.bd-tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-view') === name)) })
    $$('.bd-view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== name })
    var crumb = $('#bd-breadcrumb'); if (crumb) crumb.textContent = '团队 / ' + ({ overview: '总览', org: '组织', tasks: '任务', data: '数据', cost: '消耗' }[name] || name)
  }
  function fmtTime(ms) { try { return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false }) } catch (e) { return '--:--' } }
  function renderHeader(data) {
    state.live = data
    var t = $('#bd-data-time'); if (t) t.textContent = data && (data.generatedAt || data.snapshotAt) ? fmtTime(data.generatedAt || data.snapshotAt) : fmtTime(Date.now())
    var team = $('#bd-team-name'); if (team) team.textContent = (data && data.teamName) || '团队'
    var v = $('#bd-version'); if (v) v.textContent = '版本 ' + (state.version || (data && data.version) || '未采集')
  }
  // S3-S7 会实现以下渲染；S2 仅渲染壳层占位（保持「未采集/示例」口径）
  var DEFAULT_WF = ['设定', '拆解', '排期', '执行', '审阅', '验收', '交付']
  function degradeAll(reason) {
    var map = {
      'bd-ov-goal-body': '目标未采集',
      'bd-ov-plan-body': '计划未采集',
      'bd-ov-workflow-body': '工作流未采集',
      'bd-ov-rhythm-body': '节奏未采集',
      'bd-ov-l15-body': 'L1.5 大任务未采集',
      'bd-org-body': '角色与 agent 未采集',
      'bd-tasks-body': '任务未采集',
      'bd-data-body': '数据未采集',
      'bd-cost-body': '消耗未采集'
    }
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id)
      if (el) el.innerHTML = '<p class="bd-empty">' + esc(map[id]) + '（' + esc(reason) + '）</p>'
    })
    var t = document.getElementById('bd-data-time'); if (t) t.textContent = '未采集'
  }
  function renderWorkflow(data) {
    var body = $('#bd-ov-workflow-body'); if (!body) return
    var g = (data && data.teamGoal) || {}
    var stages = parseWorkflow(g.workflow)
    var synthetic = stages.length === 0
    if (synthetic) stages = DEFAULT_WF.map(function (n, i) { return { name: n, owner: null, output: null, status: 'todo', no: i + 1 } })
    var cur = g.currentStage || (stages.filter(function (s) { return s.status === 'doing' })[0] || {}).name || null
    var doneCount = stages.filter(function (s) { return s.status === 'done' }).length
    var pct = stages.length ? Math.round(doneCount / stages.length * 100) : 0
    var head = '<div class="bd-wf-head"><span class="bd-wf-progress-text">阶段 ' + doneCount + '/' + stages.length + '</span>' +
      '<span class="bd-wf-cur">当前：' + esc(cur || '未采集') + '</span>' +
      (synthetic ? '<span class="bd-badge bd-badge-warn">示例 · 待 TEAM.md 工作流</span>' : '') +
      '<span class="bd-wf-progress"><progress class="bd-wf-progress-bar" value="' + pct + '" max="100" aria-label="工作流进度 ' + pct + '%"></progress><b class="num">' + pct + '%</b></span>' +
      '<span class="bd-wf-scrollhint">横滑查看 ' + stages.length + ' 阶段 →</span></div>'
    var strip = stages.map(function (s, i) {
      var isCur = cur && s.name === cur
      var cls = 'bd-wf-stage ' + (s.status === 'done' ? 'bd-wf-done' : isCur ? 'bd-wf-doing' : s.status === 'asis' ? 'bd-wf-asis' : 'bd-wf-todo')
      var badge = s.status === 'done' ? '<span class="bd-badge bd-badge-ok">完成</span>' : isCur ? '<span class="bd-badge bd-badge-info">进行中</span>' : s.status === 'asis' ? '<span class="bd-badge bd-badge-warn">按需</span>' : '<span class="bd-badge bd-badge-muted">待开始</span>'
      var node = '<div class="' + cls + '" role="listitem" tabindex="0" aria-label="阶段 ' + (i + 1) + ' ' + esc(s.name) + '">' +
        (isCur ? '<span class="bd-wf-current-badge">当前</span>' : '') +
        '<span class="bd-wf-no">' + (s.status === 'done' ? '✓' : String(i + 1).padStart(2, '0')) + '</span>' +
        '<b class="bd-wf-name">' + esc(s.name) + '</b>' +
        '<span class="bd-wf-owner">' + (s.owner ? 'owner ' + esc(s.owner) : 'owner 未采集') + '</span>' +
        '<span class="bd-wf-output">' + (s.output ? esc(s.output) : '产出未采集') + '</span>' + badge + '</div>'
      var connector = i < stages.length - 1 ? '<span class="bd-wf-connector ' + (s.status === 'done' ? 'bd-wf-done' : 'bd-wf-todo') + '" aria-hidden="true">→</span>' : ''
      return node + connector
    }).join('')
    body.innerHTML = head + '<div class="bd-wf-strip" role="list" aria-label="工作流 ' + stages.length + ' 阶段">' + strip + '</div>'
  }


  // 通用：文本 → 列表项（按行；去掉编号/符号）
  function parseLines(raw) {
    var text = String(raw == null ? '' : raw).trim()
    if (!text) return []
    return text.split(/\r?\n+/).map(function (l) { return l.trim() }).filter(Boolean).map(function (l) {
      return l.replace(/^(?:[-*•]\s*|(?:P|步骤|阶段)?\s*\d+[\.\)、:：]\s*)/, '')
    })
  }
  // 工作流：文本行可含 "名称 | owner | 产出 | 状态"（状态：完成/进行中/待开始/按需）
  function parseWorkflow(raw) {
    var lines = parseLines(raw)
    if (lines.length < 2) return []
    var stages = lines.map(function (l) {
      var cols = l.split('|').map(function (x) { return x.trim() })
      var status = cols[3] || ''
      var st = /完成/.test(status) ? 'done' : /进行中|当前|doing/.test(status) ? 'doing' : /按需/.test(status) ? 'asis' : 'todo'
      return { name: cols[0], owner: cols[1] || null, output: cols[2] || null, status: st }
    })
    return stages
  }
  function renderRhythm(data) {
    var body = $('#bd-ov-rhythm-body'); if (!body) return
    var g = (data && data.teamGoal) || {}
    var items = parseLines(g.rhythm)
    var sub = $('#bd-ov-rhythm-sub')
    if (sub) sub.textContent = items.length ? ('teamGoal.rhythm · ' + items.length + ' 条') : 'teamGoal.rhythm'
    if (!items.length) { body.innerHTML = '<p class="bd-empty">节奏未采集（TEAM.md 计划节奏）</p>'; return }
    body.innerHTML = '<ol class="bd-ov-rhythm">' + items.map(function (t, i) {
      return '<li class="bd-ov-rhythm-row"><span class="bd-ov-rhythm-no" aria-hidden="true">' + (i + 1) + '</span><span>' + esc(t) + '</span></li>'
    }).join('') + '</ol>'
  }
  var L15_EXAMPLE = [
    { id: 'wi-demo-1', title: '0.12.0 发布准备', status: 'active', priority: 'P0', concurrent: 2, stage: '执行', l2: 2, l3: 4, agentRuns: 12, tokenTotal: 48200 },
    { id: 'wi-demo-2', title: '官网文案改版', status: 'paused', priority: 'P2', concurrent: 0, stage: null, l2: 0, l3: 0, agentRuns: null, tokenTotal: null },
    { id: 'wi-demo-3', title: '视频 v2 收尾', status: 'done', priority: 'P1', concurrent: 0, stage: '交付', l2: 1, l3: 2, agentRuns: 8, tokenTotal: 20500 }
  ]
  var L15_STATUS = { active: '进行中', paused: '暂停', done: '完成', cancelled: '已取消' }
  function l15Row(it) {
    var cls = it.status === 'active' ? 'bd-badge-info' : it.status === 'paused' ? 'bd-badge-paused' : 'bd-badge-muted'
    var mini = ['设定', '拆解', '排期', '执行', '审阅', '验收', '交付'].map(function (s) {
      var idx = ['设定', '拆解', '排期', '执行', '审阅', '验收', '交付'].indexOf(it.stage)
      var ci = ['设定', '拆解', '排期', '执行', '审阅', '验收', '交付'].indexOf(s)
      var c = it.stage && ci === idx ? 'cur' : it.stage && idx > ci ? 'done' : ''
      return '<i class="bd-wi-wfseg ' + c + '" title="' + esc(s) + '"></i>'
    }).join('')
    return '<a class="bd-wi-row" href="/workitem?id=' + encodeURIComponent(it.id) + '" role="article" aria-label="大任务 ' + esc(it.title) + '，查看详情">' +
      '<div class="bd-wi-col bd-wi-col-main"><div class="bd-wi-rowhead"><b class="bd-wi-title">' + esc(it.title) + '</b>' +
      '<span class="bd-badge ' + cls + '">' + esc(L15_STATUS[it.status] || '未采集') + '</span>' +
      (it.concurrent > 1 ? '<span class="bd-badge bd-badge-concurrent">并发中（' + it.concurrent + '）</span>' : '') +
      (it.priority ? '<span class="bd-badge bd-badge-priority">' + esc(it.priority) + '</span>' : '') +
      '<span class="bd-badge bd-badge-warn">示例 · 待 0.13 契约</span></div>' +
      '<div class="bd-wi-meta">示例 · 待 0.13 契约 · owner 未采集</div>' +
      '<div class="bd-wi-stage">当前阶段：<b>' + esc(it.stage || '未采集') + '</b><span class="bd-wi-miniwf" aria-label="工作流 7 阶段">' + mini + '</span></div>' +
      '<div class="bd-wi-fields"><span class="bd-wi-f">L2 <b>' + (it.l2 == null ? '未采集' : it.l2 + ' 条') + '</b></span>' +
      '<span class="bd-wi-f">L3 <b>' + (it.l3 == null ? '未采集' : it.l3 + ' 条') + '</b></span>' +
      '<span class="bd-wi-f">agent <b>' + (it.agentRuns == null ? '未采集' : it.agentRuns + ' 次') + '</b></span>' +
      '<span class="bd-wi-f">token <b>' + (it.tokenTotal == null ? '未采集' : (it.tokenTotal / 1000).toFixed(1) + 'k') + '</b></span></div>' +
      '</div><div class="bd-wi-col"><span class="bd-wi-detail-link">详情 →</span></div></a>'
  }
  function renderL15(data) {
    var host = $('#bd-ov-l15-body'); if (!host) return
    var items = L15_EXAMPLE
    var visible = items.filter(function (it) { return it.status !== 'done' && it.status !== 'cancelled' })
    var hidden = items.length - visible.length
    host.innerHTML = '<div class="bd-l15-head"><div class="bd-l15-chips" role="group" aria-label="L1.5 筛选">' +
      '<button type="button" class="bd-chip" aria-pressed="true">全部当前</button>' +
      '<button type="button" class="bd-chip" aria-pressed="false">进行中</button>' +
      '<button type="button" class="bd-chip" aria-pressed="false">暂停</button>' +
      '<button type="button" class="bd-chip" aria-pressed="false">并发</button></div>' +
      '<span class="bd-l15-count">当前 ' + visible.length + ' 个' + (hidden ? ' · 已隐藏 ' + hidden + ' 个（完成/已取消）' : '') + '</span></div>' +
      '<div class="bd-l15-rows">' + visible.map(l15Row).join('') + '</div>' +
      '<p class="bd-l15-note">示例 · 待 0.13 契约；L2 时间来自真实消息；计划时间未采集；各 workItem 的 token 不可横向加总。</p>'
  }

  function renderPlaceholders(data) {
    var g = (data && data.teamGoal) || {}
    var goal = $('#bd-ov-goal-body')
    if (goal) goal.innerHTML = g.objective
      ? '<p class="bd-ov-goal-obj">' + esc(g.objective) + '</p>' +
        (g.intro ? '<p class="bd-ov-prose">' + esc(g.intro) + '</p>' : '<p class="bd-empty">简介未采集（TEAM.md）</p>') +
        '<div class="bd-ov-goal-meta"><span><span class="bd-ov-k">来源</span>TEAM.md</span>' +
        '<span><span class="bd-ov-k">数据时刻</span><span class="num">' + esc(data && (data.generatedAt || data.snapshotAt) ? new Date(data.generatedAt || data.snapshotAt).toLocaleString('zh-CN', { hour12: false }) : '未采集') + '</span></span></div>'
      : '<p class="bd-empty">目标未采集（TEAM.md）</p>'
    var plan = $('#bd-ov-plan-body')
    var sub = $('#bd-ov-plan-sub')
    var items = parsePlan(g.plan)
    if (sub) sub.textContent = items.length ? ('teamGoal.plan · ' + items.length + ' 步') : 'teamGoal.plan'
    if (plan) plan.innerHTML = items.length
      ? '<ol class="bd-ov-plan">' + items.map(function (it, i) {
          return '<li class="bd-ov-plan-row"><span class="bd-ov-plan-no" aria-hidden="true">' + (i + 1) + '</span><div class="bd-ov-plan-main"><b>' + esc(it.title) + '</b><span class="bd-ov-plan-desc">' + esc(it.desc) + '</span></div></li>'
        }).join('') + '</ol>'
      : '<p class="bd-empty">计划未采集（TEAM.md 规划）</p>'
    var team = $('#bd-ov-team')
    if (team) team.textContent = (data && data.teamName) || ''
    renderWorkflow(data)
    renderRhythm(data)
    renderL15(data)
    var org = $('#bd-org-body')
    if (org) org.innerHTML = '<p class="bd-empty">角色与 agent：示例（S6 实现）</p>'
    var tasks = $('#bd-tasks-body')
    if (tasks) tasks.innerHTML = '<p class="bd-empty">任务分组：示例（S7 实现）</p>'
    var dt = $('#bd-data-body')
    if (dt) dt.innerHTML = '<p class="bd-empty">数据总览：未采集（S11 对齐）</p>'
    var cost = $('#bd-cost-body')
    if (cost) cost.innerHTML = '<p class="bd-empty">消耗总览：未采集（S11 对齐）</p>'
  }
  function render(data) { renderHeader(data); renderPlaceholders(data) }
  function load() {
    if (state.loading) return
    state.loading = true
    fetch('/api/health', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null }).then(function (h) { if (h && h.version) { state.version = h.version; renderHeader(state.live) } }).catch(function () {})
    fetch('/api/live', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('live ' + r.status)
      return r.json()
    }).then(function (data) { clearError(); if (!data || data.available === false) { degradeAll("数据不可得"); } else { render(data) } }).catch(function (e) { degradeAll("数据不可得"); showError('数据不可得：' + String(e && e.message || e) + '（只读，不伪造）'); var t = $('#bd-data-time'); if (t) t.textContent = '未采集' }).then(function () { state.loading = false })
  }
  function startAuto() {
    var sel = $('#bd-period'); var ms = parseInt((sel && sel.value) || '30000', 10)
    if (state.timer) clearInterval(state.timer)
    state.timer = setInterval(load, ms)
  }
  function stopAuto() { if (state.timer) { clearInterval(state.timer); state.timer = null } }
  function openDrawer(title, html) {
    var d = $('#bd-drawer'); if (!d) return
    $('#drawer-title').textContent = title
    $('#drawer-body').innerHTML = html
    d.hidden = false; d.setAttribute('aria-hidden', 'false')
  }
  function closeDrawer() { var d = $('#bd-drawer'); if (d) { d.hidden = true; d.setAttribute('aria-hidden', 'true') } }
  window.bdOpenDrawer = openDrawer
  window.bdCloseDrawer = closeDrawer
  function install() {
    $$('.bd-tab').forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')) }) })
    var refresh = $('#bd-refresh'); if (refresh) refresh.addEventListener('click', load)
    var auto = $('#bd-auto'); if (auto) auto.addEventListener('click', function () { var on = auto.getAttribute('aria-pressed') !== 'true'; auto.setAttribute('aria-pressed', String(on)); if (on) startAuto(); else stopAuto() })
    var period = $('#bd-period'); if (period) period.addEventListener('change', function () { if (state.timer) startAuto() })
    var density = $('#bd-density'); if (density) density.addEventListener('click', function () { var on = density.getAttribute('aria-pressed') !== 'true'; density.setAttribute('aria-pressed', String(on)); document.documentElement.setAttribute('data-density', on ? 'compact' : 'comfortable') })
    var close = $('#bd-drawer-close'); if (close) close.addEventListener('click', closeDrawer)
    setView('overview')
    load()
    startAuto()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install()
})()
