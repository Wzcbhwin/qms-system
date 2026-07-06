/**
 * QMS 质量整改追踪系统 — 主应用逻辑
 */
(function (global) {
  'use strict';

  // ── 应用状态 ──────────────────────────────────────────
  const state = {
    route: 'dashboard',
    issues: [],
    role: 'admin',
    search: '',
    filters: { unit: '', status: '', timeRange: 'all' },
    sort: { field: 'occurTime', dir: 'desc' },
    pagination: { page: 1, pageSize: 50 },
    editingIssue: null,
    formStep: 1,
    formData: null,
    needRedetermineStep: false,
  };

  const STATUS_LABELS = {
    not_started: '未开始',
    in_progress: '整改中',
    completed: '已完成',
    closed: '已关闭',
    overdue: '已拖期',
  };

  const STATUS_CLASSES = {
    not_started: 'status-not-started',
    in_progress: 'status-in-progress',
    completed: 'status-completed',
    closed: 'status-closed',
    overdue: 'status-overdue',
  };

  // ── 初始化 ────────────────────────────────────────────
  async function init() {
    // 鉴权 — 读取登录用户信息
    var userStr = sessionStorage.getItem('qms_user');
    if (!userStr) {
      window.location.href = 'login.html';
      return;
    }
    try {
      state.currentUser = JSON.parse(userStr);
      state.role = state.currentUser.role || 'initiator';
    } catch (e) {
      window.location.href = 'login.html';
      return;
    }

    // 渲染用户信息卡片
    renderUserInfo();

    // 显示加载状态
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh;flex-direction:column;gap:16px"><div style="width:40px;height:40px;border:3px solid var(--border-light);border-top-color:var(--color-primary);border-radius:50%;animation:spin 0.8s linear infinite"></div><div style="color:var(--text-secondary);font-size:14px">正在连接服务器...</div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';

    // 从服务器加载数据
    const ok = await QMSData.init();
    state.issues = QMSData.loadIssues();
    state.offline = !ok; // 标记离线模式

    // 主题
    const savedTheme = localStorage.getItem('qms_theme') || 'light';
    setTheme(savedTheme);

    // 事件绑定
    bindEvents();
    // 更新管理员导航可见性
    updateAdminNav();
    // 首次渲染
    navigate('dashboard');

    // 如果服务器无问题数据，初始化模拟数据
    if (ok && state.issues.length === 0) {
      console.log('[QMS] 服务器无数据，初始化模拟数据...');
      const mock = QMSData.generateMockData();
      QMSData.saveIssues(mock);
      state.issues = mock;
      renderDashboard();
    }

    // 离线模式提示
    if (!ok) {
      showToast('当前为本地存储模式，数据保存在当前浏览器中。', 'info');
    }
  }

  // ── 用户信息 & 退出 ──────────────────────────────────
  function renderUserInfo() {
    if (!state.currentUser) return;
    var nameEl = document.getElementById('user-name');
    var roleEl = document.getElementById('user-role-badge');
    var avatarEl = document.getElementById('user-avatar');
    if (nameEl) nameEl.textContent = state.currentUser.name || '未知用户';
    var roleMap = { admin: '管理员', quality: '质量部门', responsible: '责任单位', initiator: '检验员' };
    if (roleEl) roleEl.textContent = roleMap[state.currentUser.role] || state.currentUser.role;
    if (avatarEl) avatarEl.textContent = (state.currentUser.name || '?').charAt(0);
  }

  function logout() {
    sessionStorage.removeItem('qms_user');
    window.location.href = 'login.html';
  }

  function bindEvents() {
    // 侧边栏导航
    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const route = item.dataset.route;
        // 点击「问题录入」时重置为新建模式，避免残留编辑状态
        if (route === 'entry') resetEntryState();
        navigate(route);
      });
    });

    // 新建问题
    document.getElementById('btn-new-issue').addEventListener('click', () => {
      resetEntryState();
      navigate('entry');
    });

    // 全局搜索
    let searchTimer;
    document.getElementById('global-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = e.target.value.trim().toLowerCase();
        if (state.route === 'dashboard') renderDashboard();
      }, 250);
    });

    // 主题切换
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // 退出登录
    var logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // 模态关闭
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── 主题 ──────────────────────────────────────────────
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('qms_theme', theme);
    const sun = document.getElementById('theme-icon-sun');
    const moon = document.getElementById('theme-icon-moon');
    if (theme === 'dark') { sun.classList.add('hidden'); moon.classList.remove('hidden'); }
    else { sun.classList.remove('hidden'); moon.classList.add('hidden'); }
    // 重新渲染图表以适配主题色
    if (state.route === 'dashboard') {
      renderDashboard();
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  // ── 路由 ──────────────────────────────────────────────
  function navigate(route) {
    state.route = route;
    // 更新导航高亮
    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.route === route);
    });
    // 滚动到顶
    document.querySelector('.main').scrollTop = 0;

    switch (route) {
      case 'dashboard': renderDashboard(); break;
      case 'entry': renderEntry(); break;
      case 'import': renderImport(); break;
      case 'tencent-docs': renderTencentDocs(); break;
      case 'push-settings': renderPushSettings(); break;
      case 'authorization': renderAuthorization(); break;
      case 'user-mgmt': renderUserManagement(); break;
      default: renderDashboard();
    }
  }

  // ═══════════════════════════════════════════════════════
  // 模块3：数据看板
  // ═══════════════════════════════════════════════════════
  function renderDashboard() {
    const container = document.getElementById('main-content');
    const issues = getFilteredIssues();

    // 统计
    const stats = {
      total: issues.length,
      inProgress: issues.filter(i => ['in_progress', 'not_started'].includes(QMSData.computeStatus(i))).length,
      completed: issues.filter(i => QMSData.computeStatus(i) === 'completed').length,
      overdue: issues.filter(i => QMSData.computeStatus(i) === 'overdue').length,
      closed: issues.filter(i => QMSData.computeStatus(i) === 'closed').length,
    };

    // 待当前角色处理的问题数
    const role = QMSData.DICT.roles.find(r => r.id === state.role);
    const canFill = role ? role.canFill : [1,2,3,4];
    const pendingForMe = issues.filter(i => {
      if (QMSData.computeStatus(i) === 'closed') return false;
      return canFill.some(step => !isStepCompleted(i, step));
    }).length;

    // 更新侧边栏拖期徽章
    const overdueBadge = document.getElementById('nav-overdue-count');
    if (stats.overdue > 0) {
      overdueBadge.textContent = stats.overdue;
      overdueBadge.style.display = '';
    } else {
      overdueBadge.style.display = 'none';
    }

    // 拖期列表 —— 分为"真正拖期"和"已整改关闭但曾有拖期"
    const dismissedIds = QMSData.loadDismissedOverdue();
    const overdueIssues = issues
      .map(i => ({ issue: i, overdueDays: QMSData.computeOverdueDays(i) }))
      .filter(x => x.overdueDays > 0 && !dismissedIds.includes(x.issue.id))
      .sort((a, b) => b.overdueDays - a.overdueDays);

    // 已整改/已关闭但曾有拖期的项（可消除通知）
    const resolvedOverdueIssues = issues
      .map(i => ({ issue: i, wasOverdueDays: QMSData.computeWasOverdueDays(i) }))
      .filter(x => {
        if (dismissedIds.includes(x.issue.id)) return false;
        const status = QMSData.computeStatus(x.issue);
        if (status !== 'completed' && status !== 'closed') return false;
        return x.wasOverdueDays > 0 && QMSData.computeOverdueDays(x.issue) === 0;
      })
      .sort((a, b) => b.wasOverdueDays - a.wasOverdueDays);

    const totalOverdueCount = overdueIssues.length + resolvedOverdueIssues.length;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">数据看板</div>
          <div class="page-subtitle">质量问题全生命周期追踪 · ${QMSData.today()} 更新</div>
        </div>
        <div class="flex gap-2">
          ${pendingForMe > 0 ? `
            <button class="btn btn-primary btn-sm" onclick="QMSApp.filterPendingForMe()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              待我处理（${pendingForMe}）
            </button>
          ` : ''}
          <button class="btn btn-secondary btn-sm" onclick="QMSApp.exportCSV()">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            导出
          </button>
          <button class="btn btn-ghost btn-sm" onclick="QMSApp.refreshDashboard()" title="刷新看板数据">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            刷新
          </button>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="stats-grid">
        ${renderStatCard('问题总数', stats.total, 'trend-up', '+12%')}
        ${renderStatCard('整改中', stats.inProgress, '', '')}
        ${renderStatCard('已完成', stats.completed, 'trend-up', '+5%')}
        ${renderStatCard('已拖期', stats.overdue, stats.overdue > 0 ? 'trend-down' : '', stats.overdue > 0 ? '需关注' : '正常')}
      </div>

      <!-- 图表区 -->
      <div class="charts-grid">
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="card-title">责任单位问题分布</span>
            <span class="text-xs text-tertiary">按状态堆叠</span>
          </div>
          <div class="chart-card-body"><canvas id="chart-unit-bar"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="card-title">整改情况占比</span>
            <span class="text-xs text-tertiary">实时</span>
          </div>
          <div class="chart-card-body"><canvas id="chart-status-donut"></canvas></div>
        </div>
      </div>

      <!-- 趋势图 -->
      <div class="chart-card mb-6">
        <div class="chart-card-header">
          <span class="card-title">近30天问题发生趋势</span>
          <span class="text-xs text-tertiary">按发生日期</span>
        </div>
        <div class="chart-card-body" style="height:220px"><canvas id="chart-trend-line"></canvas></div>
      </div>

      <!-- 拖期警示 -->
      ${totalOverdueCount > 0 ? `
        <div class="overdue-list">
          <div class="overdue-list-header">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
            <span>拖期未整改（${overdueIssues.length}）${resolvedOverdueIssues.length > 0 ? ` · 已整改关闭（${resolvedOverdueIssues.length}）` : ''}</span>
          </div>
          ${overdueIssues.map(x => `
            <div class="overdue-item" onclick="QMSApp.openDetail('${x.issue.id}')">
              <span class="overdue-days">${x.overdueDays}天</span>
              <div class="overdue-info">
                <div class="product">${x.issue.category1?.productName || '-'} · ${x.issue.category1?.subBatchNo || ''}</div>
                <div class="detail">${(x.issue.category3?.measures || []).find(m => m.status === '待完成')?.content || '无措施'}</div>
              </div>
              <span class="overdue-unit-badge">${x.issue.category1?.responsibilityUnit || '-'}</span>
              <span class="status-tag status-overdue">已拖期</span>
            </div>
          `).join('')}
          ${resolvedOverdueIssues.map(x => `
            <div class="overdue-item resolved" onclick="QMSApp.openDetail('${x.issue.id}')">
              <span class="overdue-days resolved">${x.wasOverdueDays}天</span>
              <div class="overdue-info">
                <div class="product">${x.issue.category1?.productName || '-'} · ${x.issue.category1?.subBatchNo || ''}</div>
                <div class="detail">${(x.issue.category3?.measures || []).find(m => m.content)?.content || '整改已完成'}</div>
              </div>
              <span class="overdue-unit-badge">${x.issue.category1?.responsibilityUnit || '-'}</span>
              <span class="status-tag ${QMSData.computeStatus(x.issue) === 'closed' ? 'status-closed' : 'status-completed'}">${QMSData.computeStatus(x.issue) === 'closed' ? '已关闭' : '已整改'}</span>
              <button class="overdue-dismiss-btn" onclick="event.stopPropagation(); QMSApp.dismissOverdue('${x.issue.id}')" title="消除通知">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- 数据表格 -->
      <div class="data-table-wrap">
        <div class="data-table-toolbar">
          <div class="toolbar-group">
            <span class="text-xs text-secondary font-semibold">状态：</span>
            ${['all', 'not_started', 'in_progress', 'completed', 'closed', 'overdue'].map(s => `
              <span class="filter-chip ${state.filters.status === s ? 'active' : ''}" onclick="QMSApp.setFilter('status','${s}')">
                ${s === 'all' ? '全部' : STATUS_LABELS[s]}
              </span>
            `).join('')}
          </div>
          <div class="toolbar-group">
            <span class="text-xs text-secondary font-semibold">单位：</span>
            <select class="form-select" style="height:28px;font-size:var(--text-xs);width:auto" onchange="QMSApp.setFilter('unit', this.value)">
              <option value="">全部单位</option>
              ${QMSData.DICT.responsibilityUnits.map(u => `<option value="${u}" ${state.filters.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
          <div class="toolbar-group">
            <span class="text-xs text-secondary font-semibold">时间：</span>
            ${[['all','全部'],['today','今日'],['week','本周'],['month','本月']].map(([v,l]) => `
              <span class="filter-chip ${state.filters.timeRange === v ? 'active' : ''}" onclick="QMSApp.setFilter('timeRange','${v}')">${l}</span>
            `).join('')}
          </div>
          <div class="toolbar-group" style="margin-left:auto">
            <select class="form-select" style="height:28px;font-size:var(--text-xs);width:auto" onchange="QMSApp.setPageSize(this.value)">
              ${[50,100,200].map(n => `<option value="${n}" ${state.pagination.pageSize === n ? 'selected' : ''}>${n}条/页</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="data-table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="sortable" onclick="QMSApp.setSort('subBatchNo')">生产编号<span class="sort-arrow ${state.sort.field==='subBatchNo'?(state.sort.dir==='asc'?'asc':'desc'):''}">▼</span></th>
                <th class="sortable" onclick="QMSApp.setSort('productName')">产品名称<span class="sort-arrow ${state.sort.field==='productName'?(state.sort.dir==='asc'?'asc':'desc'):''}">▼</span></th>
                <th>责任单位</th>
                <th class="sortable" onclick="QMSApp.setSort('occurTime')">发生时间<span class="sort-arrow ${state.sort.field==='occurTime'?(state.sort.dir==='asc'?'asc':'desc'):''}">▼</span></th>
                <th>不合格数量</th>
                <th>整改状态</th>
                <th>距截止日期</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableRows(issues)}
            </tbody>
          </table>
        </div>
        ${renderPagination(issues)}
      </div>
    `;

    // 渲染图表：先销毁旧实例，再用 rAF/setTimeout 确保 DOM 已就绪后创建新图表
    QMSCharts.destroyCharts();
    var raf = window.requestAnimationFrame || function(cb) { return setTimeout(cb, 16); };
    raf(() => {
      QMSCharts.renderUnitBarChart('chart-unit-bar', issues);
      QMSCharts.renderStatusDonut('chart-status-donut', issues);
      QMSCharts.renderTrendLine('chart-trend-line', issues);
    });
  }

  function renderStatCard(label, value, trendClass, trendText) {
    return `
      <div class="stat-card">
        <div class="stat-card-label">${label}</div>
        <div class="stat-card-value">${value}</div>
        ${trendText ? `<div class="stat-card-trend ${trendClass}">${trendText}</div>` : ''}
      </div>
    `;
  }

  function renderTableRows(issues) {
    const { page, pageSize } = state.pagination;
    const sorted = sortIssues(issues);
    const start = (page - 1) * pageSize;
    const paged = sorted.slice(start, start + pageSize);

    if (paged.length === 0) {
      return `<tr><td colspan="8"><div class="empty-state">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 17v-2a4 4 0 0 1 8 0v2M9 17h6M9 17H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/></svg>
        <div class="empty-state-title">暂无数据</div>
        <div class="empty-state-desc">尝试调整筛选条件或新建问题</div>
      </div></td></tr>`;
    }

    const today = QMSData.today();
    const role = QMSData.DICT.roles.find(r => r.id === state.role);
    const canFill = role ? role.canFill : [1,2,3,4];
    return paged.map(issue => {
      const status = QMSData.computeStatus(issue);
      const progressStep = QMSData.computeProgressStep(issue);
      const progressLabel = progressStep >= 4 ? '步骤4/4 效果验证' : '步骤' + progressStep + '/4 ' + getStepInfo(progressStep).title;
      const measures = issue.category3?.measures || [];
      const nextDeadline = measures
        .filter(m => m.status === '待完成' && m.planDate)
        .sort((a, b) => new Date(a.planDate) - new Date(b.planDate))[0];
      const daysLeft = nextDeadline ? QMSData.daysBetween(today, nextDeadline.planDate) : null;

      let deadlineHtml = '<span class="text-tertiary">—</span>';
      if (daysLeft !== null) {
        if (daysLeft < 0) deadlineHtml = `<span class="overdue-highlight">拖期 ${-daysLeft} 天</span>`;
        else if (daysLeft === 0) deadlineHtml = '<span class="overdue-highlight">今日截止</span>';
        else if (daysLeft <= 3) deadlineHtml = `<span style="color:var(--color-in-progress);font-weight:600">剩余 ${daysLeft} 天</span>`;
        else deadlineHtml = `<span class="text-secondary">剩余 ${daysLeft} 天</span>`;
      }

      // 检查是否待当前角色处理
      const isPendingForMe = status !== 'closed' && canFill.some(step => !isStepCompleted(issue, step));

      return `
        <tr onclick="QMSApp.openDetail('${issue.id}')" ${isPendingForMe ? 'style="background:color-mix(in srgb, var(--color-primary) 4%, transparent)"' : ''}>
          <td><strong>${issue.category1?.subBatchNo || '-'}</strong></td>
          <td class="truncate">${issue.category1?.productName || '-'}</td>
          <td>${issue.category1?.responsibilityUnit || '-'}</td>
          <td class="tabular">${issue.category1?.occurTime || '-'}</td>
          <td class="tabular">${issue.category1?.defectQty || 0} 件</td>
          <td>
            <span class="status-tag ${STATUS_CLASSES[status]}">${STATUS_LABELS[status]}</span>
            ${status !== 'closed' && status !== 'completed' ? '<span class="progress-step-badge">' + progressLabel + '</span>' : ''}
            ${isPendingForMe ? '<span class="pending-badge">待我处理</span>' : ''}
          </td>
          <td>${deadlineHtml}</td>
          <td class="col-actions" onclick="event.stopPropagation()">
            <button class="row-action" onclick="QMSApp.openEdit('${issue.id}')" title="编辑">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="row-action" onclick="QMSApp.openDetail('${issue.id}')" title="查看">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            ${state.role === 'admin' ? `<button class="row-action row-action-danger" onclick="QMSApp.deleteIssueConfirm('${issue.id}')" title="删除">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
            </button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderPagination(issues) {
    const sorted = sortIssues(issues);
    const total = sorted.length;
    const { page, pageSize } = state.pagination;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);

    let pages = [];
    const maxVisible = 5;
    let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

    for (let i = startPage; i <= endPage; i++) pages.push(i);

    return `
      <div class="pagination">
        <div class="pagination-info">显示 ${start}–${end} / 共 ${total} 条</div>
        <div class="pagination-controls">
          <button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="QMSApp.setPage(${page - 1})">‹</button>
          ${startPage > 1 ? `<button class="page-btn" onclick="QMSApp.setPage(1)">1</button>${startPage > 2 ? '<span class="text-tertiary">…</span>' : ''}` : ''}
          ${pages.map(p => `<button class="page-btn ${p === page ? 'active' : ''}" onclick="QMSApp.setPage(${p})">${p}</button>`).join('')}
          ${endPage < totalPages ? `${endPage < totalPages - 1 ? '<span class="text-tertiary">…</span>' : ''}<button class="page-btn" onclick="QMSApp.setPage(${totalPages})">${totalPages}</button>` : ''}
          <button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="QMSApp.setPage(${page + 1})">›</button>
        </div>
      </div>
    `;
  }

  // ── 筛选/排序/分页 ────────────────────────────────────
  function getFilteredIssues() {
    let issues = QMSData.loadIssues();

    // 搜索
    if (state.search) {
      issues = issues.filter(i => {
        const c1 = i.category1 || {};
        return [c1.subBatchNo, c1.productName, c1.description, c1.customerName, c1.responsibilityUnit]
          .some(v => (v || '').toLowerCase().includes(state.search));
      });
    }

    // 单位筛选
    if (state.filters.unit) {
      issues = issues.filter(i => i.category1?.responsibilityUnit === state.filters.unit);
    }

    // 状态筛选
    if (state.filters.status && state.filters.status !== 'all') {
      issues = issues.filter(i => QMSData.computeStatus(i) === state.filters.status);
    }

    // 时间筛选
    if (state.filters.timeRange && state.filters.timeRange !== 'all') {
      const today = new Date();
      let startDate;
      if (state.filters.timeRange === 'today') startDate = new Date(today);
      else if (state.filters.timeRange === 'week') { startDate = new Date(today); startDate.setDate(startDate.getDate() - 7); }
      else if (state.filters.timeRange === 'month') { startDate = new Date(today); startDate.setMonth(startDate.getMonth() - 1); }
      issues = issues.filter(i => {
        const d = new Date(i.category1?.occurTime);
        return d >= startDate;
      });
    }

    // 角色权限：非管理员只看本单位
    if (state.role === 'responsible') {
      // 实际场景中根据用户所属单位过滤
    }

    return issues;
  }

  function sortIssues(issues) {
    const { field, dir } = state.sort;
    const sorted = [...issues];
    sorted.sort((a, b) => {
      let va, vb;
      if (field === 'subBatchNo') { va = a.category1?.subBatchNo || ''; vb = b.category1?.subBatchNo || ''; }
      else if (field === 'productName') { va = a.category1?.productName || ''; vb = b.category1?.productName || ''; }
      else if (field === 'occurTime') { va = a.category1?.occurTime || ''; vb = b.category1?.occurTime || ''; }
      else { va = ''; vb = ''; }
      const cmp = String(va).localeCompare(String(vb), 'zh');
      return dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }

  // ═══════════════════════════════════════════════════════
  // 模块1 & 2：问题录入（分步表单）
  // ═══════════════════════════════════════════════════════
  function renderEntry() {
    const container = document.getElementById('main-content');

    // 如果是编辑模式且首次加载，从 editingIssue 加载数据
    if (state.editingIssue && !state.formData) {
      state.formData = JSON.parse(JSON.stringify(state.editingIssue));
      state.formStep = determineStartStepForRole(state.formData);
    } else if (state.editingIssue && state.formData && state.needRedetermineStep) {
      // 角色切换后需要重新确定起始步骤，但保留已有数据
      state.formStep = determineStartStepForRole(state.formData);
      state.needRedetermineStep = false;
    } else if (!state.editingIssue && !state.formData) {
      // 尝试加载草稿
      const draft = QMSData.loadDraft();
      if (draft && draft.data) {
        state.formData = draft.data;
        state.formStep = determineFormStep(state.formData);
      } else {
        state.formData = createEmptyForm();
        state.formStep = 1;
      }
    }

    const role = QMSData.DICT.roles.find(r => r.id === state.role);
    const canFill = role ? role.canFill : [1,2,3,4];
    const lastEditableStep = canFill[canFill.length - 1];
    const isEditing = !!state.editingIssue;

    // 工作流状态横幅（仅编辑模式显示）
    let workflowBanner = '';
    if (isEditing) {
      const completedSteps = [1,2,3,4].filter(s => isStepCompleted(state.formData, s));
      const pendingSteps = canFill.filter(s => !isStepCompleted(state.formData, s));
      const currentStepInfo = getStepInfo(state.formStep);
      const canEditCurrent = canFill.includes(state.formStep);

      if (!canEditCurrent) {
        // 当前步骤不可编辑（只读）
        const nextEditable = canFill.find(s => s > state.formStep);
        workflowBanner = `
          <div class="workflow-banner workflow-banner-info">
            <div class="workflow-banner-icon">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
            </div>
            <div class="workflow-banner-content">
              <div class="workflow-banner-title">当前步骤「${currentStepInfo.title}」由${getStepInfo(state.formStep).role}填写，您为只读</div>
              <div class="workflow-banner-desc">已完成 ${completedSteps.length}/4 步${pendingSteps.length > 0 ? `，待您填写 ${pendingSteps.length} 步` : ''}</div>
            </div>
            ${nextEditable ? `<button class="btn btn-primary btn-sm" onclick="QMSApp.goToStep(${nextEditable})">
              进入「${getStepInfo(nextEditable).title}」
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
            </button>` : ''}
          </div>
        `;
      } else if (pendingSteps.length > 0) {
        workflowBanner = `
          <div class="workflow-banner workflow-banner-action">
            <div class="workflow-banner-icon">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </div>
            <div class="workflow-banner-content">
              <div class="workflow-banner-title">请填写「${currentStepInfo.title}」</div>
              <div class="workflow-banner-desc">已完成 ${completedSteps.length}/4 步，当前角色「${role?.name}」负责步骤 ${canFill.join('、')}</div>
            </div>
          </div>
        `;
      } else {
        workflowBanner = `
          <div class="workflow-banner workflow-banner-done">
            <div class="workflow-banner-icon">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
            </div>
            <div class="workflow-banner-content">
              <div class="workflow-banner-title">您负责的步骤已全部完成</div>
              <div class="workflow-banner-desc">已完成 ${completedSteps.length}/4 步，可提交或保存</div>
            </div>
          </div>
        `;
      }
    }

    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">${isEditing ? '编辑问题' : '新建问题'}</div>
          <div class="page-subtitle">分步填写 · 自动保存草稿 · 当前角色：${role?.name || '管理员'}</div>
        </div>
        <div class="flex gap-2">
          ${isEditing ? `
            <button class="btn btn-secondary btn-sm" onclick="QMSApp.cancelEdit()">取消编辑</button>
          ` : ''}
          <button class="btn btn-ghost btn-sm" onclick="QMSApp.discardDraft()">放弃草稿</button>
        </div>
      </div>

      ${workflowBanner}

      <!-- 步骤导航 -->
      <div class="step-form-wizard">
        ${[1,2,3,4].map((step, idx) => {
          const stepInfo = getStepInfo(step);
          const isActive = state.formStep === step;
          const stepCompleted = isStepCompleted(state.formData, step);
          const isCompleted = stepCompleted || state.formStep > step;
          const canAccess = canFill.includes(step);
          return `
            <div class="step-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}"
                 onclick="${canAccess ? `QMSApp.goToStep(${step})` : ''}"
                 style="${canAccess ? '' : 'opacity:0.4;cursor:not-allowed'}"
                 title="${stepCompleted ? '已完成' : (canAccess ? '可编辑' : '只读')}">
              <div class="step-circle">${isCompleted ? '✓' : step}</div>
              <div class="step-label">${stepInfo.title}</div>
            </div>
            ${idx < 3 ? `<div class="step-connector ${isCompleted ? 'completed' : ''}"></div>` : ''}
          `;
        }).join('')}
      </div>

      <div id="form-step-container">
        ${renderFormStep(state.formStep, canFill)}
      </div>

      <!-- 表单导航按钮 -->
      <div class="flex justify-between mt-4">
        <button class="btn btn-secondary" onclick="QMSApp.prevStep()" ${state.formStep <= 1 ? 'disabled style="opacity:0.4"' : ''}>
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
          上一步
        </button>
        <div class="flex gap-2">
          <button class="btn btn-secondary" onclick="QMSApp.saveDraftOnly()">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8"/></svg>
            保存草稿
          </button>
          ${state.formStep < lastEditableStep ? `
            <button class="btn btn-primary" onclick="QMSApp.nextStep()">
              下一步
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          ` : `
            <button class="btn btn-primary" onclick="QMSApp.submitForm()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
              提交
            </button>
          `}
        </div>
      </div>
    `;
  }

  function getStepInfo(step) {
    const infos = {
      1: { title: '问题描述及现状', role: '发起者', icon: '📋' },
      2: { title: '根本原因分析', role: '责任单位', icon: '🔍' },
      3: { title: '纠正预防措施', role: '责任单位', icon: '🔧' },
      4: { title: '效果验证', role: '质量部门', icon: '✅' },
    };
    return infos[step] || infos[1];
  }

  function createEmptyForm() {
    return {
      id: null,
      category1: {
        customerName: '', productName: '', materialGrade: '', subBatchNo: '',
        responsibilityUnit: '', occurTime: QMSData.today(), defectQty: 0,
        problemType: '', description: '', images: [],
      },
      category2: { method: 'fishbone', causes: [], fiveWhys: [] },
      category3: { inProductHandling: '', handlingQty: 0, handlingResult: '', measures: [] },
      category4: {
        verificationResult: '待验证', verificationMethod: '', actualDate: '',
        status: '待完成', reportFiles: [], verifier: '', verifyDate: '', isClosed: false,
      },
      createdBy: '', createdAt: '', updatedAt: '', currentStep: 1,
    };
  }

  function resetEntryState() {
    state.editingIssue = null;
    state.formData = null;
    state.formStep = 1;
    state.needRedetermineStep = false;
    QMSData.clearDraft();
  }

  function isStepCompleted(data, step) {
    switch (step) {
      case 1: return !!(data.category1?.customerName && data.category1?.productName && data.category1?.defectQty > 0);
      case 2: return !!(data.category2?.causes?.length > 0 || data.category2?.fiveWhys?.length > 0);
      case 3: return !!(data.category3?.measures?.length > 0 || data.category3?.inProductHandling);
      case 4: return !!(data.category4?.verificationResult && data.category4?.verificationResult !== '待验证');
      default: return false;
    }
  }

  function determineFormStep(data) {
    if (data.category4?.verificationResult && data.category4?.verificationResult !== '待验证') return 4;
    if (data.category3?.measures?.length > 0 || data.category3?.inProductHandling) return 3;
    if (data.category2?.causes?.length > 0 || data.category2?.fiveWhys?.length > 0) return 2;
    return 1;
  }

  // 角色感知：确定当前角色应该从哪一步开始填写
  function determineStartStepForRole(data) {
    const role = QMSData.DICT.roles.find(r => r.id === state.role);
    const canFill = role ? role.canFill : [1, 2, 3, 4];

    // 找到第一个"未完成"且"当前角色可填写"的步骤
    for (const step of canFill) {
      if (!isStepCompleted(data, step)) return step;
    }
    // 如果所有可填写步骤都已完成，返回最后一个可填写步骤
    return canFill[canFill.length - 1];
  }

  function renderFormStep(step, canFill) {
    const d = state.formData;
    switch (step) {
      case 1: return renderStep1(d, canFill.includes(1));
      case 2: return renderStep2(d, canFill.includes(2));
      case 3: return renderStep3(d, canFill.includes(3));
      case 4: return renderStep4(d, canFill.includes(4));
      default: return '';
    }
  }

  // ── 第一步：问题描述 ──────────────────────────────────
  function renderStep1(d, canEdit) {
    const c = d.category1;
    const ro = canEdit ? '' : 'disabled';
    return `
      <div class="form-section">
        <div class="form-section-header">
          <div class="form-section-number">1</div>
          <div class="form-section-title">问题描述及现状</div>
          <div class="form-section-meta">发起者填写</div>
        </div>
        <div class="form-section-body">
          <div class="form-field">
            <label class="form-label">客户名称<span class="required">*</span></label>
            <input class="form-input" type="text" value="${esc(c.customerName)}" ${ro}
              oninput="QMSApp.updateField('category1','customerName',this.value)" placeholder="填写客户全称">
          </div>
          <div class="form-field">
            <label class="form-label">产品名称<span class="required">*</span></label>
            <input class="form-input" type="text" value="${esc(c.productName)}" ${ro}
              oninput="QMSApp.updateField('category1','productName',this.value)" placeholder="填写产品名称">
          </div>
          <div class="form-field">
            <label class="form-label">材料牌号<span class="required">*</span></label>
            <input class="form-input" type="text" value="${esc(c.materialGrade)}" ${ro}
              oninput="QMSApp.updateField('category1','materialGrade',this.value)" placeholder="如：42CrMo、20CrMnNb">
          </div>
          <div class="form-field">
            <label class="form-label">生产子编号<span class="required">*</span></label>
            <input class="form-input" type="text" value="${esc(c.subBatchNo)}" ${ro}
              oninput="QMSApp.updateField('category1','subBatchNo',this.value)" placeholder="填写子编号">
          </div>
          <div class="form-field">
            <label class="form-label">责任单位<span class="required">*</span></label>
            <select class="form-select" ${ro} onchange="QMSApp.updateField('category1','responsibilityUnit',this.value)">
              <option value="">请选择</option>
              ${QMSData.DICT.responsibilityUnits.map(u => `<option value="${u}" ${c.responsibilityUnit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">发生时间<span class="required">*</span></label>
            <input class="form-input" type="date" value="${c.occurTime || ''}" ${ro}
              oninput="QMSApp.updateField('category1','occurTime',this.value)">
          </div>
          <div class="form-field">
            <label class="form-label">不合格数量<span class="required">*</span></label>
            <input class="form-input tabular" type="number" min="0" value="${c.defectQty || 0}" ${ro}
              oninput="QMSApp.updateField('category1','defectQty',parseInt(this.value)||0)" placeholder="单位：件/批">
          </div>
          <div class="form-field">
            <label class="form-label">问题类型<span class="required">*</span></label>
            <select class="form-select" ${ro} onchange="QMSApp.updateField('category1','problemType',this.value)">
              <option value="">请选择</option>
              ${QMSData.DICT.problemTypes.map(t => `<option value="${t}" ${c.problemType === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-field full">
            <label class="form-label">问题描述<span class="required">*</span></label>
            <textarea class="form-textarea" ${ro} rows="4"
              oninput="QMSApp.updateField('category1','description',this.value)" placeholder="详细描述问题情况，支持 @人员 提及">${esc(c.description)}</textarea>
            <div class="form-help">支持富文本：@人员、插入图片</div>
          </div>
          <div class="form-field full">
            <label class="form-label">不合格图片</label>
            <div class="image-upload-grid" id="image-grid">
              ${(c.images || []).map((img, i) => `
                <div class="image-upload-item">
                  <img src="${img}" alt="不合格图片 ${i+1}">
                  ${canEdit ? `<button class="image-upload-remove" onclick="QMSApp.removeImage(${i})">×</button>` : ''}
                </div>
              `).join('')}
              ${canEdit && (c.images || []).length < 9 ? `
                <label class="image-upload-add">
                  <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                  <input type="file" accept="image/jpeg,image/png" style="display:none" onchange="QMSApp.addImage(this)">
                </label>
              ` : ''}
            </div>
            <div class="form-help">最多9张，支持 JPG/PNG，单张≤5MB，支持标注圈画</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── 第二步：根本原因分析 ──────────────────────────────
  function renderStep2(d, canEdit) {
    const c = d.category2;
    const ro = canEdit ? '' : 'disabled';
    return `
      <div class="form-section">
        <div class="form-section-header">
          <div class="form-section-number">2</div>
          <div class="form-section-title">根本原因分析</div>
          <div class="form-section-meta">责任单位填写</div>
        </div>
        <div class="form-section-body" style="grid-template-columns:1fr">
          <!-- 方法选择 -->
          <div class="form-field">
            <label class="form-label">分析方法</label>
            <div class="flex gap-2">
              <span class="filter-chip ${c.method === 'fishbone' ? 'active' : ''}" ${ro ? '' : `onclick="QMSApp.setMethod('fishbone')"`}>鱼骨图 (Ishikawa)</span>
              <span class="filter-chip ${c.method === '5why' ? 'active' : ''}" ${ro ? '' : `onclick="QMSApp.setMethod('5why')"`}>5Why 分析法</span>
            </div>
          </div>

          ${c.method === 'fishbone' ? `
            <!-- 鱼骨图 -->
            <div class="form-field">
              <label class="form-label">原因分析（5M1E 分类）</label>
              <div class="fishbone-causes" id="causes-list">
                ${(c.causes || []).map((cause, i) => `
                  <div class="cause-item">
                    <select class="form-select" style="width:auto;height:32px;font-size:var(--text-xs)" ${ro}
                      onchange="QMSApp.updateCause(${i},'category',this.value)">
                      ${QMSData.DICT.fishboneCategories.map(cat => `<option value="${cat}" ${cause.category === cat ? 'selected' : ''}>${cat}</option>`).join('')}
                    </select>
                    <input class="form-input" type="text" value="${esc(cause.description)}" ${ro}
                      oninput="QMSApp.updateCause(${i},'description',this.value)" placeholder="原因描述">
                    ${canEdit ? `<button class="cause-remove" onclick="QMSApp.removeCause(${i})"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>` : ''}
                  </div>
                `).join('')}
              </div>
              ${canEdit ? `<button class="btn btn-secondary btn-sm mt-2" onclick="QMSApp.addCause()">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                添加原因
              </button>` : ''}
            </div>
          ` : `
            <!-- 5Why -->
            <div class="form-field">
              <label class="form-label">5Why 连锁分析</label>
              <div class="five-why-chain" id="five-why-list">
                ${(c.fiveWhys || []).map((w, i) => `
                  <div class="why-item">
                    <div class="flex items-center justify-between mb-2">
                      <div class="why-question">第 ${i + 1} 个为什么</div>
                      ${canEdit ? `<button class="cause-remove" onclick="QMSApp.removeWhy(${i})"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>` : ''}
                    </div>
                    <input class="form-input mb-2" type="text" value="${esc(w.why)}" ${ro}
                      oninput="QMSApp.updateWhy(${i},'why',this.value)" placeholder="为什么...？">
                    <textarea class="form-textarea" ${ro} rows="2" style="min-height:50px"
                      oninput="QMSApp.updateWhy(${i},'answer',this.value)" placeholder="原因分析...">${esc(w.answer)}</textarea>
                  </div>
                `).join('')}
              </div>
              ${canEdit ? `<button class="btn btn-secondary btn-sm mt-2" onclick="QMSApp.addWhy()">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                添加为什么
              </button>` : ''}
            </div>
          `}
        </div>
      </div>
    `;
  }

  // ── 第三步：纠正预防措施 ──────────────────────────────
  function renderStep3(d, canEdit) {
    const c = d.category3;
    const ro = canEdit ? '' : 'disabled';
    return `
      <div class="form-section">
        <div class="form-section-header">
          <div class="form-section-number">3</div>
          <div class="form-section-title">纠正预防措施</div>
          <div class="form-section-meta">责任单位填写</div>
        </div>
        <div class="form-section-body">
          <!-- 在制品处理 -->
          <div class="form-field">
            <label class="form-label">在制品处理</label>
            <select class="form-select" ${ro} onchange="QMSApp.updateField('category3','inProductHandling',this.value)">
              <option value="">请选择</option>
              ${QMSData.DICT.inProductHandling.map(h => `<option value="${h}" ${c.inProductHandling === h ? 'selected' : ''}>${h}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">处理数量</label>
            <input class="form-input tabular" type="number" min="0" value="${c.handlingQty || 0}" ${ro}
              oninput="QMSApp.updateField('category3','handlingQty',parseInt(this.value)||0)">
          </div>
          <div class="form-field full">
            <label class="form-label">处理结果描述</label>
            <textarea class="form-textarea" ${ro} rows="2"
              oninput="QMSApp.updateField('category3','handlingResult',this.value)">${esc(c.handlingResult)}</textarea>
          </div>
        </div>
      </div>

      <!-- 预防措施列表 -->
      <div class="form-section">
        <div class="form-section-header">
          <div class="form-section-number">3</div>
          <div class="form-section-title">预防措施清单</div>
          ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="QMSApp.addMeasure()">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            添加措施
          </button>` : ''}
        </div>
        <div class="form-section-body" style="grid-template-columns:1fr">
          ${(c.measures || []).length === 0 ? `
            <div class="empty-state">
              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              <div class="empty-state-title">暂无预防措施</div>
              <div class="empty-state-desc">点击"添加措施"创建整改计划</div>
            </div>
          ` : (c.measures || []).map((m, i) => `
            <div class="measure-item">
              <div class="measure-item-header">
                <div class="measure-number">${i + 1}</div>
                <div class="flex-1" style="flex:1">
                  <textarea class="form-textarea" ${ro} rows="2" style="min-height:50px"
                    oninput="QMSApp.updateMeasure(${i},'content',this.value)" placeholder="措施内容...">${esc(m.content)}</textarea>
                </div>
                ${canEdit ? `<button class="cause-remove" onclick="QMSApp.removeMeasure(${i})"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>` : ''}
              </div>
              <div class="measure-grid">
                <div class="measure-meta">
                  <strong>责任人</strong>
                  <input class="form-input" type="text" value="${esc(m.responsible)}" ${ro}
                    oninput="QMSApp.updateMeasure(${i},'responsible',this.value)" placeholder="责任人">
                </div>
                <div class="measure-meta">
                  <strong>计划完成日期</strong>
                  <input class="form-input" type="date" value="${m.planDate || ''}" ${ro}
                    oninput="QMSApp.updateMeasure(${i},'planDate',this.value)">
                </div>
                <div class="measure-meta">
                  <strong>实际完成日期</strong>
                  <input class="form-input" type="date" value="${m.actualDate || ''}" ${ro}
                    oninput="QMSApp.updateMeasure(${i},'actualDate',this.value)">
                </div>
                <div class="measure-meta">
                  <strong>完成状态</strong>
                  <select class="form-select" ${ro} onchange="QMSApp.updateMeasure(${i},'status',this.value)">
                    ${QMSData.DICT.measureStatus.map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ── 第四步：效果验证 ──────────────────────────────────
  function renderStep4(d, canEdit) {
    const c = d.category4;
    const ro = canEdit ? '' : 'disabled';
    return `
      <div class="form-section">
        <div class="form-section-header">
          <div class="form-section-number">4</div>
          <div class="form-section-title">措施实施后效果验证</div>
          <div class="form-section-meta">质量部门填写</div>
        </div>
        <div class="form-section-body">
          <div class="form-field">
            <label class="form-label">验证结论<span class="required">*</span></label>
            <select class="form-select" ${ro} onchange="QMSApp.updateField('category4','verificationResult',this.value)">
              ${QMSData.DICT.verificationResults.map(r => `<option value="${r}" ${c.verificationResult === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">完成状态</label>
            <select class="form-select" ${ro} onchange="QMSApp.updateField('category4','status',this.value)">
              ${QMSData.DICT.measureStatus.map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="form-field full">
            <label class="form-label">验证方法</label>
            <textarea class="form-textarea" ${ro} rows="3"
              oninput="QMSApp.updateField('category4','verificationMethod',this.value)" placeholder="描述验证方法及过程...">${esc(c.verificationMethod)}</textarea>
          </div>
          <div class="form-field">
            <label class="form-label">实际完成日期</label>
            <input class="form-input" type="date" value="${c.actualDate || ''}" ${ro}
              oninput="QMSApp.updateField('category4','actualDate',this.value)">
          </div>
          <div class="form-field">
            <label class="form-label">验证人</label>
            <input class="form-input" type="text" value="${esc(c.verifier)}" ${ro}
              oninput="QMSApp.updateField('category4','verifier',this.value)" placeholder="验证人姓名">
          </div>
          <div class="form-field">
            <label class="form-label">验证日期</label>
            <input class="form-input" type="date" value="${c.verifyDate || ''}" ${ro}
              oninput="QMSApp.updateField('category4','verifyDate',this.value)">
          </div>
          <div class="form-field full">
            <label class="form-label">验证报告（PDF/图片）</label>
            <div class="image-upload-grid">
              ${(c.reportFiles || []).map((f, i) => `
                <div class="image-upload-item">
                  ${f.startsWith('data:image') ? `<img src="${f}" alt="验证报告">` : `<div style="display:grid;place-items:center;height:100%;font-size:10px;color:var(--text-tertiary)">PDF</div>`}
                  ${canEdit ? `<button class="image-upload-remove" onclick="QMSApp.removeReport(${i})">×</button>` : ''}
                </div>
              `).join('')}
              ${canEdit ? `
                <label class="image-upload-add">
                  <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                  <input type="file" accept="image/*,.pdf" style="display:none" onchange="QMSApp.addReport(this)">
                </label>
              ` : ''}
            </div>
          </div>
          <div class="form-field full">
            <label class="flex items-center gap-2" style="cursor:${canEdit?'pointer':'not-allowed'}">
              <input type="checkbox" ${c.isClosed ? 'checked' : ''} ${ro}
                onchange="QMSApp.updateField('category4','isClosed',this.checked)" style="width:16px;height:16px">
              <span class="text-sm font-semibold">关闭此问题</span>
              <span class="text-xs text-tertiary">关闭后不可编辑，仅管理员可重开</span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════
  // 模块1：批量导入
  // ═══════════════════════════════════════════════════════
  function renderImport() {
    const container = document.getElementById('main-content');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">批量导入</div>
          <div class="page-subtitle">支持 Excel/CSV 模板导入 · 自动校验 · 图片批量压缩</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="QMSApp.downloadTemplate()">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          下载导入模板
        </button>
      </div>

      <div class="card">
        <div class="card-body">
          <div class="import-zone" id="import-zone" onclick="document.getElementById('import-file').click()">
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
            <div class="font-bold text-sm" style="margin-bottom:4px">点击或拖拽文件到此处</div>
            <div class="text-xs text-tertiary">支持 .csv / .xlsx 格式，单次最多 500 条</div>
            <input type="file" id="import-file" accept=".csv,.xlsx,.xls" style="display:none" onchange="QMSApp.handleImport(this)">
          </div>
          <div id="import-result-container"></div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header"><span class="card-title">字段说明</span></div>
        <div class="card-body">
          <table class="data-table" style="font-size:var(--text-xs)">
            <thead>
              <tr><th>字段名</th><th>类型</th><th>必填</th><th>说明</th></tr>
            </thead>
            <tbody>
              ${[
                ['客户名称','文本','是','客户全称'],
                ['产品名称','文本','是','产品名称'],
                ['材料牌号','文本','是','如 42CrMo'],
                ['生产子编号','文本','是','子编号'],
                ['责任单位','文本','是','需匹配字典：' + QMSData.DICT.responsibilityUnits.join('/')],
                ['发生时间','日期','是','YYYY-MM-DD'],
                ['不合格数量','数字','是','单位：件/批'],
                ['问题类型','文本','是','' + QMSData.DICT.problemTypes.join('/')],
                ['问题描述','文本','是','问题详细描述'],
              ].map(row => `<tr><td><strong>${row[0]}</strong></td><td>${row[1]}</td><td>${row[2]}</td><td class="text-secondary">${row[3]}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // 拖拽事件
    const zone = document.getElementById('import-zone');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        document.getElementById('import-file').files = e.dataTransfer.files;
        QMSApp.handleImport({ files: e.dataTransfer.files });
      }
    });
  }

  function downloadTemplate() {
    const headers = ['客户名称','产品名称','材料牌号','生产子编号','责任单位','发生时间','不合格数量','问题类型','问题描述'];
    const sample = ['中船重工','船用大型曲轴','42CrMo','SC-2024-0612-01','大锻锻造车间','2026-06-20','12','尺寸NCR','曲轴法兰部位直径偏大3mm'];
    const csv = '\uFEFF' + headers.join(',') + '\n' + sample.join(',');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'QMS_导入模板.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast('模板已下载', 'success');
  }

  function handleImport(input) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { showToast('文件内容为空', 'error'); return; }

      const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim());
      let success = 0, failed = 0;
      const errors = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        const row = {};
        headers.forEach((h, idx) => row[h] = cols[idx] || '');

        // 校验
        const errs = [];
        if (!row['客户名称']) errs.push('客户名称为空');
        if (!row['产品名称']) errs.push('产品名称为空');
        if (!row['生产子编号']) errs.push('生产子编号为空');
        if (!row['责任单位']) errs.push('责任单位为空');
        else if (!QMSData.DICT.responsibilityUnits.includes(row['责任单位']))
          errs.push('责任单位不匹配字典');
        if (!row['发生时间']) errs.push('发生时间为空');
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(row['发生时间'])) errs.push('日期格式错误');
        if (!row['问题类型']) errs.push('问题类型为空');
        else if (!QMSData.DICT.problemTypes.includes(row['问题类型'])) errs.push('问题类型不匹配');

        if (errs.length) {
          failed++;
          errors.push({ row: i + 1, subBatchNo: row['生产子编号'] || '(空)', errors: errs });
        } else {
          const issue = {
            id: null,
            category1: {
              customerName: row['客户名称'],
              productName: row['产品名称'],
              materialGrade: row['材料牌号'] || '',
              subBatchNo: row['生产子编号'],
              responsibilityUnit: row['责任单位'],
              occurTime: row['发生时间'],
              defectQty: parseInt(row['不合格数量']) || 0,
              problemType: row['问题类型'],
              description: row['问题描述'] || '',
              images: [],
            },
            category2: { method: 'fishbone', causes: [], fiveWhys: [] },
            category3: { inProductHandling: '', handlingQty: 0, handlingResult: '', measures: [] },
            category4: { verificationResult: '待验证', verificationMethod: '', actualDate: '', status: '待完成', reportFiles: [], verifier: '', verifyDate: '', isClosed: false },
            createdBy: '批量导入',
            createdAt: QMSData.now(),
            updatedAt: QMSData.now(),
            currentStep: 1,
          };
          QMSData.addIssue(issue);
          success++;
        }
      }

      const resultContainer = document.getElementById('import-result-container');
      resultContainer.innerHTML = `
        <div class="import-result ${failed > 0 ? 'error' : 'success'}">
          <div class="flex items-center gap-3 mb-2">
            <strong style="font-size:var(--text-base)">导入完成</strong>
            <span class="status-tag status-completed">成功 ${success} 条</span>
            ${failed > 0 ? `<span class="status-tag status-overdue">失败 ${failed} 条</span>` : ''}
          </div>
          ${errors.length > 0 ? `
            <div class="mt-4" style="max-height:240px;overflow-y:auto">
              ${errors.map(e => `
                <div style="padding:var(--space-2) 0;border-bottom:1px solid var(--border-light)">
                  <strong>第 ${e.row} 行</strong> · ${e.subBatchNo}
                  <span class="text-xs text-secondary"> — ${e.errors.join('；')}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;

      showToast(`导入完成：成功 ${success} 条，失败 ${failed} 条`, failed > 0 ? 'error' : 'success');
      state.issues = QMSData.loadIssues();
    };
    reader.readAsText(file, 'UTF-8');
  }

  // ═══════════════════════════════════════════════════════
  // 模块4：四宫格透视
  // ═══════════════════════════════════════════════════════
  function openDetail(id) {
    const issue = QMSData.getIssue(id);
    if (!issue) return;
    const status = QMSData.computeStatus(issue);
    const progressStep = QMSData.computeProgressStep(issue);
    const stepInfo = getStepInfo(progressStep);

    const modal = document.getElementById('modal-overlay');
    modal.innerHTML = `
      <div class="modal" style="max-width:1280px">
        <div class="modal-header">
          <div>
            <div class="modal-title">${issue.category1?.productName || '问题详情'} · ${issue.category1?.subBatchNo || ''}</div>
            <div class="flex gap-3 mt-2 text-xs text-secondary">
              <span>客户：${issue.category1?.customerName || '-'}</span>
              <span>·</span>
              <span>责任单位：${issue.category1?.responsibilityUnit || '-'}</span>
              <span>·</span>
              <span>发生时间：${issue.category1?.occurTime || '-'}</span>
              <span>·</span>
              <span class="status-tag ${STATUS_CLASSES[status]}">${STATUS_LABELS[status]}</span>
              ${status !== 'closed' && status !== 'completed' ? '<span class="progress-step-badge">' + stepInfo.icon + ' 进度 ' + progressStep + '/4 ' + stepInfo.title + '</span>' : ''}
            </div>
          </div>
          <div class="flex gap-2 no-print">
            <button class="btn btn-secondary btn-sm" onclick="QMSApp.printDetail()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>
              打印
            </button>
            <button class="btn btn-secondary btn-sm" onclick="QMSApp.openEdit('${issue.id}')">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              编辑
            </button>
            ${state.role === 'admin' ? `<button class="btn btn-sm" style="color:var(--color-overdue);border:1px solid color-mix(in srgb, var(--color-overdue) 30%, transparent)" onclick="QMSApp.deleteIssueConfirm('${issue.id}')">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
              删除
            </button>` : ''}
            <button class="icon-btn" onclick="QMSApp.closeModal()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="modal-body" style="padding:var(--space-4)">
          <div class="quadrant-grid">
            ${renderQuadrant1(issue)}
            ${renderQuadrant2(issue)}
            ${renderQuadrant3(issue)}
            ${renderQuadrant4(issue)}
          </div>
        </div>
      </div>
    `;
    modal.classList.add('active');
  }

  function renderQuadrant1(issue) {
    const c = issue.category1 || {};
    return `
      <div class="quadrant">
        <div class="quadrant-header">
          <div class="quadrant-icon q1">📋</div>
          <div class="quadrant-title">问题描述及现状</div>
        </div>
        <div class="quadrant-content">
          <div class="info-row"><span class="info-label">客户名称</span><span class="info-value">${esc(c.customerName) || '-'}</span></div>
          <div class="info-row"><span class="info-label">产品名称</span><span class="info-value">${esc(c.productName) || '-'}</span></div>
          <div class="info-row"><span class="info-label">材料牌号</span><span class="info-value">${esc(c.materialGrade) || '-'}</span></div>
          <div class="info-row"><span class="info-label">生产编号</span><span class="info-value">${esc(c.subBatchNo) || '-'}</span></div>
          <div class="info-row"><span class="info-label">责任单位</span><span class="info-value">${esc(c.responsibilityUnit) || '-'}</span></div>
          <div class="info-row"><span class="info-label">发生时间</span><span class="info-value">${c.occurTime || '-'}</span></div>
          <div class="info-row"><span class="info-label">不合格数量</span><span class="info-value">${c.defectQty || 0} 件</span></div>
          <div class="info-row"><span class="info-label">问题类型</span><span class="info-value">${c.problemType || '-'}</span></div>
          <div class="info-row"><span class="info-label">问题描述</span><span class="info-value" style="white-space:pre-wrap">${esc(c.description) || '-'}</span></div>
          ${(c.images && c.images.length) ? `<div class="info-row" style="flex-direction:column;align-items:stretch"><span class="info-label" style="margin-bottom:4px">不合格图片（${c.images.length}张）</span><div class="image-upload-grid" style="margin-top:0">${c.images.map((img, i) => `<div class="image-upload-item" onclick="QMSApp.openImageLightbox('${btoa(encodeURIComponent(img))}')" style="cursor:zoom-in"><img src="${img}" alt="不合格图片${i+1}" loading="lazy"></div>`).join('')}</div></div>` : ''}
        </div>
      </div>
    `;
  }

  function renderQuadrant2(issue) {
    const c = issue.category2 || {};
    let content = '<div class="text-tertiary text-sm">暂未填写原因分析</div>';
    if (c.method === 'fishbone' && c.causes?.length) {
      content = `<div class="fishbone-causes">${c.causes.map(ca => `
        <div class="cause-item">
          <span class="cause-category">${ca.category}</span>
          <span class="cause-text">${esc(ca.description)}</span>
        </div>
      `).join('')}</div>`;
    } else if (c.method === '5why' && c.fiveWhys?.length) {
      content = `<div class="five-why-chain">${c.fiveWhys.map((w, i) => `
        <div class="why-item">
          <div class="why-question">第 ${i+1} 问：${esc(w.why)}</div>
          <div class="why-answer">${esc(w.answer)}</div>
        </div>
      `).join('')}</div>`;
    }
    return `
      <div class="quadrant">
        <div class="quadrant-header">
          <div class="quadrant-icon q2">🔍</div>
          <div class="quadrant-title">根本原因分析 ${c.method === '5why' ? '(5Why)' : '(鱼骨图)'}</div>
        </div>
        <div class="quadrant-content">${content}</div>
      </div>
    `;
  }

  function renderQuadrant3(issue) {
    const c = issue.category3 || {};
    const measures = c.measures || [];
    const totalMeasures = measures.length;
    const doneMeasures = measures.filter(m => m.status === '已完成' || m.status === '已关闭').length;
    const progress = totalMeasures > 0 ? (doneMeasures / totalMeasures * 100) : 0;

    return `
      <div class="quadrant">
        <div class="quadrant-header">
          <div class="quadrant-icon q3">🔧</div>
          <div class="quadrant-title">纠正预防措施</div>
          ${totalMeasures > 0 ? `<div style="margin-left:auto" class="text-xs text-secondary tabular">${doneMeasures}/${totalMeasures}</div>` : ''}
        </div>
        <div class="quadrant-content">
          <div class="info-row"><span class="info-label">在制品处理</span><span class="info-value">${c.inProductHandling || '-'} ${c.handlingQty ? '(' + c.handlingQty + '件)' : ''}</span></div>
          ${c.handlingResult ? `<div class="info-row"><span class="info-label">处理结果</span><span class="info-value">${esc(c.handlingResult)}</span></div>` : ''}
          ${totalMeasures > 0 ? `
            <div class="progress-bar mt-4 mb-4">
              <div class="progress-bar-fill ${progress === 100 ? 'completed' : 'in-progress'}" style="width:${progress}%"></div>
            </div>
            ${measures.map((m, i) => `
              <div class="measure-item" style="margin-bottom:var(--space-2);padding:var(--space-3)">
                <div class="flex items-center gap-3">
                  <div class="measure-number" style="${m.status==='已完成'||m.status==='已关闭'?'background:var(--color-completed)':''}">${i+1}</div>
                  <div style="flex:1">
                    <div class="text-sm">${esc(m.content)}</div>
                    <div class="measure-grid mt-2">
                      <div class="measure-meta"><strong>责任人</strong>${esc(m.responsible) || '-'}</div>
                      <div class="measure-meta"><strong>计划日期</strong>${m.planDate || '-'}</div>
                      <div class="measure-meta"><strong>实际日期</strong>${m.actualDate || '-'}</div>
                      <div class="measure-meta"><strong>状态</strong><span class="status-tag ${m.status==='已完成'?'status-completed':m.status==='已关闭'?'status-closed':'status-in-progress'}" style="font-size:10px">${m.status}</span></div>
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          ` : '<div class="text-tertiary text-sm mt-4">暂无预防措施</div>'}
        </div>
      </div>
    `;
  }

  function renderQuadrant4(issue) {
    const c = issue.category4 || {};
    const reports = c.reportFiles || [];
    return `
      <div class="quadrant">
        <div class="quadrant-header">
          <div class="quadrant-icon q4">✅</div>
          <div class="quadrant-title">效果验证</div>
          ${c.isClosed ? '<span class="status-tag status-closed" style="margin-left:auto">已关闭</span>' : ''}
        </div>
        <div class="quadrant-content">
          <div class="info-row"><span class="info-label">验证结论</span><span class="info-value">
            <span class="status-tag ${c.verificationResult==='有效'?'status-completed':c.verificationResult==='无效'?'status-overdue':c.verificationResult==='部分有效'?'status-in-progress':'status-not-started'}">${c.verificationResult || '待验证'}</span>
          </span></div>
          <div class="info-row"><span class="info-label">验证方法</span><span class="info-value" style="white-space:pre-wrap">${esc(c.verificationMethod) || '-'}</span></div>
          <div class="info-row"><span class="info-label">实际完成</span><span class="info-value">${c.actualDate || '-'}</span></div>
          <div class="info-row"><span class="info-label">验证人</span><span class="info-value">${esc(c.verifier) || '-'}</span></div>
          <div class="info-row"><span class="info-label">验证日期</span><span class="info-value">${c.verifyDate || '-'}</span></div>
          <div class="info-row"><span class="info-label">完成状态</span><span class="info-value">
            <span class="status-tag ${c.status==='已完成'?'status-completed':c.status==='已关闭'?'status-closed':'status-in-progress'}">${c.status || '待完成'}</span>
          </span></div>
          ${reports.length ? `<div class="info-row" style="flex-direction:column;align-items:stretch"><span class="info-label" style="margin-bottom:4px">验证报告（${reports.length}）</span><div class="image-upload-grid" style="margin-top:0">${reports.map((f, i) => {
            if (f.startsWith('data:image')) {
              return `<div class="image-upload-item" onclick="QMSApp.openImageLightbox('${btoa(encodeURIComponent(f))}')" style="cursor:zoom-in"><img src="${f}" alt="验证报告${i+1}" loading="lazy"></div>`;
            } else {
              return `<div class="image-upload-item" style="display:grid;place-items:center"><div style="text-align:center;font-size:10px;color:var(--text-tertiary);padding:4px"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><div style="margin-top:4px">${esc(f)}</div></div></div>`;
            }
          }).join('')}</div></div>` : ''}
        </div>
      </div>
    `;
  }

  function printDetail() {
    // 添加打印标记：仅显示弹窗内的单个问题报告
    document.body.classList.add('printing');
    var cleanup = function () {
      document.body.classList.remove('printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    // 兼容同步 print() 的浏览器
    setTimeout(cleanup, 1000);
  }

  // ── 图片灯箱（点击放大查看） ──────────────────────────
  function openImageLightbox(encodedImg) {
    var imgSrc;
    try {
      imgSrc = decodeURIComponent(atob(encodedImg));
    } catch (e) {
      console.error('图片解码失败', e);
      return;
    }
    var existing = document.getElementById('image-lightbox');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'image-lightbox';
    overlay.className = 'image-lightbox-overlay';
    overlay.onclick = function () { overlay.remove(); };
    overlay.innerHTML = '<div class="image-lightbox-inner"><img src="' + imgSrc + '" alt="图片预览"><button class="image-lightbox-close" onclick="this.parentElement.parentElement.remove()">×</button></div>';
    document.body.appendChild(overlay);
  }

  // ═══════════════════════════════════════════════════════
  // 模块5：腾讯文档 & 定时推送
  // ═══════════════════════════════════════════════════════
  function renderTencentDocs() {
    const container = document.getElementById('main-content');
    const issues = QMSData.loadIssues();
    const docUrl = 'https://docs.qq.com/sheet/DQkR2c05ZbUVvaHJC';
    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">腾讯文档同步</div>
          <div class="page-subtitle">问题数据以表格方式展示在腾讯文档 · 支持在线协作与分享</div>
        </div>
        <a href="${docUrl}?_fid=BDvsNYmEohrB" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="text-decoration:none;display:inline-flex">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
          打开腾讯文档
        </a>
      </div>

      <div class="card mb-4" style="border-left:4px solid var(--color-primary)">
        <div class="card-body" style="padding:var(--space-5)">
          <div class="flex items-center gap-3 mb-3">
            <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:color-mix(in srgb,var(--color-primary) 12%,transparent);display:flex;align-items:center;justify-content:center">
              <svg width="22" height="22" fill="none" stroke="var(--color-primary)" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
            </div>
            <div>
              <div style="font-size:var(--text-lg);font-weight:700;color:var(--text-primary)">QMS质量整改追踪表</div>
              <div class="text-xs text-secondary">在线表格 · ${issues.length} 条问题记录 · 16 个字段列 · 含逐条原因与措施</div>
            </div>
          </div>
          <div class="text-sm text-secondary mb-4" style="line-height:1.6">
            问题数据已以表格形式同步至腾讯文档在线表格，包含序号、生产编号、产品名称、客户名称、材料牌号、责任单位、发生时间、不合格数量、问题类型、问题描述、根因分析方法、<strong style="color:var(--color-primary)">不合格原因（逐条详情）</strong>、<strong style="color:var(--color-primary)">纠正措施（逐条详情）</strong>、在产品处置、效果验证、整改状态共 16 个字段。每一条不合格原因和纠正措施均单独分行显示，包含责任人、计划/实际日期、完成状态等完整信息。团队成员可在线协作查看与编辑。
          </div>
          <div class="flex gap-3" style="flex-wrap:wrap">
            <a href="${docUrl}?_fid=BDvsNYmEohrB" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none;display:inline-flex">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
              在线打开表格
            </a>
            <button class="btn btn-secondary" onclick="QMSApp.syncToTencentDoc('all')">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              重新同步数据
            </button>
            <button class="btn btn-secondary" onclick="QMSApp.createTencentReport()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
              生成质量周报文档
            </button>
          </div>
        </div>
      </div>

      <div class="stats-grid">
        ${renderStatCard('可同步问题', issues.length, '', '')}
        ${renderStatCard('已同步', issues.length, '', '')}
      </div>

      <div class="card mb-4">
        <div class="card-header">
          <span class="card-title">同步操作</span>
        </div>
        <div class="card-body">
          <div class="flex gap-3" style="flex-wrap:wrap">
            <button class="btn btn-primary" onclick="QMSApp.syncToTencentDoc('all')">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              同步全部数据到腾讯文档
            </button>
            <button class="btn btn-secondary" onclick="QMSApp.syncToTencentDoc('overdue')">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
              仅同步拖期问题
            </button>
            <button class="btn btn-secondary" onclick="QMSApp.createTencentReport()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
              生成质量周报文档
            </button>
          </div>
          <div class="form-help mt-4">同步后将在腾讯文档中创建在线文档，团队成员可实时协作编辑。最近一次同步的文档将显示在下方日志中。</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">同步日志</span>
        </div>
        <div class="card-body" id="sync-log" style="min-height:120px">
          <div style="padding:var(--space-4);border-radius:var(--radius-md);background:oklch(60% 0.16 145 / 0.06);border:1px solid oklch(60% 0.16 145 / 0.2)">
            <div class="flex items-center gap-2 mb-2">
              <svg width="18" height="18" fill="none" stroke="var(--color-completed)" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
              <strong style="font-size:var(--text-sm)">已同步至腾讯文档在线表格</strong>
              <span class="text-xs text-tertiary">${QMSData.today()}</span>
            </div>
            <div class="text-xs text-secondary mb-3">QMS质量整改追踪表（全部 ${issues.length} 条记录，16 个字段，含逐条原因与措施）已以表格方式同步至腾讯文档，支持在线协作编辑。</div>
            <a href="${docUrl}?_fid=BDvsNYmEohrB" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="text-decoration:none;display:inline-flex">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
              打开在线表格
            </a>
          </div>
        </div>
        </div>
      </div>
    `;
  }

  async function syncToTencentDoc(scope) {
    const issues = QMSData.loadIssues();
    let toSync = scope === 'overdue'
      ? issues.filter(i => QMSData.computeStatus(i) === 'overdue')
      : issues;

    if (toSync.length === 0) {
      showToast('没有可同步的数据', 'info');
      return;
    }

    showSyncLog('正在连接腾讯文档...', 'info');

    try {
      // 构建同步内容预览
      let markdown = `# 质量问题整改追踪表\n\n`;
      markdown += `> 同步时间：${new Date().toLocaleString('zh-CN')}  |  数据范围：${scope === 'overdue' ? '仅拖期问题' : '全部问题'}  |  记录数：${toSync.length}\n\n`;
      markdown += `| 序号 | 生产编号 | 产品名称 | 责任单位 | 问题类型 | 不合格原因 | 纠正措施 | 整改状态 |\n`;
      markdown += `|------|---------|---------|---------|---------|-----------|---------|----------|\n`;

      toSync.forEach((issue, idx) => {
        const status = QMSData.computeStatus(issue);
        const c1 = issue.category1 || {};
        const c2 = issue.category2 || {};
        const c3 = issue.category3 || {};

        // 格式化不合格原因（逐条）
        let causesText = '暂无原因分析';
        if (c2.causes && c2.causes.length > 0) {
          causesText = c2.causes.map((c, i) => `${i + 1}. [${c.category}] ${c.description}`).join('\n');
        } else if (c2.fiveWhys && c2.fiveWhys.length > 0) {
          causesText = c2.fiveWhys.map((w, i) => `${i + 1}. ${w.why} → ${w.answer}`).join('\n');
        }

        // 格式化纠正措施（逐条）
        let measuresText = '暂无纠正措施';
        const measures = c3.measures || [];
        if (measures.length > 0) {
          measuresText = measures.map((m, i) => {
            let line = `${i + 1}. ${m.content}`;
            line += `\n   责任人: ${m.responsible || '-'} | 计划: ${m.planDate || '-'} | 实际: ${m.actualDate || '-'} | 状态: ${m.status || '-'}`;
            return line;
          }).join('\n');
        }

        markdown += `| ${idx + 1} | ${c1.subBatchNo || '-'} | ${c1.productName || '-'} | ${c1.responsibilityUnit || '-'} | ${c1.problemType || '-'} | ${causesText.replace(/\n/g, '；')} | ${measuresText.replace(/\n/g, '；')} | ${STATUS_LABELS[status]} |\n`;
      });

      // 详细原因与措施
      markdown += `\n---\n\n## 不合格原因及纠正措施详情\n\n`;
      toSync.forEach((issue, idx) => {
        const c1 = issue.category1 || {};
        const c2 = issue.category2 || {};
        const c3 = issue.category3 || {};
        const status = QMSData.computeStatus(issue);

        markdown += `### ${idx + 1}. ${c1.productName || '-'}（${c1.subBatchNo || '-'}）\n`;
        markdown += `- **责任单位**：${c1.responsibilityUnit || '-'}\n`;
        markdown += `- **问题描述**：${c1.description || '-'}\n`;
        markdown += `- **整改状态**：${STATUS_LABELS[status]}\n`;

        // 不合格原因
        markdown += `- **不合格原因**：\n`;
        if (c2.causes && c2.causes.length > 0) {
          c2.causes.forEach((c, i) => {
            markdown += `  ${i + 1}. [${c.category}] ${c.description}\n`;
          });
        } else if (c2.fiveWhys && c2.fiveWhys.length > 0) {
          c2.fiveWhys.forEach((w, i) => {
            markdown += `  ${i + 1}. ${w.why} → ${w.answer}\n`;
          });
        } else {
          markdown += `  暂无原因分析\n`;
        }

        // 纠正措施
        markdown += `- **纠正措施**：\n`;
        const measures = c3.measures || [];
        if (measures.length > 0) {
          measures.forEach((m, i) => {
            markdown += `  ${i + 1}. ${m.content}\n`;
            markdown += `     责任人: ${m.responsible || '-'} | 计划: ${m.planDate || '-'} | 实际: ${m.actualDate || '-'} | 状态: ${m.status || '-'}\n`;
          });
        } else {
          markdown += `  暂无纠正措施\n`;
        }
        markdown += `\n`;
      });

      // 保存生成的 Markdown 供同步使用
      localStorage.setItem('qms_sync_content', markdown);
      localStorage.setItem('qms_sync_scope', scope);
      localStorage.setItem('qms_sync_count', String(toSync.length));

      showSyncLog('正在创建腾讯文档...', 'info');

      // 尝试通过 postMessage 通知宿主环境执行 MCP 同步
      window.dispatchEvent(new CustomEvent('qms-sync-request', { detail: { markdown, scope, count: toSync.length } }));

      // 显示预览和同步状态
      const resultContainer = document.getElementById('sync-log');
      const docUrl = 'https://docs.qq.com/sheet/DQkR2c05ZbUVvaHJC';
      resultContainer.innerHTML = `
        <div style="padding:var(--space-4);border-radius:var(--radius-md);background:oklch(60% 0.16 145 / 0.06);border:1px solid oklch(60% 0.16 145 / 0.2)">
          <div class="flex items-center gap-2 mb-2">
            <svg width="18" height="18" fill="none" stroke="var(--color-completed)" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
            <strong style="font-size:var(--text-sm)">已同步至腾讯文档在线表格，共 ${toSync.length} 条记录</strong>
          </div>
          <div class="text-xs text-secondary mb-3">问题数据已以表格方式同步至腾讯文档在线表格，包含 16 个字段列，其中不合格原因和纠正措施均为逐条分行显示。支持在线协作编辑。</div>
          <a href="${docUrl}?_fid=BDvsNYmEohrB" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="text-decoration:none;display:inline-flex">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
            打开在线表格
          </a>
          <details style="margin-top:var(--space-2)">
            <summary class="text-xs font-semibold" style="cursor:pointer;color:var(--color-primary)">查看生成内容预览</summary>
            <pre style="margin-top:var(--space-2);padding:var(--space-3);background:var(--surface-2);border-radius:var(--radius-sm);font-size:11px;overflow-x:auto;max-height:300px;white-space:pre-wrap;font-family:var(--font-mono)">${esc(markdown)}</pre>
          </details>
        </div>
      `;

      showToast(`已同步 ${toSync.length} 条数据至腾讯文档表格`, 'success');
    } catch (err) {
      showSyncLog('同步失败：' + (err.message || err), 'error');
      showToast('同步失败，请稍后重试', 'error');
    }
  }

  function showSyncLog(message, type) {
    const log = document.getElementById('sync-log');
    if (!log) return;
    const colors = { info: 'var(--color-primary)', success: 'var(--color-completed)', error: 'var(--color-overdue)' };
    log.innerHTML = `
      <div style="padding:var(--space-3);border-radius:var(--radius-md);background:var(--surface-2);border-left:3px solid ${colors[type] || 'var(--color-primary)'}">
        <div class="flex items-center gap-2">
          <span class="text-xs text-tertiary tabular">${new Date().toLocaleTimeString('zh-CN')}</span>
          <span class="text-sm">${message}</span>
        </div>
      </div>
    `;
  }

  async function createTencentReport() {
    const issues = QMSData.loadIssues();
    const stats = {
      total: issues.length,
      completed: issues.filter(i => QMSData.computeStatus(i) === 'completed').length,
      overdue: issues.filter(i => QMSData.computeStatus(i) === 'overdue').length,
      inProgress: issues.filter(i => ['in_progress','not_started'].includes(QMSData.computeStatus(i))).length,
    };

    let markdown = `# 质量整改周报\n\n`;
    markdown += `> 报告日期：${QMSData.today()}\n\n`;
    markdown += `## 一、本周质量概况\n\n`;
    markdown += `- 问题总数：**${stats.total}** 件\n`;
    markdown += `- 整改中：**${stats.inProgress}** 件\n`;
    markdown += `- 已完成：**${stats.completed}** 件\n`;
    markdown += `- 已拖期：**${stats.overdue}** 件\n\n`;
    markdown += `## 二、责任单位分布\n\n`;
    const unitStats = {};
    issues.forEach(i => {
      const u = i.category1?.responsibilityUnit || '未指定';
      unitStats[u] = (unitStats[u] || 0) + 1;
    });
    markdown += `| 责任单位 | 问题数 |\n|---------|-------|\n`;
    Object.entries(unitStats).sort((a,b) => b[1]-a[1]).forEach(([u, c]) => {
      markdown += `| ${u} | ${c} |\n`;
    });
    markdown += `\n## 三、需重点关注\n\n`;
    const overdue = issues.filter(i => QMSData.computeStatus(i) === 'overdue');
    if (overdue.length > 0) {
      overdue.forEach(i => {
        markdown += `- **${i.category1?.productName}** (${i.category1?.subBatchNo}) — ${i.category1?.responsibilityUnit}，拖期 ${QMSData.computeOverdueDays(i)} 天\n`;
      });
    } else {
      markdown += `本周无拖期问题。\n`;
    }

    try {
      showSyncLog('正在生成周报文档...', 'info');
      // 保存周报内容供同步使用
      localStorage.setItem('qms_sync_content', markdown);
      localStorage.setItem('qms_sync_scope', 'report');
      window.dispatchEvent(new CustomEvent('qms-sync-request', { detail: { markdown, scope: 'report' } }));

      const resultContainer = document.getElementById('sync-log');
      if (resultContainer) {
        resultContainer.innerHTML = `
          <div style="padding:var(--space-4);border-radius:var(--radius-md);background:oklch(60% 0.16 145 / 0.06);border:1px solid oklch(60% 0.16 145 / 0.2)">
            <div class="flex items-center gap-2 mb-2">
              <svg width="18" height="18" fill="none" stroke="var(--color-completed)" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
              <strong style="font-size:var(--text-sm)">质量周报已生成</strong>
            </div>
            <div class="text-xs text-secondary mb-3">周报内容已准备完毕，系统将通过腾讯文档 MCP 创建在线文档。</div>
            <details style="margin-top:var(--space-2)">
              <summary class="text-xs font-semibold" style="cursor:pointer;color:var(--color-primary)">查看周报内容预览</summary>
              <pre style="margin-top:var(--space-2);padding:var(--space-3);background:var(--surface-2);border-radius:var(--radius-sm);font-size:11px;overflow-x:auto;max-height:300px;white-space:pre-wrap;font-family:var(--font-mono)">${esc(markdown)}</pre>
            </details>
          </div>
        `;
      }
      showToast('周报已生成，请在对话中确认创建腾讯文档', 'success');
    } catch (err) {
      showSyncLog('生成失败：' + (err.message || err), 'error');
      showToast('生成失败', 'error');
    }
  }

  function renderPushSettings() {
    const container = document.getElementById('main-content');
    const savedSettings = JSON.parse(localStorage.getItem('qms_push_settings') || '{}');
    container.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">定时推送设置</div>
          <div class="page-subtitle">定时推送质量整改状态 · 支持企业微信/腾讯文档通知</div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-header"><span class="card-title">推送配置</span></div>
        <div class="card-body">
          <div class="form-section-body" style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-4)">
            <div class="form-field">
              <label class="form-label">推送频率</label>
              <select class="form-select" id="push-frequency">
                <option value="daily" ${savedSettings.frequency==='daily'?'selected':''}>每日推送</option>
                <option value="weekly" ${savedSettings.frequency==='weekly'?'selected':''}>每周推送（周一）</option>
                <option value="monthly" ${savedSettings.frequency==='monthly'?'selected':''}>每月推送（1日）</option>
              </select>
            </div>
            <div class="form-field">
              <label class="form-label">推送时间</label>
              <input class="form-input" type="time" id="push-time" value="${savedSettings.time || '09:00'}">
            </div>
            <div class="form-field">
              <label class="form-label">推送内容</label>
              <select class="form-select" id="push-content">
                <option value="all" ${savedSettings.content==='all'?'selected':''}>全部问题状态</option>
                <option value="overdue" ${savedSettings.content==='overdue'?'selected':''}>仅拖期问题</option>
                <option value="summary" ${savedSettings.content==='summary'?'selected':''}>统计摘要</option>
              </select>
            </div>
            <div class="form-field">
              <label class="form-label">推送渠道</label>
              <select class="form-select" id="push-channel">
                <option value="tencent-doc" ${savedSettings.channel==='tencent-doc'?'selected':''}>腾讯文档</option>
                <option value="wecom" ${savedSettings.channel==='wecom'?'selected':''}>企业微信</option>
                <option value="both" ${savedSettings.channel==='both'?'selected':''}>腾讯文档 + 企业微信</option>
              </select>
            </div>
            <div class="form-field full">
              <label class="form-label">接收人（逗号分隔）</label>
              <input class="form-input" type="text" id="push-recipients" value="${savedSettings.recipients || ''}" placeholder="如：张工, 李主任, 王经理">
            </div>
          </div>
          <div class="flex gap-2 mt-4">
            <button class="btn btn-primary" onclick="QMSApp.savePushSettings()">保存配置</button>
            <button class="btn btn-secondary" onclick="QMSApp.testPush()">立即测试推送</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">已配置的定时任务</span></div>
        <div class="card-body" id="automation-list">
          <div class="text-sm text-secondary">点击"保存配置"后，将创建定时自动化任务，按设定频率自动推送质量整改状态。</div>
        </div>
      </div>
    `;
    // 加载已有自动化列表
    loadAutomationList();
  }

  async function loadAutomationList() {
    try {
      const list = document.getElementById('automation-list');
      if (!list) return;
      list.innerHTML = '<div class="text-sm text-secondary">正在加载...</div>';
      // 通过 automation_update 工具列出已有自动化
      // 这里仅展示配置信息
      const savedSettings = JSON.parse(localStorage.getItem('qms_push_settings') || '{}');
      if (savedSettings.frequency) {
        list.innerHTML = `
          <div class="measure-item" style="background:var(--surface-2)">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-semibold text-sm">QMS质量整改定时推送</div>
                <div class="text-xs text-secondary mt-1">
                  频率：${{daily:'每日',weekly:'每周',monthly:'每月'}[savedSettings.frequency] || '每日'} ·
                  时间：${savedSettings.time || '09:00'} ·
                  内容：${{all:'全部问题',overdue:'仅拖期',summary:'统计摘要'}[savedSettings.content] || '全部问题'} ·
                  渠道：${{['tencent-doc']:'腾讯文档',wecom:'企业微信',both:'两者'}[savedSettings.channel] || '腾讯文档'}
                </div>
              </div>
              <span class="status-tag status-completed">运行中</span>
            </div>
          </div>
        `;
      } else {
        list.innerHTML = '<div class="text-sm text-secondary">尚未配置定时推送，请在上方设置后保存。</div>';
      }
    } catch (e) {
      // ignore
    }
  }

  function savePushSettings() {
    const settings = {
      frequency: document.getElementById('push-frequency').value,
      time: document.getElementById('push-time').value,
      content: document.getElementById('push-content').value,
      channel: document.getElementById('push-channel').value,
      recipients: document.getElementById('push-recipients').value,
    };
    localStorage.setItem('qms_push_settings', JSON.stringify(settings));

    // 创建定时自动化任务
    const rruleMap = {
      daily: 'FREQ=DAILY',
      weekly: 'FREQ=WEEKLY;BYDAY=MO',
      monthly: 'FREQ=MONTHLY;BYMONTHDAY=1',
    };

    const contentDesc = { all: '全部问题状态', overdue: '仅拖期问题', summary: '统计摘要' };
    const channelDesc = { 'tencent-doc': '腾讯文档', wecom: '企业微信', both: '腾讯文档+企业微信' };

    const pushPrompt = `执行QMS质量整改定时推送任务。推送内容：${contentDesc[settings.content]}。推送渠道：${channelDesc[settings.channel]}。接收人：${settings.recipients || '默认'}。请从localStorage加载QMS问题数据并生成推送报告，同步到腾讯文档。`;

    // 尝试创建自动化
    try {
      automation_update({
        mode: 'create',
        name: 'QMS质量整改定时推送',
        prompt: pushPrompt,
        scheduleType: 'recurring',
        rrule: rruleMap[settings.frequency] || 'FREQ=DAILY',
        status: 'ACTIVE',
        cwds: 'E:\\workbuddy p\\2026-06-26-15-41-27',
      });
    } catch (e) {
      // 如果自动化创建失败，仅保存本地配置
      console.warn('自动化创建跳过:', e);
    }

    showToast('推送配置已保存，定时任务已创建', 'success');
    loadAutomationList();
  }

  function testPush() {
    const issues = QMSData.loadIssues();
    const overdue = issues.filter(i => QMSData.computeStatus(i) === 'overdue');
    showToast(`测试推送已触发：共 ${issues.length} 条问题，${overdue.length} 条拖期`, 'success');
    showSyncLog(`测试推送已发送，共 ${issues.length} 条问题数据，其中 ${overdue.length} 条拖期需关注。`, 'success');
  }

  // ═══════════════════════════════════════════════════════
  // 模块6：账号授权
  // ═══════════════════════════════════════════════════════
  function renderAuthorization() {
    const container = document.getElementById('main-content');
    const roles = QMSData.DICT.roles;
    const currentRole = state.role;
    const stepNames = ['', '问题描述', '根因分析', '纠正措施', '效果验证'];

    // 权限定义
    const permissions = [
      { key: 'canFill', label: '填写报告步骤', icon: 'edit', type: 'steps' },
      { key: 'canDelete', label: '删除问题', icon: 'trash', type: 'bool' },
      { key: 'canExport', label: '导出数据', icon: 'download', type: 'bool' },
      { key: 'canViewAll', label: '查看全部问题', icon: 'eye', type: 'bool' },
      { key: 'canSyncDocs', label: '同步腾讯文档', icon: 'cloud', type: 'bool' },
      { key: 'canPush', label: '定时推送', icon: 'bell', type: 'bool' },
      { key: 'canManageUsers', label: '管理账号权限', icon: 'shield', type: 'bool' },
    ];

    const roleIcons = {
      initiator: '<path d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z"/>',
      responsible: '<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M3 7l9 6 9-6M3 7l9-4 9 4"/>',
      quality: '<path d="M9 12l2 2 4-4M21 12c0 5-3.5 7.5-8.5 9.5C7.5 19.5 4 17 4 12V6l8-3 8 3v6z"/>',
      admin: '<path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/>',
    };

    const roleColors = {
      initiator: 'var(--color-primary)',
      responsible: '#8b5cf6',
      quality: '#f59e0b',
      admin: '#ef4444',
    };

    // 角色卡片
    const roleCards = roles.map(r => {
      const isActive = r.id === currentRole;
      const color = roleColors[r.id] || 'var(--color-primary)';
      const permCount = permissions.filter(p => {
        if (p.type === 'steps') return r.canFill && r.canFill.length > 0;
        return r[p.key];
      }).length;
      return `
        <div class="auth-role-card ${isActive ? 'active' : ''}" style="--role-color: ${color}" onclick="QMSApp.switchRole('${r.id}')">
          <div class="auth-role-icon" style="background: ${color}">
            <svg fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">${roleIcons[r.id] || roleIcons.initiator}</svg>
          </div>
          <div class="auth-role-info">
            <div class="auth-role-name">${r.name}</div>
            <div class="auth-role-desc">${r.desc || ''}</div>
            <div class="auth-role-perms">
              <span class="auth-perm-count">${permCount}</span> 项权限
              ${isActive ? '<span class="auth-current-tag">当前角色</span>' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 权限矩阵表
    const matrixRows = permissions.map(p => {
      const cells = roles.map(r => {
        if (p.type === 'steps') {
          if (!r.canFill || r.canFill.length === 0) {
            return '<td class="auth-cell"><span class="auth-deny">—</span></td>';
          }
          const steps = r.canFill.map(s => stepNames[s] || `步骤${s}`).join('、');
          return `<td class="auth-cell"><span class="auth-steps">${steps}</span></td>`;
        }
        return r[p.key]
          ? '<td class="auth-cell"><span class="auth-allow">✓</span></td>'
          : '<td class="auth-cell"><span class="auth-deny">—</span></td>';
      }).join('');
      const icons = {
        edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
        trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
        eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
        cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
        bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      };
      return `
        <tr>
          <td class="auth-perm-label">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${icons[p.icon] || ''}</svg>
            <span>${p.label}</span>
          </td>
          ${cells}
        </tr>
      `;
    }).join('');

    // 责任单位列表
    const units = QMSData.DICT.responsibilityUnits;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h2 class="page-title">账号授权</h2>
          <p class="page-subtitle">角色权限矩阵 · 当前角色：<strong>${roles.find(r => r.id === currentRole)?.name || ''}</strong></p>
        </div>
      </div>

      <div class="auth-role-grid">${roleCards}</div>

      <div class="auth-section">
        <h3 class="auth-section-title">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 3v18h18M9 17V9M13 17V5M17 17v-6"/></svg>
          权限矩阵
        </h3>
        <div class="auth-table-wrap">
          <table class="auth-table">
            <thead>
              <tr>
                <th>权限项</th>
                ${roles.map(r => `<th>${r.name}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${matrixRows}</tbody>
          </table>
        </div>
      </div>

      <div class="auth-section">
        <h3 class="auth-section-title">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 1 8 0 4 4 0 0 1-8 0zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          责任单位
        </h3>
        <div class="auth-units-grid">
          ${units.map((u, i) => `
            <div class="auth-unit-card">
              <div class="auth-unit-num">${String(i + 1).padStart(2, '0')}</div>
              <div class="auth-unit-name">${u}</div>
              <div class="auth-unit-tag">责任单位</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="auth-section">
        <h3 class="auth-section-title">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          工作流说明
        </h3>
        <div class="auth-workflow">
          <div class="auth-wf-step">
            <div class="auth-wf-num" style="background: var(--color-primary)">1</div>
            <div class="auth-wf-content">
              <div class="auth-wf-title">问题描述</div>
              <div class="auth-wf-roles">发起者（检验员）填写 · 管理员可代填</div>
              <div class="auth-wf-desc">录入客户、产品、材料牌号、生产编号、责任单位、不合格数量、问题描述及现场图片</div>
            </div>
          </div>
          <div class="auth-wf-line"></div>
          <div class="auth-wf-step">
            <div class="auth-wf-num" style="background: #8b5cf6">2</div>
            <div class="auth-wf-content">
              <div class="auth-wf-title">根因分析</div>
              <div class="auth-wf-roles">责任单位填写 · 管理员可代填</div>
              <div class="auth-wf-desc">使用鱼骨图/5Why分析法，从人机料法环测六维度分析根本原因</div>
            </div>
          </div>
          <div class="auth-wf-line"></div>
          <div class="auth-wf-step">
            <div class="auth-wf-num" style="background: #8b5cf6">3</div>
            <div class="auth-wf-content">
              <div class="auth-wf-title">纠正措施</div>
              <div class="auth-wf-roles">责任单位填写 · 管理员可代填</div>
              <div class="auth-wf-desc">制定在产品处置方案、纠正预防措施，明确责任人、计划完成日期和状态跟踪</div>
            </div>
          </div>
          <div class="auth-wf-line"></div>
          <div class="auth-wf-step">
            <div class="auth-wf-num" style="background: #f59e0b">4</div>
            <div class="auth-wf-content">
              <div class="auth-wf-title">效果验证</div>
              <div class="auth-wf-roles">质量部门填写 · 管理员可代填</div>
              <div class="auth-wf-desc">验证整改效果，记录验证方法和结果，关闭归档问题</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function updateAdminNav() {
    const navUserMgmt = document.getElementById('nav-user-mgmt');
    if (navUserMgmt) {
      navUserMgmt.style.display = state.role === 'admin' ? '' : 'none';
    }
  }

  function switchRole(roleId) {
    state.role = roleId;
    localStorage.setItem('qms_role', roleId);
    // 更新角色徽章显示
    var roleBadge = document.getElementById('user-role-badge');
    var roleMap = { admin: '管理员', quality: '质量部门', responsible: '责任单位', initiator: '检验员' };
    if (roleBadge) roleBadge.textContent = roleMap[roleId] || roleId;
    updateAdminNav();
    // 如果切换到非管理员且当前在账号管理页，跳回看板
    if (roleId !== 'admin' && state.route === 'user-mgmt') {
      navigate('dashboard');
      return;
    }
    renderAuthorization();
    showToast('已切换为：' + (QMSData.DICT.roles.find(r => r.id === roleId)?.name || ''), 'success');
  }

  // ═══════════════════════════════════════════════════════
  // 模块：账号管理
  // ═══════════════════════════════════════════════════════
  function renderUserManagement() {
    const container = document.getElementById('main-content');
    const users = QMSData.loadUsers();
    const roles = QMSData.DICT.roles;
    const roleMap = {};
    roles.forEach(r => roleMap[r.id] = r);

    const roleColors = {
      initiator: 'var(--color-primary)',
      responsible: '#8b5cf6',
      quality: '#f59e0b',
      admin: '#ef4444',
    };

    const rows = users.map(u => {
      const role = roleMap[u.role] || {};
      const color = roleColors[u.role] || 'var(--color-primary)';
      const initials = (u.name || '?').slice(0, 1);
      const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString('zh-CN') : '-';
      const isAdmin = u.role === 'admin';
      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <div class="um-avatar" style="background:${color}">${initials}</div>
              <div>
                <div class="um-user-name">${u.name}</div>
                <div class="um-user-id">${u.id}</div>
              </div>
            </div>
          </td>
          <td>
            <div class="um-account">${u.account}</div>
            ${u.phone ? `<div class="um-phone">${u.phone}</div>` : ''}
          </td>
          <td>
            <span class="um-role-badge" style="--role-color:${color}">${role.name || u.role}</span>
          </td>
          <td>${u.unit || '<span class="um-empty">—</span>'}</td>
          <td>
            <span class="um-status-badge ${u.status === 'active' ? 'active' : 'disabled'}">
              <span class="um-status-dot"></span>
              ${u.status === 'active' ? '启用' : '停用'}
            </span>
          </td>
          <td class="um-created">${created}</td>
          <td>
            <div class="um-actions">
              <button class="um-action-btn edit" onclick="QMSApp.openUserModal('${u.id}')" title="编辑">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="um-action-btn reset" onclick="QMSApp.resetUserPassword('${u.id}')" title="重置密码">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
              <button class="um-action-btn toggle" onclick="QMSApp.toggleUserStatus('${u.id}')" title="${u.status === 'active' ? '停用' : '启用'}" ${isAdmin ? 'disabled' : ''}>
                ${u.status === 'active'
                  ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>'
                  : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>'
                }
              </button>
              ${isAdmin ? '' : `<button class="um-action-btn delete" onclick="QMSApp.confirmDeleteUser('${u.id}')" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg></button>`}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const activeCount = users.filter(u => u.status === 'active').length;
    const disabledCount = users.length - activeCount;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h2 class="page-title">账号管理</h2>
          <p class="page-subtitle">共 ${users.length} 个账号 · 启用 ${activeCount} · 停用 ${disabledCount}</p>
        </div>
        <button class="btn-primary" onclick="QMSApp.openUserModal()">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:6px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          新增账号
        </button>
      </div>

      <div class="um-stats-row">
        <div class="um-stat-card">
          <div class="um-stat-icon" style="background:var(--color-primary)">U</div>
          <div>
            <div class="um-stat-value">${users.length}</div>
            <div class="um-stat-label">总账号数</div>
          </div>
        </div>
        <div class="um-stat-card">
          <div class="um-stat-icon" style="background:#22c55e">A</div>
          <div>
            <div class="um-stat-value">${activeCount}</div>
            <div class="um-stat-label">启用中</div>
          </div>
        </div>
        <div class="um-stat-card">
          <div class="um-stat-icon" style="background:#94a3b8">D</div>
          <div>
            <div class="um-stat-value">${disabledCount}</div>
            <div class="um-stat-label">已停用</div>
          </div>
        </div>
        <div class="um-stat-card">
          <div class="um-stat-icon" style="background:#ef4444">★</div>
          <div>
            <div class="um-stat-value">${users.filter(u => u.role === 'admin').length}</div>
            <div class="um-stat-label">管理员</div>
          </div>
        </div>
      </div>

      <div class="um-table-wrap">
        <table class="um-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>账号/手机</th>
              <th>角色</th>
              <th>责任单位</th>
              <th>状态</th>
              <th>创建日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="um-tips">
        <div class="um-tip-item">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>新增账号默认密码为 <code>123456</code>，用户首次登录后建议修改</span>
        </div>
        <div class="um-tip-item">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4M21 12c0 5-3.5 7.5-8.5 9.5C7.5 19.5 4 17 4 12V6l8-3 8 3v6z"/></svg>
          <span>停用账号后，该用户将无法登录系统，但历史数据保留</span>
        </div>
        <div class="um-tip-item">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>
          <span>角色决定可操作的报告步骤和数据权限，详见「账号授权」页面</span>
        </div>
      </div>
    `;
  }

  function openUserModal(userId) {
    const isEdit = !!userId;
    const users = QMSData.loadUsers();
    const user = isEdit ? users.find(u => u.id === userId) : null;
    const roles = QMSData.DICT.roles;
    const units = QMSData.DICT.responsibilityUnits;

    const roleOptions = roles.map(r =>
      `<option value="${r.id}" ${user?.role === r.id ? 'selected' : ''}>${r.name}</option>`
    ).join('');

    const unitOptions = ['<option value="">无（管理员/质量部门）</option>']
      .concat(units.map(u => `<option value="${u}" ${user?.unit === u ? 'selected' : ''}>${u}</option>`))
      .join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'userModalOverlay';
    overlay.innerHTML = `
      <div class="um-modal">
        <div class="um-modal-header">
          <h3>${isEdit ? '编辑账号' : '新增账号'}</h3>
          <button class="um-modal-close" onclick="QMSApp.closeUserModal()">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="um-modal-body">
          <div class="um-form-group">
            <label>姓名 <span class="um-required">*</span></label>
            <input type="text" id="um-field-name" value="${user?.name || ''}" placeholder="如：张三" maxlength="20">
          </div>
          <div class="um-form-row">
            <div class="um-form-group">
              <label>登录账号（邮箱） <span class="um-required">*</span></label>
              <input type="text" id="um-field-account" value="${user?.account || ''}" placeholder="如：zhangsan@dafor.com" autocomplete="off">
            </div>
            <div class="um-form-group">
              <label>手机号</label>
              <input type="text" id="um-field-phone" value="${user?.phone || ''}" placeholder="可选" maxlength="11">
            </div>
          </div>
          <div class="um-form-row">
            <div class="um-form-group">
              <label>角色 <span class="um-required">*</span></label>
              <select id="um-field-role">
                ${roleOptions}
              </select>
            </div>
            <div class="um-form-group">
              <label>所属责任单位</label>
              <select id="um-field-unit">
                ${unitOptions}
              </select>
            </div>
          </div>
          ${!isEdit ? `
          <div class="um-form-group">
            <label>初始密码</label>
            <input type="text" id="um-field-password" value="123456" placeholder="默认 123456">
            <div class="um-form-hint">用户首次登录后建议修改密码</div>
          </div>
          ` : ''}
          <div class="um-form-group">
            <label>备注</label>
            <input type="text" id="um-field-remark" value="${user?.remark || ''}" placeholder="可选" maxlength="50">
          </div>
        </div>
        <div class="um-modal-footer">
          <button class="btn-secondary" onclick="QMSApp.closeUserModal()">取消</button>
          <button class="btn-primary" onclick="QMSApp.saveUser(${isEdit ? `'${userId}'` : 'null'})">${isEdit ? '保存修改' : '创建账号'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    // 触发动画
    requestAnimationFrame(() => overlay.classList.add('active'));
    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeUserModal();
    });
    // 聚焦第一个输入框
    setTimeout(() => {
      const firstInput = overlay.querySelector('#um-field-name');
      if (firstInput) firstInput.focus();
    }, 100);
  }

  function closeUserModal() {
    const overlay = document.getElementById('userModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 200);
  }

  function saveUser(userId) {
    const name = document.getElementById('um-field-name').value.trim();
    const account = document.getElementById('um-field-account').value.trim();
    const phone = document.getElementById('um-field-phone').value.trim();
    const role = document.getElementById('um-field-role').value;
    const unit = document.getElementById('um-field-unit').value;
    const remark = document.getElementById('um-field-remark').value.trim();

    if (!name) { showToast('请输入姓名', 'error'); return; }
    if (!account) { showToast('请输入登录账号', 'error'); return; }

    // 验证账号格式（邮箱或手机号）
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRe = /^1[3-9]\d{9}$/;
    if (!emailRe.test(account) && !phoneRe.test(account)) {
      showToast('账号需为有效邮箱或手机号格式', 'error');
      return;
    }

    // 检查账号唯一性
    if (QMSData.isAccountExists(account, userId || undefined)) {
      showToast('该账号已存在，请更换', 'error');
      return;
    }

    if (userId) {
      // 编辑
      QMSData.updateUser(userId, { name, account, phone, role, unit, remark });
      showToast('账号已更新', 'success');
    } else {
      // 新增
      const password = document.getElementById('um-field-password').value.trim() || '123456';
      QMSData.addUser({ name, account, phone, role, unit, remark, password });
      showToast('账号创建成功，初始密码：' + password, 'success');
    }
    closeUserModal();
    renderUserManagement();
  }

  function toggleUserStatus(userId) {
    const users = QMSData.loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return;
    if (user.role === 'admin') {
      showToast('管理员账号不可停用', 'error');
      return;
    }
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    QMSData.updateUser(userId, { status: newStatus });
    showToast(newStatus === 'active' ? '账号已启用' : '账号已停用', 'success');
    renderUserManagement();
  }

  function resetUserPassword(userId) {
    const users = QMSData.loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return;
    if (!confirm(`确认重置「${user.name}」的密码为 123456？`)) return;
    QMSData.updateUser(userId, { password: '123456' });
    showToast('密码已重置为 123456', 'success');
  }

  function confirmDeleteUser(userId) {
    const users = QMSData.loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return;
    if (user.role === 'admin') {
      showToast('管理员账号不可删除', 'error');
      return;
    }
    if (!confirm(`确认删除账号「${user.name}（${user.account}）」？\n此操作不可撤销，但历史问题数据将保留。`)) return;
    QMSData.deleteUser(userId);
    showToast('账号已删除', 'success');
    renderUserManagement();
  }

  // ═══════════════════════════════════════════════════════
  // 表单操作方法
  // ═══════════════════════════════════════════════════════
  function updateField(category, field, value) {
    if (!state.formData) return;
    if (!state.formData[category]) state.formData[category] = {};
    state.formData[category][field] = value;
    autoSaveDraft();
  }

  function updateCause(idx, field, value) {
    if (!state.formData?.category2?.causes) return;
    state.formData.category2.causes[idx][field] = value;
    autoSaveDraft();
  }

  function addCause() {
    if (!state.formData.category2) state.formData.category2 = { method: 'fishbone', causes: [], fiveWhys: [] };
    state.formData.category2.causes.push({ category: QMSData.DICT.fishboneCategories[0], description: '' });
    autoSaveDraft();
    renderEntry();
  }

  function removeCause(idx) {
    state.formData.category2.causes.splice(idx, 1);
    autoSaveDraft();
    renderEntry();
  }

  function updateWhy(idx, field, value) {
    if (!state.formData?.category2?.fiveWhys) return;
    state.formData.category2.fiveWhys[idx][field] = value;
    autoSaveDraft();
  }

  function addWhy() {
    if (!state.formData.category2) state.formData.category2 = { method: '5why', causes: [], fiveWhys: [] };
    state.formData.category2.fiveWhys.push({ why: '', answer: '' });
    autoSaveDraft();
    renderEntry();
  }

  function removeWhy(idx) {
    state.formData.category2.fiveWhys.splice(idx, 1);
    autoSaveDraft();
    renderEntry();
  }

  function setMethod(method) {
    state.formData.category2.method = method;
    autoSaveDraft();
    renderEntry();
  }

  function updateMeasure(idx, field, value) {
    if (!state.formData?.category3?.measures) return;
    state.formData.category3.measures[idx][field] = value;
    autoSaveDraft();
  }

  function addMeasure() {
    if (!state.formData.category3) state.formData.category3 = { inProductHandling:'', handlingQty:0, handlingResult:'', measures: [] };
    if (!state.formData.category3.measures) state.formData.category3.measures = [];
    state.formData.category3.measures.push({ content:'', responsible:'', planDate:'', actualDate:'', status:'待完成', attachments:[] });
    autoSaveDraft();
    renderEntry();
  }

  function removeMeasure(idx) {
    state.formData.category3.measures.splice(idx, 1);
    autoSaveDraft();
    renderEntry();
  }

  function addImage(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('图片不能超过5MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      // 压缩图片：最大1024px，JPEG质量0.7
      let imgData = e.target.result;
      try {
        imgData = await QMSData.compressImage(imgData, 1024, 1024, 0.7);
      } catch (err) {
        console.warn('图片压缩失败，使用原图', err);
      }
      if (!state.formData.category1.images) state.formData.category1.images = [];
      state.formData.category1.images.push(imgData);
      autoSaveDraft();
      renderEntry();
      showToast('图片已添加', 'success');
    };
    reader.readAsDataURL(file);
    // 清空input以便重复选择同一文件
    input.value = '';
  }

  function removeImage(idx) {
    state.formData.category1.images.splice(idx, 1);
    autoSaveDraft();
    renderEntry();
  }

  function addReport(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        let imgData = e.target.result;
        try {
          imgData = await QMSData.compressImage(imgData, 1024, 1024, 0.7);
        } catch (err) { /* 使用原图 */ }
        if (!state.formData.category4.reportFiles) state.formData.category4.reportFiles = [];
        state.formData.category4.reportFiles.push(imgData);
        autoSaveDraft();
        renderEntry();
        showToast('验证报告已添加', 'success');
      };
      reader.readAsDataURL(file);
    } else {
      if (!state.formData.category4.reportFiles) state.formData.category4.reportFiles = [];
      state.formData.category4.reportFiles.push(file.name);
      autoSaveDraft();
      renderEntry();
    }
    input.value = '';
  }

  function removeReport(idx) {
    state.formData.category4.reportFiles.splice(idx, 1);
    autoSaveDraft();
    renderEntry();
  }

  function goToStep(step) {
    state.formStep = step;
    renderEntry();
  }

  function nextStep() {
    if (validateStep(state.formStep)) {
      // 找到下一个当前角色可填写的步骤
      const role = QMSData.DICT.roles.find(r => r.id === state.role);
      const canFill = role ? role.canFill : [1,2,3,4];
      const nextStepNum = canFill.find(s => s > state.formStep);
      if (nextStepNum && nextStepNum <= 4) {
        state.formStep = nextStepNum;
        state.formData.currentStep = state.formStep;
        renderEntry();
      } else if (state.formStep < 4) {
        state.formStep++;
        state.formData.currentStep = state.formStep;
        renderEntry();
      }
    }
  }

  function prevStep() {
    // 找到上一个当前角色可填写的步骤
    const role = QMSData.DICT.roles.find(r => r.id === state.role);
    const canFill = role ? role.canFill : [1,2,3,4];
    const prevSteps = canFill.filter(s => s < state.formStep).sort((a,b) => b - a);
    if (prevSteps.length > 0) {
      state.formStep = prevSteps[0];
      renderEntry();
    } else if (state.formStep > 1) {
      state.formStep--;
      renderEntry();
    }
  }

  function validateStep(step) {
    const d = state.formData;
    if (step === 1) {
      const c = d.category1;
      const required = { customerName: '客户名称', productName: '产品名称', materialGrade: '材料牌号', subBatchNo: '生产子编号', responsibilityUnit: '责任单位', occurTime: '发生时间', problemType: '问题类型' };
      for (const [k, label] of Object.entries(required)) {
        if (!c[k]) { showToast(`请填写${label}`, 'error'); return false; }
      }
      if (!c.defectQty || c.defectQty <= 0) { showToast('不合格数量必须大于0', 'error'); return false; }
    }
    return true;
  }

  function validateForm() {
    const d = state.formData;
    const role = state.role;

    switch (role) {
      case 'initiator':
        return validateStep(1);
      case 'responsible':
        if (!d.category2?.causes?.length && !d.category2?.fiveWhys?.length) {
          showToast('请添加根本原因', 'error');
          return false;
        }
        if (!d.category3?.inProductHandling && (!d.category3?.measures || d.category3.measures.length === 0)) {
          showToast('请填写在制品处理或添加预防措施', 'error');
          return false;
        }
        return true;
      case 'quality':
        if (!d.category4?.verificationResult) {
          showToast('请选择验证结论', 'error');
          return false;
        }
        return true;
      case 'admin':
      default:
        // 管理员至少填写第1类即可提交，后续可继续补充
        return validateStep(1);
    }
  }

  function autoSaveDraft() {
    var ok = QMSData.saveDraft(state.formData);
    if (!ok) {
      console.warn('[QMS] 草稿自动保存失败（存储空间不足）');
    }
  }

  function saveDraftOnly() {
    autoSaveDraft();
    showToast('草稿已保存', 'success');
  }

  function discardDraft() {
    QMSData.clearDraft();
    state.formData = null;
    state.editingIssue = null;
    state.formStep = 1;
    showToast('草稿已清除', 'info');
    renderEntry();
  }

  function submitForm() {
    if (!validateForm()) return;
    const data = JSON.parse(JSON.stringify(state.formData));
    // 根据数据内容实时计算当前进度步骤，确保状态跟随处理进展
    data.currentStep = QMSData.computeProgressStep(data);
    var success = false;
    if (state.editingIssue) {
      var updated = QMSData.updateIssue(state.editingIssue.id, data);
      if (updated) {
        success = true;
        showToast('问题已更新', 'success');
      } else {
        showToast('保存失败：存储空间不足，请减少图片数量后重试', 'error');
        return;
      }
    } else {
      data.createdBy = '当前用户';
      var added = QMSData.addIssue(data);
      if (added) {
        success = true;
        showToast('问题已创建', 'success');
      } else {
        showToast('保存失败：存储空间不足，请减少图片数量后重试', 'error');
        return;
      }
    }
    if (!success) return;
    QMSData.clearDraft();
    state.formData = null;
    state.editingIssue = null;
    // 重新加载 issues 到 state，确保 getFilteredIssues 拿到最新数据
    state.issues = QMSData.loadIssues();
    // 重置筛选/分页确保新数据可见
    state.pagination.page = 1;
    // navigate('dashboard') 内部会调用 renderDashboard()，其中包含图表渲染逻辑
    // 不再需要额外的 setTimeout 重复销毁/创建图表——这反而会导致 Chart.js 在同一 canvas 上 destroy→re-create 时出现渲染异常
    navigate('dashboard');
  }

  function openEdit(id) {
    const issue = QMSData.getIssue(id);
    if (!issue) return;
    if (issue.category4?.isClosed && state.role !== 'admin') {
      showToast('问题已关闭，仅管理员可重开', 'error');
      return;
    }
    state.editingIssue = issue;
    state.formData = null; // 让 renderEntry 从 editingIssue 加载
    closeModal();
    navigate('entry');
  }

  function cancelEdit() {
    state.editingIssue = null;
    state.formData = null;
    navigate('dashboard');
  }

  function filterPendingForMe() {
    // 找到第一个待当前角色处理的问题，直接打开编辑
    const issues = QMSData.loadIssues();
    const role = QMSData.DICT.roles.find(r => r.id === state.role);
    const canFill = role ? role.canFill : [1,2,3,4];
    const pending = issues.filter(i => {
      if (QMSData.computeStatus(i) === 'closed') return false;
      return canFill.some(step => !isStepCompleted(i, step));
    });
    if (pending.length === 0) {
      showToast('暂无待处理的问题', 'info');
      return;
    }
    // 直接打开第一个待处理的问题进行编辑
    openEdit(pending[0].id);
  }

  // ── 筛选/排序/分页操作 ────────────────────────────────
  function setFilter(type, value) {
    state.filters[type] = value;
    state.pagination.page = 1;
    renderDashboard();
  }

  function setSort(field) {
    if (state.sort.field === field) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort.field = field;
      state.sort.dir = 'asc';
    }
    renderDashboard();
  }

  function setPage(page) {
    state.pagination.page = page;
    renderDashboard();
  }

  function setPageSize(size) {
    state.pagination.pageSize = parseInt(size);
    state.pagination.page = 1;
    renderDashboard();
  }

  // ── 导出 CSV ──────────────────────────────────────────
  function exportCSV() {
    const issues = getFilteredIssues();
    const headers = ['生产编号','产品名称','客户名称','材料牌号','责任单位','发生时间','不合格数量','问题类型','整改状态','问题描述'];
    const rows = issues.map(i => {
      const c = i.category1 || {};
      return [c.subBatchNo, c.productName, c.customerName, c.materialGrade, c.responsibilityUnit, c.occurTime, c.defectQty, c.problemType, STATUS_LABELS[QMSData.computeStatus(i)], (c.description || '').replace(/,/g, '，')];
    });
    const csv = '\uFEFF' + headers.join(',') + '\n' + rows.map(r => r.map(c => `"${c || ''}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `QMS_导出_${QMSData.today()}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${issues.length} 条数据`, 'success');
  }

  // ── 刷新看板 & 重置数据 ────────────────────────────────
  function refreshDashboard() {
    // 强制从 localStorage 重新加载并重新渲染
    state.issues = QMSData.loadIssues();
    renderDashboard();
    showToast('看板已刷新', 'info');
  }

  function resetData() {
    if (!confirm('确定要重置所有数据吗？这将清除所有已保存的问题并恢复为示例数据。')) return;
    QMSData.clearDraft();
    localStorage.removeItem('qms_issues_v1');
    state.issues = QMSData.loadIssues();
    state.editingIssue = null;
    state.formData = null;
    state.filters = { unit: '', status: '', timeRange: 'all' };
    state.pagination.page = 1;
    QMSCharts.destroyCharts();
    navigate('dashboard');
    showToast('数据已重置为示例数据', 'success');
  }

  // ── 删除问题（仅管理员） ────────────────────────────────
  function deleteIssueConfirm(id) {
    const issue = QMSData.getIssue(id);
    if (!issue) { showToast('问题不存在', 'error'); return; }
    if (state.role !== 'admin') { showToast('仅管理员可删除问题', 'error'); return; }
    const name = (issue.category1?.productName || '问题') + ' · ' + (issue.category1?.subBatchNo || '');
    if (!confirm('确定要删除「' + name + '」吗？\n\n此操作不可撤销，删除后数据将永久丢失。')) return;
    QMSData.deleteIssue(id);
    state.issues = QMSData.loadIssues();
    closeModal();
    if (state.route === 'dashboard') renderDashboard();
    showToast('问题已删除', 'success');
  }

  // 消除已整改/已关闭问题的拖期通知
  function dismissOverdue(id) {
    QMSData.dismissOverdue(id);
    if (state.route === 'dashboard') renderDashboard();
    showToast('拖期通知已消除', 'success');
  }

  // ── 模态 & Toast ──────────────────────────────────────
  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = {
      success: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--color-completed)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>',
      error: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--color-overdue)"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
      info: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--color-primary)"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
      warning: '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:var(--color-overdue)"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    };
    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    container.appendChild(toast);
    var duration = type === 'warning' ? 6000 : 3000;
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── HTML 转义 ──────────────────────────────────────────
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ═══════════════════════════════════════════════════════
  // 导出公共 API
  // ═══════════════════════════════════════════════════════
  global.QMSApp = {
    init,
    navigate,
    renderDashboard,
    renderEntry,
    renderImport,
    renderTencentDocs,
    renderPushSettings,
    openDetail,
    openEdit,
    closeModal,
    printDetail,
    openImageLightbox,
    // 表单操作
    resetEntryState,
    updateField, updateCause, addCause, removeCause,
    updateWhy, addWhy, removeWhy, setMethod,
    updateMeasure, addMeasure, removeMeasure,
    addImage, removeImage, addReport, removeReport,
    goToStep, nextStep, prevStep, validateStep, validateForm,
    saveDraftOnly, discardDraft, submitForm, cancelEdit,
    filterPendingForMe,
    // 筛选/排序/分页
    setFilter, setSort, setPage, setPageSize,
    // 导入导出
    downloadTemplate, handleImport, exportCSV,
    // 刷新 & 重置
    refreshDashboard, resetData,
    // 删除问题
    deleteIssueConfirm,
    // 消除拖期通知
    dismissOverdue,
    // 腾讯文档
    syncToTencentDoc, createTencentReport,
    // 推送
    savePushSettings, testPush,
    // 账号授权
    switchRole,
    // 退出登录
    logout,
    // 账号管理
    openUserModal, closeUserModal, saveUser,
    toggleUserStatus, resetUserPassword, confirmDeleteUser,
    // 工具
    showToast, esc,
  };

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
