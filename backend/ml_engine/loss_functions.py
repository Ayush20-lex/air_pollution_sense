import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor

class AtmosphericInversionLoss(nn.Module):
    """
    Custom Physics-Informed Loss Function for Atmospheric Inversion Modeling.
    
    Combines standard MSE with a physics-informed penalty that enforces conservation 
    of mass under severe stagnation events (low PBL, low wind).
    """
    def __init__(self, lambda_weight: float = 1.0, pbl_threshold: float = 400.0, wind_threshold: float = 2.0):
        super().__init__()
        self.mse = nn.MSELoss()
        self.lambda_weight = lambda_weight
        self.pbl_threshold = pbl_threshold
        self.wind_threshold = wind_threshold

    def forward(
        self, 
        pred_pm25: Tensor, 
        true_pm25: Tensor, 
        prev_pm25: Tensor, 
        pbl_height: Tensor, 
        wind_velocity: Tensor
    ) -> Tensor:
        """
        Computes total loss considering physics constraints.
        
        Args:
            pred_pm25: Predicted PM2.5 concentration at step t.
            true_pm25: Ground truth PM2.5 concentration at step t.
            prev_pm25: Ground truth PM2.5 concentration at step t-1.
            pbl_height: Planetary Boundary Layer height at step t.
            wind_velocity: Wind velocity magnitude at step t.
            
        Returns:
            Total loss scalar (MSE + Physics Penalty).
        """
        mse_loss = self.mse(pred_pm25, true_pm25)
        
        # Trap condition: PBL < 400m AND Wind < 2.0 m/s
        trapped_mask = (pbl_height < self.pbl_threshold) & (wind_velocity < self.wind_threshold)
        
        # If trapped, PM2.5 cannot decrease (pred_pm25 < prev_pm25 is physically invalid)
        reduction = prev_pm25 - pred_pm25
        
        # Apply penalty only to invalid reduction
        physics_violation = F.relu(reduction) * trapped_mask.float()
        physics_penalty = physics_violation.mean()
        
        total_loss = mse_loss + (self.lambda_weight * physics_penalty)
        return total_loss
