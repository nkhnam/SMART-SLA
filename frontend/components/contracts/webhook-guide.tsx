// Giải thích webhook cho cả hai bên: SMART-SLA tạo địa chỉ nhận dữ liệu, công cụ giám sát của mỗi bên tự gửi sự kiện sang.

const Code = ({ children }: { children: string }) => <code className="rounded bg-slate-800/60 px-1 py-0.5 font-mono text-[11px] text-slate-200">{children}</code>

// Webhook là gì, ai làm gì
export function WebhookIntro() {
  return (
    <div className="space-y-2 text-xs leading-5 text-slate-400">
      <p>
        <strong className="text-slate-200">Webhook là địa chỉ nhận dữ liệu do SMART-SLA tạo cho từng bên</strong> (bên mua: webhook client, nhà cung cấp: webhook provider).
        Bạn không cần nhập gì: chỉ cần sao chép địa chỉ này và dán vào công cụ giám sát bạn đang dùng (UptimeRobot, Datadog, CloudWatch, Jira, Zendesk…).
        Từ đó, mỗi khi dịch vụ sập / hồi phục hoặc có ticket mới, công cụ <strong className="text-slate-200">tự gửi sự kiện sang SMART-SLA</strong>.
      </p>
      <p>
        Địa chỉ có gắn <strong className="text-slate-200">mã bí mật</strong> để SMART-SLA biết sự kiện đến đúng từ bên bạn, nên chỉ hiện <strong className="text-slate-200">một lần</strong> lúc tạo.
        Lỡ mất thì bấm tạo lại (địa chỉ cũ hết hiệu lực). Bạn không phải đưa API key hay mật khẩu công cụ của mình cho SMART-SLA.
      </p>
      <p>
        Với KPI chọn nguồn Webhook, kết quả tính theo <strong className="text-slate-200">webhook client trước, rồi webhook provider</strong>.
        SMART-SLA vẫn tự đo song song (HTTP, chat hỗ trợ) để đối chiếu: số liệu webhook lệch so với SMART-SLA sẽ được đánh dấu cho admin xem xét.
      </p>
    </div>
  )
}

// Cách dán địa chỉ vào công cụ + nội dung cần gửi
export function WebhookSetupSteps() {
  return (
    <div className="space-y-2 text-xs leading-5">
      <p className="font-semibold">Cách dùng địa chỉ này:</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Bấm <strong>Sao chép</strong> và lưu lại ở nơi an toàn.</li>
        <li>
          Mở công cụ giám sát của bạn, thêm 1 kênh cảnh báo kiểu <strong>Webhook</strong> và dán địa chỉ vào ô URL.
          VD UptimeRobot: <em>Integrations (Alert Contacts) → Add → Webhook</em>, tick <em>Send as JSON</em>, rồi gắn kênh này cho monitor của dịch vụ.
        </li>
        <li>
          Nội dung công cụ gửi sang (SMART-SLA tự hiểu định dạng của UptimeRobot, Datadog, CloudWatch, Grafana):
          <ul className="mt-1 space-y-1 pl-1">
            <li>• Dịch vụ sập / hồi phục: <Code>{`{"status":"DOWN"}`}</Code> / <Code>{`{"status":"UP"}`}</Code></li>
            <li>• Thời gian phản hồi: <Code>{`{"responseTimeMs":230}`}</Code></li>
            <li>• Ticket (Jira, Zendesk Automation): <Code>{`{"event":"TICKET_CREATED","ticketId":"SUP-12"}`}</Code>, sau đó <Code>TICKET_RESPONDED</Code> và <Code>TICKET_RESOLVED</Code> với cùng ticketId</li>
          </ul>
        </li>
      </ol>
    </div>
  )
}
