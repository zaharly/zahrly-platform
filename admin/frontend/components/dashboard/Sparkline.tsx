import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'

interface SparklineProps {
  data: number[]
  color?: string
  height?: number
}

/** Minimal trend line for compact metric contexts (quota history, throughput, etc). */
export function Sparkline({ data, color = 'hsl(var(--chart-2))', height = 32 }: SparklineProps) {
  const points = data.map((value, i) => ({ i, value }))
  const min = Math.min(...data)
  const max = Math.max(...data)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis domain={[min - (max - min) * 0.15 || 0, max + (max - min) * 0.15 || 1]} hide />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
