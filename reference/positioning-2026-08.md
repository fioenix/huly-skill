# Định vị `huly-skill` — ưu/nhược, đổi tên, và sức khoẻ của Huly

Ngày: 17/08/2026. Ba câu hỏi: (1) ta mạnh yếu gì so với `@firfi/huly-mcp`,
(2) có nên đổi tên thành `huly-mcp`, (3) Huly còn được phát triển không.
Chi tiết review đối thủ: [review-firfi-huly-mcp.md](./review-firfi-huly-mcp.md).

---

## 1. Ưu / nhược — hai bên

### Ta mạnh ở đâu (có số đo)

| Điểm mạnh | Bằng chứng |
|---|---|
| Bề mặt nhỏ, một người đọc hết | 4.565 LOC vs 89.614; 28 tool vs 522 |
| Chi phí context thấp ở native mode | `tools/list` 15.721 B ≈ 3.930 token (đo thật) |
| Bundle nhỏ hơn ~2,9x | npm unpacked 2,9 MB vs 8,4 MB |
| SDK khớp version server | `api-client@0.7.423` ↔ server `0.7.423`; họ pin `0.7.19` + patch tự bảo trì |
| Markup/collab miễn phí từ SDK | WS `PlatformClient` có `MarkupOperations`; họ phải tự dựng ([ADR-0001](./adr-0001-websocket-transport.md)) |
| Hiểu đường SSO/2FA của Huly | [huly-auth.md](./huly-auth.md); README của họ không đề cập SSO |
| CLI + agent skill + tiếng Việt | `bin/huly.cjs`, `skills/huly-skill/SKILL.md` — họ là MCP-first |

### Ta yếu ở đâu

| Điểm yếu | Bằng chứng | Mức độ |
|---|---|---|
| Không test, không CI | 0 file test, 0 workflow vs 1.232 test + quality gate | **cao** |
| MCP HTTP giữ một credential dùng chung | họ có `x-huly-url`/`x-huly-workspace`/`x-huly-token` theo request | **cao** |
| Không ai dùng | 39 lượt tải npm/tháng vs 4.892; 0 star vs 46 | trung bình |
| Không có kênh phân phối | họ có Docker, Smithery, Glama, MCP registry, site riêng | trung bình |
| Chẩn đoán yếu | `huly_whoami` phải connect mới nói được gì; họ có `get_huly_context` không cần kết nối | trung bình |
| Độ phủ domain hẹp | thiếu drive, boards, mail, calendar, recruiting, inventory… | thấp (chưa cần) |
| Bootstrap nặng | `fake-indexeddb`, polyfill `window`, redirect `console.log` | thấp (giá của ADR-0001) |

### Họ mạnh / yếu

Mạnh: độ phủ 522 tool, 1.232 test + CI, multi-tenant qua header, `proxy` tool mode
để tránh nổ context, harness certification không in secret, phân phối rộng, 4.892
lượt tải/tháng.

Yếu: 89.600 LOC + Effect-TS cho một wrapper (chi phí nhận thức lớn, dấu hiệu sinh
bằng agent loop — `RALPH.md`); bus factor = 1; SDK pin `0.7.19` lệch 400+ patch so
với server 0.7.423, phải tự bảo trì patch; không có hướng dẫn cho SSO/2FA; 522 tool
là 522 bề mặt có thể sai.

### Đọc thẳng

Trên trục **kỷ luật kỹ thuật và mức độ được dùng, ta thua rõ**. Trên trục **gọn,
đúng version, hiểu sâu auth, có CLI + skill tiếng Việt, ta thắng**. "Tinh gọn" là
lựa chọn scope chứ không phải phẩm chất tự thân: lean của ta thì *người dùng* trả
giá khi cần domain mới; lean của họ thì *agent* trả giá bằng context hoặc bằng vòng
discovery.

## 2. Có nên đổi tên thành `huly-mcp`? — **Không**

Lý do, theo thứ tự sức nặng:

1. **Đụng tên trực diện với dự án đã có trước 6 tuần và đang được dùng gấp 125 lần.**
   Repo họ tên `huly-mcp`, npm `@firfi/huly-mcp`, đã nằm trong MCP registry,
   Smithery, Glama. Ta vào sau, cùng tên → thua về discovery và dễ bị đọc là bắt chước.
2. **Ta đã có định danh MCP rồi.** npm package của ta là `@fioenix/huly-mcp` v1.6.1,
   binary `huly-mcp`. Người cài MCP không gõ tên repo. Đổi tên repo không giúp gì
   cho discovery, chỉ phá link cũ.
3. **"Skill" là phần khác biệt thật.** Ta là CLI + agent skill + MCP; họ là MCP-first.
   Bỏ chữ "skill" là tự xoá điểm khác biệt để lấy một cái tên đã có chủ.
