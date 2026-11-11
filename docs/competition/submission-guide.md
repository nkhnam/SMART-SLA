# Hướng dẫn hoàn thiện và nộp SLA-DEX tại UniHack

Đối chiếu ngày **11/11/2026**, giờ Việt Nam (UTC+7). Tài liệu này giúp chuẩn bị bài dự thi; không khẳng định dự án đã triển khai Fuji, đã được kiểm toán hay chắc chắn đạt giải.

## Thể lệ và mốc cần giữ

Nguồn chính là [FAQ của Team1 Vietnam](https://team1vn.xyz/#faq-submit), trang ban tổ chức mà người dùng cung cấp. Nội dung hiện đọc được quy định:

- Hạn nộp: **23:59 ngày 21/11/2026, giờ Việt Nam**.
- Đăng nhập trên `team1vn.xyz`, mở trang hồ sơ và điền **Submit Project**. Lưu nháp chưa tính là đã nộp; cần bấm **Submit**.
- Tham gia cá nhân hoặc theo đội tối đa **3 người**. Một thành viên có thể nộp thay đội. Mỗi đội được nộp tối đa 5 dự án, mỗi dự án có repo, slides và video riêng.
- Repo GitHub phải công khai; nếu để riêng tư, thêm tài khoản **`tuantqse90`** làm collaborator.
- Chuẩn bị link pitch slides trên **Canva hoặc Google Slides**, **video demo dài 2–3 phút**, và tài liệu hỗ trợ nếu có.
- Mọi link phải mở được cho giám khảo. FAQ cảnh báo đội có thể bị loại nếu giám khảo không truy cập được tài liệu.
- Dự án có thể chạy trên Avalanche L1 tự tạo, Fuji testnet hoặc C-Chain mainnet. Các chủ đề được gợi ý không bắt buộc.
- Dự án đang làm sẵn, bài tập, side project hoặc ý tưởng startup được chấp nhận, kể cả ứng dụng web2 nếu có một thành phần thực sự trên Avalanche. Phần này được chấm ở mục Avalanche Integration.
- Top 10 vào chung kết trực tiếp: **09:00–11:30 ngày 30/11/2026**, Greenwich Vietnam, 20 Cộng Hòa, TP.HCM, hội trường tầng 3 tòa nhà Cộng Hòa Garden, theo FAQ hiện tại.

**Có xung đột nguồn:** [trang sự kiện trên Avalanche Builder Hub](https://build.avax.network/events/596c0b2d-63aa-4cf0-a0ad-a7e34ddbfdc0) hiện ghi hạn 05:59 ngày 25/11/2026 theo Asia/Bangkok, hướng dẫn nộp qua Builder Hub và địa điểm chung kết khác. Vì vậy, lấy **21/11 lúc 23:59** làm hạn làm việc bảo thủ và kiểm tra lại FAQ trước khi nộp. Có thể hỏi ban tổ chức trong [nhóm Builders](https://t.me/Team1VNbuilders) để xác nhận khác biệt; tài liệu này không thay mặt đội liên hệ hoặc nộp bài.

FAQ liệt kê AI trong các kỹ năng có thể đóng góp, nhưng nội dung đã đọc không có chính sách chi tiết về mã do AI tạo. Không suy diễn thành một quy định cho phép hoặc cấm mọi hình thức sử dụng AI.

## Tiêu chí chấm điểm

Theo [FAQ chính thức](https://team1vn.xyz/#faq-submit):

| Tiêu chí | Điểm | Bằng chứng phù hợp cho SLA-DEX |
| --- | ---: | --- |
| Technical Implementation | 25 | Luồng chạy được; kiểm thử có thể tái lập; phân quyền, chữ ký, xử lý lỗi và khôi phục giao dịch |
| Avalanche Integration | 25 | Hợp đồng, mạng/chain ID, địa chỉ và giao dịch có thể kiểm tra độc lập; giải thích vì sao cần cam kết trên chuỗi |
| Creativity & Innovation | 15 | Điểm khác biệt cụ thể của thỏa thuận hai bên và gói bằng chứng kiểm chứng độc lập |
| Impact & Use Case | 15 | Người dùng mục tiêu, vấn đề thực tế và cách sản phẩm giải quyết; chỉ dùng dữ liệu xác thực |
| Presentation & Pitching | 10 | Câu chuyện rõ, giới hạn trung thực, demo đúng thời lượng và trả lời được câu hỏi |
| UI/UX & Demo | 10 | Luồng thao tác dễ hiểu, trạng thái chờ/lỗi rõ ràng, phân biệt dữ liệu mẫu với dữ liệu live |

Cột bằng chứng là đề xuất chuẩn bị, không phải tiêu chí phụ do ban tổ chức công bố. Không có cơ sở để hứa số điểm hay thứ hạng.

## Phạm vi thực tế của dự án

Theo [README](../../README.md), [kiến trúc Phase 2B](../arch/phase2b-avalanche.md) và [kiến trúc Phase 2C](../arch/phase2c-monitoring.md), SLA-DEX gồm:

- Demo Mode dùng fixture và Live Workspace dùng API thật, xác thực và dữ liệu PostgreSQL theo tổ chức.
- Lời mời giữa các bên, xác nhận quyền sở hữu ví, chữ ký EIP-712 hai bên cho snapshot thỏa thuận bất biến và quy trình đăng ký qua relayer.
- Nguồn giám sát gắn đúng phiên bản SLA đã ký và xác nhận; HTTP probes có kiểm soát SSRF, webhook có chữ ký, KPI xác định được và trạng thái thiếu dữ liệu rõ ràng.
- Gói bằng chứng Merkle có thể xuất và kiểm chứng độc lập; EvidenceRegistry có publisher riêng và cơ chế phục hồi giao dịch.

**Giới hạn cần nói rõ:** cam kết trên chuỗi chứng minh tính toàn vẹn so với dữ liệu đã cam kết, không chứng minh mọi phép đo phản ánh đúng thế giới thực. Breach candidate là tín hiệu cần xem xét, không phải phán quyết. Tranh chấp, trọng tài, escrow, thanh toán và bồi thường tự động chưa nằm trong phạm vi triển khai. Dữ liệu outage trong acceptance test là đầu vào tổng hợp có kiểm soát.

README ở thời điểm đối chiếu ghi rằng **chưa triển khai Fuji**. Local EVM và các kiểm thử tổng hợp không tương đương một triển khai Avalanche công khai. Chỉ bổ sung tuyên bố triển khai sau khi có địa chỉ hợp đồng, chain ID, giao dịch và kết quả đọc lại được xác minh. Làm theo [runbook Fuji](../deployment/fuji.md) và giữ nguyên các điều kiện phê duyệt triển khai; tài liệu này không thực hiện giao dịch.

## Kịch bản video demo 2–3 phút

Mục tiêu khoảng **2 phút 45 giây**. Quay luồng đã chạy và kiểm chứng trên môi trường thực tế đang dùng. Hiển thị mạng, nguồn dữ liệu và các đoạn tua nhanh; không ghép dữ liệu mẫu thành bằng chứng live.

| Thời gian | Nội dung trên màn hình và lời trình bày |
| --- | --- |
| 0:00–0:20 | Nêu một tình huống SLA giữa nhà cung cấp và khách hàng: cần thống nhất điều khoản và kiểm tra bằng chứng khi có bất đồng. Giới thiệu SLA-DEX là công cụ cam kết thỏa thuận và kiểm chứng tính toàn vẹn của bằng chứng. |
| 0:20–0:55 | Mở Live Workspace, chỉ rõ hai tổ chức tham gia và snapshot SLA. Cho thấy trạng thái chấp nhận và chữ ký hai bên. Nếu tua nhanh bước đăng nhập/ký, ghi nhãn rõ. Không để lộ khóa hoặc secret. |
| 0:55–1:20 | Hiển thị đăng ký thỏa thuận và đọc lại kết quả. Nếu chạy local EVM, ghi rõ **local EVM**. Chỉ mở explorer Fuji nếu đã có triển khai thật và đã kiểm tra đường dẫn. |
| 1:20–1:55 | Mở nguồn giám sát, provenance và KPI. Chỉ ra coverage, thiếu dữ liệu và breach candidate. Với kịch bản acceptance, ghi **synthetic/provider-reported test data**; không mô tả là sự cố ngoài đời. |
| 1:55–2:25 | Xuất gói bằng chứng, chạy verifier độc lập, rồi kiểm tra một bản sao đã sửa để cho thấy tamper rejection. Giữ nguyên gói gốc. Hiển thị commitment có thể đọc lại nếu môi trường hỗ trợ. |
| 2:25–2:45 | Chốt giá trị cho người dùng mục tiêu và giới hạn: bảo vệ tính toàn vẹn, chưa phân xử hay tự động chi trả. Nêu một bước tiếp theo thực tế, phân biệt rõ với chức năng đã có. |

Nếu luồng ký, anchoring hoặc xuất bằng chứng chưa chạy được trên môi trường quay, sửa và kiểm tra trước. Không thay một bước thất bại bằng fixture rồi trình bày là live. Có thể dùng [full-stack acceptance](../ref/phase2c-acceptance.md) làm cơ sở tái lập, với nhãn dữ liệu tổng hợp và giới hạn tương ứng.

## Checklist trước khi nộp

### Repository và bằng chứng kỹ thuật

- [ ] Repo công khai hoặc đã cấp quyền cho `tuantqse90`; thử mở bằng phiên không có quyền của chủ repo.
- [ ] Ghi đúng branch/commit dùng để quay demo và chạy kiểm thử.
- [ ] README có lệnh cài đặt, biến môi trường mẫu, cách chạy demo/live và các yêu cầu PostgreSQL/EVM.
- [ ] Chỉ ghi những kiểm tra đã thực sự chạy; lưu lệnh, kết quả và giới hạn môi trường. Không gọi kết quả local là kết quả hosted CI.
- [ ] Không có private key, token, cookie phiên, webhook secret hoặc dữ liệu cá nhân trong repo, video và ảnh chụp.
- [ ] Nếu có triển khai Avalanche công khai: ghi chain ID, địa chỉ hợp đồng, transaction hash và đường dẫn kiểm tra đã xác minh. Nếu chưa có, ghi rõ.

### Slides và video

- [ ] Slides có vấn đề/người dùng, giải pháp, demo, vai trò của Avalanche, kiến trúc và trust boundaries, bằng chứng kiểm thử, giới hạn và hướng tiếp theo.
- [ ] Số liệu người dùng, chi phí, doanh thu hoặc phỏng vấn đều có nguồn; bỏ mọi tuyên bố chưa có bằng chứng.
- [ ] Link Canva/Google Slides cho phép giám khảo xem mà không cần xin quyền.
- [ ] Video dài 2–3 phút, đọc được chữ, nghe rõ lời, có nhãn dữ liệu mẫu/tổng hợp và mạng sử dụng.
- [ ] Link video mở được từ cửa sổ riêng tư; mọi tài liệu hỗ trợ cũng đã kiểm tra quyền xem.
- [ ] Demo không tuyên bố có escrow, payout, trọng tài hoặc tính đúng của phép đo nếu chưa triển khai/chứng minh được.

### Nộp và chuẩn bị bảo vệ

- [ ] Kiểm tra lại [FAQ](https://team1vn.xyz/#faq-submit), đặc biệt hạn nộp và nơi nộp vì đang có xung đột nguồn.
- [ ] Hoàn thành trước hạn làm việc **23:59 ngày 21/11/2026**; không trông chờ mốc muộn hơn trên Builder Hub.
- [ ] Đúng tên đội, thành viên, repo, slides và video cho dự án.
- [ ] Bấm **Submit** và kiểm tra trạng thái đã nộp; giữ xác nhận nếu giao diện cung cấp.
- [ ] Chuẩn bị trả lời: vì sao cần Avalanche, ai có thể gửi phép đo, mất dữ liệu được xử lý thế nào, hash chứng minh điều gì, và chức năng nào còn chưa có.
- [ ] Nếu vào Top 10, kiểm tra lại địa điểm/thời gian chung kết và chuẩn bị demo có thể tái lập cùng video dự phòng được gắn nhãn trung thực.
