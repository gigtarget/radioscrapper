function parseRecordSeconds(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 360;
}

export const RECORDING_SETTINGS = {
  timezone: process.env.TZ || 'America/Toronto',
  recordSeconds: parseRecordSeconds(process.env.RECORD_SECONDS),
  // daily schedule in 24h local time
  runTimes: ['07:59', '11:59', '15:59', '23:38']
};
