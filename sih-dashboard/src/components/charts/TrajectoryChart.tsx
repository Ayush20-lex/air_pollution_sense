
import * as React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { aqiColor } from '@/lib/aqi';
import type { Frame } from '@/lib/data';
import { SERIES } from '@/lib/tokens';

type Row = {
  hour: number;
  label: string;
  pm25: number;
  wind: number;
  pbl: number;
};

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row: Row = payload[0].payload;
  return (
    <div className="glass min-w-[150px] space-y-1 p-2.5">
      <div className="font-mono text-2xs uppercase tracking-[0.2em] text-faint">
        {row.hour === 0 ? 'NOW' : `T +${row.hour}h`}
      </div>
      <TipRow label="PM2.5" value={`${row.pm25.toFixed(1)} µg/m³`} color={aqiColor(row.pm25)} />
      <TipRow label="Wind" value={`${row.wind.toFixed(1)} m/s`} color={SERIES.wind} />
      <TipRow label="PBL" value={`${row.pbl} m`} color={SERIES.pbl} />
    </div>
  );
}

function TipRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-muted">
        <span className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="font-mono text-2xs font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

/**
 * 72-hour trajectory: PM2.5 concentration (left axis, area) plotted against
 * wind speed (right axis, line) so the ventilation relationship is legible.
 */
export function TrajectoryChart({
  frames,
  currentHour,
  districtId,
  onScrub,
  height = 190,
}: {
  frames: Frame[];
  currentHour: number;
  districtId?: string | null;
  onScrub?: (hour: number) => void;
  height?: number;
}) {
  const data: Row[] = React.useMemo(
    () =>
      frames.map((f) => {
        const s = districtId ? f.districts[districtId] : null;
        return {
          hour: f.hour,
          label: f.label,
          pm25: s ? s.pm25 : f.avgPm25,
          wind: s ? s.windSpeed : f.avgWind,
          pbl: s ? s.pbl : f.avgPbl,
        };
      }),
    [frames, districtId],
  );

  const peak = Math.max(...data.map((d) => d.pm25));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 4, bottom: 0, left: -18 }}
          onClick={(e: any) => {
            if (onScrub && e?.activePayload?.[0]) onScrub(e.activePayload[0].payload.hour);
          }}
        >
          <defs>
            <linearGradient id="pmFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={aqiColor(peak)} stopOpacity={0.45} />
              <stop offset="100%" stopColor={aqiColor(peak)} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="2 4"
            stroke="rgb(var(--as-hairline))"
            strokeOpacity={0.5}
            vertical={false}
          />

          <XAxis
            dataKey="hour"
            ticks={[0, 12, 24, 36, 48, 60, 72]}
            tickFormatter={(h) => (h === 0 ? 'NOW' : `+${h}h`)}
            tick={{ fontSize: 9, fontFamily: 'var(--font-mono)', fill: 'rgb(var(--as-faint))' }}
            axisLine={{ stroke: 'rgb(var(--as-hairline))' }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            yAxisId="pm"
            tick={{ fontSize: 9, fontFamily: 'var(--font-mono)', fill: 'rgb(var(--as-faint))' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <YAxis
            yAxisId="wind"
            orientation="right"
            domain={[0, 8]}
            tick={{ fontSize: 9, fontFamily: 'var(--font-mono)', fill: 'rgb(var(--as-faint))' }}
            axisLine={false}
            tickLine={false}
            width={24}
          />

          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgb(var(--as-accent))', strokeWidth: 1, strokeDasharray: '3 3' }} />

          <Area
            yAxisId="pm"
            type="monotone"
            dataKey="pm25"
            stroke={aqiColor(peak)}
            strokeWidth={1.8}
            fill="url(#pmFill)"
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
            yAxisId="wind"
            type="monotone"
            dataKey="wind"
            stroke={SERIES.wind}
            strokeWidth={1.4}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            isAnimationActive={false}
          />

          <ReferenceLine
            yAxisId="pm"
            x={currentHour}
            stroke="rgb(var(--as-accent))"
            strokeWidth={1.2}
            label={{
              value: currentHour === 0 ? 'NOW' : `+${currentHour}h`,
              position: 'top',
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              fill: 'rgb(var(--as-accent))',
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
