import { useLocation, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PageHeader } from '../../components/layout/PageHeader'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { Tabs, TabsList, TabsTrigger } from '../../lib/shadcn/tabs'
import { useActiveModel } from '../../state/StoreContext'
import { EVALUATION_SEGMENTS } from '../../mock/data/evaluationSegments'

const TABS = [
  { path: '/models/evaluation', value: 'evaluation', label: 'Evaluation' },
  { path: '/models/calibration', value: 'calibration', label: 'Calibration' },
]

const CALIBRATION_CURVE = [
  { bucket: '0-10%', predicted: 5, observed: 6 },
  { bucket: '10-20%', predicted: 15, observed: 17 },
  { bucket: '20-30%', predicted: 25, observed: 24 },
  { bucket: '30-40%', predicted: 35, observed: 36 },
  { bucket: '40-50%', predicted: 45, observed: 44 },
  { bucket: '50-60%', predicted: 55, observed: 57 },
  { bucket: '60-70%', predicted: 65, observed: 63 },
  { bucket: '70-80%', predicted: 75, observed: 77 },
  { bucket: '80-90%', predicted: 85, observed: 83 },
  { bucket: '90-100%', predicted: 95, observed: 96 },
]

export default function Evaluation() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = TABS.find((t) => t.path === location.pathname)?.value ?? 'evaluation'
  const categories = Array.from(new Set(EVALUATION_SEGMENTS.map((s) => s.category)))
  const activeModel = useActiveModel()

  if (!activeModel) {
    return (
      <div className="flex flex-col gap-density-md">
        <PageHeader title="Model Evaluation" description="No active production model found." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Model Evaluation"
        description="Statistical evaluation of the active model. No single 'accuracy' KPI is used as a headline metric — always view Log Loss, Brier, RPS, ECE, and CLV together, segmented by context."
      />
      <Tabs value={active} onValueChange={(v) => navigate(TABS.find((t) => t.value === v)?.path ?? '/models/evaluation')}>
        <TabsList>{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>

      {active === 'evaluation' && (
        <>
          <div className="grid grid-cols-2 gap-density-md md:grid-cols-5">
            <MetricCard label="Log Loss" value={activeModel.metrics.logLoss.toFixed(3)} tone="model" />
            <MetricCard label="Brier" value={activeModel.metrics.brier.toFixed(3)} tone="model" />
            <MetricCard label="RPS" value={activeModel.metrics.rps.toFixed(3)} tone="model" />
            <MetricCard label="ECE" value={activeModel.metrics.ece.toFixed(3)} tone="model" />
            <MetricCard label="CLV" value={activeModel.metrics.clv.toFixed(1)} tone="success" />
          </div>

          {categories.map((cat) => (
            <div key={cat} className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
              <h2 className="mb-density-sm text-base font-semibold text-foreground">{cat}</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={EVALUATION_SEGMENTS.filter((s) => s.category === cat)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="segment" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" angle={-15} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="logLoss" name="Log Loss" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="clv" name="CLV" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </>
      )}

      {active === 'calibration' && (
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <h2 className="mb-density-sm text-base font-semibold text-foreground">Calibration curve — {activeModel.version}</h2>
          <p className="mb-density-md text-sm text-muted-foreground">Predicted probability vs observed frequency, bucketed in deciles. ECE {activeModel.metrics.ece.toFixed(3)}.</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={CALIBRATION_CURVE}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" unit="%" />
                <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="predicted" name="Predicted" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="observed" name="Observed" fill="hsl(var(--model))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
