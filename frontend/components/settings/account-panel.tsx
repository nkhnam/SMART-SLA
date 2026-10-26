"use client"

import { useState } from "react"
import { PencilLine } from "lucide-react"
import { api } from "@/lib/api"
import { getSession, setSession } from "@/lib/session"
import type { SessionUser } from "@/lib/types"
import { Badge, Btn, ErrorNote, Field, Panel, inputCls } from "@/components/sla/ui"

const ROLE_LABEL: Record<string, string> = { ADMIN: "Quản trị", OPERATIONS: "Vận hành", LEGAL: "Pháp chế", PM: "Quản lý dự án" }

// Thông tin tài khoản: xem + tự sửa họ tên, chức vụ, đổi mật khẩu
export default function AccountPanel({ user }: { user: SessionUser }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ fullName: user.fullName, jobTitle: user.jobTitle ?? "" })
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" })
  const [busy, setBusy] = useState<"profile" | "password" | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Cập nhật phiên đăng nhập để thanh trên cùng hiện tên / chức vụ mới ngay
  const syncSession = (u: SessionUser) => {
    const s = getSession()
    if (s) setSession({ ...s, user: { ...s.user, ...u } })
  }

  const saveProfile = async () => {
    setError(null)
    setMsg(null)
    if (!form.fullName.trim()) return setError("Họ tên không được để trống.")
    setBusy("profile")
    try {
      const u = await api<SessionUser>("/api/auth/me", { method: "PUT", body: { fullName: form.fullName.trim(), jobTitle: form.jobTitle.trim() } })
      syncSession(u)
      setEditing(false)
      setMsg("Đã cập nhật thông tin tài khoản.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được thông tin")
    } finally {
      setBusy(null)
    }
  }

  const changePassword = async () => {
    setError(null)
    setMsg(null)
    if (pw.next.length < 8) return setError("Mật khẩu mới tối thiểu 8 ký tự.")
    if (pw.next !== pw.confirm) return setError("Mật khẩu xác nhận không khớp.")
    setBusy("password")
    try {
      await api("/api/auth/me", { method: "PUT", body: { currentPassword: pw.current, newPassword: pw.next } })
      setPw({ current: "", next: "", confirm: "" })
      setMsg("Đã đổi mật khẩu.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được mật khẩu")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div id="tai-khoan" className="scroll-mt-28">
      <Panel
        title="Thông tin tài khoản"
        action={!editing && (
          <Btn variant="ghost" onClick={() => { setForm({ fullName: user.fullName, jobTitle: user.jobTitle ?? "" }); setEditing(true); setMsg(null) }}>
            <PencilLine className="h-4 w-4" />Sửa thông tin
          </Btn>
        )}
      >
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Họ tên"><input value={form.fullName} maxLength={100} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={inputCls} /></Field>
            <Field label="Chức vụ" hint="Hiển thị trong phần thông tin bên ký và báo cáo đối soát">
              <input value={form.jobTitle} maxLength={100} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="VD: Giám đốc điều hành" className={inputCls} />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Btn onClick={saveProfile} loading={busy === "profile"}>Lưu</Btn>
              <Btn variant="ghost" onClick={() => setEditing(false)}>Huỷ</Btn>
            </div>
          </div>
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Họ tên</dt><dd className="text-white">{user.fullName}</dd></div>
            <div><dt className="text-xs text-slate-500">Chức vụ</dt><dd className="text-white">{user.jobTitle || <span className="text-slate-500">Chưa cập nhật</span>}</dd></div>
            <div><dt className="text-xs text-slate-500">Email</dt><dd className="text-white">{user.email}</dd></div>
            <div><dt className="text-xs text-slate-500">Doanh nghiệp</dt><dd className="text-white">{user.organization.name}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Loại tài khoản · Vai trò</dt><dd className="text-white">{user.organization.orgType === "SUPPLIER" ? "Nhà cung cấp" : "Bên mua"} · {ROLE_LABEL[user.role] ?? user.role} {user.platformAdmin && <Badge tone="violet">Admin nền tảng</Badge>}</dd></div>
          </dl>
        )}

        <div className="mt-6 border-t border-slate-800 pt-5">
          <p className="mb-3 text-sm font-semibold text-white">Đổi mật khẩu</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Mật khẩu hiện tại"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className={inputCls} /></Field>
            <Field label="Mật khẩu mới"><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="Tối thiểu 8 ký tự" className={inputCls} /></Field>
            <Field label="Nhập lại mật khẩu mới"><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="mt-3"><Btn variant="ghost" onClick={changePassword} loading={busy === "password"} disabled={!pw.current || !pw.next}>Đổi mật khẩu</Btn></div>
        </div>

        {msg && <p className="mt-4 text-sm text-emerald-300" role="status">{msg}</p>}
        <div className="mt-3"><ErrorNote message={error} /></div>
      </Panel>
    </div>
  )
}
