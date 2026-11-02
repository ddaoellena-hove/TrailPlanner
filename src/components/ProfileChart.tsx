import { Area, AreaChart, CartesianGrid, ReferenceDot, Tooltip, XAxis, YAxis } from 'recharts';
import { type ChartConfig, ChartContainer } from '@/components/ui/chart';
import { formatKm } from '../../shared/format';
import type { ProfilePoint } from '../../shared/profile';

const config: ChartConfig = { altM: { label: 'Altitude', color: 'var(--primary)' } };

function PointDetails({ point }: { point: ProfilePoint }) {
  return (
    <div className="rounded-md border bg-popover px-2 py-1 text-xs tabular-nums shadow-md">
      <p>{formatKm(point.distKm)}</p>
      <p>{Math.round(point.altM ?? 0)} m</p>
      {point.slopePct !== null && <p>Pente {Math.round(point.slopePct)} %</p>}
    </div>
  );
}

export function ProfileChart({
  points,
  cursorIndex,
  onCursorChange,
}: {
  points: ProfilePoint[];
  cursorIndex: number | null;
  onCursorChange: (index: number | null) => void;
}) {
  const cursor = cursorIndex === null ? undefined : points[cursorIndex];

  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full">
      <AreaChart
        data={points}
        margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
        onMouseMove={(state) => onCursorChange(state.activeTooltipIndex ?? null)}
        onMouseLeave={() => onCursorChange(null)}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="distKm"
          type="number"
          domain={[0, 'dataMax']}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${Math.round(value * 10) / 10} km`}
        />
        <YAxis
          dataKey="altM"
          domain={['auto', 'auto']}
          width={60}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${Math.round(value)} m`}
        />
        <Tooltip
          isAnimationActive={false}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as ProfilePoint | undefined;
            return active && point ? <PointDetails point={point} /> : null;
          }}
        />
        <Area
          dataKey="altM"
          type="monotone"
          stroke="var(--color-altM)"
          fill="var(--color-altM)"
          fillOpacity={0.25}
          strokeWidth={2}
          isAnimationActive={false}
          dot={false}
          activeDot={false}
        />
        {cursor && cursor.altM !== null && (
          <ReferenceDot x={cursor.distKm} y={cursor.altM} r={4} fill="#f59e0b" stroke="#fff" />
        )}
      </AreaChart>
    </ChartContainer>
  );
}
