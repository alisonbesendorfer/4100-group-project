/* ── Helpers ──────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SEASON_COLORS = { 0:'#3b82f6',1:'#3b82f6',1:'#3b82f6',2:'#22c55e',3:'#22c55e',4:'#22c55e',5:'#ef4444',6:'#ef4444',7:'#ef4444',8:'#f59e0b',9:'#f59e0b',10:'#f59e0b',11:'#3b82f6' };

function showLoading() { $('loading-overlay').classList.remove('hidden'); }
function hideLoading() { $('loading-overlay').classList.add('hidden'); }

function delayColor(v) {
  if (v <= 0)    return '#22c55e';
  if (v <= 11.8) return '#3b82f6';
  if (v <= 17.7) return '#f59e0b';
  return '#ef4444';
}

function heatColor(v, min, max) {
  if (v === null) return '#111827';
  const t = Math.max(0, Math.min(1, (v - min) / (max - min)));
  const r = Math.round(34  + t * (239 - 34));
  const g = Math.round(197 + t * (68  - 197));
  const b = Math.round(94  + t * (68  - 94));
  return `rgb(${r},${g},${b})`;
}

function fmt(v, digits=1) {
  if (v === null || v === undefined) return '—';
  const s = v >= 0 ? '+' : '';
  return s + Number(v).toFixed(digits);
}

function destroyChart(id) {
  const existing = Chart.getChart(id);
  if (existing) existing.destroy();
}

/* ── Tab navigation ──────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`panel-${tab.dataset.tool}`).classList.add('active');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1. FLIGHT LOOKUP
══════════════════════════════════════════════════════════════════════════ */
let flMap = null;

$('form-flight-lookup').addEventListener('submit', async e => {
  e.preventDefault();
  const params = new URLSearchParams({
    origin:      $('fl-origin').value.toUpperCase(),
    dest:        $('fl-dest').value.toUpperCase(),
    carrier:     $('fl-carrier').value,
    month:       $('fl-month').value,
    time_of_day: $('fl-tod').value,
  });
  showLoading();
  try {
    const res = await fetch(`/api/flight-lookup?${params}`);
    const data = await res.json();
    hideLoading();
    if (!res.ok) { renderError('result-flight-lookup', data.error); return; }
    renderFlightLookup(data);
  } catch(err) { hideLoading(); renderError('result-flight-lookup', err.message); }
});

