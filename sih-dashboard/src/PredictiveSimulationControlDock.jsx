import React from 'react';

export const PredictiveSimulationControlDock = ({ step, setStep, playing, setPlaying, speed, setSpeed }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%', height: '56px', padding: '0 24px', backgroundColor: '#090D16', borderTop: '1px solid #1e293b', color: '#94a3b8', fontFamily: 'monospace', fontSize: '12px' }}>
      
      {/* Playback Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button 
          onClick={() => {
            setStep(prev => Math.max(0, prev - 1));
            setPlaying(false);
          }}
          style={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
        </button>
        <button 
          onClick={() => {
            if (step >= 71) setStep(0);
            setPlaying(!playing);
          }}
          style={{ backgroundColor: '#0f172a', border: '1px solid #10b981', color: '#10b981', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          )}
        </button>
        <button 
          onClick={() => {
            setStep(prev => Math.min(71, prev + 1));
            setPlaying(false);
          }}
          style={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
        </button>
      </div>

      {/* Speed Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {[1, 2, 5].map((s) => (
          <button 
            key={s} 
            onClick={() => setSpeed(s)}
            style={{ backgroundColor: speed === s ? '#064e3b' : '#0f172a', border: speed === s ? '1px solid #10b981' : '1px solid #334155', color: speed === s ? '#34d399' : '#94a3b8', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Slider */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', margin: '0 12px' }}>
        <input 
          type="range" 
          min="0" 
          max="71" 
          value={step}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setStep(Math.min(Math.max(0, val), 71));
            setPlaying(false);
          }}
          style={{ width: '100%', height: '6px', backgroundColor: '#1e293b', borderRadius: '4px', accentColor: '#10b981', cursor: 'pointer', outline: 'none' }} 
        />
      </div>

      {/* Status Indicator */}
      <div style={{ whiteSpace: 'nowrap', fontWeight: 600, color: '#10b981', letterSpacing: '0.05em' }}>
        T+{step}h / 71h
      </div>
    </div>
  );
};
