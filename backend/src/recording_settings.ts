const DEFAULT_RECORD_SECONDS = 480;

function parseRecordSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveRecordSeconds(): number {
  return (
    parseRecordSeconds(process.env.RECORD_SECONDS) ??
    // Backward-compatible support for the misspelled env var used in older docs.
    parseRecordSeconds(process.env.RECOD_SECONDS) ??
    parseRecordSeconds(process.env.DURATION_SECONDS) ??
    DEFAULT_RECORD_SECONDS
  );
}

export const RECORDING_SETTINGS = {
  timezone: process.env.TZ || 'America/Toronto',
  recordSeconds: resolveRecordSeconds(),
  // daily schedule in 24h local time
  runTimes: ['08:00', '11:56', '16:00', '23:38']
};
