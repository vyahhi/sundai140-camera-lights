"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ROWS = 17;
const COLS = 9;
type Status = "idle" | "starting" | "ready" | "live" | "error";

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("Camera is off");
  const [brightness, setBrightness] = useState(1.15);
  const [contrast, setContrast] = useState(1.35);
  const [mirror, setMirror] = useState(true);
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
    if (!context) return null;
    const targetRatio = COLS / ROWS;
    const sourceRatio = video.videoWidth / video.videoHeight;
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (sourceRatio > targetRatio) { sw = video.videoHeight * targetRatio; sx = (video.videoWidth - sw) / 2; }
    else { sh = video.videoWidth / targetRatio; sy = (video.videoHeight - sh) / 2; }
    context.save();
    context.clearRect(0, 0, COLS, ROWS);
    context.filter = `brightness(${brightness}) contrast(${contrast}) saturate(1.2)`;
    if (mirror) { context.translate(COLS, 0); context.scale(-1, 1); }
    context.drawImage(video, sx, sy, sw, sh, 0, 0, COLS, ROWS);
    context.restore();
    const data = context.getImageData(0, 0, COLS, ROWS).data;
    return Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => {
      const index = (y * COLS + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    }));
  }, [brightness, contrast, mirror]);

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
    void sendFrame();
    timerRef.current = window.setInterval(() => void sendFrame(), 250);
  }, [sendFrame]);

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
