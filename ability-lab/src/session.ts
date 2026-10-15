import type { MeasurementSession, SessionInterruption, SessionStatus, WearState } from "./types";

export function createMeasurementSession(startedAt: number): MeasurementSession {
  return {
    sessionId: `AL-${new Date(startedAt).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    startedAt,
    endedAt: null,
    status: "RECORDING",
    elapsedTime: 0,
    dataAcquisitionTime: 0,
    sensorSamples: [],
    interruptions: [],
  };
}

export function acquisitionTime(session: MeasurementSession, now: number) {
  const interruptedTime = session.interruptions.reduce((total, interruption) => {
    return total + ((interruption.endedAt ?? now) - interruption.startedAt);
  }, 0);
  return Math.max(0, now - session.startedAt - interruptedTime);
}

export function updateSessionClock(session: MeasurementSession, now: number): MeasurementSession {
  return {
    ...session,
    elapsedTime: Math.max(0, (session.endedAt ?? now) - session.startedAt),
    dataAcquisitionTime: acquisitionTime(session, session.endedAt ?? now),
  };
}

export function transitionSession(session: MeasurementSession | null, from: WearState, to: WearState, now: number) {
  if (from === "NOT_WORN" && to === "WORN") return createMeasurementSession(now);
  if (!session) return null;

  const next = { ...session, interruptions: session.interruptions.map((interruption) => ({ ...interruption })) };
  if (from === "WORN" && to === "DISCONNECTED") {
    next.status = "INTERRUPTED";
    next.interruptions.push({ startedAt: now, endedAt: null });
  } else if (from === "DISCONNECTED" && to === "WORN") {
    next.status = "RECORDING";
    const interruption = next.interruptions.at(-1);
    if (interruption && interruption.endedAt === null) interruption.endedAt = now;
  } else if ((from === "WORN" || from === "DISCONNECTED") && to === "NOT_WORN") {
    const interruption = next.interruptions.at(-1);
    if (interruption && interruption.endedAt === null) interruption.endedAt = now;
    next.status = "COMPLETED";
    next.endedAt = now;
  }
  return updateSessionClock(next, now);
}

export function statusLabel(status: SessionStatus) {
  return { IDLE: "IDLE", RECORDING: "RECORDING", INTERRUPTED: "INTERRUPTED", COMPLETED: "COMPLETED" }[status];
}
