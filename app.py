from flask import Flask, render_template, request, jsonify
import pandas as pd
import numpy as np
import os

app = Flask(__name__)

# ── Load data ──────────────────────────────────────────────────────────────────
# Update this path to wherever your merged_full.csv lives
CSV_PATH = os.environ.get("FLIGHT_CSV", "merged_full.csv")

USE_COLS = [
    'FL_DATE', 'OP_UNIQUE_CARRIER', 'ORIGIN', 'DEST', 'ORIGIN_CITY_NAME',
    'DEP_DELAY', 'DEP_DEL15', 'ARR_DELAY', 'CANCELLED', 'DISTANCE',
    'CARRIER_DELAY', 'WEATHER_DELAY', 'NAS_DELAY', 'SECURITY_DELAY',
    'LATE_AIRCRAFT_DELAY', 'MONTH', 'YEAR', 'CRS_DEP_TIME',
    'precipitation', 'snowfall', 'avg_wind', 'temp_max', 'temp_min',
    'hub_size', 'hub_ordinal', 'latitude', 'longitude',
]

print("Loading flight data…")
df_all = pd.read_csv(CSV_PATH, usecols=[c for c in USE_COLS if c in
                     pd.read_csv(CSV_PATH, nrows=0).columns], low_memory=False)
df_all['FL_DATE'] = pd.to_datetime(df_all['FL_DATE'])
df_delays = df_all[df_all['CANCELLED'] == 0].copy()
print(f"Loaded {len(df_delays):,} non-cancelled flights.")

# ── Lookup tables ──────────────────────────────────────────────────────────────
coord_lookup = (
    df_delays[df_delays['latitude'].notna()]
    .groupby('ORIGIN')
    .agg(lat=('latitude', 'first'), lon=('longitude', 'first'))
    .to_dict('index')
)
city_lookup = (
    df_delays[df_delays['ORIGIN_CITY_NAME'].notna()]
    .groupby('ORIGIN')['ORIGIN_CITY_NAME'].first()
    .to_dict()
)

CARRIER_NAMES = {
    'WN': 'Southwest', 'DL': 'Delta', 'AA': 'American', 'OO': 'SkyWest',
    'UA': 'United', 'YX': 'Republic', 'MQ': 'Envoy', 'B6': 'JetBlue',
    'NK': 'Spirit', 'AS': 'Alaska', '9E': 'Endeavor', 'OH': 'PSA Airlines',
    'F9': 'Frontier', 'G4': 'Allegiant', 'HA': 'Hawaiian', 'YV': 'Mesa',
    'QX': 'Horizon',
}
AIRLINE_COLORS = {
    'DL': ('#003A70', '#C8102E'), 'AA': ('#36495A', '#0078D2'),
    'UA': ('#0033A0', '#005DAA'), 'WN': ('#304CB2', '#FFBF27'),
    'B6': ('#00205B', '#003876'), 'AS': ('#01426A', '#00AFD7'),
    'NK': ('#000000', '#FFEC00'), 'F9': ('#0F6744', '#9A9B9C'),
    'G4': ('#01579B', '#F48120'), 'HA': ('#4B2D89', '#CE0C88'),
}
REGIONAL_TO_PARENT = {
    '9E': 'DL', 'MQ': 'AA', 'OH': 'AA', 'YX': 'AA', 'OO': 'DL', 'QX': 'AS',
}
MONTH_NAMES = {
    1:'January',2:'February',3:'March',4:'April',5:'May',6:'June',
    7:'July',8:'August',9:'September',10:'October',11:'November',12:'December',
}
SEASON_MAP = {
    12:'Winter',1:'Winter',2:'Winter',3:'Spring',4:'Spring',5:'Spring',
    6:'Summer',7:'Summer',8:'Summer',9:'Fall',10:'Fall',11:'Fall',
}

