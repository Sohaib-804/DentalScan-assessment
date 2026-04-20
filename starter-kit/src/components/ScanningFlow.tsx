"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Camera, CheckCircle2 } from "lucide-react";
import QuickMessageSidebar from "@/components/QuickMessageSidebar";
import { DEFAULT_PATIENT_ID } from "@/lib/notify-constants";

type FaceApiLike = {
  nets: {
    tinyFaceDetector: {
      loadFromUri: (uri: string) => Promise<void>;
    };
    faceLandmark68TinyNet: {
      loadFromUri: (uri: string) => Promise<void>;
    };
  };
  TinyFaceDetectorOptions: new () => unknown;
  detectSingleFace: (
    input: HTMLVideoElement,
    options?: unknown,
  ) => Promise<{ box: { x: number; y: number; width: number; height: number } } | undefined> & {
    withFaceLandmarks: (
      useTinyLandmarkNet?: boolean,
    ) => Promise<
      | {
          detection: { box: { x: number; y: number; width: number; height: number } };
          landmarks: {
            getLeftEye: () => Array<{ x: number; y: number }>;
            getRightEye: () => Array<{ x: number; y: number }>;
            getNose: () => Array<{ x: number; y: number }>;
            getMouth: () => Array<{ x: number; y: number }>;
          };
        }
      | undefined
    >;
  };
};

/**
 * Face / mouth gate — tweak these to change strictness (higher center limits = looser;
 * lower mouthOpenPassThreshold = easier capture on upper/lower steps).
 */
const FACE_TUNING = {
  maxCenterOffsetX: 0.28,
  maxCenterOffsetY: 0.32,
  /** Lower = user can sit farther back while still passing distance checks (matches smaller on-screen oval). */
  minFaceHeightRatio: 0.24,
  maxFaceHeightRatio: 0.92,
  /** Left view: displayed yaw must be below this (more negative = turned further left). Nearer 0 = looser. */
  leftTurnYawMax: -0.006,
  /** Right view: displayed yaw must be above this. Nearer 0 = looser. */
  rightTurnYawMin: 0.006,
  targetMouthOpenUpperLower: 0.34,
  targetMouthOpenNeutral: 0.17,
  /** Upper/lower steps: openness progress (0–1) needed before capture. Lower = easier. */
  mouthOpenPassThreshold: 0.52,
  tiltGuidanceOpenness: 0.55,
  /** When |offset| exceeds this, show “move left/right” hints before failing center check. */
  centerNudgeThreshold: 0.1,
  mouthGuideColorHigh: 0.68,
  mouthGuideColorMid: 0.32,
} as const;

const VIEWS = [
  { label: "Front View", instruction: "Smile and look straight at the camera." },
  { label: "Left View", instruction: "Turn your head to the left." },
  { label: "Right View", instruction: "Turn your head to the right." },
  { label: "Upper Teeth", instruction: "Tilt your head back and open wide." },
  { label: "Lower Teeth", instruction: "Tilt your head down and open wide." },
] as const;

/** Stable key so mouth overlay state skips React updates when landmarks barely jitter. */
function mouthGuideKey(m: {
  leftPercent: number;
  topPercent: number;
  width: number;
  height: number;
  roundnessPercent: number;
  colorClass: string;
}) {
  return `${m.leftPercent.toFixed(1)}|${m.topPercent.toFixed(1)}|${Math.round(m.width)}|${Math.round(m.height)}|${m.roundnessPercent}|${m.colorClass}`;
}

/**
 * CHALLENGE: SCAN ENHANCEMENT
 * 
 * Your goal is to improve the User Experience of the Scanning Flow.
 * 1. Implement a Visual Guidance Overlay (e.g., a circle or mouth outline) on the video feed.
 * 2. Add real-time feedback to the user (e.g., "Face not centered", "Move closer").
 * 3. Ensure the UI feels premium and responsive.
 */

