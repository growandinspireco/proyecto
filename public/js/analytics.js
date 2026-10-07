/* global Chart */
(function () {
  var el = document.getElementById('chart-data');
  if (!el || typeof Chart === 'undefined') return;
  var data = JSON.parse(el.textContent);
  var BLUE = '#2a78d6';
  var GREEN = '#1baf7a';
  var money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  var labels = data.days.map(function (d) { var p = d.split('-'); return p[2] + '/' + p[1]; });

  Chart.defaults.font.family = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  Chart.defaults.color = '#6b7280';

  function barChart(id, values, color, opts) {
    var canvas = document.getElementById(id);
    if (!canvas) return;
    opts = opts || {};
    new Chart(canvas, {
      type: 'bar',
      data: { labels: opts.labels || labels, datasets: [{ label: opts.label, data: values, backgroundColor: color, borderRadius: 4, maxBarThickness: 28 }] },
      options: {
        indexAxis: opts.horizontal ? 'y' : 'x',
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return opts.money ? money.format(c.parsed[opts.horizontal ? 'x' : 'y']) : c.formattedValue; } } },
        },
        scales: {
          x: { grid: { display: !!opts.horizontal, color: '#eef0f5' }, ticks: opts.horizontal && opts.money ? { callback: function (v) { return money.format(v); } } : { maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { display: !opts.horizontal, color: '#eef0f5' }, ticks: !opts.horizontal && opts.money ? { callback: function (v) { return money.format(v); } } : { precision: 0 } },
        },
      },
    });
  }

  barChart('chart-leads', data.leads, BLUE, { label: 'Leads' });
  barChart('chart-sales', data.sales, GREEN, { label: 'Ingresos', money: true });
  if (data.team) {
    barChart('chart-team', data.team.map(function (t) { return t.revenue; }), BLUE, { label: 'Ingresos', money: true, horizontal: true, labels: data.team.map(function (t) { return t.name; }) });
  }
})();
