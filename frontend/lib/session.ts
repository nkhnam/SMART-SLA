"use client"

import { useEffect, useState } from "react"
import type { SessionUser } from "@/lib/types"

const KEY = "sla_session_v1"
export const SESSION_EVENT = "sla-session-changed"

export type Session = { token: string; user: SessionUser }

export function getSession(): Session | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function setSession(session: Session) {
  window.localStorage.setItem(KEY, JSON.stringify(session))
  window.dispatchEvent(new Event(SESSION_EVENT))
}

export function clearSession() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(KEY)
  window.localStorage.removeItem("sla_logged_user") // dọn dữ liệu đăng nhập giả của bản cũ
  window.dispatchEvent(new Event(SESSION_EVENT))
}

// Phiên đăng nhập hiện tại (cập nhật khi đăng nhập / đăng xuất ở bất kỳ tab nào)
export function useSession() {
  const [session, setState] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sync = () => {
      setState(getSession())
      setReady(true)
    }
    sync()
    window.addEventListener(SESSION_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(SESSION_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  return { session, user: session?.user ?? null, ready, logout: clearSession }
}
