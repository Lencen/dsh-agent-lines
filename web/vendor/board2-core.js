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
    var wf = $('#bd-ov-workflow-body')
    if (wf) wf.innerHTML = '<p class="bd-empty">工作流阶段：示例（S4 实现）</p>'
    var rh = $('#bd-ov-rhythm-body')
    if (rh) rh.innerHTML = '<p class="bd-empty">节奏：示例（S5 实现）</p>'
    var l15 = $('#bd-ov-l15-body')
    if (l15) l15.innerHTML = '<p class="bd-empty">L1.5 大任务：示例 · 待 0.13 契约（S5 实现）</p>'
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
    }).then(function (data) { clearError(); render(data) }).catch(function (e) { showError('数据不可得：' + String(e && e.message || e) + '（只读，不伪造）'); var t = $('#bd-data-time'); if (t) t.textContent = '未采集' }).then(function () { state.loading = false })
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
