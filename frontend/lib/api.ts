// Base URL của Backend API.
// Local dev: frontend chạy 3000/3001, NestJS API chạy 3002.
// Production (Vercel): đặt NEXT_PUBLIC_API_URL = URL backend trên Render
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3002"

import { clearSession, getSession } from "@/lib/session"

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
  // Render bản miễn phí có thể mất 30-50 giây để "thức dậy", ghi lên Polygon mất thêm 5-10 giây
  timeoutMs?: number
}

// Gọi backend: tự gắn JWT, tự báo lỗi rõ ràng, hết phiên thì tự đăng xuất
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, timeoutMs = 90_000 } = options
  const session = getSession()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Máy chủ phản hồi quá lâu. Vui lòng thử lại sau ít phút.", 0)
    }
    throw new ApiError("Không kết nối được máy chủ. Kiểm tra mạng hoặc thử lại sau.", 0)
  }
  clearTimeout(timer)

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && session) clearSession()
    const raw = (data as { message?: string | string[] } | null)?.message
    const message = Array.isArray(raw) ? raw[0] : raw
    throw new ApiError(message || `Yêu cầu thất bại (mã ${res.status})`, res.status)
  }
  return data as T
}

export const polygonscanTx = (hash?: string | null) => (hash ? `https://amoy.polygonscan.com/tx/${hash}` : null)