export default function ScanningFlow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{ detect: (source: CanvasImageSource) => Promise<Array<{ boundingBox: DOMRectReadOnly }>> } | null>(null);
  const faceApiRef = useRef<FaceApiLike | null>(null);
  const faceApiModelLoadedRef = useRef(false);
  const detectorModeRef = useRef<"native" | "face-api" | "none">("none");
  const [camReady, setCamReady] = useState(false);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [qualityState, setQualityState] = useState<"aligning" | "hold-steady" | "ready">("aligning");
  const [guidanceMessage, setGuidanceMessage] = useState("Align your face in the oval, then tap Capture");
  const [detectorSupported, setDetectorSupported] = useState(true);
  const [mouthGuide, setMouthGuide] = useState({
    leftPercent: 50,
    topPercent: 62,
    width: 96,
    height: 34,
    roundnessPercent: 999,
    colorClass: "border-zinc-200/50",
  });

  /** Task 2: avoid duplicate notify calls (e.g. React Strict Mode double effect). */
  const notifySentRef = useRef(false);
  const [notifyStatus, setNotifyStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [notifyWarning, setNotifyWarning] = useState<string | null>(null);
  const [savedScanId, setSavedScanId] = useState<string | null>(null);
  const [savedThreadId, setSavedThreadId] = useState<string | null>(null);

  // Initialize Camera
  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCamReady(true);
        }
      } catch (err) {
        console.error("Camera access denied", err);
      }
    }
    startCamera();
    return () => {
      // Ensure camera hardware is released when leaving the flow.
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Task 2: persist scan + clinic notification when all five captures are done.
  useEffect(() => {
    if (currentStep !== 5 || capturedImages.length !== 5) return;
    if (notifySentRef.current) return;
    notifySentRef.current = true;
    setNotifyStatus("loading");
    setNotifyError(null);
    setNotifyWarning(null);

    const imagesPayload = capturedImages.join(",");
    void (async () => {
      try {
        const res = await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "completed",
            images: imagesPayload,
            patientId: DEFAULT_PATIENT_ID,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          scanId?: string;
          threadId?: string;
          error?: string;
          warning?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        setSavedScanId(data.scanId ?? null);
        setSavedThreadId(data.threadId ?? null);
        setNotifyWarning(typeof data.warning === "string" ? data.warning : null);
        setNotifyStatus("done");
      } catch (e) {
        notifySentRef.current = false;
        setNotifyStatus("error");
        setNotifyError(e instanceof Error ? e.message : "Upload failed");
      }
    })();
  }, [currentStep, capturedImages]);

  useEffect(() => {
    if (currentStep >= VIEWS.length) return;

    let disposed = false;
    const lastEmitted = {
      quality: null as "aligning" | "hold-steady" | "ready" | null,
      guidance: null as string | null,
      mouthKey: null as string | null,
    };
    const emitDetectionUi = (patch: {
      quality?: "aligning" | "hold-steady" | "ready";
      guidance?: string;
      mouth?: {
        leftPercent: number;
        topPercent: number;
        width: number;
        height: number;
        roundnessPercent: number;
        colorClass: string;
      };
    }) => {
      if (patch.mouth) {
        const mk = mouthGuideKey(patch.mouth);
        if (lastEmitted.mouthKey !== mk) {
          lastEmitted.mouthKey = mk;
          setMouthGuide(patch.mouth);
        }
      }
      if (patch.quality !== undefined && patch.guidance !== undefined) {
        if (lastEmitted.quality !== patch.quality || lastEmitted.guidance !== patch.guidance) {
          lastEmitted.quality = patch.quality;
          lastEmitted.guidance = patch.guidance;
          setQualityState(patch.quality);
          setGuidanceMessage(patch.guidance);
        }
      } else if (patch.quality !== undefined) {
        if (lastEmitted.quality !== patch.quality) {
          lastEmitted.quality = patch.quality;
          setQualityState(patch.quality);
        }
      } else if (patch.guidance !== undefined) {
        if (lastEmitted.guidance !== patch.guidance) {
          lastEmitted.guidance = patch.guidance;
          setGuidanceMessage(patch.guidance);
        }
      }
    };

    const FaceDetectorConstructor = (
      window as Window & { FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => { detect: (source: CanvasImageSource) => Promise<Array<{ boundingBox: DOMRectReadOnly }>> } }
    ).FaceDetector;

    const loadFaceApiScript = async (): Promise<FaceApiLike | null> => {
      const win = window as Window & { faceapi?: FaceApiLike };
      if (win.faceapi) return win.faceapi;

      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector('script[data-face-api="browser-bundle"]') as HTMLScriptElement | null;
        if (existing) {
          if ((window as Window & { faceapi?: FaceApiLike }).faceapi) {
            resolve();
            return;
          }
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("Failed to load face-api browser bundle")), { once: true });
          return;
        }

        const script = document.createElement("script");
        script.dataset.faceApi = "browser-bundle";
        script.src = "/vendor/face-api.min.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load face-api browser bundle"));
        document.head.appendChild(script);
      });

      return win.faceapi ?? null;
    };

    const setupDetection = async () => {
      const initializeFaceApi = async () => {
        try {
          const faceapi = await loadFaceApiScript();
          if (!faceapi) throw new Error("faceapi global not found after script load");
          faceApiRef.current = faceapi;
          if (!faceApiModelLoadedRef.current) {
            await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
            await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models");
            faceApiModelLoadedRef.current = true;
          }
          return true;
        } catch (err) {
          console.error("Unable to initialize face detection fallback", err);
          return false;
        }
      };

      if (FaceDetectorConstructor) {
        detectorModeRef.current = "native";
        setDetectorSupported(true);
        if (!detectorRef.current) {
          detectorRef.current = new FaceDetectorConstructor({ fastMode: true, maxDetectedFaces: 1 });
        }
        // Keep browser-native detection primary, while also priming landmarks for richer guidance.
        void initializeFaceApi();
        return true;
      }

      try {
        const initialized = await initializeFaceApi();
        if (!initialized) throw new Error("face-api initialization failed");
        detectorModeRef.current = "face-api";
        setDetectorSupported(true);
        return true;
      } catch (err) {
        console.error("Unable to initialize face detection fallback", err);
        detectorModeRef.current = "none";
        setDetectorSupported(false);
        emitDetectionUi({ quality: "aligning" });
        return false;
      }
    };

    const evaluateFrameQuality = async () => {
      if (disposed) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        emitDetectionUi({ quality: "aligning", guidance: "Preparing camera feed..." });
        return;
      }

      try {
        let box: DOMRectReadOnly | null = null;
        if (detectorModeRef.current === "native") {
          const faces = await detectorRef.current?.detect(video);
          box = faces?.[0]?.boundingBox ?? null;
        } else if (detectorModeRef.current === "face-api") {
        }

        const faceapi = faceApiRef.current;
        const detectionWithLandmarks = await faceapi
          ?.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks(true);
        const landmarkFaceBox = detectionWithLandmarks?.detection.box;
        const landmarkNose = detectionWithLandmarks?.landmarks.getNose();
        const landmarkLeftEye = detectionWithLandmarks?.landmarks.getLeftEye();
        const landmarkRightEye = detectionWithLandmarks?.landmarks.getRightEye();
        const landmarkMouth = detectionWithLandmarks?.landmarks.getMouth();

        if (landmarkFaceBox) {
          box = new DOMRectReadOnly(
            landmarkFaceBox.x,
            landmarkFaceBox.y,
            landmarkFaceBox.width,
            landmarkFaceBox.height,
          );
        }

        if (!box) {
          emitDetectionUi({ quality: "aligning", guidance: "Move your face into the oval" });
          return;
        }

        const { x, y, width, height } = box;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const centerOffsetXRaw = (centerX - video.videoWidth / 2) / (video.videoWidth / 2);
        const centerOffsetXDisplayed = -centerOffsetXRaw;
        const centerOffsetX = Math.abs(centerOffsetXDisplayed);
        const centerOffsetY = Math.abs(centerY - video.videoHeight / 2) / (video.videoHeight / 2);
        const faceHeightRatio = height / video.videoHeight;

        const centered =
          centerOffsetX <= FACE_TUNING.maxCenterOffsetX && centerOffsetY <= FACE_TUNING.maxCenterOffsetY;
        const distanceGood =
          faceHeightRatio >= FACE_TUNING.minFaceHeightRatio &&
          faceHeightRatio <= FACE_TUNING.maxFaceHeightRatio;
        const tooFar = faceHeightRatio < FACE_TUNING.minFaceHeightRatio;
        const tooClose = faceHeightRatio > FACE_TUNING.maxFaceHeightRatio;
        const needsUpperTilt = currentStep === 3;
        const needsLowerTilt = currentStep === 4;

        const mouthCenterX = landmarkMouth?.length
          ? landmarkMouth.reduce((sum, p) => sum + p.x, 0) / landmarkMouth.length
          : x + width / 2;
        const mouthCenterY = landmarkMouth?.length
          ? landmarkMouth.reduce((sum, p) => sum + p.y, 0) / landmarkMouth.length
          : y + height * 0.68;
        const mouthMinX = landmarkMouth?.length ? Math.min(...landmarkMouth.map((p) => p.x)) : mouthCenterX - width * 0.18;
        const mouthMaxX = landmarkMouth?.length ? Math.max(...landmarkMouth.map((p) => p.x)) : mouthCenterX + width * 0.18;
        const mouthMinY = landmarkMouth?.length ? Math.min(...landmarkMouth.map((p) => p.y)) : mouthCenterY - height * 0.04;
        const mouthMaxY = landmarkMouth?.length ? Math.max(...landmarkMouth.map((p) => p.y)) : mouthCenterY + height * 0.04;
        const mouthWidth = Math.max(16, mouthMaxX - mouthMinX);
        const mouthHeight = Math.max(8, mouthMaxY - mouthMinY);
        const mouthOpenRatio = mouthHeight / mouthWidth;

        const targetMouthOpenRatio =
          currentStep === 3 || currentStep === 4
            ? FACE_TUNING.targetMouthOpenUpperLower
            : FACE_TUNING.targetMouthOpenNeutral;
        const opennessProgress =
          currentStep === 3 || currentStep === 4
            ? Math.max(0, Math.min(1, mouthOpenRatio / targetMouthOpenRatio))
            : Math.max(
                0,
                Math.min(
                  1,
                  1 - Math.abs(mouthOpenRatio - targetMouthOpenRatio) / targetMouthOpenRatio,
                ),
              );
        const mouthColorClass =
          opennessProgress >= FACE_TUNING.mouthGuideColorHigh
            ? "border-emerald-400/85"
            : opennessProgress >= FACE_TUNING.mouthGuideColorMid
              ? "border-amber-300/85"
              : "border-rose-300/80";
        const mouthRoundnessPercent = Math.round(999 - opennessProgress * 949);
        const mouthWidthScale = currentStep >= 3 ? 1.85 : 1.5;
        const mouthHeightScale = currentStep >= 3 ? 1.15 + opennessProgress * 1.15 : 0.72 + opennessProgress * 0.35;

        emitDetectionUi({
          mouth: {
            leftPercent: Math.max(15, Math.min(85, 100 - (mouthCenterX / video.videoWidth) * 100)),
            topPercent: Math.max(35, Math.min(82, (mouthCenterY / video.videoHeight) * 100)),
            width: Math.max(84, Math.min(170, mouthWidth * mouthWidthScale)),
            height: Math.max(28, Math.min(120, mouthWidth * mouthHeightScale)),
            roundnessPercent: mouthRoundnessPercent,
            colorClass: mouthColorClass,
          },
        });

        let directionOk = true;
        if ((currentStep === 1 || currentStep === 2) && (!landmarkNose?.length || !landmarkLeftEye?.length || !landmarkRightEye?.length)) {
          emitDetectionUi({
            quality: "aligning",
            guidance: "Hold still while we detect your head direction",
          });
          return;
        }
        if (currentStep === 1 && landmarkNose?.length && landmarkLeftEye?.length && landmarkRightEye?.length) {
          const leftEyeCenterX = landmarkLeftEye.reduce((sum, p) => sum + p.x, 0) / landmarkLeftEye.length;
          const rightEyeCenterX = landmarkRightEye.reduce((sum, p) => sum + p.x, 0) / landmarkRightEye.length;
          const noseCenterX = landmarkNose.reduce((sum, p) => sum + p.x, 0) / landmarkNose.length;
          const eyeMidX = (leftEyeCenterX + rightEyeCenterX) / 2;
          const yawOffsetDisplayed = -((noseCenterX - eyeMidX) / video.videoWidth);
          if (yawOffsetDisplayed > FACE_TUNING.leftTurnYawMax) {
            directionOk = false;
            emitDetectionUi({
              quality: "aligning",
              guidance: "Turn your head to your left, then tap Capture",
            });
            return;
          }
        }

        if (currentStep === 2 && landmarkNose?.length && landmarkLeftEye?.length && landmarkRightEye?.length) {
          const leftEyeCenterX = landmarkLeftEye.reduce((sum, p) => sum + p.x, 0) / landmarkLeftEye.length;
          const rightEyeCenterX = landmarkRightEye.reduce((sum, p) => sum + p.x, 0) / landmarkRightEye.length;
          const noseCenterX = landmarkNose.reduce((sum, p) => sum + p.x, 0) / landmarkNose.length;
          const eyeMidX = (leftEyeCenterX + rightEyeCenterX) / 2;
          const yawOffsetDisplayed = -((noseCenterX - eyeMidX) / video.videoWidth);
          if (yawOffsetDisplayed < FACE_TUNING.rightTurnYawMin) {
            directionOk = false;
            emitDetectionUi({
              quality: "aligning",
              guidance: "Turn your head to your right, then tap Capture",
            });
            return;
          }
        }

        const mouthOk =
          currentStep >= 3
            ? Boolean(landmarkMouth?.length) && opennessProgress >= FACE_TUNING.mouthOpenPassThreshold
            : true;
        const allChecksPass = centered && distanceGood && directionOk && mouthOk;

        if (allChecksPass) {
          const g = needsUpperTilt
            ? opennessProgress >= FACE_TUNING.tiltGuidanceOpenness
              ? "Great. Tilt head back slightly, then tap Capture"
              : "Open wider, tilt head back, then tap Capture"
            : needsLowerTilt
              ? opennessProgress >= FACE_TUNING.tiltGuidanceOpenness
                ? "Great. Tilt head down slightly, then tap Capture"
                : "Open wider, tilt head down, then tap Capture"
              : "Ready - tap Capture";
          emitDetectionUi({ quality: "ready", guidance: g });
        } else if (centered || distanceGood || (currentStep >= 3 && !mouthOk)) {
          const g =
            currentStep >= 3 && !mouthOk
              ? currentStep === 3
                ? "Open your mouth wider and tilt head back, then tap Capture"
                : "Open your mouth wider and tilt head down, then tap Capture"
              : !centered
                ? centerOffsetXDisplayed > FACE_TUNING.centerNudgeThreshold
                  ? "Move slightly left to center your face"
                  : centerOffsetXDisplayed < -FACE_TUNING.centerNudgeThreshold
                    ? "Move slightly right to center your face"
                    : centerY < video.videoHeight * 0.5
                      ? "Move slightly down to center your face"
                      : "Move slightly up to center your face"
                : tooFar
                  ? "Move phone slightly closer to your face"
                  : tooClose
                    ? "Move phone slightly farther from your face"
                    : "Adjust position, then tap Capture when ready";
          emitDetectionUi({ quality: "hold-steady", guidance: g });
        } else {
          const g = tooFar
            ? "Move closer and center your face in the oval"
            : tooClose
              ? "Move slightly farther and center your face in the oval"
              : centerOffsetXDisplayed > FACE_TUNING.centerNudgeThreshold
                ? "Move left and center your face in the oval"
                : centerOffsetXDisplayed < -FACE_TUNING.centerNudgeThreshold
                  ? "Move right and center your face in the oval"
                  : "Center your face in the oval";
          emitDetectionUi({ quality: "aligning", guidance: g });
        }
      } catch (err) {
        console.error("Face quality detection failed", err);
        emitDetectionUi({
          quality: "aligning",
          guidance: "Detection paused. Reposition and try again",
        });
      }
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    void setupDetection().then((ready) => {
      if (!ready || disposed) return;
      timer = setInterval(() => {
        void evaluateFrameQuality();
      }, 450);
      void evaluateFrameQuality();
    });

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [currentStep]);

  const handleCapture = useCallback(() => {
    // Boilerplate logic for capturing a frame from the video feed
    const video = videoRef.current;
    if (!video || qualityState !== "ready") return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg");
      setCapturedImages((prev) => [...prev, dataUrl]);
      setCurrentStep((prev) => prev + 1);
    }
  }, [qualityState]);

  const qualityLabel =
    !detectorSupported
      ? "Face detection unavailable in this browser"
      : qualityState === "ready"
      ? "Ready - tap Capture"
      : qualityState === "hold-steady"
        ? "Adjust and then tap Capture"
        : "Alignment needed";

  const qualityColorClass =
    qualityState === "ready"
      ? "text-emerald-300 border-emerald-400/70"
      : qualityState === "hold-steady"
        ? "text-amber-200 border-amber-300/60"
        : "text-zinc-200 border-zinc-200/40";

  const isMouthFocusedStep = currentStep >= 3;

  const isResultsDashboard = currentStep >= 5;

  return (
    <div
      className={`flex flex-col items-center bg-black text-white ${
        isResultsDashboard
          ? "h-[100dvh] max-h-[100dvh] min-h-0 overflow-hidden"
          : "min-h-screen"
      }`}
    >
      {/* Header — step progress lives on the camera overlay */}
      <div className="shrink-0 mb-3 p-4 w-full bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
        <h1 className="font-bold text-blue-400">DentalScan AI</h1>
        {currentStep >= 5 ? (
          <span className="text-xs font-medium uppercase tracking-wider text-emerald-400/90">Complete</span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">5 guided photos</span>
        )}
      </div>

      {/* Main Viewport — on results dashboard, fills remaining height so sidebar can scroll internally */}
      <div
        className={`relative w-full bg-zinc-950 overflow-hidden flex ${
          currentStep < 5
            ? "max-w-md aspect-[3/4] items-center justify-center"
            : "flex-1 min-h-0 max-w-5xl w-full flex-col"
        }`}
      >
        {currentStep < 5 ? (
          <>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover opacity-80 scale-x-[-1]" 
            />

            {/* Spotlight: clear inside the face guide ellipse, darker outside (matches ~60% × 72% oval). */}
            <div
              className="pointer-events-none absolute inset-0 z-[1]"
              style={{
                background:
                  "radial-gradient(ellipse 30% 36% at 50% 50%, transparent 0%, transparent 52%, rgba(0,0,0,0.28) 66%, rgba(0,0,0,0.62) 82%, rgba(0,0,0,0.82) 100%)",
              }}
              aria-hidden
            />

            {/* Progress + status over the feed (replaces plain "Step n/5" in the header) */}
            <div
              className="absolute top-0 left-0 right-0 z-10 pointer-events-none flex flex-col items-stretch gap-2 px-4 pt-3 pb-4 bg-gradient-to-b from-black/90 via-black/55 to-transparent"
              aria-label="Scan progress"
            >
              <div
                className="mx-auto flex w-full max-w-[min(100%,18rem)] gap-1"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={VIEWS.length}
                aria-valuenow={currentStep + 1}
                aria-valuetext={`Photo ${currentStep + 1} of ${VIEWS.length}: ${VIEWS[currentStep].label}`}
              >
                {VIEWS.map((v, i) => {
                  const done = i < currentStep;
                  const active = i === currentStep;
                  return (
                    <div key={v.label} className="min-w-0 flex-1 flex flex-col items-center gap-1">
                      <div
                        className={`h-1.5 w-full rounded-full transition-all duration-300 ${
                          done
                            ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.35)]"
                            : active
                              ? "h-2 bg-blue-500 shadow-[0_0_14px_rgba(59,130,246,0.45)]"
                              : "bg-zinc-600/35"
                        }`}
                      />
                      <span
                        className={`text-[9px] font-semibold tabular-nums leading-none ${
                          done ? "text-emerald-400/90" : active ? "text-blue-300" : "text-zinc-600"
                        }`}
                      >
                        {i + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-center text-[13px] font-semibold tracking-tight text-white drop-shadow-sm">
                {VIEWS[currentStep].label}
              </p>
              <div className="flex justify-center">
                <div
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold tracking-wide bg-black/50 backdrop-blur-md transition-colors duration-300 ${qualityColorClass}`}
                >
                  {qualityLabel}
                </div>
              </div>
            </div>
            
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
              <div
                className={`relative h-[72%] w-[60%] rounded-[46%] border-[3px] border-dashed bg-transparent shadow-[0_0_0_2px_rgba(0,0,0,0.45),0_0_20px_rgba(0,0,0,0.25)] ring-2 ring-white/20 transition-[color,box-shadow,border-color] duration-300 ${qualityColorClass}`}
              >
                {/* Mouth guide becomes more prominent for upper/lower capture steps. */}
                <div
                  className={`absolute -translate-x-1/2 -translate-y-1/2 border-[3px] shadow-[0_0_12px_rgba(0,0,0,0.45)] transition-all duration-300 ${isMouthFocusedStep ? "opacity-100" : "opacity-90"} ${mouthGuide.colorClass}`}
                  style={{
                    left: `${mouthGuide.leftPercent}%`,
                    top: `${mouthGuide.topPercent}%`,
                    width: `${mouthGuide.width}px`,
                    height: `${mouthGuide.height}px`,
                    borderRadius: `${mouthGuide.roundnessPercent}px`,
                  }}
                />
              </div>
            </div>

            {/* Instruction overlay — multi-stop gradient so copy fades smoothly into the video */}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] px-5 pb-10 pt-28 text-center
                bg-[linear-gradient(to_top,rgb(0,0,0)_0%,rgba(0,0,0,0.92)_12%,rgba(0,0,0,0.72)_28%,rgba(0,0,0,0.4)_48%,rgba(0,0,0,0.12)_72%,transparent_100%)]"
            >
              <p className="text-sm font-medium text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                {VIEWS[currentStep].instruction}
              </p>
              <p className="mt-2 text-xs text-zinc-200 drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">
                {guidanceMessage}
              </p>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 w-full flex-col overflow-hidden md:flex-row md:items-stretch">
            <div className="flex shrink-0 flex-col items-center justify-center overflow-y-auto text-center p-6 md:min-h-0 md:flex-1 md:border-r border-zinc-800">
              <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold">Scan Complete</h2>
              {notifyStatus === "loading" && (
                <p className="text-zinc-400 mt-2">Saving scan and notifying clinic...</p>
              )}
              {notifyStatus === "done" && (
                <div className="mt-2 space-y-2">
                  <p className="text-zinc-400">
                    Results saved
                    {notifyWarning
                      ? "."
                      : ". A clinic notification was queued"}
                    {savedScanId ? ` Scan ${savedScanId.slice(0, 10)}…` : ""}.
                  </p>
                  {notifyWarning && (
                    <p className="text-xs text-amber-300/95 max-w-sm mx-auto">{notifyWarning}</p>
                  )}
                </div>
              )}
              {notifyStatus === "error" && (
                <p className="text-rose-400 mt-2 text-sm">
                  Could not save or notify: {notifyError}. Check the server and try again.
                </p>
              )}
            </div>
            {notifyStatus === "done" && savedScanId && savedThreadId && (
              <div className="flex min-h-0 w-full max-h-[min(52dvh,420px)] flex-1 flex-col border-t border-zinc-800 bg-zinc-950 p-3 md:h-full md:max-h-full md:w-[min(100%,320px)] md:flex-none md:shrink-0 md:border-l md:border-t-0 md:p-4">
                <QuickMessageSidebar threadId={savedThreadId} scanId={savedScanId} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className={`shrink-0 p-10 w-full flex justify-center ${isResultsDashboard ? "hidden" : ""}`}>
        {currentStep < 5 && (
          <button
            onClick={handleCapture}
            aria-label={`Capture ${VIEWS[currentStep].label}`}
            disabled={!camReady || qualityState !== "ready"}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center">
              <Camera className="text-black" />
            </div>
          </button>
        )}
      </div>

      {/* Thumbnails */}
      <div
        className={`flex w-full shrink-0 justify-center gap-2 overflow-x-auto p-4 ${isResultsDashboard ? "max-w-5xl" : ""}`}
      >
        {VIEWS.map((v, i) => (
          <div 
            key={i} 
            className={`w-16 h-20 rounded border-2 shrink-0 ${i === currentStep ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-800'}`}
          >
            {capturedImages[i] ? (
              <img src={capturedImages[i]} alt={`${v.label} captured`} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-700">{i + 1}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
