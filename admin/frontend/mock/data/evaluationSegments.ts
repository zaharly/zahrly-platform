export interface EvaluationSegment {
  segment: string
  category: 'Competition' | 'Season phase' | 'Market family' | 'Home/Away' | 'Data regime'
  logLoss: number
  brier: number
  ece: number
  clv: number
  sampleSize: number
}

export const EVALUATION_SEGMENTS: EvaluationSegment[] = [
  { segment: 'Premier League', category: 'Competition', logLoss: 0.961, brier: 0.196, ece: 0.017, clv: 1.8, sampleSize: 3120 },
  { segment: 'La Liga', category: 'Competition', logLoss: 0.974, brier: 0.199, ece: 0.019, clv: 1.6, sampleSize: 2980 },
  { segment: 'Serie A', category: 'Competition', logLoss: 0.988, brier: 0.203, ece: 0.021, clv: 1.3, sampleSize: 2740 },
  { segment: 'Bundesliga', category: 'Competition', logLoss: 0.980, brier: 0.201, ece: 0.020, clv: 1.4, sampleSize: 2210 },
  { segment: 'Brasileirao', category: 'Competition', logLoss: 1.042, brier: 0.224, ece: 0.038, clv: 0.4, sampleSize: 1580 },
  { segment: 'Early season (MD 1-8)', category: 'Season phase', logLoss: 1.031, brier: 0.218, ece: 0.033, clv: 0.7, sampleSize: 4210 },
  { segment: 'Mid season (MD 9-28)', category: 'Season phase', logLoss: 0.958, brier: 0.192, ece: 0.016, clv: 1.7, sampleSize: 9840 },
  { segment: 'Late season (MD 29+)', category: 'Season phase', logLoss: 0.972, brier: 0.198, ece: 0.019, clv: 1.5, sampleSize: 6120 },
  { segment: '1X2', category: 'Market family', logLoss: 0.958, brier: 0.191, ece: 0.016, clv: 1.7, sampleSize: 15840 },
  { segment: 'Over/Under Goals', category: 'Market family', logLoss: 0.941, brier: 0.184, ece: 0.014, clv: 1.9, sampleSize: 14210 },
  { segment: 'BTTS', category: 'Market family', logLoss: 0.949, brier: 0.188, ece: 0.015, clv: 1.8, sampleSize: 13990 },
  { segment: 'Combinations', category: 'Market family', logLoss: 1.021, brier: 0.212, ece: 0.029, clv: 0.9, sampleSize: 8410 },
  { segment: 'Home', category: 'Home/Away', logLoss: 0.955, brier: 0.190, ece: 0.016, clv: 1.7, sampleSize: 16400 },
  { segment: 'Away', category: 'Home/Away', logLoss: 0.978, brier: 0.201, ece: 0.020, clv: 1.4, sampleSize: 16400 },
  { segment: 'Complete data regime', category: 'Data regime', logLoss: 0.949, brier: 0.189, ece: 0.015, clv: 1.8, sampleSize: 22100 },
  { segment: 'Partial data regime', category: 'Data regime', logLoss: 1.062, brier: 0.229, ece: 0.041, clv: 0.3, sampleSize: 5230 },
]
