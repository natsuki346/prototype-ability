export type SensorId = "ppg" | "gsr" | "temperature" | "acceleration" | "gyroscope";
export type ScaleMode = "auto" | "fixed";

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
  readDueSamples(now: number): SensorSample[];
  reset(): void;
};
