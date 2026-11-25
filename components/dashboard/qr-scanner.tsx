'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, X } from 'lucide-react';

export function QrGateScanner({
  onScanToken,
}: {
  onScanToken: (token: string) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const regionId = 'qr-gate-reader-region';

  const stop = async () => {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
      scannerRef.current?.clear();
    } catch {
      // ignore cleanup errors
    }
    setScanning(false);
  };

  const start = async () => {
    setError(null);
    setScanning(true);
    setTimeout(async () => {
      try {
        const instance = new Html5Qrcode(regionId);
        scannerRef.current = instance;
        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            onScanToken(decodedText);
          },
          () => {}
        );
      } catch {
        setError('Unable to access camera for QR scanning. Use manual token entry below.');
        setScanning(false);
      }
    }, 60);
  };

  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  return (
    <div className="space-y-3">
      {!scanning ? (
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 text-xs font-semibold text-white"
        >
          <QrCode className="h-4 w-4" />
          Start QR Gate Scanner
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-teal-700 dark:text-teal-400">
              Point student ID card QR code at camera
            </span>
            <button
              type="button"
              onClick={stop}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs"
            >
              <X className="h-3.5 w-3.5" />
              Stop Scanner
            </button>
          </div>
          <div id={regionId} className="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800" />
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
