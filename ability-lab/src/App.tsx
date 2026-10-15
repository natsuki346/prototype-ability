"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { appendSamples, cloneSeries, createSeriesStore, type SeriesStore } from "./data-buffer";
import { MockSensorSource, SENSOR_DEFINITIONS } from "./sensors";
import { SignalChart } from "./SignalChart";
import type { ScaleMode, SensorId } from "./types";

const MAX_POINTS = 3000;
const DISPLAY_INTERVAL_MS = 100;
const RANGE_OPTIONS = [10, 30, 60];

function useMockStream(running: boolean) {
  const sourceRef = useRef(new MockSensorSource());
  const storeRef = useRef<SeriesStore>(createSeriesStore(SENSOR_DEFINITIONS.map((sensor) => sensor.id)));
  const [series, setSeries] = useState(() => cloneSeries(storeRef.current));
  const [lastSampleAt, setLastSampleAt] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const samples = sourceRef.current.readDueSamples(performance.now());
      appendSamples(storeRef.current, samples, MAX_POINTS);
      if (samples.length) setLastSampleAt(samples.at(-1)?.sampledAt ?? null);
      setSeries(cloneSeries(storeRef.current));
    }, DISPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const reset = () => {
    sourceRef.current.reset();
    storeRef.current = createSeriesStore(SENSOR_DEFINITIONS.map((sensor) => sensor.id));
    setSeries(cloneSeries(storeRef.current));
    setLastSampleAt(null);
  };

  return { series, lastSampleAt, reset };
}

