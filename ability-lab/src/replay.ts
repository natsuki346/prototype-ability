import { appendSamples, createSeriesStore, type SeriesStore } from "./data-buffer";
import { SENSOR_DEFINITIONS } from "./sensors";
import type { RawSampleRecord } from "./storage";
import type { SensorSample } from "./types";

export function replayTime(sample: RawSampleRecord) {
  return sample.sensorTimestamp ?? sample.receivedAt;
}

export function replayBounds(samples: RawSampleRecord[], fallbackStart: number, fallbackEnd: number | null) {
  const times = samples.map(replayTime).filter(Number.isFinite);
  return { start: times.length ? Math.min(...times) : fallbackStart, end: times.length ? Math.max(...times) : (fallbackEnd ?? fallbackStart) };
}

export function seriesAt(samples: RawSampleRecord[], position: number, maxPoints = 3000): SeriesStore {
  const store = createSeriesStore(SENSOR_DEFINITIONS.map((sensor) => sensor.id));
  const displaySamples: SensorSample[] = samples.filter((sample) => replayTime(sample) <= position).map((sample) => ({ sampledAt: replayTime(sample), sensor: sample.sensorId, values: { ...sample.rawValues } }));
  appendSamples(store, displaySamples, maxPoints);
  return store;
}
