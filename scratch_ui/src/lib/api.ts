export async function fetchForecastGrid(step: number) {
  return {
    data: {
      meta: {},
      features: [
        {
          geometry: { coordinates: [77.2090, 28.6139] },
          properties: { pm25: 150 + step * 2, pbl: 400 - step * 10 }
        },
        {
          geometry: { coordinates: [77.1000, 28.7000] },
          properties: { pm25: 120 + step * 1.5, pbl: 450 - step * 5 }
        }
      ]
    },
    error: null
  }
}

export async function fetchDashboardData() {
  const series = Array.from({ length: 24 }, (_, i) => ({
    hour: i * 3,
    pm25: 100 + Math.sin(i / 3) * 50,
    temp: 20 + Math.sin(i / 4) * 10,
    pbl: 500 + Math.cos(i / 3) * 200,
    solar: 800 * Math.max(0, Math.sin((i - 6) / 24 * Math.PI))
  }))

  return {
    modelStatus: {
      data_mode: 'synthetic',
      weights_loaded: false,
      model_name: 'CoupledForecaster-Demo',
      sources: {
        cpcb_waqi: 'synthetic',
        imd_met: 'synthetic',
        nasa_firms: 'synthetic'
      }
    },
    series,
    inversionAlerts: [
      {
        zone_id: 'DELHI-NCR-CENTRAL',
        severity: 'EMERGENCY',
        isi_score: 0.85,
        pm25_peak: 350
      },
      {
        zone_id: 'DELHI-NCR-NORTH',
        severity: 'WARNING',
        isi_score: 0.65,
        pm25_peak: 210
      }
    ],
    grapPolicy: {
      worst_case_aqi: 405,
      grap: {
        stage: 'IV',
        category: 'Severe Plus'
      }
    }
  }
}
