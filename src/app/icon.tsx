import { ImageResponse } from 'next/og';
import { KulmisIconMark } from '@/lib/pwa-icon-markup';

export const size = { width: 192, height: 192 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(<KulmisIconMark size={192} />, { ...size });
}
