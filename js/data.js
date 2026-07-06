/**
 * QMS 数据层 — 数据模型、内存缓存 + 服务端同步
 * 保持同步读取接口（从内存缓存读取），写入时同步更新缓存并异步发送到服务器
 */
(function (global) {
  'use strict';

  // ── API 基础路径 ──────────────────────────────────────
  const API_BASE = '/api';

  // ── 内存缓存 ──────────────────────────────────────────
  let _issuesCache = [];
  let _usersCache = [];
  let _dismissedCache = [];
  let _draftCache = null;
  let _initialized = false;
  let _offlineMode = false; // 离线模式标记

  // ── 离线模式 localStorage 工具 ──────────────────────
  const LS_KEYS = {
    issues: 'qms_offline_issues',
    users: 'qms_offline_users',
    dismissed: 'qms_offline_dismissed',
    draft: 'qms_offline_draft',
  };

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota */ }
  }

  // ── 字典数据 ──────────────────────────────────────────
  const DICT = {
    responsibilityUnits: ['大锻技术中心', '大锻锻造车间', '外协机加工'],
    problemTypes: ['尺寸NCR', '外观NCR', '管理NCR', '性能NCR'],
    inProductHandling: ['报废', '返工', '让步接收', '挑选使用'],
    verificationResults: ['有效', '部分有效', '无效', '待验证'],
    measureStatus: ['待完成', '已完成', '已关闭'],
    roles: [
      { id: 'initiator', name: '发起者（检验员）', canFill: [1], canDelete: false, canExport: false, canViewAll: true, canManageUsers: false, canSyncDocs: false, canPush: false, desc: '负责发现并录入质量问题，填写问题描述信息' },
      { id: 'responsible', name: '责任单位', canFill: [2, 3], canDelete: false, canExport: false, canViewAll: true, canManageUsers: false, canSyncDocs: false, canPush: false, desc: '负责根因分析与纠正措施制定执行（大锻技术中心、大锻锻造车间、外协机加工）' },
      { id: 'quality', name: '质量部门（质量经理）', canFill: [4], canDelete: false, canExport: true, canViewAll: true, canManageUsers: false, canSyncDocs: true, canPush: true, desc: '负责效果验证、关闭归档，可导出数据和同步腾讯文档' },
      { id: 'admin', name: '管理员', canFill: [1, 2, 3, 4], canDelete: true, canExport: true, canViewAll: true, canManageUsers: true, canSyncDocs: true, canPush: true, desc: '系统管理员，拥有全部权限，可删除问题、管理账号' },
    ],
    fishboneCategories: ['人 (Man)', '机 (Machine)', '料 (Material)', '法 (Method)', '环 (Environment)', '测 (Measurement)'],
  };

  // ── 工具函数 ──────────────────────────────────────────
  function uid() {
    return 'QMS-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function today(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function now() {
    return new Date().toISOString();
  }

  function daysBetween(dateStr1, dateStr2) {
    const d1 = new Date(dateStr1);
    const d2 = new Date(dateStr2);
    return Math.round((d2 - d1) / 86400000);
  }

  // ── API 请求工具 ──────────────────────────────────────
  async function apiGet(path) {
    const res = await fetch(API_BASE + path);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '请求失败');
    return json.data;
  }

  async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '请求失败');
    return json.data;
  }

  async function apiPut(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '请求失败');
    return json.data;
  }

  async function apiDelete(path) {
    const res = await fetch(API_BASE + path, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '请求失败');
    return true;
  }

  // ── 初始化：从服务器加载全部数据到缓存 ──────────────────
  async function init() {
    if (_initialized) return;
    try {
      const [issues, users, dismissed, draft] = await Promise.all([
        apiGet('/issues'),
        apiGet('/users'),
        apiGet('/dismissed'),
        apiGet('/draft'),
      ]);
      _issuesCache = issues || [];
      _usersCache = users || [];
      _dismissedCache = dismissed || [];
      _draftCache = draft;
      _offlineMode = false;
      _initialized = true;
      console.log('[QMS] 数据已从服务器加载:', { issues: _issuesCache.length, users: _usersCache.length, dismissed: _dismissedCache.length });
      return true;
    } catch (e) {
      console.warn('[QMS] 服务器连接失败，启用本地降级模式:', e.message);
      _offlineMode = true;
      // 优先从 localStorage 加载离线数据
      const lsIssues = lsGet(LS_KEYS.issues);
      const lsDismissed = lsGet(LS_KEYS.dismissed);
      const lsDraft = lsGet(LS_KEYS.draft);
      if (lsIssues && Array.isArray(lsIssues) && lsIssues.length > 0) {
        _issuesCache = lsIssues;
        _dismissedCache = lsDismissed || [];
        _draftCache = lsDraft;
        console.log('[QMS] 已从本地存储恢复离线数据:', { issues: _issuesCache.length });
      } else {
        // 首次离线 — 使用模拟数据
        _issuesCache = generateMockData();
        _dismissedCache = [];
        _draftCache = null;
        lsSet(LS_KEYS.issues, _issuesCache);
      }
      // 离线用户列表
      _usersCache = [
        { id: 'USR-ADMIN', name: '系统管理员', account: 'admin@dafor.com', phone: '13800000001', password: '123456', role: 'admin', unit: '', status: 'active', remark: '默认管理员账号' },
        { id: 'USR-QUALITY', name: '张质量', account: 'quality@dafor.com', phone: '13800000002', password: '123456', role: 'quality', unit: '', status: 'active', remark: '质量部门' },
        { id: 'USR-FORGE', name: '李锻造', account: 'forge@dafor.com', phone: '13800000003', password: '123456', role: 'responsible', unit: '大锻锻造车间', status: 'active', remark: '锻造车间责任人' },
        { id: 'USR-TECH', name: '王技术', account: 'tech@dafor.com', phone: '13800000004', password: '123456', role: 'responsible', unit: '大锻技术中心', status: 'active', remark: '技术中心责任人' },
        { id: 'USR-OUT', name: '赵外协', account: 'outsource@dafor.com', phone: '13800000005', password: '123456', role: 'responsible', unit: '外协机加工', status: 'active', remark: '外协机加工责任人' },
        { id: 'USR-INIT', name: '孙检验员', account: 'jianyan@dafor.com', phone: '13800000006', password: '123456', role: 'initiator', unit: '大锻锻造车间', status: 'active', remark: '锻造车间检验员' },
      ];
      _initialized = true;
      return false;
    }
  }

  // 手动从服务器刷新缓存
  async function syncFromServer() {
    try {
      const [issues, users, dismissed, draft] = await Promise.all([
        apiGet('/issues'),
        apiGet('/users'),
        apiGet('/dismissed'),
        apiGet('/draft'),
      ]);
      _issuesCache = issues || [];
      _usersCache = users || [];
      _dismissedCache = dismissed || [];
      _draftCache = draft;
      _offlineMode = false; // 服务器恢复，切换回在线模式
      console.log('[QMS] 数据已从服务器刷新，已切换为在线模式');
      return true;
    } catch (e) {
      console.error('[QMS] 刷新失败:', e.message);
      _offlineMode = true; // 标记离线
      return false;
    }
  }

  function isOffline() {
    return _offlineMode;
  }

  // ── 判断某一步骤是否已完成（基于数据内容） ──────────────
  function isStepDone(issue, step) {
    switch (step) {
      case 1:
        return !!(issue.category1?.customerName && issue.category1?.productName && issue.category1?.defectQty > 0);
      case 2:
        return !!((issue.category2?.causes && issue.category2.causes.length > 0) ||
                   (issue.category2?.fiveWhys && issue.category2.fiveWhys.length > 0));
      case 3:
        return !!((issue.category3?.measures && issue.category3.measures.length > 0) ||
                   issue.category3?.inProductHandling);
      case 4:
        return !!(issue.category4?.verificationResult && issue.category4.verificationResult !== '待验证');
      default:
        return false;
    }
  }

  // ── 计算当前处理进度步骤（1-4） ──────────────────────────
  function computeProgressStep(issue) {
    if (isStepDone(issue, 4)) return 4;
    if (isStepDone(issue, 3)) return 4;
    if (isStepDone(issue, 2)) return 3;
    if (isStepDone(issue, 1)) return 2;
    return 1;
  }

  // ── 计算整改状态（跟随处理进展实时更新） ──────────────────
  function computeStatus(issue) {
    if (issue.category4?.isClosed) return 'closed';
    if (isStepDone(issue, 4)) return 'completed';
    const measures = issue.category3?.measures || [];
    const todayStr = today();
    const overdue = measures.some(m =>
      m.status === '待完成' && m.planDate && daysBetween(m.planDate, todayStr) > 0
    );
    if (overdue) return 'overdue';
    if (isStepDone(issue, 3)) return 'in_progress';
    if (isStepDone(issue, 2)) return 'in_progress';
    if (isStepDone(issue, 1)) return 'in_progress';
    return 'not_started';
  }

  function computeOverdueDays(issue) {
    const measures = issue.category3?.measures || [];
    const todayStr = today();
    let maxOverdue = 0;
    for (const m of measures) {
      if (m.status === '待完成' && m.planDate) {
        const days = daysBetween(m.planDate, todayStr);
        if (days > 0) maxOverdue = Math.max(maxOverdue, days);
      }
    }
    return maxOverdue;
  }

  function computeWasOverdueDays(issue) {
    const measures = issue.category3?.measures || [];
    const todayStr = today();
    let maxOverdue = 0;
    for (const m of measures) {
      if (m.planDate) {
        const days = daysBetween(m.planDate, todayStr);
        if (days > 0) maxOverdue = Math.max(maxOverdue, days);
      }
    }
    return maxOverdue;
  }

  // ── 拖期通知消除管理 ──────────────────────────────────
  function loadDismissedOverdue() {
    return [..._dismissedCache];
  }

  function saveDismissedOverdue(ids) {
    _dismissedCache = [...ids];
    if (_offlineMode) {
      lsSet(LS_KEYS.dismissed, _dismissedCache);
      return true;
    }
    // 同步到服务器（fire and forget）
    apiPost('/dismissed/batch', { ids }).catch(e => console.warn('[QMS] 拖期消除状态同步失败:', e.message));
    return true;
  }

  function dismissOverdue(id) {
    if (!_dismissedCache.includes(id)) {
      _dismissedCache.push(id);
      if (_offlineMode) {
        lsSet(LS_KEYS.dismissed, _dismissedCache);
        return;
      }
      apiPost('/dismissed', { id }).catch(e => console.warn('[QMS] 拖期消除同步失败:', e.message));
    }
  }

  function isOverdueDismissed(id) {
    return _dismissedCache.includes(id);
  }

  // ── 用户账号管理 ─────────────────────────────────────
  function loadUsers() {
    return [..._usersCache];
  }

  function saveUsers(users) {
    _usersCache = [...users];
    return true;
  }

  function addUser(data) {
    const user = {
      id: 'USR-' + Date.now().toString(36).toUpperCase().slice(-6),
      name: data.name || '',
      account: data.account || '',
      phone: data.phone || '',
      password: data.password || '123456',
      role: data.role || 'initiator',
      unit: data.unit || '',
      status: 'active',
      createdAt: new Date().toISOString(),
      remark: data.remark || '',
    };
    _usersCache.push(user);
    if (_offlineMode) {
      lsSet(LS_KEYS.users, _usersCache);
      return user;
    }
    apiPost('/users', user).catch(e => {
      console.error('[QMS] 用户保存到服务器失败:', e.message);
    });
    return user;
  }

  function updateUser(id, data) {
    const idx = _usersCache.findIndex(u => u.id === id);
    if (idx === -1) return false;
    const allowed = ['name', 'account', 'phone', 'password', 'role', 'unit', 'status', 'remark'];
    allowed.forEach(k => {
      if (data[k] !== undefined) _usersCache[idx][k] = data[k];
    });
    if (_offlineMode) {
      lsSet(LS_KEYS.users, _usersCache);
      return true;
    }
    apiPut('/users/' + id, data).catch(e => {
      console.error('[QMS] 用户更新到服务器失败:', e.message);
    });
    return true;
  }

  function deleteUser(id) {
    _usersCache = _usersCache.filter(u => u.id !== id);
    if (_offlineMode) {
      lsSet(LS_KEYS.users, _usersCache);
      return true;
    }
    apiDelete('/users/' + id).catch(e => {
      console.error('[QMS] 用户删除同步失败:', e.message);
    });
    return true;
  }

  function getUserByAccount(account) {
    return _usersCache.find(u => u.account === account || u.phone === account);
  }

  function validateLogin(account, password) {
    const user = getUserByAccount(account);
    if (!user) return { success: false, error: '账号不存在' };
    if (user.status !== 'active') return { success: false, error: '账号已被停用，请联系管理员' };
    if (user.password !== password) return { success: false, error: '账号或密码错误' };
    return { success: true, user };
  }

  function isAccountExists(account, excludeId) {
    return _usersCache.some(u =>
      (u.account === account || u.phone === account) && u.id !== excludeId
    );
  }

  // ── 模拟数据 ──────────────────────────────────────────
  function generateMockData() {
    return [
      {
        id: uid(),
        category1: {
          customerName: '中船重工',
          productName: '船用大型曲轴',
          materialGrade: '42CrMo',
          subBatchNo: 'SC-2024-0612-01',
          responsibilityUnit: '大锻锻造车间',
          occurTime: '2026-06-20',
          defectQty: 12,
          problemType: '尺寸NCR',
          description: '曲轴法兰部位直径偏大 3mm，超出公差范围 ±1mm。经初步测量，批次内 12 件均存在相同问题，疑似模具磨损导致。',
          images: [],
        },
        category2: {
          method: 'fishbone',
          causes: [
            { category: '机 (Machine)', description: '锻压机模具使用超过寿命周期，型腔磨损导致尺寸偏大' },
            { category: '法 (Method)', description: '模具更换周期未按实际产量动态调整，仍按固定时间更换' },
            { category: '人 (Man)', description: '操作工未在首件检验时发现尺寸偏差' },
          ],
          fiveWhys: [],
        },
        category3: {
          inProductHandling: '返工',
          handlingQty: 12,
          handlingResult: '12 件全部返工至合格尺寸，经检验合格',
          measures: [
            { content: '立即更换磨损模具，新模具上机前进行三坐标检测', responsible: '张工', planDate: '2026-06-25', actualDate: '2026-06-24', status: '已完成', attachments: [] },
            { content: '修订模具更换制度，引入基于产量的动态更换机制', responsible: '李主任', planDate: '2026-07-05', actualDate: '', status: '待完成', attachments: [] },
          ],
        },
        category4: { verificationResult: '部分有效', verificationMethod: '对新模具生产的 50 件产品进行全检，尺寸均在公差范围内。制度修订仍在进行中。', actualDate: '2026-06-25', status: '待完成', reportFiles: [], verifier: '王质检', verifyDate: '2026-06-25', isClosed: false },
        createdBy: '赵检验员',
        createdAt: '2026-06-20T08:30:00Z',
        updatedAt: '2026-06-25T10:00:00Z',
        currentStep: 4,
      },
      {
        id: uid(),
        category1: {
          customerName: '中国中车',
          productName: '高铁齿轮锻件',
          materialGrade: '20CrMnNb',
          subBatchNo: 'ZC-2024-0701-03',
          responsibilityUnit: '大锻锻造车间',
          occurTime: '2026-06-22',
          defectQty: 5,
          problemType: '性能NCR',
          description: '齿轮锻件淬火后硬度不均匀，心部硬度偏低 HRC 5-8 度，不满足技术要求 HRC 45-50。',
          images: [],
        },
        category2: {
          method: '5why',
          causes: [],
          fiveWhys: [
            { why: '为什么硬度不均匀？', answer: '淬火冷却速度不均匀' },
            { why: '为什么冷却速度不均匀？', answer: '淬火介质循环泵流量不足' },
            { why: '为什么循环泵流量不足？', answer: '泵体叶轮磨损，效率下降' },
            { why: '为什么叶轮磨损未发现？', answer: '设备点检未包含泵性能检测项' },
            { why: '为什么未包含泵性能检测？', answer: '点检标准制定时未考虑此风险' },
          ],
        },
        category3: {
          inProductHandling: '报废',
          handlingQty: 5,
          handlingResult: '5 件性能不合格产品报废处理',
          measures: [
            { content: '更换淬火介质循环泵，恢复冷却能力', responsible: '孙设备', planDate: '2026-06-28', actualDate: '2026-06-27', status: '已完成', attachments: [] },
            { content: '修订设备点检标准，增加循环泵流量检测项', responsible: '周技术', planDate: '2026-06-30', actualDate: '', status: '待完成', attachments: [] },
            { content: '对同批次库存产品进行硬度复检', responsible: '吴检验', planDate: '2026-06-26', actualDate: '2026-06-26', status: '已完成', attachments: [] },
          ],
        },
        category4: { verificationResult: '待验证', verificationMethod: '', actualDate: '', status: '待完成', reportFiles: [], verifier: '', verifyDate: '', isClosed: false },
        createdBy: '钱检验员',
        createdAt: '2026-06-22T14:00:00Z',
        updatedAt: '2026-06-27T09:00:00Z',
        currentStep: 4,
      },
      {
        id: uid(),
        category1: {
          customerName: '三一重工',
          productName: '挖掘机底盘轴',
          materialGrade: '40Cr',
          subBatchNo: 'SY-2024-0615-05',
          responsibilityUnit: '大锻锻造车间',
          occurTime: '2026-06-18',
          defectQty: 3,
          problemType: '外观NCR',
          description: '锻件表面出现折叠裂纹，长度约 15-20mm，分布于过渡圆角处。',
          images: [],
        },
        category2: {
          method: 'fishbone',
          causes: [
            { category: '法 (Method)', description: '锻造工艺圆角半径设计偏小，金属流动不畅形成折叠' },
            { category: '料 (Material)', description: '原材料表面存在微裂纹，锻造时扩展' },
          ],
          fiveWhys: [],
        },
        category3: {
          inProductHandling: '挑选使用',
          handlingQty: 3,
          handlingResult: '3 件裂纹产品挑出报废，其余批次产品继续使用',
          measures: [
            { content: '优化锻造工艺，增大过渡圆角半径 R5→R8', responsible: '郑工艺', planDate: '2026-06-25', actualDate: '2026-06-24', status: '已完成', attachments: [] },
            { content: '加强原材料入厂检验，增加表面裂纹探伤', responsible: '冯检验', planDate: '2026-06-23', actualDate: '2026-06-23', status: '已完成', attachments: [] },
          ],
        },
        category4: { verificationResult: '有效', verificationMethod: '优化工艺后连续生产 3 批次共 100 件，无折叠裂纹产生。原材料探伤实施后有效拦截 2 批次不合格材料。', actualDate: '2026-06-26', status: '已完成', reportFiles: [], verifier: '褚质量', verifyDate: '2026-06-26', isClosed: true },
        createdBy: '卫检验员',
        createdAt: '2026-06-18T10:00:00Z',
        updatedAt: '2026-06-26T16:00:00Z',
        currentStep: 4,
      },
      {
        id: uid(),
        category1: {
          customerName: '中船重工',
          productName: '船用大型曲轴',
          materialGrade: '42CrMo',
          subBatchNo: 'SC-2024-0620-02',
          responsibilityUnit: '大锻技术中心',
          occurTime: '2026-06-24',
          defectQty: 1,
          problemType: '管理NCR',
          description: '技术图纸版本与现场使用版本不一致，导致加工尺寸错误。',
          images: [],
        },
        category2: {
          method: '5why',
          causes: [],
          fiveWhys: [
            { why: '为什么图纸版本不一致？', answer: '技术中心更新图纸后未及时通知生产现场' },
            { why: '为什么未及时通知？', answer: '图纸变更通知流程依赖人工传递，无系统自动推送' },
            { why: '为什么无系统推送？', answer: 'PDM 系统与 MES 系统未集成' },
          ],
        },
        category3: {
          inProductHandling: '返工',
          handlingQty: 1,
          handlingResult: '按正确版本图纸返工',
          measures: [
            { content: '建立图纸变更自动通知机制，PDM 变更后自动推送 MES', responsible: '蒋IT', planDate: '2026-07-10', actualDate: '', status: '待完成', attachments: [] },
          ],
        },
        category4: { verificationResult: '待验证', verificationMethod: '', actualDate: '', status: '待完成', reportFiles: [], verifier: '', verifyDate: '', isClosed: false },
        createdBy: '沈检验员',
        createdAt: '2026-06-24T11:00:00Z',
        updatedAt: '2026-06-24T11:00:00Z',
        currentStep: 3,
      },
      {
        id: uid(),
        category1: {
          customerName: '徐工集团',
          productName: '起重机回转支承',
          materialGrade: '50Mn',
          subBatchNo: 'XG-2024-0610-08',
          responsibilityUnit: '外协机加工',
          occurTime: '2026-06-15',
          defectQty: 8,
          problemType: '尺寸NCR',
          description: '回转支承滚道直径超差 0.05mm，影响装配精度。',
          images: [],
        },
        category2: {
          method: 'fishbone',
          causes: [
            { category: '机 (Machine)', description: '数控车床刀具磨损，补偿未及时调整' },
            { category: '测 (Measurement)', description: '在线测量系统温漂，测量基准偏移' },
          ],
          fiveWhys: [],
        },
        category3: {
          inProductHandling: '返工',
          handlingQty: 8,
          handlingResult: '8 件返工至合格尺寸',
          measures: [
            { content: '更换刀具并调整补偿参数', responsible: '韩操作', planDate: '2026-06-17', actualDate: '2026-06-17', status: '已完成', attachments: [] },
            { content: '测量系统增加温控补偿功能', responsible: '杨设备', planDate: '2026-06-10', actualDate: '', status: '待完成', attachments: [] },
          ],
        },
        category4: { verificationResult: '待验证', verificationMethod: '', actualDate: '', status: '待完成', reportFiles: [], verifier: '', verifyDate: '', isClosed: false },
        createdBy: '朱检验员',
        createdAt: '2026-06-15T09:00:00Z',
        updatedAt: '2026-06-17T14:00:00Z',
        currentStep: 4,
      },
      {
        id: uid(),
        category1: {
          customerName: '中国中车',
          productName: '高铁齿轮锻件',
          materialGrade: '20CrMnNb',
          subBatchNo: 'ZC-2024-0625-01',
          responsibilityUnit: '外协机加工',
          occurTime: '2026-06-25',
          defectQty: 20,
          problemType: '外观NCR',
          description: '喷砂处理后表面粗糙度不均匀，局部区域有氧化皮残留。',
          images: [],
        },
        category2: { method: 'fishbone', causes: [], fiveWhys: [] },
        category3: { inProductHandling: '返工', handlingQty: 20, handlingResult: '', measures: [] },
        category4: { verificationResult: '待验证', verificationMethod: '', actualDate: '', status: '待完成', reportFiles: [], verifier: '', verifyDate: '', isClosed: false },
        createdBy: '秦检验员',
        createdAt: '2026-06-25T15:00:00Z',
        updatedAt: '2026-06-25T15:00:00Z',
        currentStep: 1,
      },
    ];
  }

  // ── Issues CRUD ──────────────────────────────────────
  function loadIssues() {
    return [..._issuesCache];
  }

  function stripImages(issues) {
    return issues.map(function (i) {
      var copy = JSON.parse(JSON.stringify(i));
      if (copy.category1 && copy.category1.images) copy.category1.images = [];
      if (copy.category3 && copy.category3.measures) {
        copy.category3.measures.forEach(function (m) {
          if (m.attachments) m.attachments = [];
        });
      }
      if (copy.category4 && copy.category4.reportFiles) copy.category4.reportFiles = [];
      return copy;
    });
  }

  function saveIssues(issues) {
    _issuesCache = [...issues];
    if (_offlineMode) {
      lsSet(LS_KEYS.issues, _issuesCache);
      return true;
    }
    // 同步到服务器
    apiPut('/issues', issues).catch(e => {
      console.error('[QMS] 问题数据同步到服务器失败:', e.message);
    });
    return true;
  }

  function addIssue(issue) {
    issue.id = issue.id || uid();
    issue.createdAt = issue.createdAt || now();
    issue.updatedAt = now();
    _issuesCache.unshift(issue);
    if (_offlineMode) {
      lsSet(LS_KEYS.issues, _issuesCache);
      return issue;
    }
    apiPost('/issues', issue).catch(e => {
      console.error('[QMS] 问题保存到服务器失败:', e.message);
    });
    return issue;
  }

  function updateIssue(id, patch) {
    const idx = _issuesCache.findIndex(i => i.id === id);
    if (idx === -1) return null;
    _issuesCache[idx] = { ..._issuesCache[idx], ...patch, updatedAt: now() };
    if (_offlineMode) {
      lsSet(LS_KEYS.issues, _issuesCache);
      return _issuesCache[idx];
    }
    apiPut('/issues/' + id, patch).catch(e => {
      console.error('[QMS] 问题更新到服务器失败:', e.message);
    });
    return _issuesCache[idx];
  }

  function deleteIssue(id) {
    _issuesCache = _issuesCache.filter(i => i.id !== id);
    if (_offlineMode) {
      lsSet(LS_KEYS.issues, _issuesCache);
      return;
    }
    apiDelete('/issues/' + id).catch(e => {
      console.error('[QMS] 问题删除同步失败:', e.message);
    });
  }

  function getIssue(id) {
    return _issuesCache.find(i => i.id === id) || null;
  }

  // ── 图片压缩 ──────────────────────────────────────────
  function compressImage(dataUrl, maxW, maxH, quality) {
    maxW = maxW || 1024;
    maxH = maxH || 1024;
    quality = quality || 0.7;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var scale = Math.min(maxW / w, maxH / h, 1);
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  // ── 草稿管理 ──────────────────────────────────────────
  function saveDraft(data) {
    _draftCache = { data, savedAt: now() };
    if (_offlineMode) {
      lsSet(LS_KEYS.draft, _draftCache);
      return true;
    }
    apiPost('/draft', data).catch(e => {
      console.warn('[QMS] 草稿同步失败:', e.message);
    });
    return true;
  }

  function loadDraft() {
    return _draftCache;
  }

  function clearDraft() {
    _draftCache = null;
    if (_offlineMode) {
      lsSet(LS_KEYS.draft, null);
      return;
    }
    apiDelete('/draft').catch(e => {
      console.warn('[QMS] 草稿清除失败:', e.message);
    });
  }

  // ── 导出 ──────────────────────────────────────────────
  global.QMSData = {
    DICT,
    uid,
    today,
    now,
    daysBetween,
    computeStatus,
    computeProgressStep,
    isStepDone,
    computeOverdueDays,
    computeWasOverdueDays,
    loadDismissedOverdue,
    saveDismissedOverdue,
    dismissOverdue,
    isOverdueDismissed,
    loadUsers,
    saveUsers,
    addUser,
    updateUser,
    deleteUser,
    getUserByAccount,
    validateLogin,
    isAccountExists,
    loadIssues,
    saveIssues,
    addIssue,
    updateIssue,
    deleteIssue,
    getIssue,
    saveDraft,
    loadDraft,
    clearDraft,
    generateMockData,
    compressImage,
    init,
    syncFromServer,
    isOffline,
  };
})(window);
