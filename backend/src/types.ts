export type RunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface RunRecord {
  id: string;
  created_at_utc: string;
  status: RunStatus;
  duration_seconds: number;
  transcript: string | null;
  decoded_summary: string | null;
  likely_acdc_reference: string | null;
  confidence: number | null;
  error: string | null;
}

export interface RunResponse extends RunRecord {
  created_at_toronto: string;
}

export interface DecodeResult {
  decoded_summary: string;
  likely_acdc_reference: string;
  confidence_0_to_1: number;
}
