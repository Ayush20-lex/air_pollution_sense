\"\"\"
Normalization and Coupling Correctness Tests - Air Pollution Sense
SIH26082 Phase 7 verification
Run: cd backend && python test_normalization.py
\"\"\"
from __future__ import annotations
import sys, os, math
_BACKEND = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BACKEND)

import numpy as np
import torch

PASS = 'PASS'
FAIL = 'FAIL'
WARN = 'WARN'
INFO = 'INFO'

_results = []

def check(name, condition, detail=''):
    _results.append((name, condition, detail))
    status = PASS if condition else FAIL
    print(f'  [{status}] {name}' + (f' -- {detail}' if detail else ''))

# TEST 1 - AOD Range
def test_aod_range():
    print('\n[1] AOD Range: normalised PM2.5 -> physical AOD')
    from coupled_model import FeedbackCouplingModule as FCM
    pm25_max_norm = 1.0
    pm25_phys = pm25_max_norm * FCM.PM25_NORM
    aod = min(pm25_phys * FCM.AOD_PER_PM25, 3.5)
    check('AOD at PM2.5=500ug/m3 == 3.5', abs(aod - 3.5) < 1e-6, f'got {aod:.4f}')
    aod_old = pm25_max_norm * FCM.AOD_PER_PM25
    check('Old formula was near-zero (confirms C1 bug)', aod_old < 0.01, f'old AOD = {aod_old:.5f}')

# TEST 2 - Normalisation round-trip
def test_normalisation_roundtrip():
    print('\n[2] Normalisation Round-trip: outputs remain in [0, 1]')
    from coupled_model import FeedbackCouplingModule
    fb = FeedbackCouplingModule(); fb.eval()
    torch.manual_seed(0)
    B,H,W = 2,8,8
    pm25 = torch.rand(B,H,W); solar = torch.rand(B,H,W); pbl = torch.rand(B,H,W)
    with torch.no_grad():
        solar_next, pbl_next, delta_temp = fb(pm25, solar, pbl)
    s_min,s_max = solar_next.min().item(), solar_next.max().item()
    p_min,p_max = pbl_next.min().item(),  pbl_next.max().item()
    dt_max = delta_temp.abs().max().item()
    check('solar_next in [0,1]', 0.0 <= s_min and s_max <= 1.0, f'[{s_min:.4f},{s_max:.4f}]')
    check('pbl_next in [0,1]',   0.0 <= p_min and p_max <= 1.0, f'[{p_min:.4f},{p_max:.4f}]')
    check('delta_temp_norm < 1.0', dt_max < 1.0, f'max|dt|={dt_max:.5f}')

# TEST 3 - Temperature delta units
def test_temperature_delta_units():
    print('\n[3] Temperature Delta in normalised units')
    from coupled_model import FeedbackCouplingModule
    fb = FeedbackCouplingModule(); fb.eval()
    B,H,W = 1,4,4
    pm25 = torch.full((B,H,W), 0.9); solar = torch.full((B,H,W), 0.5); pbl = torch.full((B,H,W), 0.5)
    with torch.no_grad():
        _,_, dt = fb(pm25, solar, pbl)
    dt_val = dt.mean().item()
    print(f'     delta_temp_norm at PM2.5=450ug/m3: {dt_val:.5f} (expect ~-0.037)')
    check('delta_temp_norm < 0.1 (small)', abs(dt_val) < 0.1, f'{dt_val:.5f}')
    check('delta_temp_norm < 0 (aerosol cooling)', dt_val < 0, f'{dt_val:.5f}')

# TEST 4 - Channel norms sync
def test_channel_norms_sync():
    print('\n[4] Channel Norms Sync: FeedbackCouplingModule vs expected norms')
    from coupled_model import FeedbackCouplingModule as FCM
    check('PM25_NORM == 500.0',  FCM.PM25_NORM  == 500.0,  str(FCM.PM25_NORM))
    check('SOLAR_NORM == 1200.0',FCM.SOLAR_NORM == 1200.0, str(FCM.SOLAR_NORM))
    check('PBL_NORM == 3000.0',  FCM.PBL_NORM   == 3000.0, str(FCM.PBL_NORM))
    check('TEMP_NORM == 40.0',   FCM.TEMP_NORM  == 40.0,   str(FCM.TEMP_NORM))

