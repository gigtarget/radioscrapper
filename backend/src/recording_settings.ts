export const RECORDING_SETTINGS = {
  timezone: process.env.TZ || 'America/Toronto',
  recordSeconds: Number(process.env.RECORD_SECONDS || 240),
  // daily schedule in 24h local time
  runTimes: ['08:00', '12:00', '16:00', '22:45']
};
