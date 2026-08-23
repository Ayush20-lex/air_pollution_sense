import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor

class FeedbackCouplingBlock(nn.Module):
    """
    Implements a bidirectional physical feedback loop where high aerosol loading 
    suppresses solar irradiance and compresses the planetary boundary layer.
    """
    def __init__(self, pm25_threshold: float = 150.0):
        super().__init__()
        self.pm25_threshold = pm25_threshold

    def forward(self, pred_pm25: Tensor, solar_irradiance: Tensor, pbl_height: Tensor) -> tuple[Tensor, Tensor]:
        """
        Dynamically adjusts meteorological variables based on PM2.5 prediction.
        
        Args:
            pred_pm25: Predicted PM2.5 tensor at step t.
            solar_irradiance: Baseline solar irradiance tensor for step t+1.
            pbl_height: Baseline PBL height tensor for step t+1.
            
        Returns:
            Tuple of modified (solar_irradiance, pbl_height) for step t+1.
        """
        # Calculate excess PM2.5 dynamically (softplus ensures non-negative response)
        excess_pm25 = F.softplus(pred_pm25 - self.pm25_threshold)
        
        # Exponential attenuation corresponding to physical absorption/scattering
        solar_attenuation = torch.exp(-0.001 * excess_pm25)
        pbl_compression = torch.exp(-0.002 * excess_pm25)
        
        coupled_solar = solar_irradiance * solar_attenuation
        coupled_pbl = pbl_height * pbl_compression
        
        return coupled_solar, coupled_pbl


class ConvLSTMCell(nn.Module):
    """
    Spatiotemporal ConvLSTM building block.
    """
    def __init__(self, input_dim: int, hidden_dim: int, kernel_size: int = 3):
        super().__init__()
        padding = kernel_size // 2
        self.conv = nn.Conv2d(input_dim + hidden_dim, 4 * hidden_dim, kernel_size, padding=padding)
        self.hidden_dim = hidden_dim

    def forward(self, x: Tensor, state: tuple[Tensor, Tensor]) -> tuple[Tensor, Tensor]:
        h_prev, c_prev = state
        combined = torch.cat([x, h_prev], dim=1)
        gates = self.conv(combined)
        
        i, f, o, g = torch.chunk(gates, 4, dim=1)
        i = torch.sigmoid(i)
        f = torch.sigmoid(f)
        o = torch.sigmoid(o)
        g = torch.tanh(g)
        
        c_next = f * c_prev + i * g
        h_next = o * torch.tanh(c_next)
        
        return h_next, c_next


class CoupledSpatiotemporalForecaster(nn.Module):
    """
    Physics-Informed Coupled Spatiotemporal Forecaster (SIH26082).
    
    Integrates ConvLSTM with dynamic bidirectional meteorological coupling,
    enforcing environmental feedbacks in real-time prediction rollouts.
    """
    def __init__(self, meteo_dim: int = 11, hidden_dim: int = 32):
        super().__init__()
        # Input channel: prev_pm25 (1) + met_vars (meteo_dim)
        self.lstm_cell = ConvLSTMCell(input_dim=1 + meteo_dim, hidden_dim=hidden_dim)
        
        # Linear spatial predictor
        self.predictor = nn.Conv2d(hidden_dim, 1, kernel_size=1)
        
        self.coupling_block = FeedbackCouplingBlock()
        self.hidden_dim = hidden_dim

    def forward(self, pm25_initial: Tensor, met_seq: Tensor) -> tuple[Tensor, Tensor, Tensor]:
        """
        Unrolls spatiotemporal forecasting with dynamic atmospheric coupling.
        
        Args:
            pm25_initial: (B, 1, H, W) Initial PM2.5 state at t=0.
            met_seq: (B, T, meteo_dim, H, W) Baseline meteorological forcing variables.
                     Assumes dim 3 is temperature (proxy for solar_irradiance) and dim 7 is pbl_height based on external pipeline ordering.
                     
        Returns:
            Tuple of tensors containing step-by-step predictions and coupled histories:
            (pm25_preds, coupled_solar_history, coupled_pbl_history)
        """
        B, T, C, H, W = met_seq.shape
        
        h = torch.zeros(B, self.hidden_dim, H, W, device=met_seq.device)
        c = torch.zeros(B, self.hidden_dim, H, W, device=met_seq.device)
        
        current_pm25 = pm25_initial
        pm25_preds = []
        coupled_solar_history = []
        coupled_pbl_history = []
        
        for t in range(T):
            current_met = met_seq[:, t].clone()
            
            # Apply bidirectional feedback coupling for steps after t=0
            if t > 0:
                base_solar = current_met[:, 3:4]
                base_pbl = current_met[:, 7:8]
                
                coupled_solar, coupled_pbl = self.coupling_block(current_pm25, base_solar, base_pbl)
                
                # Replace baseline forcing with coupled meteorology
                current_met[:, 3:4] = coupled_solar
                current_met[:, 7:8] = coupled_pbl
                
                coupled_solar_history.append(coupled_solar)
                coupled_pbl_history.append(coupled_pbl)
            else:
                coupled_solar_history.append(current_met[:, 3:4])
                coupled_pbl_history.append(current_met[:, 7:8])
            
            x_t = torch.cat([current_pm25, current_met], dim=1)
            h, c = self.lstm_cell(x_t, (h, c))
            
            current_pm25 = self.predictor(h)
            pm25_preds.append(current_pm25)
            
        pm25_preds = torch.stack(pm25_preds, dim=1)
        coupled_solar_history = torch.stack(coupled_solar_history, dim=1)
        coupled_pbl_history = torch.stack(coupled_pbl_history, dim=1)
        
        return pm25_preds, coupled_solar_history, coupled_pbl_history