function renderFlightLookup(d) {
  const el = $('result-flight-lookup');
  el.innerHTML = `
    <div style="border-radius:12px;overflow:hidden;border:1px solid #1f2d47;">
      <!-- Header -->
      <div class="stats-header" style="background:linear-gradient(135deg,${d.primary} 0%,${d.primary}cc 100%);">
        <div class="stats-header-bg-code">${d.carrier_name.split(' ')[0].slice(0,2).toUpperCase()}</div>
        <div class="stats-eyebrow">${d.carrier_name} — Flight Delay Analysis</div>
        <div class="stats-title">✈ ${d.origin} → ${d.dest}</div>
        <div class="stats-subtitle">${d.origin_city} → ${d.dest_city}</div>
        <div class="stats-meta">${d.avg_distance.toLocaleString()} miles &bull; ${d.n_flights.toLocaleString()} flights (2021–2024)</div>
      </div>
      <!-- Risk bar -->
      <div class="risk-bar" style="background:${d.risk_color};">
        <span>${d.risk_label} — ${d.pct_delayed}% of flights delayed &gt;15 min</span>
      </div>
      <!-- KPI row -->
      <div class="kpi-grid">
        <div class="kpi-card" style="border-color:#22c55e;">
          <div class="kpi-label">On Time / Early</div>
          <div class="kpi-value text-green">${d.pct_ontime}%</div>
        </div>
        <div class="kpi-card" style="border-color:#f59e0b;">
          <div class="kpi-label">Minor (1–15m)</div>
          <div class="kpi-value text-yellow">${d.pct_minor}%</div>
        </div>
        <div class="kpi-card" style="border-color:#f97316;">
          <div class="kpi-label">Significant 15m+</div>
          <div class="kpi-value" style="color:#f97316;">${d.pct_delayed}%</div>
        </div>
        <div class="kpi-card" style="border-color:#ef4444;">
          <div class="kpi-label">Major 60m+</div>
          <div class="kpi-value text-red">${d.pct_major}%</div>
        </div>
      </div>
      <!-- Stats grid -->
      <div class="content-grid">
        <div class="content-card">
          <div class="content-card-title text-accent">Delay Statistics</div>
          ${statRow('Average delay', fmt(d.avg_delay) + ' min')}
          ${statRow('Median delay',  fmt(d.median_delay) + ' min')}
          ${statRow('Std deviation', d.std_delay + ' min')}
          ${statRow('25th pctl',     fmt(d.p25, 0) + ' min')}
          ${statRow('75th pctl',     fmt(d.p75, 0) + ' min')}
          ${statRow('90th pctl',     fmt(d.p90, 0) + ' min', '#f97316')}
          ${statRow('95th pctl',     fmt(d.p95, 0) + ' min', '#ef4444')}
        </div>
        <div class="content-card">
          <div class="content-card-title text-accent">${d.origin} Weather</div>
          ${d.wx_origin && Object.keys(d.wx_origin).length ? `
            ${statRow('Avg precipitation', d.wx_origin.precip + ' in')}
            ${statRow('Avg snowfall',       d.wx_origin.snow  + ' in')}
            ${statRow('Avg wind speed',     d.wx_origin.wind  + ' mph')}
          ` : '<div class="stat-label" style="font-size:12px;padding-top:6px;">No weather data</div>'}
        </div>
        <div class="content-card">
          <div class="content-card-title text-accent">${d.dest} Weather</div>
          ${d.wx_dest && Object.keys(d.wx_dest).length ? `
            ${statRow('Avg precipitation', d.wx_dest.precip + ' in')}
            ${statRow('Avg snowfall',       d.wx_dest.snow  + ' in')}
            ${statRow('Avg wind speed',     d.wx_dest.wind  + ' mph')}
          ` : '<div class="stat-label" style="font-size:12px;padding-top:6px;">No weather data</div>'}
        </div>
      </div>
      <!-- Map -->
      <div class="map-container" style="border-top:1px solid #1f2d47;">
        <div id="fl-map" style="height:100%;width:100%;"></div>
      </div>
      <!-- Histogram -->
      <div class="chart-wrap">
        <div class="chart-title">Departure Delay Distribution</div>
        <canvas id="fl-hist" height="80"></canvas>
      </div>
      <div class="result-footer">Historical data: BTS On-Time Performance (2021–2024). Negative = departed early. Weather: NOAA CDO API.</div>
    </div>`;

  // Map
  if (flMap) { flMap.remove(); flMap = null; }
  flMap = L.map('fl-map', { zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(flMap);

  if (d.arc && d.arc.length) {
    const poly = L.polyline(d.arc, { color: d.arc_color, weight: 4, opacity: .9 }).addTo(flMap);
    flMap.fitBounds(poly.getBounds(), { padding: [40, 40] });
    if (d.origin_coords) markerPin(flMap, d.origin_coords.lat, d.origin_coords.lon, d.origin, d.origin_city, d.arc_color);
    if (d.dest_coords)   markerPin(flMap, d.dest_coords.lat,   d.dest_coords.lon,   d.dest,   d.dest_city,   d.arc_color);
  }

  // Histogram
  destroyChart('fl-hist');
  const bins = d.hist_bins.slice(0,-1).map(b => `${b}`);
  const barColors = d.hist_bins.slice(0,-1).map(b => b < 0 ? '#22c55e' : b < 15 ? '#f59e0b' : '#ef4444');
  new Chart($('fl-hist'), {
    type: 'bar',
    data: { labels: bins, datasets: [{ data: d.hist_counts, backgroundColor: barColors, borderWidth: 0 }] },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#4a5568', maxTicksLimit: 12 }, grid: { color: '#1f2d47' } },
        y: { ticks: { color: '#4a5568' }, grid: { color: '#1f2d47' } }
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   2. AIRLINE REPORT
══════════════════════════════════════════════════════════════════════════ */
$('form-airline-report').addEventListener('submit', async e => {
  e.preventDefault();
  showLoading();
  try {
    const res = await fetch(`/api/airline-report?carrier=${$('ar-carrier').value}`);
    const data = await res.json();
    hideLoading();
    if (!res.ok) { renderError('result-airline-report', data.error); return; }
    renderAirlineReport(data);
  } catch(err) { hideLoading(); renderError('result-airline-report', err.message); }
});

function renderAirlineReport(d) {
  const el = $('result-airline-report');
  el.innerHTML = `
    <div style="border-radius:12px;overflow:hidden;border:1px solid #1f2d47;">
      <div class="stats-header" style="background:linear-gradient(135deg,${d.primary} 0%,${d.primary}cc 100%);">
        <div class="stats-header-bg-code">${d.carrier}</div>
        <div class="stats-eyebrow">Airline Performance Report Card</div>
        <div class="stats-title">${d.carrier_name}</div>
        <div class="stats-meta">${d.n_flights.toLocaleString()} flights &bull; 2021–2024 &bull; Avg distance ${d.avg_distance.toLocaleString()} mi</div>
      </div>
      <div class="risk-bar" style="background:${d.rank_color};">
        <span>Ranked #${d.rank} of ${d.n_carriers} carriers (${d.rank_label})</span>
        <span class="light">Avg delay: ${fmt(d.avg_delay)} min &bull; On-time: ${d.pct_ontime}%</span>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card" style="border-color:#22c55e;">
          <div class="kpi-label">On Time</div>
          <div class="kpi-value text-green">${d.pct_ontime}%</div>
        </div>
        <div class="kpi-card" style="border-color:${d.primary};">
          <div class="kpi-label">Avg Delay</div>
          <div class="kpi-value" style="color:${d.accent};">${fmt(d.avg_delay)}m</div>
        </div>
        <div class="kpi-card" style="border-color:#f97316;">
          <div class="kpi-label">Delayed 15m+</div>
          <div class="kpi-value" style="color:#f97316;">${d.pct_delayed}%</div>
        </div>
        <div class="kpi-card" style="border-color:#ef4444;">
          <div class="kpi-label">Major 60m+</div>
          <div class="kpi-value text-red">${d.pct_major}%</div>
        </div>
      </div>
      <!-- Charts -->
      <div class="chart-wrap">
        <div class="chart-grid-2">
          <div>
            <div class="chart-title">Monthly Average Delay</div>
            <canvas id="ar-monthly" height="120"></canvas>
          </div>
          <div>
            <div class="chart-title">Year-over-Year Trend</div>
            <canvas id="ar-yearly" height="120"></canvas>
          </div>
        </div>
      </div>
      <!-- Airports -->
      <div class="chart-wrap" style="border-top:1px solid #1f2d47;">
        <div class="chart-grid-2">
          <div>
            <div class="section-label text-red">10 Worst Airports</div>
            <canvas id="ar-worst-apt" height="160"></canvas>
          </div>
          <div>
            <div class="section-label text-green">10 Best Airports</div>
            <canvas id="ar-best-apt" height="160"></canvas>
          </div>
        </div>
      </div>
      <!-- Routes -->
      <div class="chart-wrap" style="border-top:1px solid #1f2d47;">
        <div class="route-grid">
          <div>
            <div class="section-label text-red">10 Worst Routes</div>
            ${routeTable(d.worst_routes, '#ef4444')}
          </div>
          <div>
            <div class="section-label text-green">10 Best Routes</div>
            ${routeTable(d.best_routes, '#22c55e')}
          </div>
        </div>
      </div>
      <div class="result-footer">BTS On-Time Performance (2021–2024). Min 200 flights per route, 500 per airport.</div>
    </div>`;

  const monthColors = d.monthly.map((_,i) => SEASON_COLORS[i] || '#3b82f6');

  destroyChart('ar-monthly');
  new Chart($('ar-monthly'), {
    type: 'bar',
    data: { labels: MONTH_NAMES, datasets: [{ data: d.monthly, backgroundColor: monthColors, borderWidth: 0 }] },
    options: darkChartOpts()
  });

  destroyChart('ar-yearly');
  new Chart($('ar-yearly'), {
    type: 'line',
    data: {
      labels: d.yearly.map(r => r.year),
      datasets: [{ data: d.yearly.map(r => r.avg_delay), borderColor: d.accent,
        backgroundColor: d.accent + '22', fill: true, tension: .3, pointRadius: 5 }]
    },
    options: darkChartOpts()
  });

  destroyChart('ar-worst-apt');
  new Chart($('ar-worst-apt'), {
    type: 'bar',
    data: { labels: d.worst_airports.map(a=>a.code), datasets: [{ data: d.worst_airports.map(a=>a.avg_delay), backgroundColor: '#ef4444aa', borderWidth: 0 }] },
    options: { ...darkChartOpts(), indexAxis: 'y' }
  });

  destroyChart('ar-best-apt');
  new Chart($('ar-best-apt'), {
    type: 'bar',
    data: { labels: d.best_airports.map(a=>a.code), datasets: [{ data: d.best_airports.map(a=>a.avg_delay), backgroundColor: '#22c55eaa', borderWidth: 0 }] },
    options: { ...darkChartOpts(), indexAxis: 'y' }
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   3. AIRPORT PROFILE
══════════════════════════════════════════════════════════════════════════ */
let apMap = null;

$('form-airport-profile').addEventListener('submit', async e => {
  e.preventDefault();
  showLoading();
  try {
    const res = await fetch(`/api/airport-profile?airport=${$('ap-airport').value.toUpperCase()}`);
    const data = await res.json();
    hideLoading();
    if (!res.ok) { renderError('result-airport-profile', data.error); return; }
    renderAirportProfile(data);
  } catch(err) { hideLoading(); renderError('result-airport-profile', err.message); }
});

function renderAirportProfile(d) {
  const el = $('result-airport-profile');
  el.innerHTML = `
    <div style="border-radius:12px;overflow:hidden;border:1px solid #1f2d47;">
      <div class="stats-header" style="background:linear-gradient(135deg,#0d1220 0%,#151d2e 100%);">
        <div class="stats-header-bg-code">${d.airport}</div>
        <div class="stats-eyebrow">Airport Performance Profile</div>
        <div class="stats-title">✈ ${d.airport} — ${d.city}</div>
        <div class="stats-meta">${d.hub_label} &bull; ${d.n_flights.toLocaleString()} departures &bull; ${d.n_carriers} carriers &bull; ${d.n_destinations} destinations</div>
      </div>
      <div class="risk-bar" style="background:${d.rank_color};">
        <span>Ranked #${d.rank} of ${d.n_airports} airports (${d.rank_label})</span>
        <span class="light">Avg delay: ${fmt(d.avg_delay)} min &bull; On-time: ${d.pct_ontime}%</span>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card" style="border-color:#22c55e;">
          <div class="kpi-label">On Time</div>
          <div class="kpi-value text-green">${d.pct_ontime}%</div>
        </div>
        <div class="kpi-card" style="border-color:#3b82f6;">
          <div class="kpi-label">Avg Delay</div>
          <div class="kpi-value text-blue">${fmt(d.avg_delay)}m</div>
        </div>
        <div class="kpi-card" style="border-color:#f97316;">
          <div class="kpi-label">Delayed 15m+</div>
          <div class="kpi-value" style="color:#f97316;">${d.pct_delayed}%</div>
        </div>
        <div class="kpi-card" style="border-color:#ef4444;">
          <div class="kpi-label">Major 60m+</div>
          <div class="kpi-value text-red">${d.pct_major}%</div>
        </div>
      </div>
      ${d.weather && Object.keys(d.weather).length ? `
      <div style="background:#111827;border-top:1px solid #1f2d47;padding:10px 20px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;text-align:center;font-size:12px;color:#94a3b8;">
        <div>Avg Temp <strong style="color:#e2e8f0;">${d.weather.temp}°F</strong></div>
        <div>Precipitation <strong style="color:#e2e8f0;">${d.weather.precip} in</strong></div>
        <div>Snowfall <strong style="color:#e2e8f0;">${d.weather.snow} in</strong></div>
        <div>Wind <strong style="color:#e2e8f0;">${d.weather.wind} mph</strong></div>
      </div>` : ''}
      <!-- Charts -->
      <div class="chart-wrap">
        <div class="chart-grid-2">
          <div>
            <div class="chart-title">Carriers at ${d.airport}</div>
            <canvas id="ap-carriers" height="160"></canvas>
          </div>
          <div>
            <div class="chart-title">Monthly Average Delay</div>
            <canvas id="ap-monthly" height="160"></canvas>
          </div>
        </div>
      </div>
      <div class="chart-wrap" style="border-top:1px solid #1f2d47;">
        <div class="chart-title">Delay by Time of Day</div>
        <canvas id="ap-tod" height="60"></canvas>
      </div>
      <!-- Map -->
      <div class="map-container" style="border-top:1px solid #1f2d47;">
        <div id="ap-map" style="height:100%;width:100%;"></div>
      </div>
      <div class="result-footer">BTS On-Time Performance (2021–2024). Top 75 U.S. airports. Min 200 flights per destination.</div>
    </div>`;

  destroyChart('ap-carriers');
  if (d.carriers_at.length) {
    new Chart($('ap-carriers'), {
      type: 'bar',
      data: {
        labels: d.carriers_at.map(c => c.name),
        datasets: [{ data: d.carriers_at.map(c => c.avg_delay),
          backgroundColor: d.carriers_at.map(c => c.avg_delay < d.avg_delay ? '#22c55eaa' : '#ef4444aa'),
          borderWidth: 0 }]
      },
      options: { ...darkChartOpts(), indexAxis: 'y' }
    });
  }

  destroyChart('ap-monthly');
  const monthColors = d.monthly.map((_,i) => SEASON_COLORS[i] || '#3b82f6');
  new Chart($('ap-monthly'), {
    type: 'bar',
    data: { labels: MONTH_NAMES, datasets: [{ data: d.monthly, backgroundColor: monthColors, borderWidth: 0 }] },
    options: darkChartOpts()
  });

  destroyChart('ap-tod');
  if (d.tod_data.length) {
    new Chart($('ap-tod'), {
      type: 'bar',
      data: {
        labels: d.tod_data.map(t => t.slot),
        datasets: [{ data: d.tod_data.map(t => t.avg_delay),
          backgroundColor: d.tod_data.map(t => t.avg_delay < d.avg_delay ? '#3b82f6aa' : '#ef4444aa'),
          borderWidth: 0 }]
      },
      options: darkChartOpts()
    });
  }

  // Map
  if (apMap) { apMap.remove(); apMap = null; }
  apMap = L.map('ap-map', { zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(apMap);

  if (d.coords) {
    apMap.setView([d.coords.lat, d.coords.lon], 4);
    markerPin(apMap, d.coords.lat, d.coords.lon, d.airport, d.city, '#38bdf8');
    d.dest_arcs.forEach(dest => {
      if (dest.arc && dest.arc.length) {
        L.polyline(dest.arc, { color: dest.color, weight: 2, opacity: .6 })
          .bindTooltip(`${d.airport} → ${dest.dest} | ${fmt(dest.avg_delay)} min avg`)
          .addTo(apMap);
        markerPin(apMap, dest.dest_coords.lat, dest.dest_coords.lon, dest.dest, dest.dest_city, dest.color, true);
      }
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4. WHEN TO FLY
══════════════════════════════════════════════════════════════════════════ */
$('form-when-to-fly').addEventListener('submit', async e => {
  e.preventDefault();
  const params = new URLSearchParams({
    origin:  $('wf-origin').value.toUpperCase(),
    dest:    $('wf-dest').value.toUpperCase(),
    carrier: $('wf-carrier').value,
  });
  showLoading();
  try {
    const res = await fetch(`/api/when-to-fly?${params}`);
    const data = await res.json();
    hideLoading();
    if (!res.ok) { renderError('result-when-to-fly', data.error); return; }
    renderWhenToFly(data);
  } catch(err) { hideLoading(); renderError('result-when-to-fly', err.message); }
});

function renderWhenToFly(d) {
  const el = $('result-when-to-fly');

  // Build heatmap HTML
  const allVals = d.heatmap_delay.flat().filter(v => v !== null);
  const minV = Math.min(...allVals), maxV = Math.max(...allVals);

  let heatRows = '';
  d.heatmap_delay.forEach((row, mi) => {
    heatRows += `<tr><td>${MONTH_NAMES[mi]}</td>`;
    row.forEach(val => {
      if (val === null) {
        heatRows += `<td class="null-cell">—</td>`;
      } else {
        const bg = heatColor(val, minV, maxV);
        heatRows += `<td style="background:${bg};">${fmt(val)}</td>`;
      }
    });
    heatRows += '</tr>';
  });

  el.innerHTML = `
    <div style="border-radius:12px;overflow:hidden;border:1px solid #1f2d47;">
      <div class="stats-header" style="background:linear-gradient(135deg,${d.primary} 0%,${d.primary}cc 100%);">
        <div class="stats-header-bg-code">${d.carrier_name.split(' ')[0].slice(0,2).toUpperCase()}</div>
        <div class="stats-eyebrow">When Should I Fly?</div>
        <div class="stats-title">${d.carrier_name}: ${d.origin} → ${d.dest}</div>
        <div class="stats-subtitle">${d.origin_city} → ${d.dest_city}</div>
      </div>
      <!-- Best/Worst -->
      <div style="background:var(--surface);padding:16px 20px;border-top:1px solid #1f2d47;">
        <div class="bw-grid">
          <div class="bw-card best">
            <div class="bw-eyebrow">✓ Best Time to Fly</div>
            <div class="bw-value text-green">${d.best_month} — ${d.best_tod}</div>
            <div class="bw-sub">Avg delay: ${fmt(d.best_val)} min</div>
          </div>
          <div class="bw-card worst">
            <div class="bw-eyebrow">✗ Worst Time to Fly</div>
            <div class="bw-value text-red">${d.worst_month} — ${d.worst_tod}</div>
            <div class="bw-sub">Avg delay: ${fmt(d.worst_val)} min &bull; ${(d.worst_val - d.best_val).toFixed(1)} min difference</div>
          </div>
        </div>
      </div>
      <!-- Heatmap -->
      <div class="chart-wrap" style="border-top:1px solid #1f2d47;">
        <div class="chart-title">Average Departure Delay (min) by Month × Time of Day</div>
        <div class="heatmap-wrap">
          <table class="heatmap-table">
            <thead><tr><th></th>${d.tod_cols.map(t=>`<th>${t}</th>`).join('')}</tr></thead>
            <tbody>${heatRows}</tbody>
          </table>
        </div>
      </div>
      <!-- Monthly bar -->
      <div class="chart-wrap" style="border-top:1px solid #1f2d47;">
        <div class="chart-title">Monthly Average Delay — ${d.origin} → ${d.dest}</div>
        <canvas id="wf-monthly" height="70"></canvas>
      </div>
      <div class="result-footer">Based on ${d.n_flights.toLocaleString()} flights (2021–2024). Overall route avg: ${fmt(d.avg_delay)} min.</div>
    </div>`;

  destroyChart('wf-monthly');
  const monthColors = d.monthly_avg.map((_,i) => SEASON_COLORS[i] || '#3b82f6');
  new Chart($('wf-monthly'), {
    type: 'bar',
    data: { labels: MONTH_NAMES, datasets: [{ data: d.monthly_avg, backgroundColor: monthColors, borderWidth: 0 }] },
    options: darkChartOpts()
  });
}

/* ── Shared helpers ──────────────────────────────────────────────────────── */
function statRow(label, value, color) {
  return `<div class="stat-row">
    <span class="stat-label">${label}</span>
    <span class="stat-val" style="${color ? 'color:'+color : ''}">${value}</span>
  </div>`;
}

function routeTable(routes, accentColor) {
  return `<table class="route-table">
    <thead><tr><th>Route</th><th>Avg Delay</th><th>Rate</th><th>Flights</th></tr></thead>
    <tbody>${routes.map(r => `
      <tr>
        <td>${r.route}</td>
        <td style="color:${accentColor};font-weight:700;">${fmt(r.avg_delay)}m</td>
        <td>${r.delay_rate}%</td>
        <td style="color:#4a5568;">${r.flights.toLocaleString()}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function markerPin(map, lat, lon, code, city, color, small=false) {
  const size = small ? 14 : 22;
  L.marker([lat, lon], {
    icon: L.divIcon({
      html: `<div style="font-size:${size}px;color:${color};text-shadow:1px 1px 2px #000,-1px -1px 2px #000;">✈</div>`,
      iconSize: [size, size], iconAnchor: [size/2, size/2], className: ''
    })
  }).bindTooltip(`<b>${code}</b>${city ? ' — ' + city : ''}`).addTo(map);
}

function renderError(targetId, msg) {
  $(targetId).innerHTML = `<div class="error-card">⚠ ${msg}</div>`;
}

function darkChartOpts() {
  return {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#4a5568', font: { size: 11 } }, grid: { color: '#1f2d47' } },
      y: { ticks: { color: '#4a5568', font: { size: 11 } }, grid: { color: '#1f2d47' } }
    }
  };
}
