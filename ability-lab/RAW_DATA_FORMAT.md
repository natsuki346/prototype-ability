# Ability Lab raw data format

The browser stores each session in IndexedDB and exports it as UTF-8 JSONL. The
current format version is `ability-lab.raw.v1`. Each line is one JSON object:

1. A `recordType: "session"` header with session metadata, sensor metadata,
   interruption history, and per-sensor sample counts.
2. One `recordType: "sample"` object for every acquired raw sample.
3. A `recordType: "summary"` object containing the exported total.

Sample values are not converted or smoothed. `sensorTimestamp` is the timestamp
associated with the incoming sample; for the current mock source it is a
simulated browser-clock timestamp. `receivedAt` is the browser receive time.
Device input must set `source` to `DEVICE` and may set `sensorTimestamp` to
`null` when the device does not provide one. No device timestamp is invented.

The header's `sensorConfig` describes channels, nominal frequency, ADC
resolution when known, and scale/offset metadata. Scale and offset are `1` and
`0` in the current raw-only prototype.

Example:

```jsonl
{"recordType":"session","formatVersion":"ability-lab.raw.v1","sessionId":"session-...","startedAt":1710000000000,"endedAt":null,"status":"RECORDING","elapsedTime":1200,"dataAcquisitionTime":1200,"interruptions":[],"sensorConfig":[...],"source":"SIMULATED","sampleCounts":{"ppg":1,"gsr":1,"temperature":1,"acceleration":1,"gyroscope":1},"persistedSampleCount":5}
{"recordType":"sample","formatVersion":"ability-lab.raw.v1","sessionId":"session-...","sensorId":"ppg","sequenceNumber":0,"sensorTimestamp":1710000000000,"receivedAt":1710000000001,"rawValues":{"ir":34012.3,"red":25501.8},"source":"SIMULATED"}
{"recordType":"summary","formatVersion":"ability-lab.raw.v1","sessionId":"session-...","sampleCounts":{"ppg":1,"gsr":1,"temperature":1,"acceleration":1,"gyroscope":1},"totalSamples":5}
```

A minimal Python reader is:

```python
import json

with open("ability-lab-session.jsonl", encoding="utf-8") as f:
    records = [json.loads(line) for line in f if line.strip()]
header = records[0]
samples = [record for record in records if record["recordType"] == "sample"]
assert sum(header["sampleCounts"].values()) == len(samples)
```
