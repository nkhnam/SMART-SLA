"use client"

import { useCallback, useEffect, useState } from "react"
import AppShell from "@/components/ui/app-shell"
import AccountPanel from "@/components/settings/account-panel"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import type { SessionUser } from "@/lib/types"
import { Badge, Btn, ErrorNote, Field, Panel, inputCls } from "@/components/sla/ui"

const ROLES = [
  { value: "ADMIN", label: "Quản trị" },
  { value: "OPERATIONS", label: "Vận hành" },
  { value: "LEGAL", label: "Pháp chế" },
  { value: "PM", label: "Quản lý dự án" },
] as const
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r

export default function SettingsPage() {
  const { user } = useSession()
  const [members, setMembers] = useState<SessionUser[]>([])
  const [form, setForm] = useState({ fullName: "", jobTitle: "", email: "", password: "", role: "OPERATIONS" })
  const [profile, setProfile] = useState({ serviceType: "", description: "", website: "" })
  const [msg, setMsg] = useState<{ members?: string; profile?: string }>({})
  const [error, setError] = useState<{ members?: string; profile?: string }>({})
  const [busy, setBusy] = useState<string | null>(null)

  const loadMembers = useCallback(() => {
    api<SessionUser[]>("/api/auth/members").then(setMembers).catch((e) => setError((x) => ({ ...x, members: e.message })))
  }, [])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  const addMember = async () => {
    setBusy("member")
    setError({})
    setMsg({})
    try {
      await api("/api/auth/members", { method: "POST", body: form })
      setForm({ fullName: "", jobTitle: "", email: "", password: "", role: "OPERATIONS" })
      setMsg({ members: "Đã thêm thành viên." })
      loadMembers()
    } catch (e) {
      setError({ members: e instanceof Error ? e.message : "Không thêm được thành viên" })
    } finally {
      setBusy(null)
    }
  }

  const saveProfile = async () => {
    setBusy("profile")
    setError({})
    setMsg({})
    try {
      const body = Object.fromEntries(Object.entries(profile).filter(([, v]) => v.trim() !== ""))
      await api("/api/marketplace/profile", { method: "PUT", body })
      setMsg({ profile: "Đã cập nhật hồ sơ Marketplace." })
    } catch (e) {
      setError({ profile: e instanceof Error ? e.message : "Không lưu được hồ sơ" })
    } finally {
      setBusy(null)
    }
  }

  if (!user) return <AppShell>{null}</AppShell>
  const isAdmin = user.role === "ADMIN"

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Tài khoản & cài đặt</h1>

        <AccountPanel key={`${user.id}-${user.fullName}-${user.jobTitle ?? ""}`} user={user} />

        <Panel title="Thành viên doanh nghiệp">
          <ul className="divide-y divide-slate-800">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div><p className="font-semibold text-white">{m.fullName}{m.jobTitle && <span className="ml-2 text-xs font-normal text-slate-400">{m.jobTitle}</span>}</p><p className="text-xs text-slate-400">{m.email}</p></div>
                <Badge tone={m.role === "ADMIN" ? "blue" : "slate"}>{roleLabel(m.role)}</Badge>
              </li>
            ))}
          </ul>
          {isAdmin ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Field label="Họ tên"><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={inputCls} /></Field>
              <Field label="Chức vụ (tuỳ chọn)"><input value={form.jobTitle} maxLength={100} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="VD: Trưởng phòng pháp chế" className={inputCls} /></Field>
              <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} /></Field>
              <Field label="Mật khẩu ban đầu" hint="Tối thiểu 8 ký tự. Gửi riêng cho thành viên"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} /></Field>
              <Field label="Vai trò">
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              <div className="sm:col-span-2 flex items-center gap-3">
                <Btn onClick={addMember} loading={busy === "member"}>Thêm thành viên</Btn>
                {msg.members && <span className="text-xs text-emerald-300">{msg.members}</span>}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-400">Chỉ quản trị viên doanh nghiệp mới thêm được thành viên.</p>
          )}
          <div className="mt-3"><ErrorNote message={error.members} /></div>
        </Panel>

        {user.organization.orgType === "SUPPLIER" && (
          <Panel title="Hồ sơ trên Marketplace">
            <p className="mb-4 text-xs text-slate-400">Chỉ phần giới thiệu. Điểm uy tín do hệ thống tính từ dữ liệu đo thật.</p>
            <div className="grid gap-3">
              <Field label="Loại dịch vụ"><input value={profile.serviceType} onChange={(e) => setProfile({ ...profile, serviceType: e.target.value })} placeholder="VD: Cloud Hosting" className={inputCls} /></Field>
              <Field label="Giới thiệu"><textarea rows={4} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} className={`${inputCls} h-auto py-2`} /></Field>
              <Field label="Website"><input type="url" value={profile.website} onChange={(e) => setProfile({ ...profile, website: e.target.value })} placeholder="https://" className={inputCls} /></Field>
              <div className="flex items-center gap-3">
                <Btn onClick={saveProfile} loading={busy === "profile"}>Lưu hồ sơ</Btn>
                {msg.profile && <span className="text-xs text-emerald-300">{msg.profile}</span>}
              </div>
            </div>
            <div className="mt-3"><ErrorNote message={error.profile} /></div>
          </Panel>
        )}
      </main>
    </AppShell>
  )
}
