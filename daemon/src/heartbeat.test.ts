import { HEARTBEAT_INTERVAL_MS, createHeartbeatSchedule } from './heartbeat.ts';

const AT = new Date('2026-09-09T12:00:00.000Z');

function later(ms: number): Date {
  return new Date(AT.getTime() + ms);
}

describe('createHeartbeatSchedule', () => {
  it('is due on the first tick, so a fresh start reports liveness immediately', () => {
    expect(createHeartbeatSchedule().due('imessage', AT)).toBe(true);
  });

  it('is not due again until the interval has passed', () => {
    const schedule = createHeartbeatSchedule();
    schedule.record('imessage', AT);

    expect(schedule.due('imessage', later(HEARTBEAT_INTERVAL_MS - 1))).toBe(false);
    expect(schedule.due('imessage', later(HEARTBEAT_INTERVAL_MS))).toBe(true);
  });

  it('coalesces the five-second polls into one beat a minute', () => {
    const schedule = createHeartbeatSchedule();
    let beats = 0;
    for (let elapsed = 0; elapsed <= 60_000; elapsed += 5000) {
      const now = later(elapsed);
      if (schedule.due('imessage', now)) {
        beats += 1;
        schedule.record('imessage', now);
      }
    }

    expect(beats).toBe(2);
  });

  it('counts a batch that carried messages as the beat', () => {
    const schedule = createHeartbeatSchedule();
    schedule.record('imessage', AT);
    schedule.record('imessage', later(30_000));

    expect(schedule.due('imessage', later(60_000))).toBe(false);
    expect(schedule.due('imessage', later(90_000))).toBe(true);
  });

  it('tracks each source separately, so a quiet mailbox does not mute the other', () => {
    const schedule = createHeartbeatSchedule();
    schedule.record('imessage', AT);

    expect(schedule.due('workmail', AT)).toBe(true);
  });

  it('honours a caller-supplied interval', () => {
    const schedule = createHeartbeatSchedule(1000);
    schedule.record('imessage', AT);

    expect(schedule.due('imessage', later(1000))).toBe(true);
  });
});
