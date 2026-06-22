'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { ImageUploadZone } from '@/components/media/ImageUploadZone';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';
import { ProductImage } from '@/components/media/ProductImage';
import { Button } from '@/components/ui/button';
import { Star, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProductImage as ProductImageRow } from '@/types';

export interface PendingGalleryItem {
  id: string;
  preview: string;
  blob: Blob;
  isPrimary: boolean;
}

interface ProductMediaEditorProps {
  productId?: string;
  storeId: string;
  categoryName?: string;
  mainPreview: string | null;
  onMainPreviewChange: (url: string | null) => void;
  onMainBlobChange: (blob: Blob | null) => void;
  onRemoveMain: () => void;
  pendingGallery: PendingGalleryItem[];
  onPendingGalleryChange: (items: PendingGalleryItem[]) => void;
  existingImages?: ProductImageRow[];
  onDeleteExisting?: (id: string) => void;
}

export function ProductMediaEditor({
  productId,
  storeId,
  categoryName,
  mainPreview,
  onMainPreviewChange,
  onMainBlobChange,
  onRemoveMain,
  pendingGallery,
  onPendingGalleryChange,
  existingImages = [],
  onDeleteExisting,
}: ProductMediaEditorProps) {
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropMode, setCropMode] = useState<'main' | 'gallery'>('main');

  const { data: loadedImages = [] } = useQuery({
    queryKey: ['product-images', productId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('product_images')
        .select('*')
        .eq('product_id', productId!)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProductImageRow[];
    },
    enabled: !!productId,
  });

  const gallery = productId ? loadedImages : existingImages;

  const onFile = useCallback((file: File, mode: 'main' | 'gallery') => {
    setCropMode(mode);
    setCropFile(file);
  }, []);

  const onCrop = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    if (cropMode === 'main') {
      onMainBlobChange(blob);
      onMainPreviewChange(url);
    } else {
      onPendingGalleryChange([
        ...pendingGallery,
        {
          id: `pending-${Date.now()}`,
          preview: url,
          blob,
          isPrimary: pendingGallery.length === 0 && gallery.length === 0 && !mainPreview,
        },
      ]);
    }
    setCropFile(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <ProductImage
          src={mainPreview}
          alt="Product"
          categoryName={categoryName}
          size="md"
          rounded="2xl"
          className="mx-auto sm:mx-0"
        />
        <div className="flex-1 min-w-0">
          <ImageUploadZone
            label="Main product image"
            previewUrl={mainPreview}
            onFileSelected={(f) => onFile(f, 'main')}
            onRemove={onRemoveMain}
          />
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-700">Gallery images</p>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = () => {
              const f = input.files?.[0];
              if (f) onFile(f, 'gallery');
            };
            input.click();
          }}>
            Add to gallery
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {gallery.map((img) => (
            <div key={img.id} className="relative group">
              <ProductImage src={img.thumbnail_url || img.image_url} alt="" categoryName={categoryName} size="sm" />
              {img.is_primary && (
                <span className="absolute top-1 left-1 rounded bg-amber-500 text-white p-0.5">
                  <Star className="h-3 w-3 fill-current" />
                </span>
              )}
              {onDeleteExisting && (
                <button
                  type="button"
                  onClick={() => onDeleteExisting(img.id)}
                  className="absolute top-1 right-1 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {pendingGallery.map((p) => (
            <div key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="h-12 w-12 rounded-lg object-cover border border-slate-200" />
              <button
                type="button"
                onClick={() => onPendingGalleryChange(pendingGallery.filter((x) => x.id !== p.id))}
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <ImageCropDialog
        open={!!cropFile}
        file={cropFile}
        title={cropMode === 'main' ? 'Crop product image' : 'Crop gallery image'}
        onClose={() => setCropFile(null)}
        onConfirm={onCrop}
      />
    </div>
  );
}

/** Persist gallery uploads after product save */
export async function syncProductGallery(
  storeId: string,
  productId: string,
  mainImageUrl: string | null,
  pending: PendingGalleryItem[],
  deletedIds: string[],
) {
  const supabase = createClient();
  const { uploadProductImage } = await import('@/lib/storage/upload');

  for (const id of deletedIds) {
    await supabase.from('product_images').delete().eq('id', id);
  }

  let sortOrder = 0;
  for (const item of pending) {
    const up = await uploadProductImage(storeId, productId, item.blob);
    await supabase.from('product_images').insert({
      store_id: storeId,
      product_id: productId,
      image_url: up.url,
      thumbnail_url: up.thumbnailUrl ?? null,
      sort_order: sortOrder++,
      is_primary: item.isPrimary,
    });
  }

  if (mainImageUrl) {
    const { data: existing } = await supabase
      .from('product_images')
      .select('id')
      .eq('product_id', productId)
      .eq('is_primary', true)
      .maybeSingle();

    if (!existing) {
      await supabase.from('product_images').insert({
        store_id: storeId,
        product_id: productId,
        image_url: mainImageUrl,
        sort_order: 0,
        is_primary: true,
      });
    } else {
      await supabase.from('product_images').update({ image_url: mainImageUrl }).eq('id', existing.id);
    }
  }
}
