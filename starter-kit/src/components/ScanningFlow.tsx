"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Camera, CheckCircle2 } from "lucide-react";
import QuickMessageSidebar from "@/components/QuickMessageSidebar";

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
  const [savedScanId, setSavedScanId] = useState<string | null>(null);

  const VIEWS = [
    { label: "Front View", instruction: "Smile and look straight at the camera." },
    { label: "Left View", instruction: "Turn your head to the left." },
    { label: "Right View", instruction: "Turn your head to the right." },
    { label: "Upper Teeth", instruction: "Tilt your head back and open wide." },
    { label: "Lower Teeth", instruction: "Tilt your head down and open wide." },
  ];

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

    const imagesPayload = capturedImages.join(",");
    void (async () => {
      try {
        const res = await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "completed",
            images: imagesPayload,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          scanId?: string;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        setSavedScanId(data.scanId ?? null);
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
        setQualityState("aligning");
        return false;
      }
    };

    const evaluateFrameQuality = async () => {
      if (disposed) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        setQualityState("aligning");
        setGuidanceMessage("Preparing camera feed...");
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
          setQualityState("aligning");
          setGuidanceMessage("Move your face into the oval");
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

        const centered = centerOffsetX <= 0.18 && centerOffsetY <= 0.22;
        const distanceGood = faceHeightRatio >= 0.42 && faceHeightRatio <= 0.8;
        const tooFar = faceHeightRatio < 0.42;
        const tooClose = faceHeightRatio > 0.8;
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
            ? 0.42
            : 0.2;
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
          opennessProgress >= 0.75
            ? "border-emerald-400/85"
            : opennessProgress >= 0.45
              ? "border-amber-300/85"
              : "border-rose-300/80";
        const mouthRoundnessPercent = Math.round(999 - opennessProgress * 949);
        const mouthWidthScale = currentStep >= 3 ? 1.85 : 1.5;
        const mouthHeightScale = currentStep >= 3 ? 1.15 + opennessProgress * 1.15 : 0.72 + opennessProgress * 0.35;

        setMouthGuide({
          leftPercent: Math.max(15, Math.min(85, 100 - (mouthCenterX / video.videoWidth) * 100)),
          topPercent: Math.max(35, Math.min(82, (mouthCenterY / video.videoHeight) * 100)),
          width: Math.max(84, Math.min(170, mouthWidth * mouthWidthScale)),
          height: Math.max(28, Math.min(120, mouthWidth * mouthHeightScale)),
          roundnessPercent: mouthRoundnessPercent,
          colorClass: mouthColorClass,
        });

        let directionOk = true;
        if ((currentStep === 1 || currentStep === 2) && (!landmarkNose?.length || !landmarkLeftEye?.length || !landmarkRightEye?.length)) {
          setQualityState("aligning");
          setGuidanceMessage("Hold still while we detect your head direction");
          return;
        }
        if (currentStep === 1 && landmarkNose?.length && landmarkLeftEye?.length && landmarkRightEye?.length) {
          const leftEyeCenterX = landmarkLeftEye.reduce((sum, p) => sum + p.x, 0) / landmarkLeftEye.length;
          const rightEyeCenterX = landmarkRightEye.reduce((sum, p) => sum + p.x, 0) / landmarkRightEye.length;
          const noseCenterX = landmarkNose.reduce((sum, p) => sum + p.x, 0) / landmarkNose.length;
          const eyeMidX = (leftEyeCenterX + rightEyeCenterX) / 2;
          const yawOffsetDisplayed = -((noseCenterX - eyeMidX) / video.videoWidth);
          if (yawOffsetDisplayed > -0.015) {
            directionOk = false;
            setQualityState("aligning");
            setGuidanceMessage("Turn your head to your left, then tap Capture");
            return;
          }
        }

        if (currentStep === 2 && landmarkNose?.length && landmarkLeftEye?.length && landmarkRightEye?.length) {
          const leftEyeCenterX = landmarkLeftEye.reduce((sum, p) => sum + p.x, 0) / landmarkLeftEye.length;
          const rightEyeCenterX = landmarkRightEye.reduce((sum, p) => sum + p.x, 0) / landmarkRightEye.length;
          const noseCenterX = landmarkNose.reduce((sum, p) => sum + p.x, 0) / landmarkNose.length;
          const eyeMidX = (leftEyeCenterX + rightEyeCenterX) / 2;
          const yawOffsetDisplayed = -((noseCenterX - eyeMidX) / video.videoWidth);
          if (yawOffsetDisplayed < 0.015) {
            directionOk = false;
            setQualityState("aligning");
            setGuidanceMessage("Turn your head to your right, then tap Capture");
            return;
          }
        }

        const mouthOk = currentStep >= 3 ? Boolean(landmarkMouth?.length) && opennessProgress >= 0.72 : true;
        const allChecksPass = centered && distanceGood && directionOk && mouthOk;

        if (allChecksPass) {
          setQualityState("ready");
          if (needsUpperTilt) {
            setGuidanceMessage(opennessProgress >= 0.7 ? "Great. Tilt head back slightly, then tap Capture" : "Open wider, tilt head back, then tap Capture");
          } else if (needsLowerTilt) {
            setGuidanceMessage(opennessProgress >= 0.7 ? "Great. Tilt head down slightly, then tap Capture" : "Open wider, tilt head down, then tap Capture");
          } else {
            setGuidanceMessage("Ready - tap Capture");
          }
        } else if (centered || distanceGood || (currentStep >= 3 && !mouthOk)) {
          setQualityState("hold-steady");
          if (currentStep >= 3 && !mouthOk) {
            setGuidanceMessage(
              currentStep === 3
                ? "Open your mouth wider and tilt head back, then tap Capture"
                : "Open your mouth wider and tilt head down, then tap Capture",
            );
          } else if (!centered) {
            if (centerOffsetXDisplayed > 0.06) {
              setGuidanceMessage("Move slightly left to center your face");
            } else if (centerOffsetXDisplayed < -0.06) {
              setGuidanceMessage("Move slightly right to center your face");
            } else if (centerY < video.videoHeight * 0.5) {
              setGuidanceMessage("Move slightly down to center your face");
            } else {
              setGuidanceMessage("Move slightly up to center your face");
            }
          } else if (tooFar) {
            setGuidanceMessage("Move phone slightly closer to your face");
          } else if (tooClose) {
            setGuidanceMessage("Move phone slightly farther from your face");
          } else {
            setGuidanceMessage("Adjust position, then tap Capture when ready");
          }
        } else {
          setQualityState("aligning");
          if (tooFar) {
            setGuidanceMessage("Move closer and center your face in the oval");
          } else if (tooClose) {
            setGuidanceMessage("Move slightly farther and center your face in the oval");
          } else if (centerOffsetXDisplayed > 0.06) {
            setGuidanceMessage("Move left and center your face in the oval");
          } else if (centerOffsetXDisplayed < -0.06) {
            setGuidanceMessage("Move right and center your face in the oval");
          } else {
            setGuidanceMessage("Center your face in the oval");
          }
        }
      } catch (err) {
        console.error("Face quality detection failed", err);
        setQualityState("aligning");
        setGuidanceMessage("Detection paused. Reposition and try again");
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
  }, [currentStep, VIEWS.length]);

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
      {/* Header */}
      <div className="shrink-0 p-4 w-full bg-zinc-900 border-b border-zinc-800 flex justify-between">
        <h1 className="font-bold text-blue-400">DentalScan AI</h1>
        <span className="text-xs text-zinc-500">
          {currentStep >= 5 ? "Done" : `Step ${currentStep + 1}/5`}
        </span>
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
              className="w-full h-full object-cover grayscale opacity-80 scale-x-[-1]" 
            />
            
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                className={`relative w-[72%] h-[84%] border-2 border-dashed bg-black/10 transition-colors duration-300 ${qualityColorClass} rounded-[46%]`}
              >
                {/* Mouth guide becomes more prominent for upper/lower capture steps. */}
                <div
                  className={`absolute -translate-x-1/2 -translate-y-1/2 border-2 transition-all duration-300 ${isMouthFocusedStep ? "opacity-100" : "opacity-80"} ${mouthGuide.colorClass}`}
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

            <div className="absolute top-4 left-1/2 -translate-x-1/2">
              <div
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold tracking-wide bg-black/45 backdrop-blur-sm transition-colors duration-300 ${qualityColorClass}`}
              >
                {qualityLabel}
              </div>
            </div>

            {/* Instruction Overlay */}
            <div className="absolute bottom-10 left-0 right-0 p-6 bg-gradient-to-t from-black to-transparent text-center">
              <p className="text-sm font-medium">{VIEWS[currentStep].instruction}</p>
              <p className="text-xs text-zinc-300 mt-2">{guidanceMessage}</p>
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
                <p className="text-zinc-400 mt-2">
                  Results saved. The clinic has been notified
                  {savedScanId ? ` (scan ${savedScanId.slice(0, 10)}…)` : ""}.
                </p>
              )}
              {notifyStatus === "error" && (
                <p className="text-rose-400 mt-2 text-sm">
                  Could not save or notify: {notifyError}. Check the server and try again.
                </p>
              )}
            </div>
            {notifyStatus === "done" && savedScanId && (
              <div className="flex min-h-0 w-full max-h-[min(52dvh,420px)] flex-1 flex-col border-t border-zinc-800 bg-zinc-950 p-3 md:h-full md:max-h-full md:w-[min(100%,320px)] md:flex-none md:shrink-0 md:border-l md:border-t-0 md:p-4">
                <QuickMessageSidebar scanId={savedScanId} />
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
      <div className={`flex shrink-0 gap-2 overflow-x-auto p-4 w-full ${isResultsDashboard ? "max-w-5xl" : ""}`}>
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
