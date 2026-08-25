import time
import requests
import subprocess
import threading
import sys
import torch

print(f"torch.cuda.is_available(): {torch.cuda.is_available()}")

# Start the server
def run_server():
    subprocess.run([sys.executable, "-m", "uvicorn", "backend.api_server:app", "--host", "127.0.0.1", "--port", "8000"])

server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()

# Wait for server to start
import urllib.request
from urllib.error import URLError

for _ in range(20):
    try:
        urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=1)
        break
    except Exception:
        time.sleep(1)
else:
    print("Server failed to start")
    sys.exit(1)

endpoints = [
    ("/health", "GET /health"),
    ("/api/v1/forecast/grid", "GET /api/v1/forecast/grid"),
    ("/api/v1/forecast/station/DEL001", "GET /api/v1/forecast/station/{id}"),
    ("/api/v1/alerts/inversion", "GET /api/v1/alerts/inversion")
]

for url, name in endpoints:
    t0 = time.time()
    r = requests.get(f"http://127.0.0.1:8000{url}")
    t1 = time.time()
    print(f"Latency for {name}: {t1 - t0:.4f} seconds (Status: {r.status_code})")

