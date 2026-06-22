'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RotateCw, ZoomIn } from 'lucide-react';
import { centerSquareCrop, cropImageToBlob, loadImageFromFile } from '@/lib/storage/media';

interface ImageCropDialogProps {
  open: boolean;
  file: File | null;
  title?: string;
  onClose: () => void;
  onConfirm: (blob: Blob) => void;
}

export function ImageCropDialog({
  open,
  file,
  title = 'Crop image',
  onClose,
  onConfirm,
}: ImageCropDialogProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file || !open) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    setZoom(1);
    setRotation(0);
    loadImageFromFile(file).then((img) => setDims({ w: img.width, h: img.height })).catch(() => {});
    return () => URL.revokeObjectURL(url);
  }, [file, open]);

  const apply = useCallback(async () => {
    if (!preview || !dims.w) return;
    setBusy(true);
    try {
      const crop = centerSquareCrop(dims.w, dims.h, zoom);
      const blob = await cropImageToBlob(preview, crop, rotation, 512);
      onConfirm(blob);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [preview, dims, zoom, rotation, onConfirm, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md w-[calc(100%-1.5rem)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt=""
                className="h-full w-full object-cover transition-transform duration-200"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                }}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5 text-slate-500">
              <ZoomIn className="h-3.5 w-3.5" /> Zoom
            </Label>
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setRotation((r) => (r + 90) % 360)}>
            <RotateCw className="h-4 w-4" /> Rotate 90°
          </Button>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={apply} disabled={busy || !preview}>
            {busy ? 'Processing…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