def get_time_bin(dep_time):
    try:
        t = int(float(dep_time))
    except Exception:
        return 'Unknown'
    if t < 600:   return 'Red-eye'
    if t < 1200:  return 'Morning'
    if t < 1700:  return 'Afternoon'
    if t < 2100:  return 'Evening'
    return 'Night'

def great_circle_points(lat1, lon1, lat2, lon2, n=40):
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    d = np.arccos(np.clip(
        np.sin(lat1)*np.sin(lat2) + np.cos(lat1)*np.cos(lat2)*np.cos(lon2-lon1), -1, 1))
    if d < 1e-10:
        return [[np.degrees(lat1), np.degrees(lon1)]]
    pts = []
    for f in np.linspace(0, 1, n):
        A = np.sin((1-f)*d) / np.sin(d)
        B = np.sin(f*d)     / np.sin(d)
        x = A*np.cos(lat1)*np.cos(lon1) + B*np.cos(lat2)*np.cos(lon2)
        y = A*np.cos(lat1)*np.sin(lon1) + B*np.cos(lat2)*np.sin(lon2)
        z = A*np.sin(lat1)              + B*np.sin(lat2)
        pts.append([np.degrees(np.arctan2(z, np.sqrt(x**2+y**2))),
                    np.degrees(np.arctan2(y, x))])
    return pts

def delay_color(avg_delay):
    if avg_delay <= 0:    return '#22c55e'
    if avg_delay <= 11.8: return '#3b82f6'
    if avg_delay <= 17.7: return '#f59e0b'
    return '#ef4444'

# ── Routes ─────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    carriers = sorted([
        {'code': k, 'name': v}
        for k, v in CARRIER_NAMES.items()
        if k in df_delays['OP_UNIQUE_CARRIER'].unique()
    ], key=lambda x: x['name'])
    airports = sorted(coord_lookup.keys())
    return render_template('index.html', carriers=carriers, airports=airports)


