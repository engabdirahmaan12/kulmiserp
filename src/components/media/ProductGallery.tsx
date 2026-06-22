'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface GalleryImage {
  id: string;
  image_url: string;
  thumbnail_url?: string | null;
  is_primary?: boolean;
}

interface ProductGalleryProps {
  images: GalleryImage[];
  productName: string;
  className?: string;
}

export function ProductGallery({ images, productName, className }: ProductGalleryProps) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  if (images.length === 0) return null;

  const current = images[index] ?? images[0];
  const src = current.image_url;

  const prev = () => setIndex((i) => (i - 1 + images.length) % images.length);
  const next = () => setIndex((i) => (i + 1) % images.length);

  return (
    <>
      <div className={cn('space-y-2', className)}>
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="relative w-full aspect-square max-h-[280px] rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 group"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={productName} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
          </div>
        </button>

        {images.length > 1 && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={prev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex gap-1.5 overflow-x-auto flex-1 py-1">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn(
                    'h-12 w-12 shrink-0 rounded-lg overflow-hidden border-2 transition-all',
                    i === index ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent opacity-70 hover:opacity-100',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.thumbnail_url || img.image_url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={next}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <Dialog open={lightbox} onOpenChange={setLightbox}>
        <DialogContent className="max-w-4xl w-[calc(100%-1rem)] p-0 bg-black/95 border-0 overflow-hidden">
          <button
            type="button"
            onClick={() => setLightbox(false)}
            className="absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="relative flex items-center justify-center min-h-[50vh] max-h-[85vh] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={productName} className="max-h-[80vh] max-w-full object-contain" />
            {images.length > 1 && (
              <>
                <Button type="button" variant="ghost" size="icon" className="absolute left-2 text-white hover:bg-white/10" onClick={prev}>
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="absolute right-2 text-white hover:bg-white/10" onClick={next}>
                  <ChevronRight className="h-6 w-6" />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
