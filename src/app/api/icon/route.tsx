import { ImageResponse } from 'next/og';
import { KulmisIconMark } from '@/lib/pwa-icon-markup';

export const runtime = 'edge';

function parseSize(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 192;
  return Math.min(512, Math.max(32, Math.round(n)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const size = parseSize(searchParams.get('size'));
  return new ImageResponse(<KulmisIconMark size={size} />, {
    width: size,
    height: size,
  });
}
