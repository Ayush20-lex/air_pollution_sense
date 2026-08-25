### SLIDE 1 — TITLE PAGE
**PROJECT TITLE:** AirSense: Physics-Informed Spatiotemporal Air Pollution Forecasting for Delhi NCR
**SUBTITLE:** Anticipating the NCR's Air Quality Evolution in 3D

**PROBLEM STATEMENT ID:** [INSERT PROBLEM STATEMENT ID]
**PROBLEM STATEMENT TITLE:** [INSERT OFFICIAL PROBLEM STATEMENT TITLE]
**THEME:** [INSERT REGISTERED THEME]
**PS CATEGORY:** Software
**TEAM ID:** [INSERT TEAM ID]
**TEAM NAME:** [INSERT TEAM NAME]

---

### SLIDE 2 — PROPOSED SOLUTION
**A. PROBLEM**
- Reactive monitoring: AQI dashboards show the past, not the 72-hour future.
- Spatial blind spots: Severe localized pollution is missed between sparse physical stations.
- Meteorological variability: Wind and temperature dynamically shift plumes hourly.
- Inversion/stagnation: Sudden trapping of pollutants goes unpredicted.
- Regional fire influence: Plume transport from stubble burning is disconnected from urban modeling.

**B. OUR SOLUTION**
- **72-hour spatial forecasting pipeline** predicting continuous 3D pollution evolution.
- **70 × 80 NCR spatial grid** covering urban and peripheral zones.
- **12-channel environmental state** evaluating weather, fires, and air quality simultaneously.
- **Meteorology + Air Quality + Fire fusion** via Inverse Distance Weighting (IDW).
- **Inversion & PBL awareness** calculating localized atmospheric trapping risks.
- **Interactive 3D decision-support dashboard** enabling temporal scrubbing of the forecast.

**C. UNIQUE / USP**
**Primary USP: TWO-WAY COUPLED FORECASTING**
*(Include visual diagram)*
`High PM2.5` → `Aerosol/solar attenuation` → `PBL reduction` → `Pollution trapping` → `PM2.5 spike feedback`

**Secondary USPs:**
- Spatially explicit interpolation rather than point-based statistical models.
- NASA FIRMS fire/plume transport integration.
- Fast, local GPU-accelerated inference architecture.

*(Include small screenshot of the AirSense 3D dashboard showing a plume forecast here)*

---

### SLIDE 3 — TECHNICAL APPROACH
**IMPLEMENTATION FLOW DIAGRAM**
*(Include a large flowchart)*
`External Data` → `Data Ingestion` → `Quality Control` → `Spatial Fusion` → `12-Channel 70×80 Grid` → `Coupled ConvLSTM` → `Physics Feedback` → `72h Forecast` → `FastAPI` → `AirSense Dashboard`

**DATA SOURCES**
- Copernicus CAMS Global Reanalysis (Composition)
- Copernicus ERA5 (Meteorology)
- NASA FIRMS (Fire Radiative Power)
- Operational station data (OpenAQ/CPCB)

**MODEL INPUT (12 Channels)**
- PM2.5, PM10, O3, NOx
- U & V wind components
- Temperature, Relative Humidity
- Surface Solar Radiation, PBL Height
- FRP (Fires), Smoke Transport

**MODEL ARCHITECTURE**
- Spatiotemporal ConvLSTM
- Spatial Attention mechanisms
- Dynamic Graph Reasoning
- Physics Feedback Coupling (Atmospheric constraints)
- Autoregressive 72h decoder

**TECH STACK**
- Python, PyTorch, CUDA
- FastAPI, Pydantic
- React, Vite, Deck.gl, MapLibre

**VERIFIED SOFTWARE INFERENCE LATENCIES**
*(Tested on NVIDIA RTX 3050 6GB local hardware)*
- Grid forecast generation: **≈ 1.69 s**
- Station forecast extraction: **≈ 1.26 s**
- Inversion analysis endpoint: **≈ 1.24 s**
*(Note: These are inference speeds, not accuracy metrics)*

---

### SLIDE 4 — FEASIBILITY AND VIABILITY
**A. TECHNICAL FEASIBILITY**
- Fully implemented modular architecture (React frontend + FastAPI backend).
- GPU-accelerated local inference pipeline successfully verified (sub-2 second latency).
- 3D spatial visualization scrubbing implemented via Deck.gl.

**B. DATA FEASIBILITY**
- Validated Copernicus ERA5 & CAMS Global historical atmospheric sources.
- NASA FIRMS satellite data integration validated.
- 7-day pilot data-engineering pipeline fully prototyped and validated (Mass historical dataset generation is the next phase).

**C. RISKS → MITIGATION STRATEGIES**
- **Risk 1:** External API failure or rate limiting.
  → **Mitigation:** Built-in retries, caching, and fallback to explicit DEMO/SYNTHETIC mode to maintain operational uptime.
