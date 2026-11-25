'use client';

import React, { useRef, useState } from 'react';
import { Camera, Upload, X } from 'lucide-react';

export function WebcamPhotoCapture({
  valueUrl,
  onCaptureFile,
}: {
  valueUrl?: string | null;
  onCaptureFile: (file: File, previewUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch {
      setCameraError('Camera unavailable or permission denied. You can upload a photo file instead.');
    }
  };

  const takeSnapshot = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const preview = URL.createObjectURL(blob);
      onCaptureFile(file, preview);
      stopCamera();
    }, 'image/jpeg', 0.9);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        {valueUrl ? (
          <img
            src={valueUrl}
            alt="Captured profile"
            referrerPolicy="no-referrer"
            className="h-16 w-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-400">
            Photo
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800">
            <Upload className="h-3.5 w-3.5" />
            Upload Photo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onCaptureFile(f, URL.createObjectURL(f));
              }}
            />
          </label>

          {!cameraActive ? (
            <button
              type="button"
              onClick={startCamera}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Camera className="h-3.5 w-3.5" />
              Webcam Capture
            </button>
          ) : (
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600"
            >
              <X className="h-3.5 w-3.5" />
              Stop Camera
            </button>
          )}
        </div>
      </div>

      {cameraError && <p className="text-xs text-red-600 dark:text-red-400">{cameraError}</p>}

      {cameraActive && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 p-3 space-y-2.5">
          <video ref={videoRef} className="w-full max-w-xs rounded-lg" muted playsInline />
          <button
            type="button"
            onClick={takeSnapshot}
            className="rounded-lg bg-teal-600 hover:bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            Capture Photo
          </button>
        </div>
      )}
    </div>
  );
}
