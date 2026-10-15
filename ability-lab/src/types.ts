export type SensorId = "ppg" | "gsr" | "temperature" | "acceleration" | "gyroscope";
export type ScaleMode = "auto" | "fixed";
export type WearState = "NOT_WORN" | "WORN" | "DISCONNECTED";
export type SessionStatus = "IDLE" | "RECORDING" | "INTERRUPTED" | "COMPLETED";

export type SensorSample = {
  sampledAt: number;
  sensor: SensorId;
  values: Record<string, number>;
};

export type SensorDefinition = {
  id: SensorId;
  label: string;
  shortLabel: string;
  unit: string;
  frequencyHz: number;
  periodMs: number;
  channels: string[];
  channelLabels: string[];
  color: string;
  ranges: { min: number; max: number };
};

export type SensorDataSource = {
  readDueSamples(now: number, wallClockNow?: number): SensorSample[];
  reset(): void;
};

export type SessionInterruption = {
  startedAt: number;
  endedAt: number | null;
};

export type MeasurementSession = {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  elapsedTime: number;
  dataAcquisitionTime: number;
  sensorSamples: SensorSample[];
  interruptions: SessionInterruption[];
};