# ── 1. Flight Lookup ───────────────────────────────────────────────────────────
@app.route('/api/flight-lookup')
def api_flight_lookup():
    origin     = request.args.get('origin', '').upper()
    dest       = request.args.get('dest', '').upper()
    carrier    = request.args.get('carrier', '').upper()
    month      = request.args.get('month', 'all')
    time_of_day= request.args.get('time_of_day', 'Any')

    mask = ((df_delays['ORIGIN'] == origin) &
            (df_delays['DEST']   == dest)   &
            (df_delays['OP_UNIQUE_CARRIER'] == carrier))
    if month != 'all':
        mask &= (df_delays['MONTH'] == int(month))

    sub = df_delays[mask].copy()

    if time_of_day != 'Any' and 'CRS_DEP_TIME' in sub.columns:
        sub['_tod'] = sub['CRS_DEP_TIME'].apply(get_time_bin)
        sub = sub[sub['_tod'] == time_of_day]

    if len(sub) == 0:
        avail = sorted(df_delays[(df_delays['ORIGIN']==origin) &
                                  (df_delays['DEST']==dest)
                                 ]['OP_UNIQUE_CARRIER'].unique().tolist())
        return jsonify({'error': f'No flights found. Available carriers: {", ".join(avail) or "none"}'}), 404

    d   = sub['DEP_DELAY']
    pct = lambda cond: float((cond).mean() * 100)

    pct_delayed = pct(sub['DEP_DEL15'] == 1)
    avg_delay   = float(d.mean())

    # Weather
    wx_o, wx_d = {}, {}
    if sub['precipitation'].notna().any():
        w = sub[sub['precipitation'].notna()]
        wx_o = dict(precip=round(float(w['precipitation'].mean()),2),
                    snow=round(float(w['snowfall'].mean()),2),
                    wind=round(float(w['avg_wind'].mean()),1))
    dest_wx = df_delays[(df_delays['ORIGIN']==dest) & df_delays['precipitation'].notna()]
    if month != 'all':
        dest_wx = dest_wx[dest_wx['MONTH'] == int(month)]
    if len(dest_wx):
        wx_d = dict(precip=round(float(dest_wx['precipitation'].mean()),2),
                    snow=round(float(dest_wx['snowfall'].mean()),2),
                    wind=round(float(dest_wx['avg_wind'].mean()),1))

    # Arc
    arc = []
    if origin in coord_lookup and dest in coord_lookup:
        o, dv = coord_lookup[origin], coord_lookup[dest]
        arc = great_circle_points(o['lat'], o['lon'], dv['lat'], dv['lon'])

    # Histogram
    hist_vals = d.dropna().clip(-30, 120).tolist()
    bins = list(range(-30, 125, 5))
    counts, _ = np.histogram(hist_vals, bins=bins)

    dc = REGIONAL_TO_PARENT.get(carrier, carrier)
    primary, accent = AIRLINE_COLORS.get(dc, ('#0f172a', '#38bdf8'))

    return jsonify({
        'origin': origin, 'dest': dest,
        'origin_city': city_lookup.get(origin, origin),
        'dest_city':   city_lookup.get(dest,   dest),
        'carrier_name': CARRIER_NAMES.get(carrier, carrier),
        'primary': primary, 'accent': accent,
        'n_flights': len(sub),
        'avg_delay':    round(avg_delay, 1),
        'median_delay': round(float(d.median()), 1),
        'std_delay':    round(float(d.std()), 1),
        'pct_ontime':   round(pct(d <= 0), 1),
        'pct_minor':    round(pct((d > 0) & (d <= 15)), 1),
        'pct_delayed':  round(pct_delayed, 1),
        'pct_major':    round(pct(d > 60), 1),
        'p25': round(float(d.quantile(.25)), 1),
        'p75': round(float(d.quantile(.75)), 1),
        'p90': round(float(d.quantile(.90)), 1),
        'p95': round(float(d.quantile(.95)), 1),
        'avg_distance': round(float(sub['DISTANCE'].mean()), 0),
        'risk_label': 'LOW RISK' if pct_delayed < 15 else ('MODERATE RISK' if pct_delayed < 25 else 'HIGH RISK'),
        'risk_color': '#22c55e' if pct_delayed < 15 else ('#f59e0b' if pct_delayed < 25 else '#ef4444'),
        'arc': arc,
        'arc_color': delay_color(avg_delay),
        'origin_coords': coord_lookup.get(origin),
        'dest_coords':   coord_lookup.get(dest),
        'wx_origin': wx_o, 'wx_dest': wx_d,
        'hist_counts': counts.tolist(),
        'hist_bins':   bins,
    })


