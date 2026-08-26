export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ─── Table Row types ─────────────────────────────────────────────────────

export type AdminSettingsRow = {
  id: string
  setting_key: string
  setting_value: string
  created_at: string
  updated_at: string
}

export type AdminSettingsInsert = {
  id?: string
  setting_key: string
  setting_value: string
  created_at?: string
  updated_at?: string
}

export type AdminSettingsUpdate = {
  id?: string
  setting_key?: string
  setting_value?: string
  created_at?: string
  updated_at?: string
}

export type AccessCodesRow = {
  code: string
  created_at: string
  duration_days: number
  id: string
  used: boolean
  used_at: string | null
  used_by_device: string | null
}

export type AccessCodesInsert = {
  code: string
  created_at?: string
  duration_days?: number
  id?: string
  used?: boolean
  used_at?: string | null
  used_by_device?: string | null
}

export type AccessCodesUpdate = {
  code?: string
  created_at?: string
  duration_days?: number
  id?: string
  used?: boolean
  used_at?: string | null
  used_by_device?: string | null
}

export type PredictionsRow = {
  away: string
  created_at: string
  device_id: string
  exact_score: string
  expected_goals: number
  first_half_goal_prob: number
  gg_result: string
  goals_away: number
  goals_home: number
  home: string
  id: string
  odd_away: number
  odd_draw: number
  odd_home: number
  over_under_15: string
  over_under_25: string
  over_under_35: string
  parity: string
  prob_away: number
  prob_draw: number
  prob_gg: number
  prob_gn: number
  prob_home: number
  score_away: number
  score_home: number
  total_goals: number
  winner_1x2: string
  // Additional columns from usage
  home_team?: string
  away_team?: string
  league?: string
  prediction?: string
  confidence?: number
  predicted_home_score?: number | null
  predicted_away_score?: number | null
  predicted_score?: string | null
  actual_home_score?: number | null
  actual_away_score?: number | null
  actual_outcome?: string | null
  actual_score?: string | null
  status?: string
  verified_at?: string | null
  btts_prob?: number
  over25_prob?: number
  match_id?: number | null
  round?: number | null
  league_id?: string | null
}

export type PredictionsInsert = {
  away: string
  created_at?: string
  device_id?: string
  exact_score: string
  expected_goals: number
  first_half_goal_prob: number
  gg_result: string
  goals_away: number
  goals_home: number
  home: string
  id?: string
  odd_away: number
  odd_draw: number
  odd_home: number
  over_under_15: string
  over_under_25: string
  over_under_35: string
  parity: string
  prob_away: number
  prob_draw: number
  prob_gg: number
  prob_gn: number
  prob_home: number
  score_away: number
  score_home: number
  total_goals: number
  winner_1x2: string
  home_team?: string
  away_team?: string
  league?: string
  prediction?: string
  confidence?: number
  predicted_home_score?: number | null
  predicted_away_score?: number | null
  predicted_score?: string | null
  actual_home_score?: number | null
  actual_away_score?: number | null
  actual_outcome?: string | null
  actual_score?: string | null
  status?: string
  verified_at?: string | null
  btts_prob?: number
  over25_prob?: number
  match_id?: number | null
  round?: number | null
  league_id?: string | null
}

export type PredictionsUpdate = {
  away?: string
  created_at?: string
  device_id?: string
  exact_score?: string
  expected_goals?: number
  first_half_goal_prob?: number
  gg_result?: string
  goals_away?: number
  goals_home?: number
  home?: string
  id?: string
  odd_away?: number
  odd_draw?: number
  odd_home?: number
  over_under_15?: string
  over_under_25?: string
  over_under_35?: string
  parity?: string
  prob_away?: number
  prob_draw?: number
  prob_gg?: number
  prob_gn?: number
  prob_home?: number
  score_away?: number
  score_home?: number
  total_goals?: number
  winner_1x2?: string
  home_team?: string
  away_team?: string
  league?: string
  prediction?: string
  confidence?: number
  predicted_home_score?: number | null
  predicted_away_score?: number | null
  predicted_score?: string | null
  actual_home_score?: number | null
  actual_away_score?: number | null
  actual_outcome?: string | null
  actual_score?: string | null
  status?: string
  verified_at?: string | null
  btts_prob?: number
  over25_prob?: number
  match_id?: number | null
  round?: number | null
  league_id?: string | null
}

export type ScrapedDataRow = {
  created_at: string
  data_type: string
  id: string
  league: string | null
  payload: Json
  scraped_at: string
}

export type ScrapedDataInsert = {
  created_at?: string
  data_type: string
  id?: string
  league?: string | null
  payload?: Json
  scraped_at?: string
}

export type ScrapedDataUpdate = {
  created_at?: string
  data_type?: string
  id?: string
  league?: string | null
  payload?: Json
  scraped_at?: string
}
