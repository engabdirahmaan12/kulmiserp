/** Image MIME types and size limits for store/product uploads */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

export const ALLOWED_IMAGE_ACCEPT =
  'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,.svg';

export type StorageBucket = 'product-images' | 'store-assets';

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return 'Unsupported format. Use PNG, JPG, WEBP, or SVG.';
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return 'Image must be 10 MB or smaller.';
  }
  return null;
}

/** Skip canvas processing for SVG */
export function isSvgFile(file: File | Blob): boolean {
  return file.type === 'image/svg+xml';
}

export async function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImageBlob(
  file: File | Blob,
  maxWidth = 1920,
  quality = 0.88,
): Promise<Blob> {
  if (isSvgFile(file)) return file;

  const img = await loadImageFromFile(file);
  const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(img, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
      'image/webp',
      quality,
    );
  });
}

export async function createThumbnailBlob(
  file: File | Blob,
  size = 256,
  quality = 0.82,
): Promise<Blob> {
  if (isSvgFile(file)) return file;

  const img = await loadImageFromFile(file);
  const scale = size / Math.max(img.width, img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(img, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Thumbnail failed'))),
      'image/webp',
      quality,
    );
  });
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop image region to blob (WebP) */
export async function cropImageToBlob(
  imageSrc: string,
  crop: CropArea,
  rotation = 0,
  outputSize?: number,
): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageSrc;
  });

  const canvas = document.createElement('canvas');
  const size = outputSize ?? Math.min(crop.width, crop.height);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.translate(size / 2, size / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-size / 2, -size / 2);
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, size, size);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Crop failed'))),
      'image/webp',
      0.9,
    );
  });
}

/** Center square crop from loaded image dimensions */
export function centerSquareCrop(width: number, height: number, zoom = 1): CropArea {
  const minSide = Math.min(width, height) / zoom;
  const x = (width - minSide) / 2;
  const y = (height - minSide) / 2;
  return { x, y, width: minSide, height: minSide };
}

export function storagePathFromPublicUrl(url: string, bucket: StorageBucket): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}
