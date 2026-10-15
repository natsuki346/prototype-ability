"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { appendSamples, cloneSeries, createSeriesStore, type SeriesStore } from "./data-buffer";
import { MockSensorSource, SENSOR_DEFINITIONS } from "./sensors";
import { acquisitionTime, statusLabel, transitionSession, updateSessionClock } from "./session";
import { IndexedDbRawStorage, createRawSampleRecord, emptySampleCounts, exportSessionJsonl, parseJsonlSession, sessionToStorageMeta, type RawSampleRecord, type StoredSessionMeta } from "./storage";
import { replayBounds, replayTime, seriesAt } from "./replay";
import { SignalChart } from "./SignalChart";
import type { MeasurementSession, ScaleMode, SensorId, SessionStatus, WearState } from "./types";

const MAX_POINTS = 3000;
const DISPLAY_INTERVAL_MS = 100;
const RANGE_OPTIONS = [10, 30, 60];

function useSessionRecorder(wearState: WearState, displayPaused: boolean) {
  const sourceRef = useRef(new MockSensorSource());
  const storeRef = useRef<SeriesStore>(createSeriesStore(SENSOR_DEFINITIONS.map((sensor) => sensor.id)));
  const sessionRef = useRef<MeasurementSession | null>(null);
  const previousWearStateRef = useRef<WearState>("NOT_WORN");
  const [series, setSeries] = useState(() => cloneSeries(storeRef.current));
  const [lastSampleAt, setLastSampleAt] = useState<number | null>(null);
  const [session, setSession] = useState<MeasurementSession | null>(null);
  const [completedSessions, setCompletedSessions] = useState<MeasurementSession[]>([]);
  const storageRef = useRef<IndexedDbRawStorage | null>(null);
  const writeQueueRef = useRef(Promise.resolve());
  const sampleCountsRef = useRef(emptySampleCounts());
  const sequenceRef = useRef<Record<SensorId, number>>(emptySampleCounts());
  const persistedSampleCountRef = useRef(0);
  const [storedSessions, setStoredSessions] = useState<StoredSessionMeta[]>([]);
  const [persistedSampleCount, setPersistedSampleCount] = useState(0);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<"idle" | "exporting" | "success">("idle");

  const saveCurrentMeta = (nextSession: MeasurementSession | null) => {
    if (!nextSession || !storageRef.current) return;
    const storage = storageRef.current;
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      const meta = sessionToStorageMeta(nextSession, sampleCountsRef.current, persistedSampleCountRef.current);
      await storage.saveSession(meta);
      setStoredSessions((current) => [meta, ...current.filter((item) => item.sessionId !== meta.sessionId)].sort((a, b) => b.startedAt - a.startedAt));
    }).catch((error: unknown) => {
      setStorageError(error instanceof Error ? error.message : "Unable to save session metadata");
    });
  };

  const publishSession = (next: MeasurementSession | null) => {
    sessionRef.current = next;
    setSession(next ? { ...next, sensorSamples: next.sensorSamples } : null);
  };

  const resetCurrentView = () => {
    sourceRef.current.reset();
    storeRef.current = createSeriesStore(SENSOR_DEFINITIONS.map((sensor) => sensor.id));
    setSeries(cloneSeries(storeRef.current));
    setLastSampleAt(null);
  };

  useEffect(() => {
    const storage = new IndexedDbRawStorage();
    storageRef.current = storage;
    storage.listSessionMetas().then((metas) => {
      setStoredSessions(metas);
      const latestCount = metas[0]?.persistedSampleCount ?? 0;
      persistedSampleCountRef.current = latestCount;
      setPersistedSampleCount(latestCount);
    }).catch((error: unknown) => {
      setStorageError(error instanceof Error ? error.message : "IndexedDB is unavailable");
    });
    return () => { storageRef.current = null; };
  }, []);

  useEffect(() => {
    const previous = previousWearStateRef.current;
    if (previous === wearState) return;
    const now = Date.now();
    const next = transitionSession(sessionRef.current, previous, wearState, now);
    if (previous === "NOT_WORN" && wearState === "WORN") resetCurrentView();
    if (previous === "NOT_WORN" && wearState === "WORN") {
      sampleCountsRef.current = emptySampleCounts();
      sequenceRef.current = emptySampleCounts();
      persistedSampleCountRef.current = 0;
      setPersistedSampleCount(0);
    }
    if (next?.status === "COMPLETED" && sessionRef.current?.status !== "COMPLETED") {
      setCompletedSessions((current) => [...current, next]);
    }
    publishSession(next);
    saveCurrentMeta(next);
    previousWearStateRef.current = wearState;
  }, [wearState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const current = sessionRef.current;
      if (wearState === "WORN" && current && current.status === "RECORDING") {
        const samples = sourceRef.current.readDueSamples(performance.now(), now);
        appendSamples(storeRef.current, samples, MAX_POINTS);
        current.sensorSamples.push(...samples);
        const records = samples.map((sample) => {
          const sequenceNumber = sequenceRef.current[sample.sensor];
          sequenceRef.current[sample.sensor] += 1;
          sampleCountsRef.current[sample.sensor] += 1;
          return createRawSampleRecord(current.sessionId, sample, sequenceNumber, now);
        });
        if (records.length && storageRef.current) {
          const storage = storageRef.current;
          writeQueueRef.current = writeQueueRef.current.then(async () => {
            await storage.appendSamples(records);
            persistedSampleCountRef.current += records.length;
            setPersistedSampleCount(persistedSampleCountRef.current);
            const latest = sessionRef.current;
            if (latest) await storage.saveSession(sessionToStorageMeta(latest, sampleCountsRef.current, persistedSampleCountRef.current));
            setStoredSessions((stored) => {
              const latestMeta = latest ? sessionToStorageMeta(latest, sampleCountsRef.current, persistedSampleCountRef.current) : null;
              return latestMeta ? [latestMeta, ...stored.filter((item) => item.sessionId !== latestMeta.sessionId)].sort((a, b) => b.startedAt - a.startedAt) : stored;
            });
          }).catch((error: unknown) => {
            setStorageError(error instanceof Error ? error.message : "Unable to persist raw samples");
          });
        }
        if (samples.length) setLastSampleAt(samples.at(-1)?.sampledAt ?? null);
        const updated = updateSessionClock(current, now);
        publishSession(updated);
        if (!displayPaused) setSeries(cloneSeries(storeRef.current));
      } else if (current && (current.status === "INTERRUPTED" || current.status === "RECORDING")) {
        const updated = updateSessionClock(current, now);
        publishSession(updated);
      }
    }, DISPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [displayPaused, wearState]);

  const exportSession = async (sessionId?: string) => {
    const id = sessionId ?? sessionRef.current?.sessionId ?? storedSessions[0]?.sessionId;
    if (!id || !storageRef.current) return;
    setExportState("exporting");
    try {
      await writeQueueRef.current;
      const metas = await storageRef.current.listSessionMetas();
      const meta = metas.find((item) => item.sessionId === id);
      if (!meta) throw new Error("Session data is not available in local storage");
      await exportSessionJsonl(storageRef.current, meta);
      setStoredSessions(metas);
      setExportState("success");
    } catch (error: unknown) {
      setStorageError(error instanceof Error ? error.message : "Unable to export JSONL");
      setExportState("idle");
    }
  };

  return { series, lastSampleAt, session, completedSessions, resetCurrentView, storedSessions, persistedSampleCount, storageError, exportState, exportSession };
}