# ── 2. Airline Report ─────────────────────────────────────────────────────────
@app.route('/api/airline-report')
def api_airline_report():
    carrier = request.args.get('carrier', 'DL').upper()
    sub = df_delays[df_delays['OP_UNIQUE_CARRIER'] == carrier]
    if len(sub) == 0:
        return jsonify({'error': f'No data for carrier {carrier}'}), 404

    d = sub['DEP_DELAY']
    pct = lambda cond: round(float((cond).mean() * 100), 1)

    # Rank
    ranks = (df_delays.groupby('OP_UNIQUE_CARRIER')['DEP_DELAY']
             .mean().sort_values().reset_index())
    rank_pos = int(ranks[ranks['OP_UNIQUE_CARRIER']==carrier].index[0]) + 1
    n_carriers = len(ranks)

    # Monthly
    monthly = (sub.groupby('MONTH')['DEP_DELAY'].mean()
               .reindex(range(1,13)).round(2).tolist())

    # Yearly
    yearly_df = sub.groupby('YEAR').agg(
        avg_delay=('DEP_DELAY','mean'), flights=('DEP_DELAY','count')).round(2)
    yearly = [{'year': int(y), 'avg_delay': round(float(r['avg_delay']),1),
               'flights': int(r['flights'])} for y, r in yearly_df.iterrows()]

    # Airports (best/worst)
    apt = (sub.groupby('ORIGIN')
           .agg(flights=('DEP_DELAY','count'), avg_delay=('DEP_DELAY','mean'))
           .query('flights >= 500').sort_values('avg_delay'))
    best_airports  = [{'code': c, 'avg_delay': round(float(r['avg_delay']),1)}
                      for c, r in apt.head(10).iterrows()]
    worst_airports = [{'code': c, 'avg_delay': round(float(r['avg_delay']),1)}
                      for c, r in apt.tail(10).iterrows()]

    # Routes
    sub2 = sub.copy()
    sub2['ROUTE'] = sub2['ORIGIN'] + ' → ' + sub2['DEST']
    rp = (sub2.groupby('ROUTE')
          .agg(flights=('DEP_DELAY','count'), avg_delay=('DEP_DELAY','mean'),
               delay_rate=('DEP_DEL15','mean'))
          .query('flights >= 200'))
    best_routes  = [{'route': r, 'avg_delay': round(float(v['avg_delay']),1),
                     'delay_rate': round(float(v['delay_rate'])*100,1),
                     'flights': int(v['flights'])}
                    for r, v in rp.sort_values('avg_delay').head(10).iterrows()]
    worst_routes = [{'route': r, 'avg_delay': round(float(v['avg_delay']),1),
                     'delay_rate': round(float(v['delay_rate'])*100,1),
                     'flights': int(v['flights'])}
                    for r, v in rp.sort_values('avg_delay', ascending=False).head(10).iterrows()]

    dc = REGIONAL_TO_PARENT.get(carrier, carrier)
    primary, accent = AIRLINE_COLORS.get(dc, ('#0f172a', '#38bdf8'))

    return jsonify({
        'carrier': carrier,
        'carrier_name': CARRIER_NAMES.get(carrier, carrier),
        'primary': primary, 'accent': accent,
        'n_flights': len(sub),
        'avg_delay':    round(float(d.mean()), 1),
        'median_delay': round(float(d.median()), 1),
        'pct_ontime':   pct(d <= 0),
        'pct_delayed':  pct(sub['DEP_DEL15'] == 1),
        'pct_major':    pct(d > 60),
        'avg_distance': round(float(sub['DISTANCE'].mean()), 0),
        'rank': rank_pos, 'n_carriers': n_carriers,
        'rank_label': ('Top tier' if rank_pos <= n_carriers*.33
                       else 'Mid tier' if rank_pos <= n_carriers*.66 else 'Bottom tier'),
        'rank_color': ('#22c55e' if rank_pos <= n_carriers*.33
                       else '#f59e0b' if rank_pos <= n_carriers*.66 else '#ef4444'),
        'monthly': monthly,
        'yearly':  yearly,
        'best_airports':  best_airports,
        'worst_airports': worst_airports,
        'best_routes':    best_routes,
        'worst_routes':   worst_routes,
    })


