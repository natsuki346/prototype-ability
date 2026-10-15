import type { SensorDataSource, SensorDefinition, SensorId, SensorSample } from "./types";

export const SENSOR_DEFINITIONS: SensorDefinition[] = [
  { id: "ppg", label: "PPG", shortLabel: "PPG", unit: "ADC", frequencyHz: 100, periodMs: 10, channels: ["ir", "red"], channelLabels: ["IR", "Red"], color: "#2977d5", ranges: { min: 0, max: 65535 } },
  { id: "gsr", label: "GSR", shortLabel: "GSR", unit: "ADC", frequencyHz: 10, periodMs: 100, channels: ["adc"], channelLabels: ["ADC"], color: "#9268d6", ranges: { min: 250, max: 600 } },
  { id: "temperature", label: "Contact temperature", shortLabel: "TEMP", unit: "ADC", frequencyHz: 1, periodMs: 1000, channels: ["adc"], channelLabels: ["ADC"], color: "#d06b46", ranges: { min: 0, max: 4095 } },
  { id: "acceleration", label: "IMU acceleration", shortLabel: "ACC", unit: "g", frequencyHz: 50, periodMs: 20, channels: ["x", "y", "z"], channelLabels: ["X", "Y", "Z"], color: "#25977e", ranges: { min: -1.25, max: 1.25 } },
  { id: "gyroscope", label: "IMU angular velocity", shortLabel: "GYRO", unit: "°/s", frequencyHz: 50, periodMs: 20, channels: ["x", "y", "z"], channelLabels: ["X", "Y", "Z"], color: "#be902b", ranges: { min: -50, max: 50 } },
];

const byId = Object.fromEntries(SENSOR_DEFINITIONS.map((definition) => [definition.id, definition])) as Record<SensorId, SensorDefinition>;

export class MockSensorSource implements SensorDataSource {
  private startedAt = performance.now();
  private phase = 0;
  private nextDue: Record<SensorId, number> = Object.fromEntries(SENSOR_DEFINITIONS.map((definition) => [definition.id, 0])) as Record<SensorId, number>;

  reset() {
    this.startedAt = performance.now();
    this.phase = 0;
    this.nextDue = Object.fromEntries(SENSOR_DEFINITIONS.map((definition) => [definition.id, 0])) as Record<SensorId, number>;
  }

  readDueSamples(now: number): SensorSample[] {
    const elapsed = now - this.startedAt;
    const samples: SensorSample[] = [];
    this.phase += 0.012;

    for (const definition of SENSOR_DEFINITIONS) {
      while (elapsed >= this.nextDue[definition.id]) {
        const sampleTime = now - (elapsed - this.nextDue[definition.id]);
        samples.push({ sampledAt: sampleTime, sensor: definition.id, values: this.valuesFor(definition.id, this.nextDue[definition.id] / 1000) });
        this.nextDue[definition.id] += definition.periodMs;
      }
    }
    return samples;
  }

  private valuesFor(sensor: SensorId, seconds: number): Record<string, number> {
    const t = seconds + this.phase;
    if (sensor === "ppg") {
      const pulse = Math.sin(t * 2 * Math.PI * 1.12);
      return { ir: 34000 + pulse * 6400 + Math.sin(t * 2 * Math.PI * 7) * 550, red: 25500 + Math.sin(t * 2 * Math.PI * 1.12 + 0.4) * 4300 + Math.sin(t * 2 * Math.PI * 5) * 390 };
    }
    if (sensor === "gsr") return { adc: 430 + Math.sin(t * 0.6) * 35 + Math.sin(t * 2.5) * 8 };
    if (sensor === "temperature") return { adc: 1870 + Math.sin(t * 0.08) * 42 };
    if (sensor === "acceleration") return { x: Math.sin(t * 2.1) * 0.07, y: Math.sin(t * 1.4 + 1.1) * 0.05, z: 0.98 + Math.sin(t * 0.9) * 0.04 };
    return { x: Math.sin(t * 1.7) * 8, y: Math.sin(t * 1.1 + 1.8) * 5, z: Math.cos(t * 1.4) * 6 };
  }
}

export function getSensorDefinition(id: SensorId) {
  return byId[id];
}