function formatClock(value: number | null) {
  return value === null ? "--:--:--" : new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(value: number | null) {
  return value === null ? "—" : new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "medium" });
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatReplayTime(value: number | null) {
  return value === null ? "—" : new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function useReplaySessions(storedSessions: StoredSessionMeta[]) {
  const storageRef = useRef<IndexedDbRawStorage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meta, setMeta] = useState<StoredSessionMeta | null>(null);
  const [samples, setSamples] = useState<RawSampleRecord[]>([]);
  const [position, setPosition] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const positionRef = useRef<number | null>(null);

  useEffect(() => { storageRef.current = new IndexedDbRawStorage(); return () => { storageRef.current = null; }; }, []);

  const availableSessions = useMemo(() => meta && !storedSessions.some((item) => item.sessionId === meta.sessionId) ? [meta, ...storedSessions] : storedSessions, [meta, storedSessions]);
  const loadSession = async (sessionId: string) => {
    setPlaying(false);
    setError(null);
    const selectedMeta = availableSessions.find((item) => item.sessionId === sessionId);
    if (!selectedMeta || !storageRef.current) return;
    try {
      const nextSamples = await storageRef.current.getSamples(sessionId);
      const bounds = replayBounds(nextSamples, selectedMeta.startedAt, selectedMeta.endedAt);
      setSelectedId(sessionId);
      setMeta(selectedMeta);
      setSamples(nextSamples);
      setPosition(bounds.start);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load replay session");
    }
  };

  useEffect(() => {
    if (!selectedId && storedSessions[0]) void loadSession(storedSessions[0].sessionId);
  // The initial session is intentionally loaded only when IndexedDB metadata becomes available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedSessions, selectedId]);

  const bounds = useMemo(() => meta ? replayBounds(samples, meta.startedAt, meta.endedAt) : null, [meta, samples]);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => {
    if (!playing || !bounds) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const next = Math.min(bounds.end, (positionRef.current ?? bounds.start) + (now - previous) * speed);
      previous = now;
      setPosition(next);
      if (next >= bounds.end) setPlaying(false);
    }, 50);
    return () => window.clearInterval(timer);
  }, [bounds, playing, speed]);

  const importFile = async (file: File) => {
    try {
      const parsed = parseJsonlSession(await file.text());
      const nextBounds = replayBounds(parsed.samples, parsed.meta.startedAt, parsed.meta.endedAt);
      setError(null); setPlaying(false); setSelectedId(parsed.meta.sessionId); setMeta(parsed.meta); setSamples(parsed.samples); setPosition(nextBounds.start);
    } catch (importError: unknown) {
      setError(importError instanceof Error ? importError.message : "Unable to import JSONL");
    }
  };

  const replaySeries = useMemo(() => position === null ? null : seriesAt(samples, position), [position, samples]);
  const seek = (percent: number) => { if (bounds) setPosition(bounds.start + (bounds.end - bounds.start) * percent); };
  return { availableSessions, selectedId, meta, position, bounds, playing, speed, error, replaySeries, loadSession, setPlaying, setSpeed, seek, importFile };
}

