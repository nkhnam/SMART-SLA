import Image from "next/image"

// Ô logo SLA-DEX: chữ đỏ nổi trên nền trắng, bóng đổ, viền LED xanh dương
export function SdMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="logo-led grid shrink-0 place-items-center rounded-xl"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="logo-led-mark font-[family-name:var(--font-display)] text-sm font-extrabold tracking-tight text-[#e11d2a]" style={{ fontSize: size * 0.36 }}>
        SD
      </span>
    </span>
  )
}

// Logo AISC'26: đỏ trên tấm nền trắng, bóng đổ, viền LED xanh dương
export function AiscBadge({ width = 240, className = "" }: { width?: number; className?: string }) {
  return (
    <span className={`logo-led inline-flex items-center justify-center rounded-2xl px-5 py-3 ${className}`}>
      <Image
        src="/brand/aisc26-red.png"
        alt="AISC'26"
        width={1200}
        height={485}
        priority
        className="logo-led-mark h-auto"
        style={{ width }}
      />
    </span>
  )
}

// Logo của web trên thanh menu / footer: AISC'26 đỏ trên ô trắng, bóng đổ, viền LED xanh dương
export function AiscMark({ height = 40 }: { height?: number }) {
  const logoH = Math.round(height * 0.62)
  return (
    <span className="logo-led inline-flex shrink-0 items-center justify-center rounded-xl px-2" style={{ height }} aria-hidden="true">
      <Image src="/brand/aisc26-red.png" alt="" width={1200} height={485} priority className="logo-led-mark w-auto" style={{ height: logoH }} />
    </span>
  )
}
