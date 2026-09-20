import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EquityPoint } from '../types/portfolio';
import { formatUsd } from '../lib/format';

interface Props {
  data: EquityPoint[];
}

export function EquityChart({ data }: Props) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#ffffff60', fontSize: 11 }}
            tickFormatter={(v) => v.slice(5)}
          />
          <YAxis
            tick={{ fill: '#ffffff60', fontSize: 11 }}
            tickFormatter={(v) => formatUsd(v, true)}
            width={60}
          />
          <Tooltip
            contentStyle={{
              background: '#111827',
              border: '1px solid #ffffff20',
              borderRadius: 8,
            }}
            labelStyle={{ color: '#fff' }}
            formatter={(value) => [formatUsd(Number(value ?? 0)), 'Equity']}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#34d399"
            strokeWidth={2}
            fill="url(#equityFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