4. **Chi phí đổi tên đến đúng lúc không nên chi.** Xem mục 3.

Nếu muốn nhấn MCP mà không đổi tên: sửa `description` của repo và headline README
thành dạng "Huly MCP server + CLI + agent skill", giữ nguyên tên `huly-skill`.

## 3. Huly còn được phát triển không? — Còn, nhưng đã tụt xuống chế độ bảo trì

Số đo từ `hcengineering/platform` (17/08/2026):

- **Commit/tuần, 52 tuần gần nhất** (cũ → mới): `44 55 63 70 77 89 105 150 85 63 69
  15 15 36 41 14 15 20 9 24 30 23 17 18 21 11 25 24 18 23 23 32 15 25 15 15 12 18 5
  11 3 4 1 5 8 21 11 6 5 5 1 1`. Tức là từ **100–150/tuần** một năm trước xuống
  **1–10/tuần** trong ~12 tuần gần nhất.
- Commit gần nhất: **11/08/2026**. Repo **không** archived; 27.4k star, 2.107 fork,
  846 issue mở.
- Người còn commit (từ 01/06/2026): Artyom Savchenko (14), Alexander Onnikov (5),
  Denis Bykhov (4) — core team vẫn ở đó, chỉ ít việc.
- **Hosted Huly (huly.app) đã đóng ~20/07/2026** vì "hosting is no longer being
  funded" (thông báo ngay đầu README platform). Self-hosted **không** ảnh hưởng →
  `work.yody.io` không bị gì.
- README nói platform đang đỡ nhiều sản phẩm, "including Huly and **TraceX**"
  (tracex.co) — năng lượng thương mại có vẻ đã dịch sang đó.
- Org phân tán ra nhiều repo nhỏ (hulypulse, hulykvs, huly.net, hulyrs, hulylake…),
  phần lớn push lần cuối từ 2025.

**Điểm chí tử với ta — npm đã ngừng publish:** `@hcengineering/core` (và cả bộ SDK)
bản cuối trên npm là **0.7.423 ngày 10/05/2026**. Trong khi đó tag `v0.7.426`
(03/07) và `v0.7.432` (16/07) **đã ra nhưng không được publish lên npm**. Ba tháng
không có bản npm mới.

### Hệ quả trực tiếp cho quyết định "Chọn 3"

Ở lượt trước ta chốt: chờ bản phát hành có PR #10624 (revocable API tokens) rồi
chuyển sang. Với dữ liệu này, **xác suất điều đó xảy ra trong vài tháng tới là
thấp**: PR #10624 nằm ở `develop`, chưa vào tag nào, và ngay cả tag đã có cũng
không lên npm nữa. Chờ vô thời hạn không phải kế hoạch.

Ba đường đi, kèm ai trả giá:

1. **Chọn 1 (mint token có `exp` bằng `SERVER_SECRET`)** — không phụ thuộc Huly
   phát hành gì. `jwt-simple` đã enforce `exp` ngay ở `decode()` nên hạn dùng có
   hiệu lực trên 0.7.423. Không có revocation, chỉ có hết hạn → bù bằng hạn ngắn
   (30 ngày). Giá: admin phải rotate; `SERVER_SECRET` phải xử như secret hạng nhất.
2. **Build self-host từ `develop`** để có revocable tokens sớm. Giá: chạy nhánh
   chưa release cho production, và tự gánh việc build image — với một platform
   đang bảo trì cầm chừng thì đây là rủi ro tăng dần.
3. **Chờ** — chỉ hợp lý nếu Huly publish npm trở lại. Cần một mốc kiểm tra, không
   phải chờ mở.

**Khuyến nghị: đi Chọn 1, và đặt lịch kiểm tra npm `@hcengineering/core` mỗi tháng.**
Nếu ba tháng nữa vẫn không có bản mới thì coi như SDK đóng băng ở 0.7.423 và ta
pin cứng, không kỳ vọng nâng.

### Ba việc nên làm vì Huly chậm lại, không phải bất chấp điều đó

1. **Pin cứng dependency + commit lockfile** (đã có `pnpm-lock.yaml`) và ghi rõ
   trong README rằng SDK dừng ở 0.7.423 — để sau này không ai debug mù.
2. **Test + CI**: khi upstream ít vá lỗi, hồi quy là việc của ta. Đây là khoảng
   cách lớn nhất so với họ, và giá trị của nó tăng đúng lúc upstream chậm lại.
3. **Credential theo request cho HTTP transport**: xoá rủi ro "một token dùng chung",
   không phụ thuộc phiên bản Huly nào.

Không đề xuất: đổi tên, đua số lượng tool, hay viết lại theo Effect-TS.
