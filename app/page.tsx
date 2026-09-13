"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const ROWS = 17;
const COLS = 9;
const WORK_SCALE = 8;
type Status = "idle" | "starting" | "ready" | "live" | "error";
type FilterId = "natural" | "portrait" | "caricature" | "neon" | "mono";
type FaceStatus = "off" | "loading" | "searching" | "locked" | "error";
type Landmark = { x: number; y: number; z: number };
type Crop = { x: number; y: number; width: number; height: number };
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "natural", label: "Natural" },
  { id: "portrait", label: "Portrait" },
  { id: "caricature", label: "Caricature" },
  { id: "neon", label: "Neon" },
  { id: "mono", label: "Mono" },
];

const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
const LEFT_BROW = [70, 63, 105, 66, 107];
const RIGHT_BROW = [336, 296, 334, 293, 300];

function clamp(value: number) { return Math.max(0, Math.min(255, Math.round(value))); }

function applyFilter(image: ImageData, filter: FilterId) {
  if (filter === "natural" || filter === "portrait" || filter === "caricature") return;
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
    if (filter === "neon") {
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

function meanPoint(landmarks: Landmark[], indexes: number[]) {
  const total = indexes.reduce((sum, index) => ({ x: sum.x + landmarks[index].x, y: sum.y + landmarks[index].y }), { x: 0, y: 0 });
  return { x: total.x / indexes.length, y: total.y / indexes.length };
}

function faceCrop(landmarks: Landmark[], sourceRatio: number): Crop {
  const forehead = landmarks[10];
  const chin = landmarks[152];
  const templeA = landmarks[234];
  const templeB = landmarks[454];
  const distance = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * sourceRatio, a.y - b.y);
  const faceHeight = distance(forehead, chin);
  const faceWidth = distance(templeA, templeB);
  const targetRatio = COLS / ROWS;
  const height = Math.min(1, Math.max(faceHeight * 1.48, faceWidth / targetRatio * 1.22));
  const width = Math.min(1, height * targetRatio / sourceRatio);
  const centerX = (templeA.x + templeB.x) / 2;
  const centerY = forehead.y + (chin.y - forehead.y) * .56;
  return {
    x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
    y: Math.max(0, Math.min(1 - height, centerY - height * .45)),
    width,
    height,
  };
}

function applyCaricatureWarp(canvas: HTMLCanvasElement, landmarks: Landmark[], crop: Crop, mirror: boolean, strength: number) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const toPixel = (point: Landmark | { x: number; y: number }) => {
    let x = (point.x - crop.x) / crop.width * canvas.width;
    if (mirror) x = canvas.width - x;
    return { x, y: (point.y - crop.y) / crop.height * canvas.height };
  };
  const leftEye = toPixel(meanPoint(landmarks, LEFT_EYE));
  const rightEye = toPixel(meanPoint(landmarks, RIGHT_EYE));
  const mouth = toPixel(meanPoint(landmarks, [13, 14, 0, 17]));
  const mouthLeft = toPixel(landmarks[61]);
  const mouthRight = toPixel(landmarks[291]);
  const templeA = toPixel(landmarks[234]);
  const templeB = toPixel(landmarks[454]);
  const forehead = toPixel(landmarks[10]);
  const chin = toPixel(landmarks[152]);
  const center = { x: (templeA.x + templeB.x) / 2, y: (forehead.y + chin.y) / 2 };
  const faceRx = Math.max(8, Math.abs(templeB.x - templeA.x) / 2);
  const faceRy = Math.max(12, Math.abs(chin.y - forehead.y) / 2);
  const eyeRadius = Math.max(4, Math.abs(rightEye.x - leftEye.x) * .29);
  const mouthRadius = Math.max(5, Math.abs(mouthRight.x - mouthLeft.x) * .72);
  const amount = Math.max(0, Math.min(1, (strength - .5) / 1.3));
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const output = context.createImageData(canvas.width, canvas.height);

  const magnify = (position: { x: number; y: number }, feature: { x: number; y: number }, radiusX: number, radiusY: number, power: number) => {
    const dx = (position.x - feature.x) / radiusX;
    const dy = (position.y - feature.y) / radiusY;
    const distance = dx * dx + dy * dy;
    if (distance >= 1) return;
    const pull = power * (1 - distance) ** 2;
    position.x = feature.x + (position.x - feature.x) * (1 - pull);
    position.y = feature.y + (position.y - feature.y) * (1 - pull);
  };

  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const sample = { x, y };
    const faceDistance = ((x - center.x) / faceRx) ** 2 + ((y - center.y) / faceRy) ** 2;
    if (faceDistance < 1.35) {
      const vertical = Math.max(0, Math.min(1, (y - center.y) / faceRy));
      sample.x = center.x + (sample.x - center.x) * (1 - .06 * amount * (.35 + vertical * .65) * (1 - faceDistance / 1.35));
    }
    magnify(sample, leftEye, eyeRadius * 1.45, eyeRadius, .12 * amount);
    magnify(sample, rightEye, eyeRadius * 1.45, eyeRadius, .12 * amount);
    magnify(sample, mouth, mouthRadius * 1.35, mouthRadius * .82, .08 * amount);
    const sx = Math.max(0, Math.min(canvas.width - 1, Math.round(sample.x)));
    const sy = Math.max(0, Math.min(canvas.height - 1, Math.round(sample.y)));
    const from = (sy * canvas.width + sx) * 4;
    const to = (y * canvas.width + x) * 4;
    output.data[to] = source.data[from];
    output.data[to + 1] = source.data[from + 1];
    output.data[to + 2] = source.data[from + 2];
    output.data[to + 3] = source.data[from + 3];
  }
  context.putImageData(output, 0, 0);
}

