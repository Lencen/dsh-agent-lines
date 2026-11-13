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
      'bd-org-roles': '角色与 agent 未采集',
      'bd-tasks-list': '任务未采集',
      'bd-tasks-summary': '任务摘要未采集',
      'bd-data-body': '数据未采集',
      'bd-cost-body': '消耗未采集'
    }
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id)
      if (el) el.innerHTML = '<p class="bd-empty">' + esc(map[id]) + '（' + esc(reason) + '）</p>'
    })
    ['bd-org-kpi-roles', 'bd-org-kpi-agents', 'bd-org-kpi-online', 'bd-tasks-kpi-total', 'bd-tasks-kpi-doing', 'bd-tasks-kpi-blocked', 'bd-tasks-kpi-latest'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.textContent = '未采集'
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
    var sub = $('#bd-ov-workflow-sub'); if (sub) sub.textContent = (synthetic ? '示例 · 待 0.13 契约 · ' : '') + 'teamGoal.workflow · ' + stages.length + ' 阶段'
  }


  // 通用：文本 → 列表项（按行；去掉编号/符号）
  function parseLines(raw) {
    var text = String(raw == null ? '' : raw).trim()
    if (!text) return []
    return text.split(/\r?\n+/).map(function (l) { return l.trim() }).filter(Boolean).map(function (l) {
      return l.replace(/^(?:[-*•]\s*|(?:P|步骤|阶段)?\s*\d+[\.\)、:：]\s*)/, '')
    })
  }
  // 工作流：支持多行（每行 名称 | owner | 产出 | 状态）或单行 "设定→拆解→..." / "设定、拆解、..."
  function splitWorkflowText(raw) {
    var text = String(raw == null ? '' : raw).trim()
    if (!text) return []
    var lines = text.split(new RegExp(String.fromCharCode(13) + '?[' + String.fromCharCode(10) + ']+')).map(function (l) { return l.trim() }).filter(Boolean)
    if (lines.length >= 2) return lines
    var parts = text.split(/\s*(?:→|->|、|;|；)\s*/).map(function (x) { return x.trim() }).filter(Boolean)
    return parts.length >= 2 ? parts : lines
  }
  function parseWorkflow(raw) {
    var lines = splitWorkflowText(raw)
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
    { id: 'wi-demo-1', title: '0.12.0 发布准备', status: 'active', priority: 'P0', concurrent: 2, stage: '执行', l2: 2, l3: 4, agentRuns: 12, tokenTotal: 48200, linked: ['V60-T6d', 'V60-T7c'], l2list: ['V60-T6d', 'V60-T7c'], l3list: ['V60-T6d#L3a', 'V60-T6d#L3b', 'V60-T7c#L3a', 'V60-T7c#L3b'], l2done: 1, l3done: 1 },
    { id: 'wi-demo-2', title: '官网文案改版', status: 'paused', priority: 'P2', concurrent: 0, stage: null, l2: 0, l3: 0, agentRuns: null, tokenTotal: null, linked: [], l2list: [], l3list: [], l2done: 0, l3done: 0 },
    { id: 'wi-demo-3', title: '视频 v2 收尾', status: 'done', priority: 'P1', concurrent: 0, stage: '交付', l2: 1, l3: 2, agentRuns: 8, tokenTotal: 20500, linked: ['V60-T9b'], l2list: ['V60-T9b'], l3list: ['V60-T9b#L3a', 'V60-T9b#L3b'], l2done: 1, l3done: 2 }
  ]
  var L15_STATUS = { active: '进行中', paused: '暂停', done: '完成', cancelled: '已取消' }
  var L15_STAGES = ['设定', '拆解', '排期', '执行', '审阅', '验收', '交付']
  function miniwf(cur) {
    var idx = L15_STAGES.indexOf(cur)
    return '<span class="bd-wi-miniwf" aria-label="工作流 7 阶段">' + L15_STAGES.map(function (s, i) {
      var c = idx >= 0 && i === idx ? 'cur' : idx >= 0 && i < idx ? 'done' : ''
      return '<i class="bd-wi-wfseg ' + c + '" title="' + s + '"></i>'
    }).join('') + '</span>'
  }
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
    function draw(items) {
      var visible = items.filter(function (it) { return it.status !== 'done' && it.status !== 'cancelled' })
      var hidden = items.length - visible.length
      var rows = visible.map(function (it) {
        var syn = it.synthetic !== false
        var l2 = it.l2list || []
        var l3 = it.l3list || []
        var st = L15_STATUS[it.status] || '未采集'
        var cls = it.status === 'active' ? 'bd-badge-info' : it.status === 'paused' ? 'bd-badge-paused' : 'bd-badge-muted'
        var l2chips = l2.slice(0, 3).map(function (r) { return '<span class="bd-l15-mini">' + esc(r) + '</span>' }).join('') + (l2.length > 3 ? '<span class="bd-l15-more">+' + (l2.length - 3) + '</span>' : '')
        return '<a class="bd-wi-row" data-status="' + esc(it.status) + '" data-concurrent="' + (it.concurrent > 1 ? '1' : '0') + '" href="/workitem?id=' + encodeURIComponent(it.id) + '" role="article">' +
          '<span class="bd-wi-col bd-wi-col-main"><span class="bd-wi-rowhead"><b class="bd-wi-title">' + esc(it.title) + '</b>' +
          '<span class="bd-badge ' + cls + '">' + esc(st) + '</span>' +
          (it.concurrent > 1 ? '<span class="bd-badge bd-badge-concurrent">并发中（' + it.concurrent + '）</span>' : '') +
          (it.priority ? '<span class="bd-badge bd-badge-priority">' + esc(it.priority) + '</span>' : '') +
          (syn ? '<span class="bd-badge bd-badge-warn">示例 · 待 0.13 契约</span>' : '') + '</span>' +
          '<span class="bd-wi-meta">' + (it.origin === 'goal' ? '目标内' : '来源未采集') + ' · owner 未采集</span></span>' +
          '<span class="bd-wi-col"><span class="bd-wi-stage">' + miniwf(it.currentStage || it.stage) + ' 当前阶段 <b>' + esc(it.currentStage || it.stage || '未采集') + '</b></span></span>' +
          '<span class="bd-wi-col bd-wi-col-board">' +
          '<span class="bd-l15-board"><span class="bd-l15-boardk">L2 拆解</span><b>' + l2.length + '</b>' + (l2chips ? '<span class="bd-l15-minis">' + l2chips + '</span>' : '<span class="bd-l15-none">未拆解</span>') + '</span>' +
          '<span class="bd-l15-board"><span class="bd-l15-boardk">L3 拆分</span><b>' + l3.length + '</b>' + (l3.length ? '<span class="bd-l15-minis"><span class="bd-l15-mini">示例</span></span>' : '<span class="bd-l15-none">未采集</span>') + '</span>' +
          '<span class="bd-wi-rowmetrics">' +
          '<span class="bd-wi-f">L2 完成 <b>' + (it.l2done == null ? '未采集' : it.l2done + '/' + l2.length) + '</b><i class="bd-badge bd-badge-muted">' + (syn ? '示例' : '真实') + '</i></span>' +
          '<span class="bd-wi-f">L3 完成 <b>' + (it.l3done == null ? '未采集' : it.l3done + '/' + l3.length) + '</b><i class="bd-badge bd-badge-muted">' + (syn ? '示例' : '真实') + '</i></span>' +
          '<span class="bd-wi-f">agent <b>' + (it.agentRuns == null ? '未采集' : it.agentRuns + ' 次') + '</b><i class="bd-badge bd-badge-muted">' + (it.agentRuns == null ? '未采集' : '示例') + '</i></span>' +
          '<span class="bd-wi-f">token <b>' + (it.tokenTotal == null ? '未采集' : (it.tokenTotal / 1000).toFixed(1) + 'k') + '</b><i class="bd-badge bd-badge-muted">' + (it.tokenTotal == null ? '未采集' : '估计') + '</i></span>' +
          '</span><span class="bd-wi-detail-link">详情 →</span></span></a>'
      }).join('')
      host.innerHTML = '<div class="bd-l15-head"><div class="bd-l15-chips" role="group" aria-label="L1.5 筛选">' +
        '<button type="button" class="bd-chip" data-filter="all" aria-pressed="true">全部当前</button>' +
        '<button type="button" class="bd-chip" data-filter="active" aria-pressed="false">进行中</button>' +
        '<button type="button" class="bd-chip" data-filter="paused" aria-pressed="false">暂停</button>' +
        '<button type="button" class="bd-chip" data-filter="concurrent" aria-pressed="false">并发</button></div>' +
        '<span class="bd-l15-count">当前 ' + visible.length + ' 个' + (hidden ? ' · 已隐藏 ' + hidden + ' 个（完成/已取消）' : '') + '</span></div>' +
        '<div class="bd-l15-rows">' + rows + '</div>' +
        '<p class="bd-l15-note">示例 · 待 0.13 契约；L2 时间来自真实消息；计划时间未采集；各 workItem 的 token 不可横向加总。</p>'
      $$('.bd-chip', host).forEach(function (chip) {
        chip.addEventListener('click', function () {
          $$('.bd-chip', host).forEach(function (x) { x.setAttribute('aria-pressed', String(x === chip)) })
          var f = chip.getAttribute('data-filter')
          $$('.bd-wi-row', host).forEach(function (row) {
            var show = f === 'all' || (f === 'concurrent' ? row.getAttribute('data-concurrent') === '1' : row.getAttribute('data-status') === f)
            row.style.display = show ? '' : 'none'
          })
        })
      })
    }
    fetch('/api/work-items', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null }).then(function (j) {
      var items = (j && j.available && Array.isArray(j.items) && j.items.length) ? j.items : L15_EXAMPLE
      draw(items)
    }).catch(function () { draw(L15_EXAMPLE) })
  }

  var AV_PAL = ['bd-av-c0', 'bd-av-c1', 'bd-av-c2', 'bd-av-c3', 'bd-av-c4', 'bd-av-c5', 'bd-av-c6', 'bd-av-c7', 'bd-av-c8']
  function fnv1a(s) { var h = 0x811c9dc5; s = String(s || ''); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) } return h >>> 0 }
  function initial(s) { s = String(s || '').trim(); if (!s) return '?'; var c = s.charAt(0); return /[a-z]/.test(c) ? c.toUpperCase() : c }
  function renderOrg(data) {
    fetch('/api/team-board', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null }).then(function (j) { drawOrg(data, j) }).catch(function () { drawOrg(data, null) })
  }
  function drawOrg(data, teamBoard) {
    var members = (teamBoard && Array.isArray(teamBoard.members)) ? teamBoard.members : []
    function membersOf(line) { return members.filter(function (m) { return m.line === line || m.owner === line || m.name === line }) }
    var host = $('#bd-org-roles'); if (!host) return
    var lines = (data && data.lines) || []
    var g = (data && data.teamGoal) || {}
    var goalText = $('#bd-org-goal-text'); if (goalText) goalText.textContent = g.objective || '未采集（TEAM.md 目标）'
    var byLine = ((data && data.lineTasks && data.lineTasks.byLine) || [])
    var cnt = { roles: $('#bd-org-kpi-roles'), online: $('#bd-org-kpi-online') }
    var now = Date.now()
    var online = lines.filter(function (l) { return l.lifecycle === 'active' }).length
    if (cnt.roles) cnt.roles.textContent = String(lines.length)
    if (cnt.online) cnt.online.textContent = String(online)
    if (!lines.length) { host.innerHTML = '<p class="bd-empty">角色线未采集（lines.db 无 lines 记录）</p>'; return }
    var managerLabel = (lines.filter(function (l) { return l.role === 'manager' || l.label === 'manager' })[0] || {}).label || '未采集'
    var rows = lines.slice().sort(function (a, b) {
      var am = (a.role === 'manager' || a.label === managerLabel) ? 0 : 1
      var bm = (b.role === 'manager' || b.label === managerLabel) ? 0 : 1
      return am - bm || String(a.label).localeCompare(String(b.label))
    }).map(function (l) {
      var name = l.title || l.role || l.label
      var hit = byLine.filter(function (x) { return x.line === l.label })[0]
      var l2 = hit ? hit.taskCount : null
      var LIFECYCLE_TEXT = { active: '在线', hibernating: '离线（休眠）', retired: '离线（退役）' }
      var state = (LIFECYCLE_TEXT[l.lifecycle] || '未采集') + (l.generation != null ? ' · gen' + l.generation : '')
      var isOn = l.lifecycle === 'active'
      var key = String(l.label)
      return '<div class="bd-org-role-row' + (l.role === 'manager' || l.label === managerLabel ? ' bd-org-role-l1' : '') + '" role="listitem" tabindex="0" data-org-role="' + esc(key) + '" aria-label="' + esc(name) + ' 角色，查看详情">' +
        '<span class="bd-avatar bd-avatar-24 ' + AV_PAL[fnv1a(key) % 9] + '" data-avatar-key="' + esc(key) + '" data-avatar-init="' + esc(initial(name)) + '" aria-hidden="true">' + esc(initial(name)) + '</span>' +
        '<span class="bd-dot ' + (isOn ? 'bd-dot-online' : '') + '" aria-hidden="true"></span>' +
        '<span class="bd-org-role-main"><b>' + esc(name) + '</b><span class="bd-org-role-sub">' + (l.role === 'manager' || l.label === managerLabel ? 'L1 负责人' : 'L2 角色 · ' + esc(l.label)) + '</span></span>' +
        '<span class="bd-org-owner">owner ' + esc(managerLabel) + '</span>' +
        '<span class="bd-org-state">' + esc(state) + '</span>' +
        '<span class="bd-org-load">负载 未采集（无 turns 口径）</span>' +
        '<span class="bd-org-l2">负责 L2 <b class="num">' + (l2 == null ? '未采集' : l2) + '</b></span>' +
        '<button type="button" class="bd-org-agents" data-org-agents="' + esc(key) + '" aria-expanded="false" aria-label="' + esc(name) + ' 的 agent 实例">agent 未采集 ▸</button>' +
        '<span class="bd-org-go" aria-hidden="true">详情 ▸</span></div>'
    }).join('')
    host.innerHTML = rows
    // 展开 agent 实例（官方 members[] 未提供 → 显示不可得说明）
    $$('.bd-org-agents', host).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation()
        var open = btn.getAttribute('aria-expanded') !== 'true'
        btn.setAttribute('aria-expanded', String(open))
        btn.textContent = open ? 'agent 未采集 ▾' : 'agent 未采集 ▸'
        var row = btn.closest('.bd-org-role-row')
        var next = row && row.nextElementSibling
        if (open) {
          var div = document.createElement('div')
          div.className = 'bd-org-agent-row'; div.setAttribute('role', 'listitem')
          var ms = membersOf(btn.getAttribute('data-org-agents'))
          div.innerHTML = ms.length
            ? ms.map(function (m) { return '<span class="bd-org-agent"><span class="bd-avatar bd-avatar-20" aria-hidden="true">' + esc(String(m.name || '?').charAt(0).toUpperCase()) + '</span><b>' + esc(m.name || '未采集') + '</b><span class="bd-org-agent-sub">' + esc(m.role || m.kind || '类型未采集') + ' · ' + esc(m.state || '状态未采集') + '</span></span>' }).join('')
            : '<span class="bd-org-agent-empty"><span class="bd-unavailable" title="agent 实例未采集">不可得 · agent 实例未采集（官方 members[] 未提供 line 归属）</span></span>'
          row.parentNode.insertBefore(div, row.nextSibling)
        } else if (next && next.classList.contains('bd-org-agent-row')) {
          next.remove()
        }
      })
    })
    // 点行开抽屉（角色信息；只读）
    $$('.bd-org-role-row', host).forEach(function (row) {
      row.addEventListener('click', function () {
        var key = row.getAttribute('data-org-role')
        var l = lines.filter(function (x) { return x.label === key })[0] || {}
        var w = ((data.teamWorkspace && data.teamWorkspace.lines) || []).filter(function (x) { return x.label === key })[0] || {}
        var sec = (w && w.sections) || {}
        openDrawer(l.title || l.role || key,
          '<p class="bd-drawer-kv"><b>label</b> ' + esc(key) + '</p>' +
          '<p class="bd-drawer-kv"><b>角色</b> ' + esc(l.role || '未采集') + '</p>' +
          '<p class="bd-drawer-kv"><b>生命周期</b> ' + esc(l.lifecycle || '未采集') + ' · gen' + esc(l.generation == null ? '未采集' : l.generation) + '</p>' +
          '<p class="bd-drawer-kv"><b>最近活跃</b> ' + esc(l.lastSeen ? new Date(l.lastSeen).toLocaleString('zh-CN', { hour12: false }) : '未采集') + '</p>' +
          '<p class="bd-drawer-kv"><b>章程来源</b> ' + esc(w.source || '未采集') + '</p>' +
          '<p class="bd-drawer-kv"><b>定位</b> ' + esc(sec.positioning || '未采集（缺 charter）') + '</p>' +
          '<p class="bd-drawer-note">只读 · 不挂 L3 任务（L3 见任务页/大任务详情）</p>')
      })
    })
  }

  var TASK_STATUS = { done: '完成', active: '进行中', paused: '暂停', cancelled: '已取消' }
  function taskBadge(status) {
    var cls = status === 'done' ? 'bd-badge-ok' : status === 'paused' ? 'bd-badge-paused' : status === 'cancelled' ? 'bd-badge-muted' : 'bd-badge-info'
    return '<span class="bd-badge ' + cls + '">' + esc(TASK_STATUS[status] || '未采集') + '</span>'
  }
  function renderTasks(data) {
    var host = $('#bd-tasks-list'); if (!host) return
    var by = (data && data.lineTasks && data.lineTasks.byTaskRef) || []
    var byMap = {}; by.forEach(function (x) { byMap[x.taskRef] = x })
    var byLine = (data && data.lineTasks && data.lineTasks.byLine) || []
    var openN = 0, blockedN = 0, latest = 0
    by.forEach(function (x) {
      Object.keys(x.byState || {}).forEach(function (k) {
        var n = x.byState[k] || 0
        if (['queued', 'claimed', 'delivered'].indexOf(k) >= 0) openN += n
        if (k === 'failed' || k === 'expired') blockedN += n
      })
      latest = Math.max(latest, x.latestAt || 0)
    })
    if ($('#bd-tasks-kpi-total')) $('#bd-tasks-kpi-total').textContent = String(by.length)
    if ($('#bd-tasks-kpi-doing')) $('#bd-tasks-kpi-doing').textContent = openN + ' 条'
    if ($('#bd-tasks-kpi-blocked')) $('#bd-tasks-kpi-blocked').textContent = blockedN + ' 条'
    if ($('#bd-tasks-kpi-latest')) $('#bd-tasks-kpi-latest').textContent = latest ? new Date(latest).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5) : '未采集'
    if ($('#bd-tasks-summary')) $('#bd-tasks-summary').textContent = '线任务 ' + by.length + ' 个 · 消息 ' + by.reduce(function (a, x) { return a + (x.messageCount || 0) }, 0) + ' 条（消息口径）· 最近 ' + (latest ? new Date(latest).toLocaleString('zh-CN', { hour12: false }) : '未采集')
    function avatar(name) {
      var key = String(name || '?'); var c = key.trim().charAt(0).toUpperCase()
      return '<span class="bd-avatar bd-avatar-20 bd-av-c' + (key.length % 9) + '" aria-hidden="true">' + esc(c) + '</span>'
    }
    function l2card(w, ref) {
      var hit = byMap[ref]
      var lines = hit && hit.byLine ? hit.byLine.map(function (b) { return b.line }).join(' / ') : '未采集'
      var l3 = w.l3list ? w.l3list.length : null
      return '<div class="bd-task-card bd-tasks-group" data-ref="' + esc(ref) + '"><div class="bd-tasks-grow"><div class="bd-tasks-ghead" role="button" tabindex="0">' +
        '<span class="bd-pill bd-badge-l2">L2 线</span>' + avatar(lines.split(' / ')[0]) +
        '<span class="bd-tasks-ref">' + esc(ref) + '</span><span class="bd-tasks-title">' + esc(ref) + ' 线任务</span>' +
        '<span class="bd-badge ' + (hit ? 'bd-badge-info' : 'bd-badge-muted') + '">' + (hit ? '按消息状态' : '未采集') + '</span>' +
        '<span class="bd-tasks-gmeta"><span class="bd-tasks-metric">参与线 ' + esc(lines) + '</span>' +
        '<span class="bd-tasks-metric">消息 ' + (hit ? (hit.messageCount || 0) : '未采集') + ' 条</span>' +
        '<span class="bd-tasks-metric-note bd-tasks-recent-time">最近 ' + (hit ? new Date(hit.latestAt).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5) : '未采集') + '</span></span>' +
        '</div><div class="bd-tasks-gacts">' + (l3 == null ? '<span class="bd-tasks-toggle bd-tasks-toggle-empty">L3 未采集</span>' : '<button type="button" class="bd-btn bd-tasks-toggle" data-l3="' + esc(ref) + '" aria-expanded="false">L3 ' + l3 + ' ▸</button>') + '</div></div>' +
        (l3 ? '<div class="bd-tasks-l3wrap" data-l3wrap="' + esc(ref) + '" hidden>' + (w.l3list || []).map(function (x) { return '<div class="bd-tasks-l3"><span class="mono">' + esc(x) + '</span> <span class="bd-badge bd-badge-warn">示例 · 待 0.13 契约</span></div>' }).join('') + '</div>' : '') +
        '</div>'
    }
    function draw(items) {
      var groups = items.filter(function (w) { return w.status !== 'cancelled' }).map(function (w) {
        var refsAll = w.linked || []
        var cards = refsAll.map(function (r) { return l2card(w, r) }).join('')
        var head = '<div class="bd-tasks-wihead" role="button" tabindex="0" data-wi="' + esc(w.id) + '" data-title="' + esc(w.title) + '">' +
          '<span class="bd-pill bd-badge-l15">L1.5 大任务</span><b class="bd-tasks-wi-title">' + esc(w.title) + '</b>' +
          '<span class="bd-badge ' + (w.status === 'active' ? 'bd-badge-info' : 'bd-badge-muted') + '">' + esc(L15_STATUS[w.status] || '未采集') + '</span>' +
          '<span class="bd-meta">来源未采集 · 目标归属未采集 · 示例关联 ' + refsAll.length + ' 个 L2</span>' +
          '<span class="bd-badge bd-badge-warn">示例 · 待 0.13 契约</span>' +
          '<span class="bd-tasks-wi-go">查看大任务甘特 ▸</span></div>'
        return '<div class="bd-tasks-wisection" data-wi="' + esc(w.id) + '" data-l3="' + (w.l3list && w.l3list.length ? 1 : 0) + '">' + head + (cards || '<p class="bd-tasks-wi-empty">暂无 L2；点开大任务详情查看甘特。</p>') + '</div>'
      }).join('')
      var linked = {}; items.forEach(function (w) { (w.linked || []).forEach(function (r) { linked[r] = true }) })
      var unlinked = by.filter(function (x) { return !linked[x.taskRef] })
      var unlinkedHtml = unlinked.length ? '<div class="bd-tasks-unlinked"><b>未关联 L1.5</b>' + unlinked.map(function (x) {
        return '<div class="bd-task-card bd-tasks-group bd-tasks-line"><div class="bd-tasks-grow"><div class="bd-tasks-ghead" role="button" tabindex="0">' +
          '<span class="bd-pill bd-badge-l2">L2 线</span><span class="bd-tasks-ref">' + esc(x.taskRef) + '</span>' +
          '<span class="bd-badge bd-badge-info">按消息状态</span><span class="bd-tasks-metric">消息 ' + (x.messageCount || 0) + ' 条</span></div></div></div>'
      }).join('') + '</div>' : ''
      host.innerHTML = groups + unlinkedHtml + '<div class="bd-tasks-official" hidden><p class="bd-tasks-empty-l3">官方·L3 任务：未采集（0.13 契约后提供，不伪造）</p></div>'
      // L3 展开
      $$('.bd-tasks-toggle[data-l3]', host).forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation()
          var ref = btn.getAttribute('data-l3'); var wrap = host.querySelector('[data-l3wrap="' + ref + '"]')
          if (!wrap) return
          var open = btn.getAttribute('aria-expanded') !== 'true'
          btn.setAttribute('aria-expanded', String(open)); wrap.hidden = !open
          btn.textContent = 'L3 ' + wrap.children.length + (open ? ' ▾' : ' ▸')
        })
      })
      // 行点击抽屉
      $$('.bd-tasks-ghead', host).forEach(function (row) {
        row.addEventListener('click', function () {
          var ref = row.closest('.bd-tasks-group').getAttribute('data-ref'); var hit = byMap[ref]
          openDrawer(ref || '任务', hit
            ? '<p class="bd-drawer-kv"><b>消息数</b> ' + esc(hit.messageCount || 0) + ' 条</p>' +
              '<p class="bd-drawer-kv"><b>参与线</b> ' + esc((hit.byLine || []).map(function (b) { return b.line }).join(' / ') || '未采集') + '</p>' +
              '<p class="bd-drawer-kv"><b>首末消息</b> ' + esc(new Date(hit.firstAt).toLocaleString('zh-CN', { hour12: false })) + ' → ' + esc(new Date(hit.latestAt).toLocaleString('zh-CN', { hour12: false })) + '</p>'
            : '<p class="bd-drawer-note">该 taskRef 未采集。</p>')
        })
      })
      // 大任务跳转
      $$('.bd-tasks-wihead', host).forEach(function (h) {
        h.addEventListener('click', function () { location.href = '/workitem?id=' + encodeURIComponent(h.getAttribute('data-wi')) })
      })
      // tabs: 线/历史/官方
      $$('.bd-tasks-tab', document).forEach(function (tab) {
        tab.addEventListener('click', function () {
          $$('.bd-tasks-tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === tab)) })
          var pane = tab.getAttribute('data-pane')
          var linePane = host
          linePane.hidden = pane === 'official'
          var off = host.querySelector('.bd-tasks-official'); if (off) off.hidden = pane !== 'official'
          if (pane === 'history') {
            $$('.bd-tasks-wisection', host).forEach(function (s) { s.hidden = true })
          } else if (pane === 'line') {
            $$('.bd-tasks-wisection', host).forEach(function (s) { s.hidden = false })
          }
        })
      })
      // chips: 全部/进行中/阻塞/未关联
      $$('#bd-tasks-status .bd-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          $$('#bd-tasks-status .bd-chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === chip)) })
          var mode = chip.getAttribute('data-status')
          $$('.bd-tasks-wisection', host).forEach(function (s) { s.hidden = mode === 'unlinked' || mode === 'blocked' })
          $$('.bd-tasks-unlinked', host).forEach(function (u) { u.hidden = mode !== 'unlinked' && mode !== 'blocked' })
          if (mode === 'doing') { $$('.bd-tasks-wisection', host).forEach(function (s) { s.hidden = false }) }
        })
      })
      // 下拉：大任务 / 线
      var wiSel = $('#bd-tasks-wi-select'); if (wiSel && wiSel.options.length === 1) items.forEach(function (w) { var o = document.createElement('option'); o.value = w.id; o.textContent = w.title; wiSel.appendChild(o) })
      var lnSel = $('#bd-tasks-line-select'); if (lnSel && lnSel.options.length === 1) byLine.forEach(function (b) { var o = document.createElement('option'); o.value = b.line; o.textContent = b.line; lnSel.appendChild(o) })
      if (wiSel) wiSel.onchange = function () { var v = wiSel.value; $$('.bd-tasks-wisection', host).forEach(function (s) { s.hidden = v ? s.getAttribute('data-wi') !== v : false }) }
      if (lnSel) lnSel.onchange = function () { var v = lnSel.value; $$('.bd-tasks-group', host).forEach(function (g) { g.hidden = v ? g.textContent.indexOf(v) < 0 : false }) }
      var hasl3 = $('#bd-tasks-hasl3'); if (hasl3) hasl3.onchange = function () { $$('.bd-tasks-wisection', host).forEach(function (s) { s.hidden = hasl3.checked ? s.getAttribute('data-l3') !== '1' : false }) }
      var reset = $('#bd-tasks-reset'); if (reset) reset.onclick = function () { $$('.bd-tasks-wisection', host).forEach(function (s) { s.hidden = false }); if (wiSel) wiSel.value = ''; if (lnSel) lnSel.value = ''; if (hasl3) hasl3.checked = false; $$('.bd-tasks-unlinked', host).forEach(function (u) { u.hidden = false }); $$('.bd-tasks-wisection', host).forEach(function (s) { s.hidden = false }) }
    }
    fetch('/api/work-items', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null }).then(function (j) {
      var items = (j && j.available && Array.isArray(j.items) && j.items.length) ? j.items : L15_EXAMPLE
      draw(items)
    }).catch(function () { draw(L15_EXAMPLE) })
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
    renderOrg(data)
    renderTasks(data)
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
    var qv = (new URLSearchParams(location.search).get('view') || '').trim(); if (['overview','org','tasks','data','cost'].indexOf(qv) >= 0) setView(qv); else setView('overview')
    load()
    startAuto()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install()
})()
