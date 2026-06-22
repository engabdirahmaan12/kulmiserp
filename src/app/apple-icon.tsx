import { ImageResponse } from 'next/og';
import { KulmisIconMark } from '@/lib/pwa-icon-markup';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(<KulmisIconMark size={180} />, { ...size });
}