function faceRotation(landmarks: Landmark[], crop: Crop, mirror: boolean, width: number, height: number) {
  const map = (point: Landmark | { x: number; y: number }) => {
    let x = (point.x - crop.x) / crop.width * width;
    if (mirror) x = width - x;
    return { x, y: (point.y - crop.y) / crop.height * height };
  };
  const eyeA = map(meanPoint(landmarks, LEFT_EYE));
  const eyeB = map(meanPoint(landmarks, RIGHT_EYE));
  const left = eyeA.x <= eyeB.x ? eyeA : eyeB;
  const right = eyeA.x <= eyeB.x ? eyeB : eyeA;
  const center = map(meanPoint(landmarks, FACE_OVAL));
  const angle = Math.max(-.58, Math.min(.58, Math.atan2(right.y - left.y, right.x - left.x)));
  return { angle, center };
}

function straightenFace(canvas: HTMLCanvasElement, scratch: HTMLCanvasElement, landmarks: Landmark[], crop: Crop, mirror: boolean) {
  const { angle, center } = faceRotation(landmarks, crop, mirror, canvas.width, canvas.height);
  if (Math.abs(angle) < .025) return 0;
  scratch.width = canvas.width;
  scratch.height = canvas.height;
  const scratchContext = scratch.getContext("2d");
  const context = canvas.getContext("2d");
  if (!scratchContext || !context) return 0;
  scratchContext.clearRect(0, 0, scratch.width, scratch.height);
  scratchContext.drawImage(canvas, 0, 0);
  context.save();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.translate(center.x, center.y);
  context.rotate(-angle);
  context.translate(-center.x, -center.y);
  context.drawImage(scratch, 0, 0);
  context.restore();
  return angle;
}

