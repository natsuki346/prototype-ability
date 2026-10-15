import { SENSOR_DEFINITIONS } from "./sensors";
import type { MeasurementSession, SensorId, SensorSample, SessionInterruption, SessionStatus } from "./types";

export const RAW_FORMAT_VERSION = "ability-lab.raw.v1";
export type RawSource = "SIMULATED" | "DEVICE";

export type RawSampleRecord = {
  recordType: "sample";
  formatVersion: typeof RAW_FORMAT_VERSION;
  sessionId: string;
  sensorId: SensorId;
  sequenceNumber: number | null;
  sensorTimestamp: number | null;
  receivedAt: number;
  rawValues: Record<string, number>;
  source: RawSource;
};

export type SensorStorageMetadata = {
  sensorId: SensorId;
  label: string;
  channels: string[];
  unit: string;
  frequencyHz: number;
  adcResolutionBits: number | null;
  scale: number;
  offset: number;
};

export type StoredSessionMeta = {
  recordType: "session";
  formatVersion: typeof RAW_FORMAT_VERSION;
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  elapsedTime: number;
  dataAcquisitionTime: number;
  interruptions: SessionInterruption[];
  sensorConfig: SensorStorageMetadata[];
  source: RawSource;
  sampleCounts: Record<SensorId, number>;
  persistedSampleCount: number;
};

type StoredSample = RawSampleRecord & { id?: number };

const DB_NAME = "ability-lab-raw";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const SAMPLE_STORE = "samples";

export const SENSOR_STORAGE_CONFIG: SensorStorageMetadata[] = SENSOR_DEFINITIONS.map((sensor) => ({
  sensorId: sensor.id,
  label: sensor.label,
  channels: [...sensor.channels],
  unit: sensor.unit,
  frequencyHz: sensor.frequencyHz,
  adcResolutionBits: sensor.id === "ppg" ? 16 : sensor.id === "gsr" || sensor.id === "temperature" ? 12 : null,
  scale: 1,
  offset: 0,
}));

export function emptySampleCounts(): Record<SensorId, number> {
  return Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, 0])) as Record<SensorId, number>;
}

export function createRawSampleRecord(sessionId: string, sample: SensorSample, sequenceNumber: number | null, receivedAt: number): RawSampleRecord {
  return {
    recordType: "sample",
    formatVersion: RAW_FORMAT_VERSION,
    sessionId,
    sensorId: sample.sensor,
    sequenceNumber,
    sensorTimestamp: sample.sampledAt,
    receivedAt,
    rawValues: { ...sample.values },
    source: "SIMULATED",
  };
}

export function sessionToStorageMeta(session: MeasurementSession, sampleCounts: Record<SensorId, number>, persistedSampleCount: number): StoredSessionMeta {
  return {
    recordType: "session",
    formatVersion: RAW_FORMAT_VERSION,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    elapsedTime: session.elapsedTime,
    dataAcquisitionTime: session.dataAcquisitionTime,
    interruptions: session.interruptions.map((item) => ({ ...item })),
    sensorConfig: SENSOR_STORAGE_CONFIG.map((item) => ({ ...item, channels: [...item.channels] })),
    source: "SIMULATED",
    sampleCounts: { ...sampleCounts },
    persistedSampleCount,
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class IndexedDbRawStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available in this browser"));
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(SESSION_STORE)) database.createObjectStore(SESSION_STORE, { keyPath: "sessionId" });
          if (!database.objectStoreNames.contains(SAMPLE_STORE)) {
            const samples = database.createObjectStore(SAMPLE_STORE, { keyPath: "id", autoIncrement: true });
            samples.createIndex("sessionId", "sessionId", { unique: false });
            samples.createIndex("receivedAt", "receivedAt", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB"));
      });
    }
    return this.databasePromise;
  }

  async saveSession(meta: StoredSessionMeta): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    transaction.objectStore(SESSION_STORE).put(meta);
    await transactionToPromise(transaction);
  }

  async appendSamples(samples: RawSampleRecord[]): Promise<void> {
    if (!samples.length) return;
    const database = await this.open();
    const transaction = database.transaction(SAMPLE_STORE, "readwrite");
    const store = transaction.objectStore(SAMPLE_STORE);
    samples.forEach((sample) => store.add(sample));
    await transactionToPromise(transaction);
  }

  async listSessionMetas(): Promise<StoredSessionMeta[]> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const values = await requestToPromise(transaction.objectStore(SESSION_STORE).getAll());
    await transactionToPromise(transaction);
    return (values as StoredSessionMeta[]).sort((a, b) => b.startedAt - a.startedAt);
  }

  async getSamples(sessionId: string): Promise<RawSampleRecord[]> {
    const database = await this.open();
    const transaction = database.transaction(SAMPLE_STORE, "readonly");
    const request = transaction.objectStore(SAMPLE_STORE).index("sessionId").getAll(IDBKeyRange.only(sessionId));
    const values = await requestToPromise(request);
    await transactionToPromise(transaction);
    return (values as StoredSample[]).sort((a, b) => (a.receivedAt - b.receivedAt) || ((a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))).map(({ id: _id, ...sample }) => sample);
  }
}

