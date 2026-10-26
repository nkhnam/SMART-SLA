"use client"

import { useEffect, useRef } from "react"
import { Mesh, Program, Renderer, Triangle } from "ogl"
import "./ghost-fibers.css"

type GhostFibersProps = {
  lineColor?: string
  glowColor?: string
  speed?: number
  scale?: number
  rotation?: number
  rotationSpeed?: number
  layers?: number
  waveAmplitude?: number
  waveFrequency?: number
  waveSpeed?: number
  layerSpeed?: number
  twist?: number
  twistFrequency?: number
  twistSpeed?: number
  lineFrequency?: number
  lineSpacing?: number
  lineSharpness?: number
  glowFalloff?: number
  glowIntensity?: number
  brightness?: number
  blueBoost?: number
  vignette?: number
  grain?: number
  dpr?: number
  fps?: number
  paused?: boolean
  className?: string
}

const hexToRgb = (hex: string) => {
  const value = hex.trim().replace(/^#/, "")
  const normalized = value.length === 3 ? value.replace(/./g, (channel) => channel + channel) : value
  const match = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized)
  return match ? [Number.parseInt(match[1], 16) / 255, Number.parseInt(match[2], 16) / 255, Number.parseInt(match[3], 16) / 255] : [1, 1, 1]
}

