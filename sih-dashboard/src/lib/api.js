const API_BASE = 'http://localhost:8000/api/v1';

export async function fetchForecastGrid(step, channels = '0,6,9,8') {
  try {
    const res = await fetch(`${API_BASE}/forecast/grid?step=${step}&channels=${channels}&compress=false`);
    if (!res.ok) throw new Error('Failed to fetch grid data');
    const data = await res.json();
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

export async function fetchDashboardData() {
  try {
    const requests = [
      fetch(`${API_BASE}/status`),
      fetch(`${API_BASE}/forecast/station/delhi?channel=0`),
      fetch(`${API_BASE}/forecast/station/delhi?channel=6`),
      fetch(`${API_BASE}/forecast/station/delhi?channel=9`),
      fetch(`${API_BASE}/forecast/station/delhi?channel=8`),
      fetch(`${API_BASE}/alerts/inversion`),
      fetch(`${API_BASE}/policy/grap`)
    ];

    const responses = await Promise.all(
      requests.map(p => p.then(res => res.json()).catch(e => ({ error: e.message })))
    );

    const [statusRes, pm25, temp, pbl, solar, alertsRes, policyRes] = responses;

    if (statusRes.error) {
      return { fatalError: "Failed to connect to backend: " + statusRes.error };
    }

    const series = [];
    if (!pm25.error && !temp.error && !pbl.error && !solar.error) {
      // 72 hours forecast
      for (let i = 0; i < 72; i++) {
        series.push({
          hour: i,
          pm25: pm25.values?.[i] ?? 0,
          temp: temp.values?.[i] ?? 0,
          pbl: pbl.values?.[i] ?? 0,
          solar: solar.values?.[i] ?? 0
        });
      }
    }

    return {
      modelStatus: statusRes.error ? null : statusRes,
      series: series.length > 0 ? series : [],
      inversionAlerts: alertsRes.error ? [] : alertsRes,
      grapPolicy: policyRes.error ? null : policyRes,
      errors: {
        status: statusRes.error,
        station: pm25.error,
        alerts: alertsRes.error,
        policy: policyRes.error
      }
    };
  } catch (err) {
    return { fatalError: err.message };
  }
}
