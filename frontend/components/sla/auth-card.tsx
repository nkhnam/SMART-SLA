"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Check, Eye, EyeOff } from "lucide-react"
import { api } from "@/lib/api"
import { setSession } from "@/lib/session"
import type { SessionUser } from "@/lib/types"
import { ErrorNote, inputCls } from "@/components/sla/ui"
import { BrandMark } from "@/components/ui/brand-logo"
import SiteFooter from "@/components/ui/site-footer"

type AuthResponse = { accessToken: string; user: SessionUser }

// Ô mật khẩu có nút hiện/ẩn. Inline style để không bị kiểu nút "kính" dùng chung của giao diện áp vào.
function PasswordInput({ label, value, onChange, autoComplete, placeholder, invalid, describedBy }: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  placeholder: string
  invalid?: boolean
  describedBy?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <div className="relative mt-1.5">
        <input
          required
          type={show ? "text" : "password"}
          minLength={8}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${inputCls} pr-11 ${invalid ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20" : ""}`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          aria-pressed={show}
          className="grid h-8 w-9 place-items-center rounded-md text-slate-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
          style={{
            // Đặt bằng style trực tiếp: CSS chung ".app-theme button { position: relative }" sẽ ghi đè class "absolute"
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            boxShadow: "none",
            backdropFilter: "none",
          }}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  )
}


// Form đăng nhập / đăng ký (trang /login và /register)
export default function AuthCard({ mode }: { mode: "login" | "register" }) {
  const router = useRouter()
  const view = mode
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [orgName, setOrgName] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [serviceType, setServiceType] = useState("")
  const [accountType, setAccountType] = useState<"BUYER" | "SUPPLIER">("BUYER")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (view === "register" && password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.")
      return
    }
    setBusy(true)
    try {
      const res =
        view === "login"
          ? await api<AuthResponse>("/api/auth/login", { method: "POST", body: { email, password } })
          : await api<AuthResponse>("/api/auth/register", { method: "POST", body: { email, password, fullName, jobTitle: jobTitle.trim() || undefined, orgName, accountType, serviceType: accountType === "SUPPLIER" ? serviceType.trim() || undefined : undefined } })
      setSession({ token: res.accessToken, user: res.user })
      router.push("/")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra")
    } finally {
      setBusy(false)
    }
  }

  const isLogin = view === "login"
  const mismatch = !isLogin && confirmPassword.length > 0 && confirmPassword !== password
  return (
    <div className="app-theme flex min-h-screen flex-col">
    <div className="flex flex-1 items-center justify-center p-4 py-12">
      <div className="relative flex w-full max-w-[440px] flex-col items-center rounded-2xl border border-slate-700 bg-[#0f172a] p-8 shadow-2xl">
        <Link href="/" className="absolute left-4 top-4 text-slate-400 hover:text-white" aria-label="Về trang chủ">←</Link>
        <div className="mb-4"><BrandMark height={48} /></div>
        <h2 className="mb-1 text-2xl font-bold text-white">{isLogin ? "Đăng nhập" : "Đăng ký doanh nghiệp"}</h2>
        <p className="mb-6 text-center text-sm text-slate-400">{isLogin ? "Dùng email công việc đã đăng ký" : "Tài khoản đầu tiên sẽ là quản trị viên của doanh nghiệp"}</p>
        <form onSubmit={submit} className="w-full space-y-4">
          {!isLogin && (
            <>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Loại tài khoản">
                {(["BUYER", "SUPPLIER"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={accountType === t}
                    onClick={() => setAccountType(t)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${accountType === t ? "border-blue-400 bg-blue-500/15 text-white ring-2 ring-blue-400/60" : "border-slate-700 text-slate-500"}`}
                  >
                    {accountType === t && <Check className="h-3.5 w-3.5" />}
                    {t === "BUYER" ? "Bên mua dịch vụ" : "Nhà cung cấp dịch vụ"}
                  </button>
                ))}
              </div>
              <label className="block text-xs font-semibold text-slate-300">Tên doanh nghiệp<input required value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Công ty CP ..." className={`mt-1.5 ${inputCls}`} /></label>
              <label className="block text-xs font-semibold text-slate-300">Họ và tên<input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nguyễn Văn A" className={`mt-1.5 ${inputCls}`} /></label>
              <label className="block text-xs font-semibold text-slate-300">Chức vụ <span className="font-normal text-slate-500">(người đại diện, tuỳ chọn)</span><input value={jobTitle} maxLength={100} onChange={(e) => setJobTitle(e.target.value)} placeholder="VD: Giám đốc điều hành" className={`mt-1.5 ${inputCls}`} /></label>
              {accountType === "SUPPLIER" && (
                <label className="block text-xs font-semibold text-slate-300">Lĩnh vực dịch vụ<input value={serviceType} maxLength={100} onChange={(e) => setServiceType(e.target.value)} placeholder="VD: Cloud Hosting, API Gateway, IT Support" className={`mt-1.5 ${inputCls}`} /></label>
              )}
            </>
          )}
          <label className="block text-xs font-semibold text-slate-300">Email công việc<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@congty.vn" className={`mt-1.5 ${inputCls}`} /></label>
          <PasswordInput label="Mật khẩu" value={password} onChange={setPassword} autoComplete={isLogin ? "current-password" : "new-password"} placeholder="Tối thiểu 8 ký tự" />
          {!isLogin && (
            <div>
              <PasswordInput
                label="Xác nhận mật khẩu"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                placeholder="Nhập lại mật khẩu"
                invalid={mismatch}
                describedBy="confirm-hint"
              />
              {mismatch && <p id="confirm-hint" className="mt-1 text-[11px] text-rose-300">Mật khẩu xác nhận chưa khớp.</p>}
            </div>
          )}
          <ErrorNote message={error} />
          <button type="submit" disabled={busy} className="h-10 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Đang xử lý…" : isLogin ? "Đăng nhập" : "Tạo tài khoản"}
          </button>
          {busy && <p className="text-center text-[11px] text-slate-500">Lần đầu có thể mất tới 1 phút vì máy chủ đang khởi động.</p>}
        </form>
        <Link href={isLogin ? "/register" : "/login"} className="mt-5 text-xs font-bold text-blue-400 hover:text-blue-300">
          {isLogin ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
        </Link>
      </div>
    </div>
    <SiteFooter />
    </div>
  )
}
