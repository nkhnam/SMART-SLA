"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import AuthCard from "@/components/sla/auth-card"
import { useSession } from "@/lib/session"

export default function LoginPage() {
  const router = useRouter()
  const { user, ready } = useSession()

  // Đã đăng nhập thì về trang chủ
  useEffect(() => {
    if (ready && user) router.replace("/")
  }, [ready, user, router])

  return <AuthCard mode="login" />
}
