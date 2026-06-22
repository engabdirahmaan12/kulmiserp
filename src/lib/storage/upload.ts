import { createClient } from '@/lib/supabase/client';
import {
  compressImageBlob,
  createThumbnailBlob,
  isSvgFile,
  type StorageBucket,
} from '@/lib/storage/media';

export interface UploadResult {
  url: string;
  path: string;
  thumbnailUrl?: string;
  thumbnailPath?: string;
}

export async function uploadToStorage(
  bucket: StorageBucket,
  storeId: string,
  file: File | Blob,
  subPath: string,
  options?: { withThumbnail?: boolean; maxWidth?: number },
): Promise<UploadResult> {
  const supabase = createClient();
  const ext = isSvgFile(file) ? 'svg' : 'webp';
  const baseName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${storeId}/${subPath}/${baseName}.${ext}`;

  const body = isSvgFile(file) ? file : await compressImageBlob(file, options?.maxWidth ?? 1920);

  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    cacheControl: '31536000',
    upsert: true,
    contentType: isSvgFile(file) ? 'image/svg+xml' : 'image/webp',
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  let thumbnailUrl: string | undefined;
  let thumbnailPath: string | undefined;

  if (options?.withThumbnail && !isSvgFile(file)) {
    const thumb = await createThumbnailBlob(body, 256);
    thumbnailPath = `${storeId}/${subPath}/thumb_${baseName}.webp`;
    const { error: thumbErr } = await supabase.storage.from(bucket).upload(thumbnailPath, thumb, {
      cacheControl: '31536000',
      upsert: true,
      contentType: 'image/webp',
    });
    if (!thumbErr) {
      thumbnailUrl = supabase.storage.from(bucket).getPublicUrl(thumbnailPath).data.publicUrl;
    }
  }

  return { url: data.publicUrl, path, thumbnailUrl, thumbnailPath };
}

export async function uploadStoreLogo(storeId: string, file: File | Blob): Promise<UploadResult> {
  return uploadToStorage('store-assets', storeId, file, 'logo', { maxWidth: 800 });
}

export async function uploadStoreCover(storeId: string, file: File | Blob): Promise<UploadResult> {
  return uploadToStorage('store-assets', storeId, file, 'cover', { maxWidth: 2400 });
}

export async function uploadProductImage(
  storeId: string,
  productId: string,
  file: File | Blob,
): Promise<UploadResult> {
  return uploadToStorage('product-images', storeId, file, `products/${productId}`, {
    withThumbnail: true,
    maxWidth: 1600,
  });
}

export async function deleteStoragePath(bucket: StorageBucket, path: string): Promise<void> {
  const supabase = createClient();
  await supabase.storage.from(bucket).remove([path]);
}

export async function deleteStorageByUrl(bucket: StorageBucket, url: string | null | undefined): Promise<void> {
  if (!url) return;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(url.slice(idx + marker.length));
  await deleteStoragePath(bucket, path);
}
