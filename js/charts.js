/**
 * QMS 图表渲染模块
 */
(function (global) {
  'use strict';

  let chartInstances = {};

  function getThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      text: isDark ? '#b0b8c4' : '#4a5568',
      grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      notStarted: isDark ? '#7a8595' : '#8a95a5',
      inProgress: isDark ? '#e8a040' : '#d97f1a',
      completed: isDark ? '#3dba6e' : '#2d9d56',
      closed: isDark ? '#5588cc' : '#3a6db5',
      overdue: isDark ? '#e84545' : '#c83030',
      primary: isDark ? '#5588cc' : '#3a6db5',
    };
  }

  function destroyCharts() {
    Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch (e) {} });
    chartInstances = {};
  }

  function destroyChart(name) {
    if (chartInstances[name]) {
      try { chartInstances[name].destroy(); } catch (e) {}
      delete chartInstances[name];
    }
  }

  // ── 责任单位问题数量柱状图（堆叠） ────────────────────
  function renderUnitBarChart(canvasId, issues) {
    destroyChart('unitBar');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colors = getThemeColors();
    const units = [...new Set(issues.map(i => i.category1?.responsibilityUnit).filter(Boolean))];
    const statuses = ['not_started', 'in_progress', 'completed', 'closed', 'overdue'];
    const statusLabels = { not_started: '未开始', in_progress: '整改中', completed: '已完成', closed: '已关闭', overdue: '已拖期' };
    const statusColors = {
      not_started: colors.notStarted,
      in_progress: colors.inProgress,
      completed: colors.completed,
      closed: colors.closed,
      overdue: colors.overdue,
    };

    const datasets = statuses.map(status => ({
      label: statusLabels[status],
      data: units.map(unit => issues.filter(i =>
        i.category1?.responsibilityUnit === unit &&
        QMSData.computeStatus(i) === status
      ).length),
      backgroundColor: statusColors[status],
      borderRadius: 4,
      barPercentage: 0.65,
      categoryPercentage: 0.7,
    }));

    chartInstances.unitBar = new Chart(canvas, {
      type: 'bar',
      data: { labels: units, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11 }, color: colors.text, usePointStyle: true, pointStyle: 'circle', padding: 12, boxWidth: 8 },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              footer: (items) => '合计: ' + items.reduce((s, i) => s + i.parsed.y, 0),
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: colors.text, font: { size: 11 } } },
          y: { stacked: true, beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 }, stepSize: 1 } },
        },
      },
    });
  }

  // ── 整改情况环形图 ────────────────────────────────────
  function renderStatusDonut(canvasId, issues) {
    destroyChart('statusDonut');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colors = getThemeColors();
    const statuses = ['not_started', 'in_progress', 'completed', 'closed', 'overdue'];
    const statusLabels = { not_started: '未开始', in_progress: '整改中', completed: '已完成', closed: '已关闭', overdue: '已拖期' };
    const statusColors = {
      not_started: colors.notStarted,
      in_progress: colors.inProgress,
      completed: colors.completed,
      closed: colors.closed,
      overdue: colors.overdue,
    };

    const counts = statuses.map(s => issues.filter(i => QMSData.computeStatus(i) === s).length);
    const total = counts.reduce((a, b) => a + b, 0) || 1;

    chartInstances.statusDonut = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: statuses.map(s => statusLabels[s]),
        datasets: [{
          data: counts,
          backgroundColor: statuses.map(s => statusColors[s]),
          borderWidth: 0,
          spacing: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { size: 11 }, color: colors.text, usePointStyle: true, pointStyle: 'circle', padding: 10, boxWidth: 8 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.parsed} (${(ctx.parsed / total * 100).toFixed(1)}%)`,
            },
          },
        },
      },
    });
  }

  // ── 趋势折线图（近30天） ──────────────────────────────
  function renderTrendLine(canvasId, issues) {
    destroyChart('trendLine');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colors = getThemeColors();
    const today = new Date();
    const labels = [];
    const data = [];

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      labels.push((d.getMonth() + 1) + '/' + d.getDate());
      data.push(issues.filter(issue => {
        const occur = issue.category1?.occurTime;
        return occur === dateStr;
      }).length);
    }

    const ctx = canvas.getContext('2d');
    let gradient = colors.primary + '30';
    if (ctx) {
      try {
        gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, colors.primary + '40');
        gradient.addColorStop(1, colors.primary + '00');
      } catch (e) { /* fallback to solid */ }
    }

    chartInstances.trendLine = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '问题数量',
          data,
          borderColor: colors.primary,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: colors.primary,
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => '日期: ' + items[0].label,
              label: (ctx) => '问题数: ' + ctx.parsed.y,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: colors.text, font: { size: 10 }, maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 }, stepSize: 1 } },
        },
      },
    });
  }

  global.QMSCharts = {
    renderUnitBarChart,
    renderStatusDonut,
    renderTrendLine,
    destroyCharts,
    destroyChart,
    getThemeColors,
  };
})(window);