function drawSemanticPortrait(context: CanvasRenderingContext2D, landmarks: Landmark[], crop: Crop, mirror: boolean, caricature = false, strength = 1, rotation = 0) {
  const rawCell = (point: Landmark | { x: number; y: number }) => {
    let x = (point.x - crop.x) / crop.width * COLS;
    if (mirror) x = COLS - x;
    return { x, y: (point.y - crop.y) / crop.height * ROWS };
  };
  const rotationCenter = rawCell(meanPoint(landmarks, FACE_OVAL));
  const cell = (point: Landmark | { x: number; y: number }) => {
    const raw = rawCell(point);
    const dx = raw.x - rotationCenter.x;
    const dy = raw.y - rotationCenter.y;
    const cosine = Math.cos(-rotation);
    const sine = Math.sin(-rotation);
    const x = rotationCenter.x + dx * cosine - dy * sine;
    const y = rotationCenter.y + dx * sine + dy * cosine;
    return { x: Math.max(0, Math.min(COLS - 1, Math.round(x - .5))), y: Math.max(0, Math.min(ROWS - 1, Math.round(y - .5))) };
  };
  // Separate the face gently while keeping the camera's real color palette.
  const faceCenter = cell(meanPoint(landmarks, FACE_OVAL));
  const templeA = cell(landmarks[234]);
  const templeB = cell(landmarks[454]);
  const chin = cell(landmarks[152]);
  const forehead = cell(landmarks[10]);
  const rx = Math.max(2, Math.abs(templeB.x - templeA.x) / 2 + .65);
  const ry = Math.max(3, Math.abs(chin.y - forehead.y) / 2 + .75);
  const pixels = context.getImageData(0, 0, COLS, ROWS);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const outside = ((x - faceCenter.x) / rx) ** 2 + ((y - faceCenter.y) / ry) ** 2 > 1.28;
    const index = (y * COLS + x) * 4;
    if (outside) {
      pixels.data[index] = clamp(pixels.data[index] * .52);
      pixels.data[index + 1] = clamp(pixels.data[index + 1] * .56);
      pixels.data[index + 2] = clamp(pixels.data[index + 2] * .6);
    } else {
      pixels.data[index] = clamp(Math.round(pixels.data[index] / 28) * 28);
      pixels.data[index + 1] = clamp(Math.round(pixels.data[index + 1] / 28) * 28);
      pixels.data[index + 2] = clamp(Math.round(pixels.data[index + 2] / 28) * 28);
    }
  }
  const blendCell = (x: number, y: number, target: [number, number, number], amount: number) => {
    x = Math.max(0, Math.min(COLS - 1, x));
    y = Math.max(0, Math.min(ROWS - 1, y));
    const index = (y * COLS + x) * 4;
    pixels.data[index] = clamp(pixels.data[index] * (1 - amount) + target[0] * amount);
    pixels.data[index + 1] = clamp(pixels.data[index + 1] * (1 - amount) + target[1] * amount);
    pixels.data[index + 2] = clamp(pixels.data[index + 2] * (1 - amount) + target[2] * amount);
  };

  // Caricature keeps only a whisper of contour; hard outlines looked mask-like.
  if (caricature) for (let index = 0; index < FACE_OVAL.length; index += 6) {
    const original = cell(landmarks[FACE_OVAL[index]]);
    const expansion = 1 + .035 * strength;
    blendCell(
      Math.round(faceCenter.x + (original.x - faceCenter.x) * expansion),
      Math.round(faceCenter.y + (original.y - faceCenter.y) * 1.02),
      [24, 31, 32],
      .2,
    );
  }
  const leftEye = cell(meanPoint(landmarks, LEFT_EYE));
  const rightEye = cell(meanPoint(landmarks, RIGHT_EYE));
  const leftEyeOpen = Math.abs(landmarks[159].y - landmarks[145].y) / Math.max(.001, Math.abs(landmarks[133].x - landmarks[33].x));
  const rightEyeOpen = Math.abs(landmarks[386].y - landmarks[374].y) / Math.max(.001, Math.abs(landmarks[263].x - landmarks[362].x));
  const eyeTone: [number, number, number] = [214, 220, 205];
  const closedEye: [number, number, number] = [42, 45, 43];
  blendCell(leftEye.x, leftEye.y, leftEyeOpen > .075 ? eyeTone : closedEye, caricature ? .42 : .3);
  blendCell(rightEye.x, rightEye.y, rightEyeOpen > .075 ? eyeTone : closedEye, caricature ? .42 : .3);
  const leftBrow = cell(meanPoint(landmarks, LEFT_BROW));
  const rightBrow = cell(meanPoint(landmarks, RIGHT_BROW));
  blendCell(leftBrow.x, Math.min(leftEye.y - 1, leftBrow.y), [35, 32, 29], .38);
  blendCell(rightBrow.x, Math.min(rightEye.y - 1, rightBrow.y), [35, 32, 29], .38);

  const nose = cell(landmarks[1]);
  blendCell(nose.x, nose.y, [205, 157, 116], .14);
  const mouthLeft = cell(landmarks[61]);
  const mouthRight = cell(landmarks[291]);
  const mouthCenter = cell(meanPoint(landmarks, [13, 14, 0, 17]));
  const mouthMin = Math.min(mouthLeft.x, mouthRight.x);
  const mouthMax = Math.max(mouthLeft.x, mouthRight.x);
  const mouthWidth = Math.max(1, Math.min(caricature ? 3 : 2, mouthMax - mouthMin + (caricature && strength > 1.15 ? 1 : 0)));
  const startX = Math.max(0, Math.min(COLS - mouthWidth, mouthCenter.x - Math.floor(mouthWidth / 2)));
  for (let x = startX; x < startX + mouthWidth; x++) blendCell(x, mouthCenter.y, [132, 58, 62], caricature ? .52 : .4);
  const mouthOpen = Math.abs(landmarks[13].y - landmarks[14].y) / Math.max(.001, Math.abs(landmarks[291].x - landmarks[61].x));
  if (mouthOpen > .09 && mouthCenter.y < ROWS - 1) blendCell(mouthCenter.x, mouthCenter.y + 1, [28, 20, 23], .62);
  context.putImageData(pixels, 0, 0);
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const landmarksRef = useRef<Landmark[] | null>(null);
  const lastDetectionRef = useRef(0);
  const lastFaceSeenRef = useRef(0);
  const cropRef = useRef<Crop | null>(null);
  const previousPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const previousFilterRef = useRef<FilterId>("portrait");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("Camera is off");
  const [brightness, setBrightness] = useState(1.15);
  const [contrast, setContrast] = useState(1.35);
  const [caricatureStrength, setCaricatureStrength] = useState(1);
  const [mirror, setMirror] = useState(true);
  const [filter, setFilter] = useState<FilterId>("portrait");
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("off");
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

  useEffect(() => {
    if (filter !== "portrait" && filter !== "caricature") { setFaceStatus("off"); return; }
    if (faceLandmarkerRef.current) { setFaceStatus(landmarksRef.current ? "locked" : "searching"); return; }
    let cancelled = false;
    setFaceStatus("loading");
    void (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe");
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task" },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: .55,
          minFacePresenceConfidence: .55,
          minTrackingConfidence: .55,
        });
        if (cancelled) { landmarker.close(); return; }
        faceLandmarkerRef.current = landmarker;
        setFaceStatus("searching");
      } catch {
        if (!cancelled) setFaceStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [filter]);

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
    const now = performance.now();
    const sourceRatio = video.videoWidth / video.videoHeight;
    const faceMode = filter === "portrait" || filter === "caricature";
    if (faceMode && faceLandmarkerRef.current && now - lastDetectionRef.current > 85) {
      lastDetectionRef.current = now;
      const result = faceLandmarkerRef.current.detectForVideo(video, now);
      const detected = result.faceLandmarks[0] as Landmark[] | undefined;
      if (detected) {
        const previous = landmarksRef.current;
        landmarksRef.current = previous?.length === detected.length
          ? detected.map((point, index) => ({ x: previous[index].x * .68 + point.x * .32, y: previous[index].y * .68 + point.y * .32, z: previous[index].z * .68 + point.z * .32 }))
          : detected;
        lastFaceSeenRef.current = now;
        setFaceStatus((current) => current === "locked" ? current : "locked");
      } else if (now - lastFaceSeenRef.current > 550) {
        landmarksRef.current = null;
        cropRef.current = null;
        setFaceStatus((current) => current === "searching" ? current : "searching");
      }
    }
    const landmarks = faceMode ? landmarksRef.current : null;
    let normalizedCrop: Crop;
    if (landmarks) {
      const next = faceCrop(landmarks, sourceRatio);
      const previous = cropRef.current;
      normalizedCrop = previous ? {
        x: previous.x * .78 + next.x * .22,
        y: previous.y * .78 + next.y * .22,
        width: previous.width * .78 + next.width * .22,
        height: previous.height * .78 + next.height * .22,
      } : next;
      cropRef.current = normalizedCrop;
    } else {
      const targetRatio = COLS / ROWS;
      normalizedCrop = sourceRatio > targetRatio
        ? { x: (1 - targetRatio / sourceRatio) / 2, y: 0, width: targetRatio / sourceRatio, height: 1 }
        : { x: 0, y: (1 - sourceRatio / targetRatio) / 2, width: 1, height: sourceRatio / targetRatio };
    }
    const sx = normalizedCrop.x * video.videoWidth;
    const sy = normalizedCrop.y * video.videoHeight;
    const sw = normalizedCrop.width * video.videoWidth;
    const sh = normalizedCrop.height * video.videoHeight;
    work.save();
    work.clearRect(0, 0, workCanvas.width, workCanvas.height);
    const modeContrast = faceMode ? 1 + (contrast - 1) * .72 : contrast;
    const modeBrightness = faceMode ? brightness * .97 : brightness;
    work.filter = `brightness(${modeBrightness}) contrast(${modeContrast}) saturate(${faceMode ? 1.04 : 1.2})`;
    if (mirror) { work.translate(workCanvas.width, 0); work.scale(-1, 1); }
    work.drawImage(video, sx, sy, sw, sh, 0, 0, workCanvas.width, workCanvas.height);
    work.restore();
    if (filter === "caricature" && landmarks) applyCaricatureWarp(workCanvas, landmarks, normalizedCrop, mirror, caricatureStrength);
    let rotation = 0;
    if (faceMode && landmarks) {
      const rotationCanvas = rotationCanvasRef.current ?? document.createElement("canvas");
      rotationCanvasRef.current = rotationCanvas;
      rotation = straightenFace(workCanvas, rotationCanvas, landmarks, normalizedCrop, mirror);
    }
    if (filter !== "natural") {
      const processed = work.getImageData(0, 0, workCanvas.width, workCanvas.height);
      applyFilter(processed, filter);
      work.putImageData(processed, 0, 0);
    }
    context.clearRect(0, 0, COLS, ROWS);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(workCanvas, 0, 0, COLS, ROWS);
    if (faceMode && landmarks) drawSemanticPortrait(context, landmarks, normalizedCrop, mirror, filter === "caricature", caricatureStrength, rotation);
    const finalImage = context.getImageData(0, 0, COLS, ROWS);
    const previous = previousFilterRef.current === filter ? previousPixelsRef.current : null;
    if (faceMode && previous?.length === finalImage.data.length) {
      for (let index = 0; index < finalImage.data.length; index += 4) {
        finalImage.data[index] = clamp(finalImage.data[index] * .78 + previous[index] * .22);
        finalImage.data[index + 1] = clamp(finalImage.data[index + 1] * .78 + previous[index + 1] * .22);
        finalImage.data[index + 2] = clamp(finalImage.data[index + 2] * .78 + previous[index + 2] * .22);
      }
      context.putImageData(finalImage, 0, 0);
    }
    previousPixelsRef.current = new Uint8ClampedArray(finalImage.data);
    previousFilterRef.current = filter;
    const data = finalImage.data;
    return Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => {
      const index = (y * COLS + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    }));
  }, [brightness, caricatureStrength, contrast, filter, mirror]);

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
    faceLandmarkerRef.current?.close();
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
          {(filter === "portrait" || filter === "caricature") && <div className={`face-lock ${faceStatus}`}><span aria-hidden="true">◎</span><div><strong>{faceStatus === "loading" ? "Loading face detector" : faceStatus === "locked" ? filter === "caricature" ? "Caricature locked" : "Face locked" : faceStatus === "error" ? "Face model unavailable" : status === "idle" ? filter === "caricature" ? "Caricature ready" : "Portrait ready" : "Looking for a face"}</strong><small>{faceStatus === "locked" ? filter === "caricature" ? "Your distinctive features are exaggerated" : "Eyes and expression are enhanced" : faceStatus === "error" ? "Natural pixels are still available" : status === "idle" ? "Start the camera to find your features" : "Center your face inside the guide"}</small></div></div>}
          {filter === "caricature" && <label><span>Exaggeration <b>{caricatureStrength.toFixed(2)}×</b></span><input type="range" min="0.5" max="1.8" step="0.05" value={caricatureStrength} onChange={(event) => setCaricatureStrength(Number(event.target.value))} /></label>}
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
