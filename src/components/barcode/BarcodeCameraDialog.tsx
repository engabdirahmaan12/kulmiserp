'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CameraDevice } from 'html5-qrcode/esm/camera/core';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Camera, RefreshCw, SwitchCamera, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildCameraFallbacks,
  clearSavedCameraId,
  createBarcodeScanner,
  isMobileDevice,
  listCamerasWithPermission,
  pickPreferredCamera,
  saveCameraId,
  waitForElement,
} from '@/lib/barcode/camera-scanner';
import { toSelectItems } from '@/lib/ui/select-utils';
import { toast } from 'sonner';

interface BarcodeCameraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (code: string) => void;
  closeOnScan?: boolean;
  title?: string;
}

export function BarcodeCameraDialog({
  open,
  onOpenChange,
  onScan,
  closeOnScan = true,
  title = 'Scan barcode',
}: BarcodeCameraDialogProps) {
  const regionId = useId().replace(/:/g, '');
  const scannerRef = useRef<ReturnType<typeof createBarcodeScanner> | null>(null);
  const onScanRef = useRef(onScan);
  const closeOnScanRef = useRef(closeOnScan);
  const onOpenChangeRef = useRef(onOpenChange);
  const camerasRef = useRef<CameraDevice[]>([]);
  const startingRef = useRef(false);

  onScanRef.current = onScan;
  closeOnScanRef.current = closeOnScan;
  onOpenChangeRef.current = onOpenChange;

  const [mounted, setMounted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [cameraId, setCameraId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    setMounted(true);
    setMobile(isMobileDevice());
  }, []);

  const cameraSelectItems = useMemo(
    () => toSelectItems(cameras, (c) => c.id, (c) => c.label),
    [cameras],
  );

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        /* already stopped */
      }
      scannerRef.current = null;
    }
    setScanning(false);
    startingRef.current = false;
  }, []);

  const startCamera = useCallback(
    async (preferredId: string) => {
      if (startingRef.current) return;
      startingRef.current = true;
      setError(null);
      setScanning(false);

      await stopCamera();
      startingRef.current = true;

      try {
        await waitForElement(regionId, 4000);

        const scanner = createBarcodeScanner(regionId);
        scannerRef.current = scanner;

        const scanConfig = {
          fps: 10,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const w = Math.min(Math.floor(viewfinderWidth * 0.88), 340);
            const h = Math.min(Math.floor(viewfinderHeight * 0.42), 160);
            return { width: Math.max(w, 200), height: Math.max(h, 80) };
          },
          disableFlip: false,
        };

        const targets = buildCameraFallbacks(camerasRef.current, preferredId);
        let lastErr: unknown;

        for (const target of targets) {
          try {
            await scanner.start(
              target,
              scanConfig,
              (decoded) => {
                const code = decoded.trim();
                if (!code) return;
                onScanRef.current(code);
                toast.success(`Scanned: ${code}`, { duration: 1500 });
                if (closeOnScanRef.current) onOpenChangeRef.current(false);
              },
              () => {},
            );

            if (typeof target === 'string') {
              saveCameraId(target);
              setCameraId(target);
            }
            setScanning(true);
            setError(null);
            startingRef.current = false;
            return;
          } catch (err) {
            lastErr = err;
            try {
              await scanner.stop();
            } catch {
              /* ignore */
            }
          }
        }

        clearSavedCameraId();
        throw lastErr ?? new Error('Could not open any camera');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not start camera';
        setError(msg);
        toast.error('Camera failed — try another device from the list');
        setScanning(false);
      } finally {
        startingRef.current = false;
      }
    },
    [regionId, stopCamera],
  );

  useEffect(() => {
    if (!open) {
      stopCamera();
      setError(null);
      setCameras([]);
      setCameraId('');
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const devices = await listCamerasWithPermission();
        if (cancelled) return;

        if (!devices.length) {
          setError('No camera found. Connect a webcam or use your phone camera.');
          return;
        }

        camerasRef.current = devices;
        setCameras(devices);
        const id = pickPreferredCamera(devices);
        setCameraId(id);
        await new Promise((r) => setTimeout(r, 350));
        if (!cancelled && id) await startCamera(id);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Camera access failed';
        setError(msg);
        toast.error(msg);
      }
    };

    init();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, startCamera, stopCamera]);

  const handleCameraChange = (id: string | null) => {
    if (!id || id === cameraId) return;
    setCameraId(id);
    startCamera(id);
  };

  const cycleCamera = () => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex((c) => c.id === cameraId);
    const next = cameras[(idx + 1) % cameras.length];
    handleCameraChange(next.id);
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => onOpenChange(false)}
    >
      <div
        className={cn(
          'relative flex flex-col bg-white dark:bg-slate-900 shadow-2xl overflow-hidden',
          mobile
            ? 'fixed inset-0 h-[100dvh] w-full'
            : 'mx-auto mt-[5vh] w-full max-w-lg max-h-[90vh] rounded-2xl border border-slate-200 dark:border-slate-800',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex flex-row items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
            <Camera className="h-4 w-4 text-blue-600" />
            {title}
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-4 py-2 border-b bg-slate-50 dark:bg-slate-950 shrink-0 space-y-2">
          {cameras.length > 0 ? (
            <div className="flex gap-2 items-center">
              <Select
                value={cameraId || null}
                items={cameraSelectItems}
                onValueChange={handleCameraChange}
              >
                <SelectTrigger className="h-9 flex-1 min-w-0 w-full text-xs">
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent className="z-[250]">
                  {cameras.map((cam) => (
                    <SelectItem key={cam.id} value={cam.id} className="text-xs">
                      {cam.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cameras.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={cycleCamera}
                  title="Switch camera"
                >
                  <SwitchCamera className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Searching for cameras…</p>
          )}
          <p className="text-[10px] text-slate-400 leading-snug">
            USB barcode gun: use the barcode icon in the form — no camera needed.
          </p>
        </div>

        <div className="relative flex-1 min-h-[280px] bg-black">
          <div id={regionId} className="w-full h-full min-h-[280px]" />
          {!scanning && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80 pointer-events-none">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <p className="text-xs">Starting camera…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/80">
              <p className="text-sm text-red-300">{error}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const id = cameraId || cameras[0]?.id;
                  if (id) startCamera(id);
                }}
              >
                Retry
              </Button>
            </div>
          )}
        </div>

        {scanning && (
          <p className="text-xs text-center text-slate-500 py-3 shrink-0 bg-white dark:bg-slate-900">
            Hold barcode steady in the frame — EAN, UPC, Code128, QR supported
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
