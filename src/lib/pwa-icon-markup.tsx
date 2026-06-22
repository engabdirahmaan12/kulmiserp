/** Shared markup for PWA / favicon ImageResponse routes */
export function KulmisIconMark({ size }: { size: number }) {
  const radius = Math.round(size * 0.167);
  const fontSize = Math.round(size * 0.42);
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
      <span
        style={{
          color: '#ffffff',
          fontSize,
          fontWeight: 800,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '-0.04em',
        }}
      >
        K
      </span>
    </div>
  );
}
