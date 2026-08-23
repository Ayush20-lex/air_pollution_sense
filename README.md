# Air Pollution Sense - SIH Dashboard

This repository contains the backend simulation engine and the frontend visualizer for the Atmospheric Intelligence Dashboard (AERIS/OPS). 

## Project Structure
- `backend/`: FastAPI server that runs the coupled ConvLSTM engine, physics loss models, and external data fusion.
- `sih-dashboard/`: React + Vite frontend dashboard featuring 3D visualizations (Deck.gl/Maplibre) and analytics.
- `external_data_pipeline/`: Data ingestion scripts for satellite, sensors, and HRRR model feeds.

## How to Run the Project locally

### 1. Start the Backend (FastAPI)
The backend requires Python. It is recommended to use a virtual environment.

```bash
# Navigate to the backend directory
cd backend

# Create a virtual environment (optional but recommended)
python -m venv venv
# Activate it (Windows)
venv\Scripts\activate
# Activate it (Mac/Linux)
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the API server
python api_server.py
```
The backend server will start on `http://localhost:8000`.

### 2. Start the Frontend (React + Vite)
The frontend requires Node.js.

```bash
# Open a new terminal and navigate to the dashboard directory
cd sih-dashboard

# Install dependencies
npm install

# Start the development server
npm run dev
```
The frontend dashboard will start on `http://localhost:5173`. Open this URL in your browser.

## Troubleshooting

- **Black screen on the 3D Map:** Ensure the backend is running properly and that no browser extensions are blocking WebGL or fetching from `localhost`.
- **Backend timeouts:** The initial backend model inference may take a few seconds. Successive requests are cached.
