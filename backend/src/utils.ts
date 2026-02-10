import type { RunRecord, RunResponse } from './types.js';

const torontoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

export function toTorontoDate(isoUtc: string): string {
  return torontoFmt.format(new Date(isoUtc));
}

export function withToronto(run: RunRecord): RunResponse {
  return {
    ...run,
    created_at_toronto: toTorontoDate(run.created_at_utc)
  };
}

export function generateRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
