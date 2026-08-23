import torch
from torch.utils.data import Dataset, DataLoader
import numpy as np

class DelhiNCRCoupledDataset(Dataset):
    """
    Dataset for loading and normalizing coupled meteorological and chemical data.
    Assumes .npy shape: (Samples, Time_Steps, Channels, Height, Width)
    Channel order based on ModelFeaturePayload:
    0: pm25
    1: pm10
    2: o3
    3: nox
    4: temperature (acts as proxy for solar_irradiance)
    5: humidity
    6: wind_speed
    7: wind_direction
    8: pbl_height
    9: ventilation_index
    10: inversion_flag
    11: upstream_fire_count_24h
    """
    def __init__(self, npy_path: str, normalize: bool = True):
        self.data = np.load(npy_path)
        self.data = torch.tensor(self.data, dtype=torch.float32)
        
        if normalize:
            # Z-score normalization per channel
            mean_vals = self.data.mean(dim=(0, 1, 3, 4), keepdim=True)
            std_vals = self.data.std(dim=(0, 1, 3, 4), keepdim=True)
            std_vals = torch.clamp(std_vals, min=1e-5)
            self.data = (self.data - mean_vals) / std_vals

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        return self.data[idx]

def get_dataloader(npy_path: str, batch_size: int = 8, shuffle: bool = True, num_workers: int = 2):
    """
    Returns a DataLoader yielding batches in the shape (Batch, Time_Steps, Channels, Height, Width).
    """
    dataset = DelhiNCRCoupledDataset(npy_path)
    return DataLoader(dataset, batch_size=batch_size, shuffle=shuffle, num_workers=num_workers)
