'use client';

import { useCallback, useEffect, useRef } from 'react';
import { findProductByScan, type BarcodeLookup, type BarcodeScanHit } from './utils';

interface UseBarcodeScannerOptions {
  index: BarcodeLookup;
  onScan: (code: string, hit?: BarcodeScanHit) => void;
  onNotFound?: (code: string) => void;
  /** Keep hidden input focused for USB scanners when not typing elsewhere */
  autoFocus?: boolean;
  enabled?: boolean;
}

/**
 * Handles USB / Bluetooth barcode wedge scanners (rapid keypress + Enter).
 * Works globally when focus is outside inputs, plus via hidden capture input.
 */
export function useBarcodeScanner({
  index,
  onScan,
  onNotFound,
  autoFocus = true,
  enabled = true,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const processCode = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (trimmed.length < BARCODE_MIN_LENGTH) return;
      const hit = findProductByScan(index, trimmed);
      if (hit) {
        onScan(trimmed, hit);
      } else {
        onNotFound?.(trimmed);
        onScan(trimmed);
      }
    },
    [index, onScan, onNotFound],
  );

  // USB wedge: accumulate fast keystrokes globally when not typing in inputs
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isBarcodeInput = target.closest('[data-barcode-input]');
      const isInput =
        !isBarcodeInput &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Enter') {
        if (!isInput && bufferRef.current.length >= BARCODE_MIN_LENGTH) {
          e.preventDefault();
          processCode(bufferRef.current);
          bufferRef.current = '';
        }
        return;
      }

      if (isInput) return;

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        if (now - lastKeyTimeRef.current > 120) {
          bufferRef.current = '';
        }
        lastKeyTimeRef.current = now;
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, processCode]);

  // Refocus hidden capture input when clicking outside text fields (POS backup for USB scanners)
  useEffect(() => {
    if (!enabled || !autoFocus) return;

    const refocusHidden = () => {
      const active = document.activeElement as HTMLElement | null;
      const inTextField =
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable);
      if (!inTextField) {
        hiddenInputRef.current?.focus({ preventScroll: true });
      }
    };

    const t = setTimeout(refocusHidden, 400);
    document.addEventListener('pointerdown', refocusHidden);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', refocusHidden);
    };
  }, [enabled, autoFocus]);

  const handleHiddenInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = e.currentTarget.value;
      e.currentTarget.value = '';
      processCode(v);
    }
  };

  return {
    hiddenInputRef,
    handleHiddenInputKeyDown,
    processCode,
  };
}
