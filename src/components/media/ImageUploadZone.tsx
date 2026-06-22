'use client';

import { useCallback, useRef, useState } from 'react';
import { Camera, ImageIcon, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ALLOWED_IMAGE_ACCEPT, validateImageFile } from '@/lib/storage/media';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ImageUploadZoneProps {
  label?: string;
  hint?: string;
  previewUrl?: string | null;
  onFileSelected: (file: File) => void;
  onRemove?: () => void;
  aspect?: 'square' | 'banner';
  className?: string;
  disabled?: boolean;
}

export function ImageUploadZone({
  label = 'Upload image',
  hint = 'PNG, JPG, WEBP, SVG · Max 10 MB',
  previewUrl,
  onFileSelected,
  onRemove,
  aspect = 'square',
  className,
  disabled,
}: ImageUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const err = validateImageFile(file);
      if (err) {
        toast.error(err);
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && <p className="text-sm font-medium text-slate-700">{label}</p>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'relative rounded-2xl border-2 border-dashed transition-colors overflow-hidden',
          aspect === 'banner' ? 'aspect-[3/1] min-h-[120px]' : 'aspect-square max-w-[200px]',
          dragOver ? 'border-blue-400 bg-blue-50/50' : 'border-slate-200 bg-slate-50/60',
          disabled && 'opacity-60 pointer-events-none',
        )}
      >
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                aria-label="Remove image"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <Upload className="h-8 w-8 text-slate-400" />
            <p className="text-xs text-slate-500">Drag & drop or browse</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_IMAGE_ACCEPT}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => inputRef.current?.click()} disabled={disabled}>
          <ImageIcon className="h-4 w-4" /> Browse
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 sm:hidden" onClick={() => cameraRef.current?.click()} disabled={disabled}>
          <Camera className="h-4 w-4" /> Camera
        </Button>
      </div>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
