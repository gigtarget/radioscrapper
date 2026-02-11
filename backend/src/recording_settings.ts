function parseRecordSeconds(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 240;
}

export const RECORDING_SETTINGS = {
  timezone: process.env.TZ || 'America/Toronto',
  recordSeconds: parseRecordSeconds(process.env.RECORD_SECONDS),
  // daily schedule in 24h local time
  runTimes: ['08:00', '12:00', '16:00', '22:45']
};