function formatClock(value: number | null) {
  return value === null ? "--:--:--" : new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  const [running, setRunning] = useState(true);
  const [rangeSeconds, setRangeSeconds] = useState(30);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("auto");
  const [visible, setVisible] = useState<Record<SensorId, boolean>>(() => Object.fromEntries(SENSOR_DEFINITIONS.map((sensor) => [sensor.id, true])) as Record<SensorId, boolean>);
  const [selectedSensor, setSelectedSensor] = useState<SensorId | "all">("all");
  const { series, lastSampleAt, reset } = useMockStream(running);
  const visibleSensors = useMemo(() => SENSOR_DEFINITIONS.filter((sensor) => visible[sensor.id]), [visible]);
  const displaySensors = useMemo(() => selectedSensor === "all" ? visibleSensors : visibleSensors.filter((sensor) => sensor.id === selectedSensor), [selectedSensor, visibleSensors]);

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
  const handleReset = () => { reset(); setRunning(true); };

  return (
    <div className="lab-app">
      <header className="top-header">
        <div className="brand"><span className="brand-mark">A</span><span>ABILITY <b>LAB</b></span><small>v0.1</small></div>
        <div className="header-status"><span className="sample-pill"><i /> SAMPLE MODE</span><span className={`state-pill ${running ? "is-live" : "is-paused"}`}><i /> {running ? "RUNNING" : "PAUSED"}</span><span className="clock">{formatClock(lastSampleAt)}</span></div>
      </header>

      <div className="workspace">
        <aside className="left-sidebar">
          <section className="side-section"><div className="section-eyebrow">SIGNALS</div><h2>Sensor selection</h2><button className={`sensor-all ${selectedSensor === "all" ? "is-selected" : ""}`} onClick={showAllSensors}><span className="all-icon">＋</span><span>All sensors</span><small>5 signals</small></button>{SENSOR_DEFINITIONS.map((sensor) => <div className={`sensor-check ${selectedSensor === sensor.id ? "is-selected" : ""}`} key={sensor.id}><button className="sensor-select" onClick={() => selectSensor(sensor.id)}><span className="checkbox" style={{ "--sensor-color": sensor.color } as CSSProperties} /><span>{sensor.shortLabel}</span></button><label className="sensor-visibility" title={`Show ${sensor.label}`}><input type="checkbox" checked={visible[sensor.id]} onChange={() => toggleVisible(sensor.id)} /><span className="visibility-box" /></label><small>{sensor.frequencyHz} Hz</small></div>)}</section>
          <section className="side-section"><div className="section-eyebrow">WINDOW</div><h2>Display time</h2><div className="segmented">{RANGE_OPTIONS.map((seconds) => <button className={rangeSeconds === seconds ? "is-selected" : ""} key={seconds} onClick={() => setRangeSeconds(seconds)}>{seconds}s</button>)}</div><p className="side-note">The graph window is shared across signals. Data acquisition continues at each sensor's own rate.</p></section>
          <section className="side-section"><div className="section-eyebrow">DISPLAY</div><h2>View settings</h2><label className="select-row"><span>Y-axis</span><select value={scaleMode} onChange={(event) => setScaleMode(event.target.value as ScaleMode)}><option value="auto">Auto scale</option><option value="fixed">Fixed scale</option></select></label><label className="select-row"><span>Grid</span><span className="setting-value">On</span></label></section>
        </aside>

        <main className="signal-workbench">
          <div className="workbench-heading"><div><div className="section-eyebrow">LIVE ACQUISITION / MOCK INPUT</div><h1>{selectedSensor === "all" ? "Signal monitor" : SENSOR_DEFINITIONS.find((sensor) => sensor.id === selectedSensor)?.label}</h1></div><div className="workbench-meta"><span><i className="green-dot" /> {running ? "Stream active" : "Stream paused"}</span><span>{selectedSensor === "all" ? `${visibleSensors.length} / 5 signals` : "Individual view"}</span></div></div>
          <div className={`chart-grid ${selectedSensor !== "all" ? "is-single" : ""}`}>{displaySensors.map((sensor) => <article className={`signal-card ${selectedSensor === sensor.id ? "is-expanded" : ""}`} key={sensor.id}><div className="signal-card-header"><div><div className="signal-title"><span className="signal-swatch" style={{ background: sensor.color }} /><h2>{sensor.label}</h2><span className="frequency">{sensor.frequencyHz} Hz</span></div><p>{sensor.channels.map((channel) => `${sensor.channelLabels[sensor.channels.indexOf(channel)]} ${valueFor(series, sensor.id, channel)} ${sensor.unit}`).join("  ·  ")}</p></div><button className="icon-button" onClick={() => setSelectedSensor(selectedSensor === sensor.id ? "all" : sensor.id)} aria-label={`${selectedSensor === sensor.id ? "Show all sensors" : `Expand ${sensor.label}`}`}>{selectedSensor === sensor.id ? "×" : "↗"}</button></div><SignalChart sensor={sensor} series={windowedSeries(series, sensor.id, rangeSeconds)} expanded={selectedSensor === sensor.id} scaleMode={scaleMode} /><div className="chart-footer"><span>{rangeSeconds}s window</span><span>raw signal</span></div></article>)}</div>
          {displaySensors.length === 0 && <div className="empty-state">Select a visible signal or choose All sensors.</div>}
          <div className="lab-note"><span>ⓘ</span> Raw sensor channels only. Derived values such as heart rate, PRV, respiration, or temperature conversion are intentionally not shown in this research prototype.</div>
        </main>

        <aside className="right-sidebar">
          <section className="side-section"><div className="section-eyebrow">DEVICE STATUS</div><h2>Sensor state</h2><div className="device-card"><div className="device-row"><span className="device-led" /><strong>Mock sensor stream</strong><span className="connected">LOCAL</span></div><div className="device-row detail"><span>Input source</span><b>MockSensorSource</b></div><div className="device-row detail"><span>Clock</span><b>Browser monotonic</b></div></div>{SENSOR_DEFINITIONS.map((sensor) => <div className="state-row" key={sensor.id}><span className="state-name"><i style={{ background: sensor.color }} />{sensor.shortLabel}</span><span className={visible[sensor.id] ? "state-ready" : "state-off"}>{visible[sensor.id] ? "READY" : "HIDDEN"}</span></div>)}</section>
          <section className="side-section"><div className="section-eyebrow">ACQUISITION</div><h2>Measurement control</h2><button className={`primary-action ${running ? "stop" : "start"}`} onClick={() => setRunning((value) => !value)}><span>{running ? "Ⅱ" : "▶"}</span>{running ? "Pause stream" : "Start stream"}</button><button className="secondary-action" onClick={handleReset}>Reset mock stream</button><p className="side-note">No data is saved. This control only starts or pauses the in-memory sample generator.</p></section>
          <section className="side-section event-section"><div className="section-eyebrow">EVENTS</div><h2>Event record</h2><button className="event-button" disabled><span>＋</span> Add event marker</button><p className="side-note">Event annotation UI is reserved for the next phase. Playback and persistence are not connected.</p></section>
        </aside>
      </div>
      <footer className="bottom-bar"><span>ABILITY LAB / RESEARCH INSTRUMENT</span><span>SIMULATED INPUT · NOT A MEASUREMENT</span></footer>
    </div>
  );
}

export default App;
