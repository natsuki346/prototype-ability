import type { SensorId, SensorSample } from "./types";

export type SensorSeries = { times: number[]; channels: Record<string, number[]> };
export type SeriesStore = Record<SensorId, SensorSeries>;

export function createSeriesStore(sensorIds: SensorId[]): SeriesStore {
  return Object.fromEntries(sensorIds.map((id) => [id, { times: [], channels: {} }])) as unknown as SeriesStore;
}

export function appendSamples(store: SeriesStore, samples: SensorSample[], maxPoints: number) {
  for (const sample of samples) {
    const series = store[sample.sensor];
    series.times.push(sample.sampledAt);
    for (const [channel, value] of Object.entries(sample.values)) (series.channels[channel] ??= []).push(value);
    if (series.times.length > maxPoints) {
      const excess = series.times.length - maxPoints;
      series.times.splice(0, excess);
      for (const values of Object.values(series.channels)) values.splice(0, excess);
    }
  }
}

export function cloneSeries(store: SeriesStore): SeriesStore {
  return Object.fromEntries(Object.entries(store).map(([id, series]) => [id, { times: [...series.times], channels: Object.fromEntries(Object.entries(series.channels).map(([key, values]) => [key, [...values]])) }])) as SeriesStore;
}