# ── 3. Airport Profile ────────────────────────────────────────────────────────
@app.route('/api/airport-profile')
def api_airport_profile():
    airport = request.args.get('airport', 'JFK').upper()
    sub = df_delays[df_delays['ORIGIN'] == airport]
    if len(sub) == 0:
        return jsonify({'error': f'No data for airport {airport}'}), 404
    if airport not in coord_lookup:
        return jsonify({'error': f'{airport} is not in the top-75 airport set'}), 404

    d = sub['DEP_DELAY']
    pct = lambda cond: round(float((cond).mean() * 100), 1)

    # Rank
    apt_ranks = (df_delays[df_delays['hub_size'].notna()]
                 .groupby('ORIGIN')['DEP_DELAY'].mean().sort_values())
    apt_rank  = int(apt_ranks.index.get_loc(airport)) + 1 if airport in apt_ranks.index else 0
    n_airports = len(apt_ranks)

    hub = sub['hub_size'].mode()
    hub_label = {'L':'Large Hub','M':'Medium Hub','S':'Small Hub'}.get(
        hub.iloc[0] if len(hub) else '', 'Unknown')

    # Monthly
    monthly = (sub.groupby('MONTH')['DEP_DELAY'].mean()
               .reindex(range(1,13)).round(2).tolist())

    # Time of day
    tod_data = []
    if 'CRS_DEP_TIME' in sub.columns:
        sub2 = sub.copy()
        sub2['_tod'] = sub2['CRS_DEP_TIME'].apply(get_time_bin)
        tod_order = ['Red-eye','Morning','Afternoon','Evening','Night']
        tod_df = (sub2.groupby('_tod')['DEP_DELAY'].mean()
                  .reindex(tod_order).dropna().round(2))
        tod_data = [{'slot': s, 'avg_delay': round(float(v),1)}
                    for s, v in tod_df.items()]

    # Carriers at this airport
    cp = (sub.groupby('OP_UNIQUE_CARRIER')
          .agg(flights=('DEP_DELAY','count'), avg_delay=('DEP_DELAY','mean'))
          .query('flights >= 100').sort_values('avg_delay'))
    carriers_at = [{'code': c, 'name': CARRIER_NAMES.get(c,c),
                    'avg_delay': round(float(r['avg_delay']),1),
                    'flights': int(r['flights'])}
                   for c, r in cp.iterrows()]

    # Worst destinations + arcs
    dp = (sub.groupby('DEST')
          .agg(flights=('DEP_DELAY','count'), avg_delay=('DEP_DELAY','mean'))
          .query('flights >= 200').sort_values('avg_delay', ascending=False))
    o = coord_lookup[airport]
    dest_arcs = []
    for dest_code, row in dp.head(30).iterrows():
        if dest_code not in coord_lookup:
            continue
        dv = coord_lookup[dest_code]
        dest_arcs.append({
            'dest': dest_code,
            'dest_city': city_lookup.get(dest_code, ''),
            'avg_delay': round(float(row['avg_delay']),1),
            'flights': int(row['flights']),
            'color': delay_color(float(row['avg_delay'])),
            'arc': great_circle_points(o['lat'],o['lon'],dv['lat'],dv['lon'],n=30),
            'dest_coords': coord_lookup[dest_code],
        })

    # Weather
    wx = {}
    if sub['precipitation'].notna().any():
        w = sub[sub['precipitation'].notna()]
        wx = dict(temp=round(float(w['temp_max'].mean()),1),
                  precip=round(float(w['precipitation'].mean()),2),
                  snow=round(float(w['snowfall'].mean()),2),
                  wind=round(float(w['avg_wind'].mean()),1))

    avg_delay = round(float(d.mean()), 1)
    return jsonify({
        'airport': airport,
        'city': city_lookup.get(airport, airport),
        'hub_label': hub_label,
        'n_flights': len(sub),
        'n_carriers': int(sub['OP_UNIQUE_CARRIER'].nunique()),
        'n_destinations': int(sub['DEST'].nunique()),
        'avg_delay': avg_delay,
        'median_delay': round(float(d.median()),1),
        'pct_ontime':  pct(d <= 0),
        'pct_delayed': pct(sub['DEP_DEL15'] == 1),
        'pct_major':   pct(d > 60),
        'rank': apt_rank, 'n_airports': n_airports,
        'rank_label': ('Best third' if apt_rank <= n_airports*.33
                       else 'Middle third' if apt_rank <= n_airports*.66 else 'Worst third'),
        'rank_color': ('#22c55e' if apt_rank <= n_airports*.33
                       else '#f59e0b' if apt_rank <= n_airports*.66 else '#ef4444'),
        'monthly':      monthly,
        'tod_data':     tod_data,
        'carriers_at':  carriers_at,
        'dest_arcs':    dest_arcs,
        'coords':       coord_lookup[airport],
        'weather':      wx,
    })


