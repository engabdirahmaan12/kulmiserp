import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import type { CameraDevice } from 'html5-qrcode/esm/camera/core';

export const BARCODE_SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
];

const CAMERA_PREF_KEY = 'kulmis-barcode-camera-id';

export function getSavedCameraId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(CAMERA_PREF_KEY);
  } catch {
    return null;
  }
}

export function saveCameraId(id: string) {
  try {
    localStorage.setItem(CAMERA_PREF_KEY, id);
  } catch {
    /* private browsing */
  }
}

export function clearSavedCameraId() {
  try {
    localStorage.removeItem(CAMERA_PREF_KEY);
  } catch {
    /* ignore */
  }
}

/** Human-readable name — never show raw device hash in UI. */
export function formatCameraLabel(label: string | undefined, index: number): string {
  const trimmed = label?.trim();
  if (trimmed) {
    return trimmed.length > 42 ? `${trimmed.slice(0, 39)}…` : trimmed;
  }
  return `Camera ${index + 1}`;
}

/**
 * Request camera permission then enumerate devices (labels only available after permission).
 */
export async function listCamerasWithPermission(): Promise<CameraDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return [];
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    throw new Error('Camera permission denied. Allow camera access in your browser settings.');
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter((d) => d.kind === 'videoinput');

  return videoInputs.map((d, i) => ({
    id: d.deviceId,
    label: formatCameraLabel(d.label, i),
  }));
}

/** @deprecated use listCamerasWithPermission */
export async function listCameras(): Promise<CameraDevice[]> {
  try {
    return await listCamerasWithPermission();
  } catch {
    return [];
  }
}

export function pickPreferredCamera(cameras: CameraDevice[]): string {
  if (!cameras.length) return '';

  const saved = getSavedCameraId();
  if (saved && cameras.some((c) => c.id === saved)) return saved;

  const back = cameras.find((c) => /back|rear|environment|facing back/i.test(c.label));
  if (back) return back.id;

  const external = cameras.find((c) => /usb|external|webcam|logitech|hd pro|integrated/i.test(c.label));
  if (external) return external.id;

  return cameras[0].id;
}

export function createBarcodeScanner(elementId: string) {
  return new Html5Qrcode(elementId, {
    formatsToSupport: BARCODE_SCAN_FORMATS,
    useBarCodeDetectorIfSupported: true,
    verbose: false,
  });
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
}

export type CameraStartTarget = string | { facingMode: string };

/** Build ordered list of camera targets to try when one fails. */
export function buildCameraFallbacks(cameras: CameraDevice[], preferredId: string): CameraStartTarget[] {
  const targets: CameraStartTarget[] = [];
  const seen = new Set<string>();

  const add = (t: CameraStartTarget) => {
    const key = typeof t === 'string' ? `id:${t}` : `face:${t.facingMode}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(t);
  };

  if (preferredId) add(preferredId);
  for (const cam of cameras) add(cam.id);
  if (isMobileDevice()) add({ facingMode: 'environment' });
  add({ facingMode: 'user' });

  return targets;
}

export function waitForElement(id: string, timeoutMs = 3000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const el = document.getElementById(id);
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Scanner view not ready'));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
