with open('ml_pipeline/scripts/04_validate_pilot.py', 'r') as f:
    c = f.read()
c = c.replace("freq='H'", "freq='h'").replace('freq="H"', 'freq="h"')
c = c.replace("resample('H')", "resample('h')").replace('resample("H")', 'resample("h")')
c = c.replace(".floor('H')", ".floor('h')").replace('.floor("H")', '.floor("h")')
with open('ml_pipeline/scripts/04_validate_pilot.py', 'w') as f:
    f.write(c)
