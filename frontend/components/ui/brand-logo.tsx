// Logo SMART-SLA tối giản đơn sắc trên nền kính mờ phản quang
function SmartSlaIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className="logo-led-mark shrink-0 text-[#09090b]"
      aria-hidden="true"
    >
      <path
        d="M16 3.5L26 7.5V15.2C26 21.6 21.7 26.9 16 28.6C10.3 26.9 6 21.6 6 15.2V7.5L16 3.5Z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M19.8 11.4C19.8 10.2 18.1 9.3 16 9.3C13.9 9.3 12.2 10.3 12.2 11.6C12.2 13.2 14.2 13.8 16.2 14.3C18.3 14.9 20.1 15.7 20.1 17.5C20.1 19.1 18.2 20.3 16 20.3C13.7 20.3 11.9 19.3 11.9 17.9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="23.8" r="1.4" fill="currentColor" />
    </svg>
  )
}

// Ô logo vuông trên thanh menu / footer / auth card
export function BrandMark({ height = 40 }: { height?: number }) {
  const iconSize = Math.round(height * 0.56)
  return (
    <span
      className="logo-led inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: height, height }}
      aria-hidden="true"
    >
      <SmartSlaIcon size={iconSize} />
    </span>
  )
}

// Huy hiệu thương hiệu SMART-SLA trên trang trung tâm điều hướng
export function BrandBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`logo-led inline-flex items-center gap-3 rounded-2xl px-5 py-3 ${className}`}>
      <SmartSlaIcon size={28} />
      <span className="font-[family-name:var(--font-display)] text-lg font-extrabold tracking-[-0.02em] text-[#09090b]">
        SMART-SLA
      </span>
    </span>
  )
}
