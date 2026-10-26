"use client"

import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

export type PlanDef = {
  code: "PILOT" | "PAYG" | "STARTER" | "ENTERPRISE"
  name: string
  tagline: string
  priceLabel: string
  priceNote: string
  durationDays: number | null
  maxActiveSla: number | null
  maxSourcesPerContract: number | null
  probeIntervalSeconds: number
  oneTime: boolean
  features: string[]
}

export type MyPlan = {
  code: PlanDef["code"] | "PLATFORM" | null
  name: string
  active: boolean
  status: "ACTIVE" | "EXPIRED" | "NONE" | "PLATFORM"
  startedAt: string | null
  expiresAt: string | null
  pilotUsed: boolean
  liveSla: number
  limits: { maxActiveSla: number | null; maxSourcesPerContract: number | null; probeIntervalSeconds: number }
}

export const PLAN_EVENT = "sla-plan-changed"

// Gói hiện tại của doanh nghiệp đang đăng nhập (tự tải lại khi vừa đăng ký gói)
export function useMyPlan() {
  const { user } = useSession()
  const [plan, setPlan] = useState<MyPlan | null>(null)

  const load = useCallback(async () => {
    if (!user) return setPlan(null)
    try {
      setPlan(await api<MyPlan>("/api/billing/me", { timeoutMs: 30_000 }))
    } catch {
      /* không chặn giao diện nếu lỗi */
    }
  }, [user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    window.addEventListener(PLAN_EVENT, load)
    return () => window.removeEventListener(PLAN_EVENT, load)
  }, [load])

  return { plan, reload: load }
}

export const fmtInterval = (s: number) => (s >= 60 ? `${Math.round(s / 60)} phút` : `${s} giây`)