function valueFor(series: SeriesStore, sensorId: SensorId, channel: string) {
  const values = series[sensorId].channels[channel];
  return values?.at(-1)?.toFixed(sensorId === "temperature" ? 0 : 2) ?? "—";
}

function windowedSeries(series: SeriesStore, sensorId: SensorId, seconds: number) {
  const current = series[sensorId];
  const latest = current.times.at(-1);
  if (latest === undefined) return current;
  const firstIndex = current.times.findIndex((time) => time >= latest - seconds * 1000);
  const start = firstIndex < 0 ? 0 : firstIndex;
  return { times: current.times.slice(start), channels: Object.fromEntries(Object.entries(current.channels).map(([channel, values]) => [channel, values.slice(start)])) };
}

function App() {
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [displayPaused, setDisplayPaused] = useState(false);
  const [wearState, setWearState] = useState<WearState>("NOT_WORN");
  const [rangeSeconds, setRangeSeconds] = useState(30);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("auto");
  const [visible, setVisible] = useState<Record<SensorId, boolean>>(() => Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, true])) as Record<SensorId, boolean>);
  const [selectedSensor, setSelectedSensor] = useState<SensorId | "all">("all");
  const { series, lastSampleAt, session, completedSessions, resetCurrentView, storedSessions, persistedSampleCount, storageError, exportState, exportSession } = useSessionRecorder(wearState, displayPaused);
  const replay = useReplaySessions(storedSessions);
  const visibleSensors = useMemo(() => SENSOR_DEFINITIONS.filter((sensor) => visible[sensor.id]), [visible]);
  const displaySensors = useMemo(() => selectedSensor === "all" ? visibleSensors : visibleSensors.filter((sensor) => sensor.id === selectedSensor), [selectedSensor, visibleSensors]);
  const sessionStatus: SessionStatus = session?.status ?? "IDLE";
  const isReplay = mode === "replay";
  const activeSeries = isReplay && replay.replaySeries ? replay.replaySeries : series;
  const activeLatest = isReplay ? replay.position : lastSampleAt;

  const selectSensor = (id: SensorId) => {
    setVisible((current) => ({ ...current, [id]: true }));
    setSelectedSensor(id);
  };
  const showAllSensors = () => {
    setVisible(Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, true])) as Record<SensorId, boolean>);
    setSelectedSensor("all");
  };
  const toggleVisible = (id: SensorId) => {
    setVisible((current) => {
      const nextVisible = !current[id];
      if (!nextVisible && selectedSensor === id) setSelectedSensor("all");
      return { ...current, [id]: nextVisible };
    });
  };
  const handleReset = () => { resetCurrentView(); };

  return (
    <div className="lab-app">
      <header className="top-header">
        <div className="brand"><span className="brand-mark">A</span><span>ABILITY <b>LAB</b></span><small>v0.1</small></div>
        <div className="header-status"><span className="sample-pill"><i /> SAMPLE MODE</span><span className="wear-pill"><i /> SIMULATED WEAR STATE</span><span className={`mode-pill ${isReplay ? "is-replay" : "is-live"}`}>{isReplay ? "REPLAY MODE" : "LIVE MODE"}</span><span className={`state-pill ${sessionStatus === "RECORDING" ? "is-live" : "is-paused"}`}><i /> {isReplay ? "REPLAY" : statusLabel(sessionStatus)}</span><span className="clock">{formatClock(activeLatest)}</span></div>
      </header>

      <div className="workspace">
        <aside className="left-sidebar">
          <section className="side-section"><div className="section-eyebrow">WORKSPACE</div><h2>Acquisition mode</h2><div className="mode-switch"><button className={mode === "live" ? "is-selected" : ""} onClick={() => setMode("live")}>Live</button><button className={mode === "replay" ? "is-selected" : ""} onClick={() => { if (sessionStatus !== "RECORDING") { setMode("replay"); if (storedSessions[0]) void replay.loadSession(storedSessions[0].sessionId); } }} disabled={sessionStatus === "RECORDING"}>Replay</button></div><p className="side-note">{sessionStatus === "RECORDING" ? "Replay is locked while a live session is recording." : isReplay ? "Saved raw data only. No new samples are generated." : "Live mock acquisition and IndexedDB recording."}</p></section>
          <section className="side-section"><div className="section-eyebrow">SIGNALS</div><h2>Sensor selection</h2><button className={`sensor-all ${selectedSensor === "all" ? "is-selected" : ""}`} onClick={showAllSensors}><span className="all-icon">＋</span><span>All sensors</span><small>5 signals</small></button>{SENSOR_DEFINITIONS.map((sensor) => <div className={`sensor-check ${selectedSensor === sensor.id ? "is-selected" : ""}`} key={sensor.id}><button className="sensor-select" onClick={() => selectSensor(sensor.id)}><span className="checkbox" style={{ "--sensor-color": sensor.color } as CSSProperties} /><span>{sensor.shortLabel}</span></button><label className="sensor-visibility" title={`Show ${sensor.label}`}><input type="checkbox" checked={visible[sensor.id]} onChange={() => toggleVisible(sensor.id)} /><span className="visibility-box" /></label><small>{sensor.frequencyHz} Hz</small></div>)}</section>
          <section className="side-section"><div className="section-eyebrow">WINDOW</div><h2>Display time</h2><div className="segmented">{RANGE_OPTIONS.map((seconds) => <button className={rangeSeconds === seconds ? "is-selected" : ""} key={seconds} onClick={() => setRangeSeconds(seconds)}>{seconds}s</button>)}</div><p className="side-note">The graph window is shared across signals. Data acquisition continues at each sensor's own rate.</p></section>
          <section className="side-section"><div className="section-eyebrow">DISPLAY</div><h2>View settings</h2><label className="select-row"><span>Y-axis</span><select value={scaleMode} onChange={(event) => setScaleMode(event.target.value as ScaleMode)}><option value="auto">Auto scale</option><option value="fixed">Fixed scale</option></select></label><label className="select-row"><span>Grid</span><span className="setting-value">On</span></label></section>
        </aside>

        <main className="signal-workbench">
          <div className="workbench-heading"><div><div className="section-eyebrow">{isReplay ? "REPLAY / SAVED RAW INPUT" : "LIVE ACQUISITION / MOCK INPUT"}</div><h1>{selectedSensor === "all" ? "Signal monitor" : SENSOR_DEFINITIONS.find((sensor) => sensor.id === selectedSensor)?.label}</h1></div><div className="workbench-meta"><span><i className={`green-dot ${isReplay || wearState !== "WORN" ? "is-muted" : ""}`} /> {isReplay ? "Replay timeline" : wearState === "WORN" ? (displayPaused ? "Display paused · recording" : "Stream active") : wearState === "DISCONNECTED" ? "Communication interrupted" : "Waiting for wear"}</span><span>{selectedSensor === "all" ? `${visibleSensors.length} / 5 signals` : "Individual view"}</span></div></div>
          <div className={`chart-grid ${selectedSensor !== "all" ? "is-single" : ""}`}>{displaySensors.map((sensor) => <article className={`signal-card ${selectedSensor === sensor.id ? "is-expanded" : ""}`} key={sensor.id}><div className="signal-card-header"><div><div className="signal-title"><span className="signal-swatch" style={{ background: sensor.color }} /><h2>{sensor.label}</h2><span className="frequency">{sensor.frequencyHz} Hz</span></div><p>{sensor.channels.map((channel) => `${sensor.channelLabels[sensor.channels.indexOf(channel)]} ${valueFor(activeSeries, sensor.id, channel)} ${sensor.unit}`).join("  ·  ")}</p></div><button className="icon-button" onClick={() => setSelectedSensor(selectedSensor === sensor.id ? "all" : sensor.id)} aria-label={`${selectedSensor === sensor.id ? "Show all sensors" : `Expand ${sensor.label}`}`}>{selectedSensor === sensor.id ? "×" : "↗"}</button></div><SignalChart sensor={sensor} series={windowedSeries(activeSeries, sensor.id, rangeSeconds)} expanded={selectedSensor === sensor.id} scaleMode={scaleMode} /><div className="chart-footer"><span>{rangeSeconds}s window</span><span>{isReplay ? "replay raw signal" : "raw signal"}</span></div></article>)}</div>
          {displaySensors.length === 0 && <div className="empty-state">Select a visible signal or choose All sensors.</div>}
          <div className="lab-note"><span>ⓘ</span> Raw sensor channels only. Derived values such as heart rate, PRV, respiration, or temperature conversion are intentionally not shown in this research prototype.</div>
        </main>

        <aside className="right-sidebar">
          {isReplay && <section className="side-section replay-section"><div className="section-eyebrow">REPLAY</div><h2>Saved session</h2><select className="replay-select" value={replay.selectedId ?? ""} onChange={(event) => void replay.loadSession(event.target.value)}><option value="" disabled>Select a session</option>{replay.availableSessions.map((item) => <option value={item.sessionId} key={item.sessionId}>{formatDateTime(item.startedAt)} · {item.sessionId}</option>)}</select><label className="file-import">Import JSONL<input type="file" accept=".jsonl,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void replay.importFile(file); event.currentTarget.value = ""; }} /></label>{replay.meta && replay.bounds && <><div className="replay-meta"><span>{replay.meta.source}</span><span>{replay.meta.persistedSampleCount} samples</span></div><div className="replay-controls"><button className="primary-action" onClick={() => replay.setPlaying(!replay.playing)}>{replay.playing ? "Ⅱ Pause" : "▶ Play"}</button><select value={replay.speed} onChange={(event) => replay.setSpeed(Number(event.target.value))}><option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option></select></div><input className="replay-range" type="range" min="0" max="1000" value={Math.round(((replay.position ?? replay.bounds.start) - replay.bounds.start) / Math.max(1, replay.bounds.end - replay.bounds.start) * 1000)} onChange={(event) => replay.seek(Number(event.target.value) / 1000)} /><div className="replay-time"><span>{formatReplayTime(replay.position)}</span><span>{formatReplayTime(replay.bounds.end)}</span></div>{replay.meta.interruptions.length > 0 && <div className="replay-interruptions"><b>{replay.meta.interruptions.length} interruption{replay.meta.interruptions.length === 1 ? "" : "s"}</b>{replay.meta.interruptions.map((item, index) => <span key={`${item.startedAt}-${index}`}>{formatReplayTime(item.startedAt)} – {formatReplayTime(item.endedAt)}</span>)}</div>}</>}{replay.error && <p className="lab-alert">{replay.error}</p>}</section>}
          <section className="side-section"><div className="section-eyebrow">DEVICE STATUS</div><h2>Sensor state</h2><div className="device-card"><div className="device-row"><span className={`device-led ${wearState !== "WORN" ? "is-muted" : ""}`} /><strong>{isReplay ? "Saved session" : "Mock sensor stream"}</strong><span className="connected">{isReplay ? "REPLAY" : "LOCAL"}</span></div><div className="device-row detail"><span>Input source</span><b>{isReplay ? replay.meta?.source ?? "—" : "MockSensorSource"}</b></div><div className="device-row detail"><span>Clock</span><b>{isReplay ? "Saved timestamps" : "Browser UTC samples"}</b></div></div>{SENSOR_DEFINITIONS.map((sensor) => <div className="state-row" key={sensor.id}><span className="state-name"><i style={{ background: sensor.color }} />{sensor.shortLabel}</span><span className={visible[sensor.id] ? "state-ready" : "state-off"}>{visible[sensor.id] ? (isReplay ? "LOADED" : wearState === "WORN" ? "READY" : "WAITING") : "HIDDEN"}</span></div>)}</section>
          <section className="side-section"><div className="section-eyebrow">SIMULATED WEAR STATE</div><h2>Virtual device state</h2><div className="wear-state-buttons">{(["NOT_WORN", "WORN", "DISCONNECTED"] as WearState[]).map((state) => <button disabled={isReplay} className={wearState === state ? "is-selected" : ""} key={state} onClick={() => setWearState(state)}>{state}</button>)}</div><p className="side-note">{isReplay ? "Wear controls are disabled during replay." : "Development-only state simulation. This is not real wear detection."}</p></section>
          <section className="side-section"><div className="section-eyebrow">SESSION</div><h2>Measurement session</h2><div className="session-card"><div className="session-row"><span>Status</span><b>{sessionStatus}</b></div><div className="session-row"><span>Session ID</span><b>{session?.sessionId ?? "—"}</b></div><div className="session-row"><span>Started</span><b>{formatDateTime(session?.startedAt ?? null)}</b></div><div className="session-row"><span>Total elapsed</span><b>{formatDuration(session?.elapsedTime ?? 0)}</b></div><div className="session-row"><span>Data acquired</span><b>{formatDuration(session?.dataAcquisitionTime ?? 0)}</b></div><div className="session-row"><span>Samples in session</span><b>{session?.sensorSamples.length ?? 0}</b></div><div className="session-row"><span>Persisted locally</span><b>{persistedSampleCount}</b></div><div className="session-row"><span>Pending save</span><b>{Math.max(0, (session?.sensorSamples.length ?? 0) - persistedSampleCount)}</b></div><div className="session-row"><span>Storage</span><b className={storageError ? "storage-error" : "storage-ok"}>{storageError ? "ERROR" : "IndexedDB"}</b></div></div><p className="side-note">{completedSessions.length} completed in memory · {storedSessions.length} stored locally.</p>{storageError && <p className="lab-alert">{storageError}</p>}<button className="secondary-action export-action" onClick={() => exportSession()} disabled={exportState === "exporting" || (!session && !storedSessions.length)}>{exportState === "exporting" ? "Preparing JSONL…" : exportState === "success" ? "Exported JSONL ✓" : "Export session JSONL"}</button></section>
          <section className="side-section"><div className="section-eyebrow">ACQUISITION</div><h2>Display control</h2><button className={`primary-action ${displayPaused ? "start" : "stop"}`} onClick={() => setDisplayPaused((value) => !value)}><span>{displayPaused ? "▶" : "Ⅱ"}</span>{displayPaused ? "Resume display" : "Pause display"}</button><button className="secondary-action" onClick={handleReset}>Reset view buffer</button><p className="side-note">Display pause is separate from recording. WORN sessions continue collecting samples in memory.</p></section>
          <section className="side-section event-section"><div className="section-eyebrow">EVENTS</div><h2>Event record</h2><button className="event-button" disabled><span>＋</span> Add event marker</button><p className="side-note">Event annotation UI is reserved for the next phase. Playback is not connected.</p></section>
        </aside>
      </div>
      <footer className="bottom-bar"><span>ABILITY LAB / RESEARCH INSTRUMENT</span><span>SIMULATED INPUT · NOT A MEASUREMENT</span></footer>
    </div>
  );
}

export default App;