- **Risk 2:** Historical data gaps in training pipeline.
  → **Mitigation:** Strict quality flags, controlled IDW interpolation, and sequence rejection for severely degraded windows.
- **Risk 3:** Local GPU limitations for edge deployment.
  → **Mitigation:** Proven CUDA acceleration on consumer RTX 3050; future mixed-precision (FP16) optimizations planned.
- **Risk 4:** Physically implausible model predictions.
  → **Mitigation:** Implementation of physics-informed loss constraints mimicking real atmospheric thermodynamics.
- **Risk 5:** Scientific accuracy not yet validated (current prototype uses synthetic/random weights).
  → **Mitigation:** Roadmap strictly enforces mass historical training, held-out evaluation, and baseline comparisons prior to deployment.

---

### SLIDE 5 — IMPACT AND BENEFITS
**A. ENVIRONMENTAL BENEFITS**
- True spatial pollution awareness, visualizing safe vs. hazardous blocks.
- Earlier anticipation of severe pollution episodes and sudden atmospheric inversion trapping.
- Clearer visibility into how regional fire events influence urban air quality.

**B. OPERATIONAL BENEFITS**
- Shifts monitoring from reactive observation to proactive, 72-hour planning.
- Highlights localized risk zones to prevent broad, ineffective interventions.
- Provides highly visual, interactive 3D decision support for authorities.

**C. DECISION SUPPORT INTELLIGENCE**
- **WHAT?** → Continuous visualization of the regional pollution state.
- **WHERE?** → High-resolution spatial risk and inversion mapping.
- **WHEN?** → Forward-looking 72-hour timeline scrubbing.
- **WHY?** → Distinguishing between fire smoke transport and local meteorological stagnation.

**D. LONGER-TERM POTENTIAL (FUTURE ROADMAP)**
- Enabling highly localized Graded Response Action Plan (GRAP) implementations (e.g., targeted construction bans).
- Integration with smart-city traffic and emission mitigation systems.
- Validated, localized public-health alerts to protect vulnerable populations.

---

### SLIDE 6 — RESEARCH AND REFERENCES
**DATA SOURCES**
- Copernicus Climate Change Service (C3S). *ERA5: Fifth generation of ECMWF atmospheric reanalyses*.
- Copernicus Atmosphere Monitoring Service (CAMS). *CAMS Global Reanalysis (EAC4)*.
- NASA Earthdata. *Fire Information for Resource Management System (FIRMS)*.
- Central Pollution Control Board (CPCB), Government of India.

**SCIENTIFIC / ML REFERENCES**
- Shi, X., et al. (2015). "Convolutional LSTM Network: A Machine Learning Approach for Precipitation Nowcasting." *NeurIPS*.
- Karniadakis, G. E., et al. (2021). "Physics-informed machine learning." *Nature Reviews Physics*.
- Ding, A. J., et al. (2016). "Enhanced haze pollution by black carbon in megacities in China." *Geophysical Research Letters* (Aerosol-boundary layer feedback).
- Karnae, S., & John, K. (2011). "Aerosol Optical Depth and PM2.5 Relationships." *J. Air & Waste Management Assoc.*

**TECHNICAL DOCUMENTATION**
- PyTorch (CUDA-accelerated deep learning framework).
- FastAPI (High-performance Python API standard).
- Deck.gl & MapLibre (WebGL2-powered spatial visualization).

---

### FINAL VERIFIED NUMBERS
- **70×80** continuous NCR spatial grid.
- **12** physical/environmental model channels.
- **72-hour** autoregressive forecast horizon.
- **≈ 1.69s** grid forecast inference time.
- **≈ 1.26s** station forecast inference time.
- **≈ 1.24s** inversion analysis inference time.
- **RTX 3050 6GB** local GPU verification hardware.

### CURRENT LIMITATIONS (Transparent Prototype Status)
- The current interactive dashboard and model operate using **synthetic/random weights** to demonstrate the software architecture and inference pipeline.
- The model currently possesses **no scientifically validated accuracy** (no MAE/RMSE metrics).
- The mass historical training pipeline across ERA5/CAMS datasets is still pending execution.
- Modeled atmospheric physics relationships currently utilize mathematical approximations requiring rigorous empirical validation.

### DO NOT CLAIM
- Do not claim the model is highly accurate, "accurate," or scientifically validated.
- Do not claim the system is fully trained on real historical data.
- Do not claim the system is actively deployed by the government or saving actual lives/money.
- Do not claim any real RMSE, MAE, or R² performance metrics.
- Do not claim that the physics-informed loss perfectly mirrors real-world dynamics without error.

### FINAL CHECK:
✅ Exactly 6 Slides.
✅ Matches Official SIH Structure & Headings perfectly.
✅ No Slide 7 or 8 included.
✅ Verified against the AirSense source of truth.
✅ Correctly characterizes the project as a GPU-accelerated prototype utilizing synthetic/demo weights.