const vertex = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const fragment = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime, uSpeed, uScale, uRotation, uRotationSpeed, uLayers;
uniform float uWaveAmplitude, uWaveFrequency, uWaveSpeed, uLayerSpeed;
uniform float uTwist, uTwistFrequency, uTwistSpeed, uLineFrequency, uLineSpacing, uLineSharpness;
uniform float uGlowFalloff, uGlowIntensity, uBrightness, uBlueBoost, uVignette, uGrain;
uniform vec3 uLineColor, uGlowColor;
out vec4 fragColor;
#define MAX_LAYERS 10
mat2 rotate2d(float angle) { float s = sin(angle); float c = cos(angle); return mat2(c, -s, s, c); }
float grainHash(vec2 p) { p = floor(p); return fract(52.9829189 * fract(dot(p, vec2(.065, .005)))); }
float layeredGrain(vec2 p) { p = mod(p + vec2(uTime * 30., -uTime * 21.), 1024.); return .4*grainHash(p) + .25*grainHash(p*2.+17.) + .2*grainHash(p*4.+47.) + .1*grainHash(p*8.+113.) + .05*grainHash(p*16.+191.); }
void main() {
  vec2 resolution = max(uResolution, vec2(1.));
  vec2 uv = (2. * gl_FragCoord.xy - resolution) / resolution.y;
  float time = uTime * uSpeed;
  vec2 p = rotate2d(radians(uRotation) + time * uRotationSpeed) * (uv / max(uScale, .05));
  vec3 color = vec3(0.);
  for (int index = 0; index < MAX_LAYERS; index++) {
    float fi = float(index) + 1.; if (fi > uLayers) break;
    p += uWaveAmplitude * sin(p.yx * fi * uWaveFrequency + time * (uWaveSpeed + fi * uLayerSpeed));
    float radius = length(p); float angle = atan(p.y, p.x) + sin(radius * uTwistFrequency - time * uTwistSpeed + fi) * uTwist;
    p = vec2(cos(angle), sin(angle)) * radius;
    float lines = pow(max(0., 1. - abs(sin(p.x * (uLineFrequency + fi * uLineSpacing) + sin(p.y * 3. + time)))), uLineSharpness);
    color += uLineColor * lines / fi;
    color += uGlowColor * exp(-uGlowFalloff * abs(sin(p.x * 3. + time + fi))) * uGlowIntensity / (fi * 2.);
  }
  color += max(uLineColor * .85567 - uGlowColor * .06186, vec3(0.)) * exp(-2.2 * dot(uv, uv));
  color += (uLineColor * .19588 + uGlowColor * .2268) * exp(-1.5 * length(uv + vec2(sin(time * .3) * .25, cos(time * .25) * .18)));
  float vignette = 1. - smoothstep(.35, 1.45, length(uv));
  color *= mix(1. - uVignette, 1., vignette);
  color = 1. - exp(-color * uBrightness); color.b *= uBlueBoost;
  vec3 outputColor = vec3(.0235, .0431, .0824) + color;
  outputColor += (layeredGrain(gl_FragCoord.xy) - .5) * uGrain;
  fragColor = vec4(clamp(outputColor, 0., 1.), 1.);
}`

export default function GhostFibers({
  lineColor = "#071a42", glowColor = "#1d4ed8", speed = 0.12, scale = 2.2, rotation = -8, rotationSpeed = 0.04,
  layers = 3, waveAmplitude = 0.015, waveFrequency = 3, waveSpeed = 0.15, layerSpeed = 0.08, twist = 0.1,
  twistFrequency = 5, twistSpeed = 1.2, lineFrequency = 5, lineSpacing = 2, lineSharpness = 16, glowFalloff = 10,
  glowIntensity = 1.2, brightness = 1.5, blueBoost = 1.2, vignette = 0.8, grain = 0.025, dpr = 1, fps = 30,
  paused = false, className = "",
}: GhostFibersProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new Renderer({ webgl: 2, alpha: false, antialias: false, dpr: Math.min(Math.max(dpr, 0.5), 2) })
    // The shader uses WebGL 2 syntax. Leave the existing Home backdrop intact on
    // browsers where WebGL 2 is unavailable instead of allowing a shader error.
    if (!renderer.isWebgl2) return
    const gl = renderer.gl
    const canvas = gl.canvas
    Object.assign(canvas.style, { width: "100%", height: "100%", display: "block" })
    canvas.setAttribute("aria-hidden", "true")
    container.appendChild(canvas)
    const program = new Program(gl, {
      vertex, fragment,
      uniforms: {
        uResolution: { value: new Float32Array([1, 1]) }, uTime: { value: 0 }, uSpeed: { value: speed }, uScale: { value: scale }, uRotation: { value: rotation }, uRotationSpeed: { value: rotationSpeed }, uLayers: { value: Math.min(Math.max(Math.round(layers), 1), 10) },
        uWaveAmplitude: { value: waveAmplitude }, uWaveFrequency: { value: waveFrequency }, uWaveSpeed: { value: waveSpeed }, uLayerSpeed: { value: layerSpeed }, uTwist: { value: twist }, uTwistFrequency: { value: twistFrequency }, uTwistSpeed: { value: twistSpeed },
        uLineFrequency: { value: lineFrequency }, uLineSpacing: { value: lineSpacing }, uLineSharpness: { value: lineSharpness }, uGlowFalloff: { value: glowFalloff }, uGlowIntensity: { value: glowIntensity }, uBrightness: { value: brightness }, uBlueBoost: { value: blueBoost }, uVignette: { value: vignette }, uGrain: { value: grain },
        uLineColor: { value: new Float32Array(hexToRgb(lineColor)) }, uGlowColor: { value: new Float32Array(hexToRgb(glowColor)) },
      },
    })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })
    let frameId = 0
    let previous = performance.now()
    let elapsed = 0
    let lastRender = 0
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const render = () => renderer.render({ scene: mesh })
    const resize = () => {
      const rect = container.getBoundingClientRect()
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)))
      program.uniforms.uResolution.value[0] = gl.drawingBufferWidth
      program.uniforms.uResolution.value[1] = gl.drawingBufferHeight
      render()
    }
    const animate = (now: number) => {
      if (paused || reducedMotion.matches || document.hidden) return
      elapsed += Math.min((now - previous) / 1000, 0.1); previous = now
      if (now - lastRender >= 1000 / Math.min(Math.max(fps, 1), 120)) { program.uniforms.uTime.value = elapsed; render(); lastRender = now }
      frameId = requestAnimationFrame(animate)
    }
    const start = () => { if (!paused && !reducedMotion.matches && !document.hidden && !frameId) { previous = performance.now(); frameId = requestAnimationFrame(animate) } }
    const stop = () => { if (frameId) cancelAnimationFrame(frameId); frameId = 0 }
    const updateAnimation = () => { stop(); render(); start() }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    document.addEventListener("visibilitychange", updateAnimation)
    reducedMotion.addEventListener("change", updateAnimation)
    resize(); start()
    return () => {
      stop(); resizeObserver.disconnect(); document.removeEventListener("visibilitychange", updateAnimation); reducedMotion.removeEventListener("change", updateAnimation)
      if (canvas.parentNode === container) container.removeChild(canvas)
      gl.getExtension("WEBGL_lose_context")?.loseContext()
    }
  }, [lineColor, glowColor, speed, scale, rotation, rotationSpeed, layers, waveAmplitude, waveFrequency, waveSpeed, layerSpeed, twist, twistFrequency, twistSpeed, lineFrequency, lineSpacing, lineSharpness, glowFalloff, glowIntensity, brightness, blueBoost, vignette, grain, dpr, fps, paused])

  return <div ref={containerRef} className={`ghost-fibers-container ${className}`.trim()} />
}