# ── 4. When to Fly ─────────────────────────────────────────────────────────────
@app.route('/api/when-to-fly')
def api_when_to_fly():
    origin  = request.args.get('origin','').upper()
    dest    = request.args.get('dest','').upper()
    carrier = request.args.get('carrier','').upper()

    mask = ((df_delays['ORIGIN']==origin) &
            (df_delays['DEST']==dest) &
            (df_delays['OP_UNIQUE_CARRIER']==carrier))
    sub = df_delays[mask].copy()

    if len(sub) == 0:
        avail = sorted(df_delays[(df_delays['ORIGIN']==origin) &
                                  (df_delays['DEST']==dest)
                                 ]['OP_UNIQUE_CARRIER'].unique().tolist())
        return jsonify({'error': f'No flights found. Available: {", ".join(avail) or "none"}'}), 404

    tod_order = ['Red-eye','Morning','Afternoon','Evening','Night']
    sub['_tod'] = sub['CRS_DEP_TIME'].apply(get_time_bin)

    pivot = (sub.groupby(['MONTH','_tod'])['DEP_DELAY'].mean()
             .unstack('_tod')
             .reindex(columns=[t for t in tod_order if t in sub['_tod'].unique()])
             .reindex(range(1,13)))
    rate_pivot = (sub.groupby(['MONTH','_tod'])['DEP_DEL15'].mean()
                  .unstack('_tod')
                  .reindex(columns=[t for t in tod_order if t in sub['_tod'].unique()])
                  .reindex(range(1,13)))

    # Heatmap rows for JSON
    heatmap_delay = []
    heatmap_rate  = []
    for m in range(1,13):
        row_d, row_r = [], []
        for tod in pivot.columns:
            v = pivot.loc[m, tod] if m in pivot.index else None
            r = rate_pivot.loc[m, tod] if m in rate_pivot.index else None
            row_d.append(round(float(v),1) if pd.notna(v) else None)
            row_r.append(round(float(r)*100,1) if pd.notna(r) else None)
        heatmap_delay.append(row_d)
        heatmap_rate.append(row_r)

    flat = pivot.stack().dropna()
    best_idx  = flat.idxmin()
    worst_idx = flat.idxmax()

    monthly_avg = (sub.groupby('MONTH')['DEP_DELAY'].mean()
                   .reindex(range(1,13)).round(2).tolist())
    best_month  = int(sub.groupby('MONTH')['DEP_DELAY'].mean().idxmin())
    worst_month = int(sub.groupby('MONTH')['DEP_DELAY'].mean().idxmax())

    dc = REGIONAL_TO_PARENT.get(carrier, carrier)
    primary, accent = AIRLINE_COLORS.get(dc, ('#0f172a','#38bdf8'))

    return jsonify({
        'origin': origin, 'dest': dest,
        'origin_city': city_lookup.get(origin, origin),
        'dest_city':   city_lookup.get(dest, dest),
        'carrier_name': CARRIER_NAMES.get(carrier, carrier),
        'primary': primary, 'accent': accent,
        'n_flights': len(sub),
        'avg_delay': round(float(sub['DEP_DELAY'].mean()),1),
        'tod_cols': list(pivot.columns),
        'heatmap_delay': heatmap_delay,
        'heatmap_rate':  heatmap_rate,
        'best_month':  MONTH_NAMES[best_idx[0]],
        'best_tod':    best_idx[1],
        'best_val':    round(float(flat.min()),1),
        'worst_month': MONTH_NAMES[worst_idx[0]],
        'worst_tod':   worst_idx[1],
        'worst_val':   round(float(flat.max()),1),
        'monthly_avg': monthly_avg,
        'best_month_name':  MONTH_NAMES[best_month],
        'worst_month_name': MONTH_NAMES[worst_month],
    })


# ── Meta endpoints ─────────────────────────────────────────────────────────────
@app.route('/api/airports')
def api_airports():
    return jsonify(sorted(coord_lookup.keys()))

@app.route('/api/carriers')
def api_carriers():
    active = df_delays['OP_UNIQUE_CARRIER'].unique()
    return jsonify([{'code': k, 'name': v} for k, v in CARRIER_NAMES.items() if k in active])

if __name__ == '__main__':
    app.run(debug=True, port=5000)
