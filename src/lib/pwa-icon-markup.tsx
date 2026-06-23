/** Shared markup for PWA / favicon ImageResponse routes.
 *  Renders the KULMIS block logo on a brand gradient (Satori-safe: divs only). */
export function KulmisIconMark({ size }: { size: number }) {
  const radius = Math.round(size * 0.22);
  const mark = size * 0.5;          // logo bounding box
  const gap = Math.round(size * 0.055);
  const colW = Math.round((mark - gap) / 2);
  const halfH = Math.round((mark - gap) / 2);
  const blockRadius = Math.max(2, Math.round(size * 0.045));

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)',
        borderRadius: radius,
      }}
    >
      <div style={{ display: 'flex', gap }}>
        {/* Left tall block */}
        <div
          style={{
            width: colW,
            height: mark,
            background: 'rgba(255,255,255,0.92)',
            borderRadius: blockRadius,
          }}
        />
        {/* Right stacked blocks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap }}>
          <div
            style={{
              width: colW,
              height: halfH,
              background: 'rgba(255,255,255,0.7)',
              borderRadius: blockRadius,
            }}
          />
          <div
            style={{
              width: colW,
              height: halfH,
              background: '#ffffff',
              borderRadius: blockRadius,
            }}
          />
        </div>
      </div>
    </div>
  );
}