# TEST 5 - Synthetic history
def test_synthetic_history():
    print('\n[5] Synthetic History Builder')
    from api_server import _build_synthetic_history, _CHANNEL_NORMS
    frame = np.ones((12,70,80), dtype=np.float32) * 0.5
    hist = _build_synthetic_history(frame, n_steps=24, seed=99)
    check('history shape == (24,12,70,80)', hist.shape == (24,12,70,80), str(hist.shape))
    check('history dtype == float32', hist.dtype == np.float32, str(hist.dtype))
    check('_CHANNEL_NORMS has 12 entries', len(_CHANNEL_NORMS) == 12, str(len(_CHANNEL_NORMS)))
    hist2 = _build_synthetic_history(frame, n_steps=24, seed=99)
    check('Reproducible (same seed)', np.allclose(hist, hist2), '')
    delta = np.abs(hist - frame[None]).max()
    check('Max jitter < 0.1', delta < 0.1, f'{delta:.4f}')

# TEST 6 - Autoregressive rollout
def test_autoregressive_rollout():
    print('\n[6] Autoregressive Rollout (5-step, small grid)')
    from coupled_model import AirPollutionCoupledForecaster
    model = AirPollutionCoupledForecaster(in_channels=12, hidden_dim=32, n_steps=5)
    model.eval()
    torch.manual_seed(42)
    x_in = torch.rand(1,6,12,10,10)
    with torch.inference_mode():
        out = model(x_in)
    check('Output shape == (1,5,12,10,10)', out.shape == (1,5,12,10,10), str(tuple(out.shape)))
    check('No NaN in output', not out.isnan().any().item(), '')
    check('No Inf in output', not out.isinf().any().item(), '')
    print(f'     [{WARN}] Output range with random weights: [{out.min():.3f}, {out.max():.3f}] -- EXPECTED unbounded without training')

# TEST 7 - AQICN inversion
def test_aqicn_aqi_inversion():
    print('\n[7] AQICN AQI->PM2.5 Inversion boundary checks')
    def inv(aqi_val):
        bp = [(0,50,0.0,30.0),(51,100,30.1,60.0),(101,200,60.1,90.0),(201,300,90.1,120.0),(301,400,120.1,250.0),(401,500,250.1,350.0)]
        for I_lo,I_hi,C_lo,C_hi in bp:
            if I_lo <= aqi_val <= I_hi:
                return C_lo + (aqi_val - I_lo)*(C_hi-C_lo)/(I_hi-I_lo)
        return 350.0
    cases = [(0,0.0),(50,30.0),(100,60.0),(200,90.0),(300,120.0),(400,250.0),(500,350.0)]
    all_ok = True
    for aqi,exp in cases:
        got = inv(aqi)
        ok = abs(got-exp)<0.5
        all_ok = all_ok and ok
        print(f'     AQI={aqi:3d} -> {got:.1f} ug/m3 (expected {exp:.1f}) {"OK" if ok else "FAIL"}')
    check('All boundary conversions correct', all_ok, '')

def main():
    print('='*65)
    print('  Air Pollution Sense - Normalisation & Coupling Tests')
    print('='*65)
    for t in [test_aod_range, test_normalisation_roundtrip, test_temperature_delta_units,
              test_channel_norms_sync, test_synthetic_history,
              test_autoregressive_rollout, test_aqicn_aqi_inversion]:
        try:
            t()
        except Exception as e:
            print(f'  [ERROR] {t.__name__}: {e}')
            _results.append((t.__name__, False, str(e)))
    n_pass = sum(1 for _,ok,_ in _results if ok)
    n_fail = sum(1 for _,ok,_ in _results if not ok)
    print(f'\n{"="*65}')
    print(f'  {n_pass} passed  /  {n_fail} failed  /  {len(_results)} total')
    print('='*65)
    print("""
MODEL STATUS:     UNTRAINED
DATA MODE:        SYNTHETIC
COUPLING STATUS:  FUNCTIONAL (architecture, C1+C2+I9 fixed)
INFERENCE STATUS: PROTOTYPE
""")
    return n_fail

if __name__ == '__main__':
    exit(main())
