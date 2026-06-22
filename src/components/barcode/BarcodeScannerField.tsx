'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Barcode, Camera, ScanLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarcodeCameraDialog } from './BarcodeCameraDialog';
import { isMobileDevice } from '@/lib/barcode/camera-scanner';

interface BarcodeScannerFieldProps {
  value?: string;
  onChange?: (value: string) => void;
  onScan?: (code: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  showCamera?: boolean;
  /** Close camera after each scan (POS). Keep open for product forms. */
  closeCameraOnScan?: boolean;
}

/**
 * Barcode input with USB wedge scanner + camera support.
 * - USB / Bluetooth barcode guns: focus field and scan (types + Enter)
 * - Mobile / external webcam: tap camera button
 */
export function BarcodeScannerField({
  value,
  onChange,
  onScan,
  placeholder = 'Scan or enter barcode...',
  className,
  inputClassName,
  autoFocus = false,
  showCamera = true,
  closeCameraOnScan = true,
}: BarcodeScannerFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeyTimeRef = useRef(0);
  const wedgeRef = useRef(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    setMobile(isMobileDevice());
  }, []);

  const emit = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      onChange?.(trimmed);
      onScan?.(trimmed);
    },
    [onChange, onScan],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const now = Date.now();
    if (now - lastKeyTimeRef.current < 80) {
      wedgeRef.current = true;
    }
    lastKeyTimeRef.current = now;
    onChange?.(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    if (now - lastKeyTimeRef.current < 100) {
      wedgeRef.current = true;
    }
    lastKeyTimeRef.current = now;

    if (e.key === 'Enter') {
      e.preventDefault();
      emit(e.currentTarget.value);
      if (wedgeRef.current) {
        onChange?.('');
      }
      wedgeRef.current = false;
    }
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <>
      <div className={cn('flex gap-2', className)}>
        <div className="relative flex-1 min-w-0">
          <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={cn('pl-10', inputClassName)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode={mobile ? 'none' : 'text'}
            data-barcode-input
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 h-10 w-10"
          onClick={() => inputRef.current?.focus()}
          title="USB / Bluetooth barcode scanner — click here then scan"
        >
          <Barcode className="h-4 w-4 text-blue-600" />
        </Button>
        {showCamera && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn('shrink-0 h-10 w-10', mobile && 'bg-blue-50 border-blue-200')}
            onClick={() => setCameraOpen(true)}
            title={mobile ? 'Scan with phone camera' : 'Scan with webcam / external camera'}
          >
            <Camera className="h-4 w-4 text-blue-600" />
          </Button>
        )}
      </div>

      <BarcodeCameraDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onScan={emit}
        closeOnScan={closeCameraOnScan}
      />
    </>
  );
}
