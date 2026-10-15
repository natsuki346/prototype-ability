import { useEffect, useRef } from "react";
import uPlot, { type AlignedData } from "uplot";
import type { ScaleMode, SensorDefinition } from "./types";
import type { SensorSeries } from "./data-buffer";
import "uplot/dist/uPlot.min.css";

type SignalChartProps = { sensor: SensorDefinition; series: SensorSeries; expanded: boolean; scaleMode: ScaleMode };

export function SignalChart({ sensor, series, expanded, scaleMode }: SignalChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const data = [series.times.map((time) => time / 1000), ...sensor.channels.map((channel) => series.channels[channel] ?? [])] as AlignedData;
    const options: uPlot.Options = {
      width: host.clientWidth || 480,
      height: expanded ? 300 : 170,
      padding: [10, 12, 8, 8],
      legend: { show: false },
      cursor: { show: true, drag: { x: false, y: false } },
      scales: { x: { time: true }, y: scaleMode === "fixed" ? { auto: false, range: [sensor.ranges.min, sensor.ranges.max] } : { auto: true } },
      axes: [
        { stroke: "#9ba7b5", grid: { stroke: "#e7ecf1", width: 1 }, ticks: { stroke: "#e7ecf1", width: 1 }, font: "10px ui-monospace, SFMono-Regular, Menlo, monospace", values: (_u, splits) => splits.map((value) => new Date(value * 1000).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })) },
        { stroke: "#9ba7b5", grid: { stroke: "#e7ecf1", width: 1 }, ticks: { stroke: "#e7ecf1", width: 1 }, font: "10px ui-monospace, SFMono-Regular, Menlo, monospace", size: 42 },
      ],
      series: [{ label: "time" }, ...sensor.channels.map((channel, index) => ({ label: sensor.channelLabels[index], stroke: index === 0 ? sensor.color : `${sensor.color}99`, width: index === 0 ? 2 : 1.4, points: { show: false } }))],
    };
    plotRef.current = new uPlot(options, data, host);
    const resizeObserver = new ResizeObserver(() => { if (plotRef.current) plotRef.current.setSize({ width: host.clientWidth, height: expanded ? 300 : 170 }); });
    resizeObserver.observe(host);
    return () => { resizeObserver.disconnect(); plotRef.current?.destroy(); plotRef.current = null; };
  }, [expanded, scaleMode, sensor]);

  useEffect(() => {
    if (!plotRef.current) return;
    plotRef.current.setData([series.times.map((time) => time / 1000), ...sensor.channels.map((channel) => series.channels[channel] ?? [])] as AlignedData);
  }, [sensor, series]);

  return <div className="chart-host" ref={hostRef} aria-label={`${sensor.label} time series`} />;
}
