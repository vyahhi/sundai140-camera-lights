"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ROWS = 17;
const COLS = 9;
const WORK_SCALE = 8;
type Status = "idle" | "starting" | "ready" | "live" | "error";
type FilterId = "natural" | "anime" | "neon" | "mono";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "natural", label: "Natural" },
  { id: "anime", label: "Anime" },
  { id: "neon", label: "Neon" },
  { id: "mono", label: "Mono" },
];

function clamp(value: number) { return Math.max(0, Math.min(255, Math.round(value))); }

function applyFilter(image: ImageData, filter: FilterId) {
  if (filter === "natural") return;
  const { data, width, height } = image;
  const source = new Uint8ClampedArray(data);
  const luminance = (index: number) => source[index] * .299 + source[index + 1] * .587 + source[index + 2] * .114;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    const left = (y * width + Math.max(0, x - 1)) * 4;
    const right = (y * width + Math.min(width - 1, x + 1)) * 4;
    const up = (Math.max(0, y - 1) * width + x) * 4;
    const down = (Math.min(height - 1, y + 1) * width + x) * 4;
    const edge = Math.abs(luminance(right) - luminance(left)) + Math.abs(luminance(down) - luminance(up));
    const light = luminance(index);
    if (filter === "anime") {
      if (edge > 58) { data[index] = 7; data[index + 1] = 12; data[index + 2] = 22; }
      else {
        const average = (source[index] + source[index + 1] + source[index + 2]) / 3;
        data[index] = clamp(Math.round((average + (source[index] - average) * 1.45) / 64) * 64);
        data[index + 1] = clamp(Math.round((average + (source[index + 1] - average) * 1.45) / 64) * 64);
        data[index + 2] = clamp(Math.round((average + (source[index + 2] - average) * 1.45) / 64) * 64);
      }
    } else if (filter === "neon") {
      const glow = Math.min(255, edge * 3.2);
      data[index] = clamp(glow * .75 + light * .12);
      data[index + 1] = clamp(glow + light * .08);
      data[index + 2] = clamp(120 + glow * .72);
    } else {
      const value = light > 120 ? 255 : light > 62 ? 145 : 8;
      data[index] = value; data[index + 1] = value; data[index + 2] = value;
    }
  }
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("Camera is off");
  const [brightness, setBrightness] = useState(1.15);
  const [contrast, setContrast] = useState(1.35);
  const [mirror, setMirror] = useState(true);
  const [filter, setFilter] = useState<FilterId>("natural");
  const [framesSent, setFramesSent] = useState(0);

  const stopLive = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setStatus((current) => current === "error" ? current : "ready");
    setMessage("Preview ready — press Go live");
  }, []);

  const stopCamera = useCallback(() => {
    stopLive();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
    setMessage("Camera is off");
  }, [stopLive]);

  const startCamera = useCallback(async () => {
    setStatus("starting");
    setMessage("Requesting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setStatus("ready");
      setMessage("Preview ready — press Go live");
    } catch {
      setStatus("error");
      setMessage("Camera access was blocked. Allow it and try again.");
    }
  }, []);

  const makeFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const workCanvas = workCanvasRef.current ?? document.createElement("canvas");
    workCanvasRef.current = workCanvas;
    workCanvas.width = COLS * WORK_SCALE;
    workCanvas.height = ROWS * WORK_SCALE;
    const work = workCanvas.getContext("2d", { willReadFrequently: true });
    if (!context || !work) return null;
    const targetRatio = COLS / ROWS;
    const sourceRatio = video.videoWidth / video.videoHeight;
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (sourceRatio > targetRatio) { sw = video.videoHeight * targetRatio; sx = (video.videoWidth - sw) / 2; }
    else { sh = video.videoWidth / targetRatio; sy = (video.videoHeight - sh) / 2; }
    work.save();
    work.clearRect(0, 0, workCanvas.width, workCanvas.height);
    work.filter = `brightness(${brightness}) contrast(${contrast}) saturate(1.2)`;
    if (mirror) { work.translate(workCanvas.width, 0); work.scale(-1, 1); }
    work.drawImage(video, sx, sy, sw, sh, 0, 0, workCanvas.width, workCanvas.height);
    work.restore();
    if (filter !== "natural") {
      const processed = work.getImageData(0, 0, workCanvas.width, workCanvas.height);
      applyFilter(processed, filter);
      work.putImageData(processed, 0, 0);
    }
    context.clearRect(0, 0, COLS, ROWS);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(workCanvas, 0, 0, COLS, ROWS);
    const data = context.getImageData(0, 0, COLS, ROWS).data;
    return Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => {
      const index = (y * COLS + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    }));
  }, [brightness, contrast, filter, mirror]);

  const sendFrame = useCallback(async () => {
    if (sendingRef.current) return;
    const frame = makeFrame();
    if (!frame) return;
    sendingRef.current = true;
    try {
      const response = await fetch("/api/frame", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(frame) });
      if (!response.ok) throw new Error("Display rejected frame");
      setFramesSent((count) => count + 1);
      setMessage("Live on the building");
    } catch { setMessage("Building connection lost — retrying…"); }
    finally { sendingRef.current = false; }
  }, [makeFrame]);

  const goLive = useCallback(() => {
    if (!streamRef.current) return;
    setStatus("live");
    setMessage("Live on the building");
  }, []);

  useEffect(() => {
    if (status !== "live") return;
    void sendFrame();
    const liveTimer = window.setInterval(() => void sendFrame(), 250);
    timerRef.current = liveTimer;
    return () => {
      window.clearInterval(liveTimer);
      if (timerRef.current === liveTimer) timerRef.current = null;
    };
  }, [sendFrame, status]);

  useEffect(() => {
    if (status !== "ready" && status !== "live") return;
    const preview = window.setInterval(() => { makeFrame(); }, 100);
    return () => window.clearInterval(preview);
  }, [makeFrame, status]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return (
    <main className="app-shell">
      <div className="aurora" aria-hidden="true" />
      <header className="topbar">
        <div><p className="eyebrow">Green Building camera experiment</p><h1>YOU, IN LIGHT</h1></div>
        <a href="https://sundai.willsarg.com/jolly-seal?view=river&real=1" target="_blank" rel="noreferrer">Open simulator ↗</a>
      </header>
      <section className="studio">
        <div className="camera-card">
          <div className="camera-stage">
            <video ref={videoRef} muted playsInline className={mirror ? "mirrored" : ""} />
            {status === "idle" && <div className="camera-empty"><span>◉</span><p>Your camera becomes<br />the building facade.</p></div>}
            <div className={`live-badge ${status === "live" ? "on" : ""}`}><i />{status === "live" ? "LIVE" : "PREVIEW"}</div>
            <div className="crop-guide" aria-hidden="true" />
          </div>
          <div className="primary-controls">
            {status === "idle" || status === "error" || status === "starting" ? <button className="primary" onClick={() => void startCamera()} disabled={status === "starting"}>{status === "starting" ? "Starting…" : "Start camera"}</button> : status === "live" ? <button className="stop" onClick={stopLive}>Stop sending</button> : <button className="primary pulse" onClick={goLive}>Go live on building</button>}
            {status !== "idle" && status !== "starting" && <button className="secondary" onClick={stopCamera}>Camera off</button>}
          </div>
        </div>
        <aside className="control-card">
          <div className="pixel-panel"><div className="pixel-header"><span>BUILDING FEED</span><strong>17 rows × 9 columns</strong></div><canvas ref={canvasRef} width={COLS} height={ROWS} aria-label="Seventeen rows by nine columns pixel preview" /></div>
          <div className="status-line"><span className={`status-dot ${status}`} /> <span>{message}</span></div>
          <fieldset className="filter-control"><legend>Look</legend><div className="filter-buttons">{FILTERS.map((item) => <button type="button" key={item.id} className={filter === item.id ? "active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div></fieldset>
          <label><span>Brightness <b>{brightness.toFixed(2)}×</b></span><input type="range" min="0.5" max="2" step="0.05" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></label>
          <label><span>Contrast <b>{contrast.toFixed(2)}×</b></span><input type="range" min="0.5" max="2.5" step="0.05" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} /></label>
          <label className="toggle-row"><span>Mirror selfie</span><input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} /></label>
          <div className="stats"><div><strong>{framesSent}</strong><span>frames sent</span></div><div><strong>4</strong><span>frames / sec</span></div></div>
          <p className="privacy">Video stays in your browser. Only 153 colored pixels are sent.</p>
        </aside>
      </section>
    </main>
  );
}
