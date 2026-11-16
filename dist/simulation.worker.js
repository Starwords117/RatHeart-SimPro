import { Experiment, POINT_DT } from "./core.js";
const scope = globalThis;
let experiment = new Experiment(true);
let sentFrames = 0, sentEvents = 0;
let last = performance.now(), budget = 0;
let broadcastOn = false, broadcastSeq = 0, bSentFrames = 0, bSentEvents = 0, lastBroadcast = 0, broadcastFull = false;
function broadcastNow() {
  const payload = broadcastFull ? { type: "full", seq: broadcastSeq, state: experiment.state, frames: experiment.trace, events: experiment.events } : { type: "chunk", seq: broadcastSeq, state: experiment.state, frames: experiment.trace.slice(bSentFrames), events: experiment.events.slice(bSentEvents) };
  bSentFrames = experiment.trace.length;
  bSentEvents = experiment.events.length;
  broadcastFull = false;
  scope.fetch("/api/broadcast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then((r) => r.json()).then((d) => scope.postMessage({ type: "broadcast", on: broadcastOn, followers: d.followers ?? 0 })).catch(() => {
    broadcastOn = false;
    scope.postMessage({ type: "broadcast", on: false, error: true });
  });
}
function send(replace = false) {
  if (replace) {
    sentFrames = 0;
    sentEvents = 0;
  }
  scope.postMessage({
    type: "update",
    state: experiment.state,
    activeDrugs: experiment.activeDrugs(),
    frames: experiment.trace.slice(sentFrames),
    events: experiment.events.slice(sentEvents),
    replace
  });
  sentFrames = experiment.trace.length;
  sentEvents = experiment.events.length;
}
function rebaseline() {
  budget = 0;
  last = performance.now();
  if (broadcastOn) {
    bSentFrames = 0;
    bSentEvents = 0;
    broadcastFull = true;
  }
}
scope.onmessage = (event) => {
  const m = event.data;
  switch (m.type) {
    case "init":
      send(true);
      break;
    case "run":
      if (!experiment.state.historyOnly) experiment.state.running = true;
      experiment.state.recorderStarted = true;
      rebaseline();
      send();
      break;
    case "pause":
      experiment.state.running = false;
      budget = 0;
      send();
      break;
    case "speed":
      experiment.state.speed = m.value;
      send();
      break;
    case "advance":
      experiment.advance(m.seconds);
      rebaseline();
      send();
      break;
    case "reset":
      experiment.reset(m.pithed, m.seed ?? experiment.state.seed, m.noise ?? experiment.state.noise);
      rebaseline();
      send(true);
      break;
    case "dose":
      experiment.inject(m.drugId, m.dose);
      send();
      break;
    case "stimulate":
      experiment.stimulate(m.pathway);
      send();
      break;
    case "model":
      experiment.setPithed(m.value);
      send();
      break;
    case "noise":
      experiment.setNoise(m.value);
      send();
      break;
    case "snapshot":
      scope.postMessage({ type: "snapshot", purpose: m.purpose ?? "download", snapshot: experiment.exportSnapshot() });
      break;
    case "csv":
      scope.postMessage({ type: "csv", trace: experiment.trace, events: experiment.events });
      break;
    case "rat-export":
      scope.postMessage({ type: "rat", buffer: experiment.exportRAT() });
      break;
    case "restore":
      try {
        experiment.restore(m.snapshot);
        rebaseline();
        send(true);
      } catch (error) {
        console.error(error);
        scope.postMessage({ type: "file-error" });
      }
      break;
    case "rat":
      try {
        if (experiment.importRAT(m.buffer)) {
          rebaseline();
          send(true);
        } else scope.postMessage({ type: "file-error" });
      } catch (error) {
        console.error(error);
        scope.postMessage({ type: "file-error" });
      }
      break;
    case "broadcast-on":
      broadcastOn = true;
      broadcastSeq += 1;
      bSentFrames = 0;
      bSentEvents = 0;
      broadcastFull = true;
      lastBroadcast = 0;
      broadcastNow();
      break;
    // 关闭广播需回执,否则界面按钮状态不翻转
    case "broadcast-off":
      broadcastOn = false;
      scope.postMessage({ type: "broadcast", on: false, followers: 0 });
      break;
  }
};
setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min((now - last) / 1e3, 0.5);
  last = now;
  if (broadcastOn && (broadcastFull || now - lastBroadcast >= 150 || experiment.trace.length > bSentFrames + 200)) {
    lastBroadcast = now;
    broadcastNow();
  }
  if (!experiment.state.running || experiment.state.historyOnly) return;
  budget += elapsed * experiment.state.speed;
  const steps = Math.floor(budget / POINT_DT);
  for (let i = 0; i < steps; i++) experiment.step();
  budget -= steps * POINT_DT;
  if (steps) send();
}, 40);