export function buildJsonl(meta: StoredSessionMeta, samples: RawSampleRecord[]): string {
  const header = { ...meta, sampleCounts: { ...meta.sampleCounts }, sensorConfig: meta.sensorConfig.map((item) => ({ ...item, channels: [...item.channels] })) };
  const summary = {
    recordType: "summary",
    formatVersion: RAW_FORMAT_VERSION,
    sessionId: meta.sessionId,
    sampleCounts: { ...meta.sampleCounts },
    totalSamples: samples.length,
  };
  return [header, ...samples, summary].map((record) => JSON.stringify(record)).join("\n") + "\n";
}

export async function exportSessionJsonl(storage: IndexedDbRawStorage, meta: StoredSessionMeta): Promise<void> {
  const samples = await storage.getSamples(meta.sessionId);
  const content = buildJsonl(meta, samples);
  const blob = new Blob([content], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ability-lab-${meta.sessionId}.jsonl`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type ParsedJsonlSession = { meta: StoredSessionMeta; samples: RawSampleRecord[] };

function isSensorId(value: unknown): value is SensorId {
  return SENSOR_DEFINITIONS.some((sensor) => sensor.id === value);
}

export function parseJsonlSession(contents: string): ParsedJsonlSession {
  const records = contents.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`Invalid JSON on line ${index + 1}`);
    }
  });
  const meta = records.find((record) => record.recordType === "session");
  const samples = records.filter((record) => record.recordType === "sample");
  const summary = records.find((record) => record.recordType === "summary");
  if (!meta || !summary || meta.formatVersion !== RAW_FORMAT_VERSION || summary.formatVersion !== RAW_FORMAT_VERSION) throw new Error("Unsupported or incomplete Ability Lab JSONL format");
  if (typeof meta.sessionId !== "string" || typeof summary.sessionId !== "string" || meta.sessionId !== summary.sessionId) throw new Error("sessionId mismatch in JSONL");
  const parsedSamples = samples.map((record, index) => {
    if (record.formatVersion !== RAW_FORMAT_VERSION || record.sessionId !== meta.sessionId || !isSensorId(record.sensorId) || typeof record.receivedAt !== "number" || (record.sensorTimestamp !== null && typeof record.sensorTimestamp !== "number") || typeof record.rawValues !== "object" || record.rawValues === null) throw new Error(`Invalid sample record near line ${index + 1}`);
    return { ...record, recordType: "sample", sensorId: record.sensorId, rawValues: { ...(record.rawValues as Record<string, number>) } } as RawSampleRecord;
  });
  const parsedMeta = { ...meta, recordType: "session", sampleCounts: { ...(meta.sampleCounts as Record<SensorId, number>) }, interruptions: [...(meta.interruptions as SessionInterruption[])], sensorConfig: [...(meta.sensorConfig as SensorStorageMetadata[])] } as StoredSessionMeta;
  if (parsedMeta.persistedSampleCount !== parsedSamples.length || summary.totalSamples !== parsedSamples.length) throw new Error("JSONL sample count does not match summary");
  return { meta: parsedMeta, samples: parsedSamples };
}
