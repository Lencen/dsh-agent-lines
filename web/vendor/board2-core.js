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
        var l2 = (it.l2list || []).length
        var l3 = (it.l3list || []).length
        var l2done = it.l2done == null ? null : it.l2done
        var l3done = it.l3done == null ? null : it.l3done
        var st = L15_STATUS[it.status] || '未采集'
        var cls = it.status === 'active' ? 'bd-badge-info' : it.status === 'paused' ? 'bd-badge-paused' : 'bd-badge-muted'
        return '<a class="bd-wi-row" href="/workitem?id=' + encodeURIComponent(it.id) + '" role="article">' +
          '<div class="bd-wi-col bd-wi-col-main"><div class="bd-wi-rowhead"><b class="bd-wi-title">' + esc(it.title) + '</b>' +
          '<span class="bd-badge ' + cls + '">' + esc(st) + '</span>' +
          (it.concurrent > 1 ? '<span class="bd-badge bd-badge-concurrent">并发中（' + it.concurrent + '）</span>' : '') +
          (it.priority ? '<span class="bd-badge bd-badge-priority">' + esc(it.priority) + '</span>' : '') +
          (syn ? '<span class="bd-badge bd-badge-warn">示例 · 待 0.13 契约</span>' : '') + '</div>' +
          '<div class="bd-wi-meta">' + (it.origin === 'goal' ? '目标内' : '来源未采集') + ' · owner 未采集</div>' +
          '<div class="bd-wi-stage">当前阶段：<b>' + esc(it.currentStage || it.stage || '未采集') + '</b>' + miniwf(it.currentStage || it.stage) + '</div></div>' +
          '<div class="bd-wi-col"><div class="bd-wi-rowmetrics">' +
          '<span class="bd-wi-f">L2 <b>' + l2 + ' 条</b>（完成 ' + (l2done == null ? '未采集' : l2done) + '）</span>' +
          '<span class="bd-wi-f">L3 <b>' + l3 + ' 条</b>（完成 ' + (l3done == null ? '未采集' : l3done) + '）</span>' +
          '<span class="bd-wi-f">agent <b>' + (it.agentRuns == null ? '未采集' : it.agentRuns + ' 次') + '</b></span>' +
          '<span class="bd-wi-f">token <b>' + (it.tokenTotal == null ? '未采集' : (it.tokenTotal / 1000).toFixed(1) + 'k') + '</b></span>' +
          '</div><span class="bd-wi-detail-link">详情 →</span></div></a>'
      }).join('')
      host.innerHTML = '<div class="bd-l15-head"><div class="bd-l15-chips" role="group" aria-label="L1.5 筛选">' +
        '<button type="button" class="bd-chip" aria-pressed="true">全部当前</button>' +
        '<button type="button" class="bd-chip" aria-pressed="false">进行中</button>' +
        '<button type="button" class="bd-chip" aria-pressed="false">暂停</button>' +
        '<button type="button" class="bd-chip" aria-pressed="false">并发</button></div>' +
        '<span class="bd-l15-count">当前 ' + visible.length + ' 个' + (hidden ? ' · 已隐藏 ' + hidden + ' 个（完成/已取消）' : '') + '</span></div>' +
        '<div class="bd-l15-rows">' + rows + '</div>' +
        '<p class="bd-l15-note">示例 · 待 0.13 契约；L2 时间来自真实消息；计划时间未采集；各 workItem 的 token 不可横向加总。</p>'
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
          div.innerHTML = '<span class="bd-org-agent-empty"><span class="bd-unavailable" title="agent 实例未采集">不可得 · agent 实例未采集（官方 members[] 未提供 line 归属）</span></span>'
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
    var by = ((data && data.lineTasks && data.lineTasks.byTaskRef) || [])
    var byMap = {}; by.forEach(function (x) { byMap[x.taskRef] = x })
    var refs = by.map(function (x) { return x.taskRef })
    var total = refs.length
    var latest = by.reduce(function (a, x) { return Math.max(a, x.latestAt || 0) }, 0)
    if ($('#bd-tasks-kpi-total')) $('#bd-tasks-kpi-total').textContent = String(total)
    if ($('#bd-tasks-kpi-doing')) $('#bd-tasks-kpi-doing').textContent = String(L15_EXAMPLE.filter(function (w) { return w.status === 'active' }).length) + '（示例）'
    if ($('#bd-tasks-kpi-blocked')) $('#bd-tasks-kpi-blocked').textContent = '未采集'
    if ($('#bd-tasks-kpi-latest')) $('#bd-tasks-kpi-latest').textContent = latest ? new Date(latest).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5) : '未采集'
    if ($('#bd-tasks-summary')) $('#bd-tasks-summary').textContent = '线任务 ' + total + ' 个 · 消息 ' + by.reduce(function (a, x) { return a + (x.messageCount || 0) }, 0) + ' 条（消息口径）· 最近 ' + (latest ? new Date(latest).toLocaleString('zh-CN', { hour12: false }) : '未采集')
    var linkedRefs = {}
    var html = L15_EXAMPLE.filter(function (w) { return w.status !== 'cancelled' }).map(function (w) {
      var mine = (w.linked || []).filter(function (r) { return byMap[r] })
      var refsAll = (w.linked || [])
      refsAll.forEach(function (r) { linkedRefs[r] = true })
      var head = '<div class="bd-tasks-wihead" role="button" tabindex="0" data-act="wi" aria-label="大任务 ' + esc(w.title) + '，打开大任务详情">' +
        '<span class="bd-pill bd-badge-l15">L1.5 大任务</span><b class="bd-tasks-wi-title">' + esc(w.title) + '</b>' +
        '<span class="bd-badge bd-badge-warn">示例</span>' +
        '<span class="bd-meta">来源未采集 · 目标归属未采集 · 示例关联 ' + refsAll.length + ' 个 L2</span>' +
        '<span class="bd-badge bd-badge-warn">示例 · 待 0.13 契约</span>' +
        '<span class="bd-tasks-wi-go">查看大任务甘特 ▸</span></div>'
      if (!refsAll.length) return head + '<p class="bd-tasks-wi-empty">暂无 L2；点开大任务详情查看甘特。</p>'
      var rows = refsAll.map(function (ref) {
        var hit = byMap[ref]
        if (!hit) return '<div class="bd-task-card bd-tasks-group"><div class="bd-tasks-grow"><div class="bd-tasks-ghead" role="button" tabindex="0" data-ref="' + esc(ref) + '">' +
          '<span class="bd-pill bd-badge-l2">L2 线</span><span class="bd-pill bd-badge-l15">' + esc(w.title) + '</span>' +
          '<span class="bd-tasks-ref">' + esc(ref) + '</span><span class="bd-tasks-title">' + esc(ref) + '</span>' +
          '<span class="bd-badge bd-badge-muted">未采集</span>' +
          '<span class="bd-tasks-gmeta"><span class="bd-tasks-metric">消息 未采集</span></span>' +
          '</div><div class="bd-tasks-gacts"><span class="bd-tasks-toggle bd-tasks-toggle-empty" aria-hidden="true">L3 未采集</span></div></div></div>'
        return '<div class="bd-task-card bd-tasks-group"><div class="bd-tasks-grow"><div class="bd-tasks-ghead" role="button" tabindex="0" data-ref="' + esc(ref) + '">' +
          '<span class="bd-pill bd-badge-l2">L2 线</span><span class="bd-pill bd-badge-l15">' + esc(w.title) + '</span>' +
          '<span class="bd-tasks-ref">' + esc(ref) + '</span><span class="bd-tasks-title">' + esc(ref) + ' 线任务</span>' +
          '<span class="bd-badge bd-badge-info">按消息状态</span>' +
          '<span class="bd-tasks-gmeta"><span class="bd-tasks-metric">消息 ' + (hit.messageCount || 0) + ' 条</span>' +
          '<span class="bd-tasks-metric-note bd-tasks-recent-time">最近 ' + new Date(hit.latestAt).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5) + '</span></span>' +
          '</div><div class="bd-tasks-gacts"><a class="bd-btn" href="/workitem?id=' + encodeURIComponent(w.id) + '">详情 ▸</a></div></div></div>'
      }).join('')
      return head + rows
    }).join('')
    var unlinked = refs.filter(function (r) { return !linkedRefs[r] })
    if (unlinked.length) {
      html += '<div class="bd-tasks-wihead" role="button" tabindex="0"><span class="bd-pill bd-badge-l2">未关联 L1.5</span><b class="bd-tasks-wi-title">未关联 L1.5 的 L2</b><span class="bd-meta">' + unlinked.length + ' 个 taskRef</span></div>' +
        '<div class="bd-tasks-unlinked-list">' + unlinked.map(function (r) {
          var hit = byMap[r]
          return '<div class="bd-task-card bd-tasks-group"><div class="bd-tasks-grow"><div class="bd-tasks-ghead" role="button" tabindex="0" data-ref="' + esc(r) + '">' +
            '<span class="bd-pill bd-badge-l2">L2 线</span><span class="bd-tasks-ref">' + esc(r) + '</span>' +
            '<span class="bd-tasks-title">' + esc(r) + ' 线任务</span><span class="bd-tasks-metric">消息 ' + (hit.messageCount || 0) + ' 条</span>' +
            '</div></div></div>'
        }).join('') + '</div>'
    }
    host.innerHTML = '<div class="bd-tasks-tabs" role="tablist" aria-label="任务分组筛选">' +
      '<button type="button" class="bd-tasks-tab" role="tab" data-tab="all" aria-selected="true">全部</button>' +
      '<button type="button" class="bd-tasks-tab" role="tab" data-tab="wi" aria-selected="false">大任务</button>' +
      '<button type="button" class="bd-tasks-tab" role="tab" data-tab="unlinked" aria-selected="false">未关联</button></div>' + html
    $$('.bd-tasks-tab', host).forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('.bd-tasks-tab', host).forEach(function (x) { x.setAttribute('aria-selected', String(x === tab)) })
        var mode = tab.getAttribute('data-tab')
        $$('.bd-tasks-wihead', host).forEach(function (h) { if (mode !== 'all') h.style.display = (mode === 'wi' ? '' : 'none') })
        $$('.bd-tasks-group', host).forEach(function (g) {
          var isUnlinked = !g.querySelector('.bd-pill.bd-badge-l15')
          g.style.display = mode === 'all' ? '' : mode === 'unlinked' ? (isUnlinked ? '' : 'none') : (isUnlinked ? 'none' : '')
        })
        $$('.bd-tasks-unlinked-list', host).forEach(function (u) { u.style.display = mode === 'unlinked' ? '' : 'none' })
      })
    })
    $$('.bd-tasks-ghead', host).forEach(function (row) {
      row.addEventListener('click', function () {
        var ref = row.getAttribute('data-ref'); var hit = byMap[ref]
        openDrawer(ref || '任务', hit
          ? '<p class="bd-drawer-kv"><b>消息数</b> ' + esc(hit.messageCount || 0) + ' 条（消息口径，只读）</p>' +
            '<p class="bd-drawer-kv"><b>首末消息</b> ' + esc(new Date(hit.firstAt).toLocaleString('zh-CN', { hour12: false })) + ' → ' + esc(new Date(hit.latestAt).toLocaleString('zh-CN', { hour12: false })) + '</p>' +
            '<p class="bd-drawer-note">L3 拆分任务见大任务详情页；本抽屉不推断 L3。</p>'
          : '<p class="bd-drawer-note">该 taskRef 未采集（0.13 契约后提供）。</p>')
      })
    })
    $$('.bd-tasks-wihead', host).forEach(function (h) {
      h.addEventListener('click', function () { var w = L15_EXAMPLE.filter(function (x) { return x.title === h.querySelector('.bd-tasks-wi-title').textContent })[0]; if (w) location.href = '/workitem?id=' + encodeURIComponent(w.id) })
    })
    $$('#bd-tasks-status .bd-chip').forEach(function (c) {
      c.addEventListener('click', function () {
        $$('#bd-tasks-status .bd-chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)) })
        var mode = c.getAttribute('data-status')
        $$('.bd-tasks-ghead', host).forEach(function (row) { row.parentNode.parentNode.style.display = mode === 'unlinked' ? (row.getAttribute('data-ref') && !linkedRefs[row.getAttribute('data-ref')] ? '' : 'none') : '' })
      })
    })
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
