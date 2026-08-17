# Review: `dearlordylord/huly-mcp` (npm `@firfi/huly-mcp`)

Ngày review: 17/08/2026. Đối tượng: repo public tại
https://github.com/dearlordylord/huly-mcp, commit cuối `2026-08-13`, version `0.49.5`.
Đối chiếu với `huly-skill` (repo này).

## 1. Ai có trước

| | `@firfi/huly-mcp` | `huly-skill` |
|---|---|---|
| Commit đầu tiên | **01/02/2026** (`ee347c3 init`) | 17/03/2026 (`6ae0ce0 chore: initial public-safe commit`) |
| Repo tạo trên GitHub | 02/02/2026 | 17/03/2026 |
| Commit cuối | 13/08/2026 | 17/08/2026 |
| Tổng commit | 1.119 | ~43 PR merge |

**Họ có trước ~6 tuần.** Lưu ý: commit đầu của ta ghi rõ "initial public-safe
commit" nên lịch sử private có thể sớm hơn 17/03, nhưng không có bằng chứng công
khai nào cho thấy sớm hơn 01/02/2026. Không có dấu hiệu vay mượn code theo cả hai
chiều: họ dùng Effect-TS + REST client + tool name không prefix (`create_issue`),
ta dùng TS thuần + WebSocket platform client + prefix `huly_` (`huly_create_task`).
Hai codebase độc lập, cùng license MIT.

## 2. Quy mô — không cùng hạng

| | `@firfi/huly-mcp` | `huly-skill` |
|---|---|---|
| LOC (src, trừ test) | ~89.600 | ~4.565 |
| Số MCP tool | **522** | 28 |
| Test case | 1.232 (289 file test) | 0 |
| CI | GitHub Actions (`check-all` quality gate) | không có |
| npm | `@firfi/huly-mcp` v0.49.5 | `@fioenix/huly-mcp` v1.6.1 |
| GitHub stars / forks | 46 / 20 | 0 |
| Phân phối | npm, Docker, Smithery, Glama, MCP registry, Cloudflare (wrangler), site riêng | npm |

Domain coverage của họ vượt xa: ngoài tracker/document/milestone như ta, còn có
boards, cards, drive, inventory, leads, recruiting, mail, calendar, planner,
processes, test-management, love (virtual office), notifications, custom fields,
generic associations, model administration.

## 3. Bốn điểm thiết kế đáng học

**a. Multi-tenant qua HTTP header.** Transport HTTP nhận credential theo từng
request: `x-huly-url`, `x-huly-workspace`, `x-huly-token`
(`src/config/huly-config-constants.ts:4`). Một server phục vụ nhiều workspace,
mỗi caller mang credential của mình. Đây chính là lời giải cho rủi ro #3 trong
[huly-auth.md](./huly-auth.md) của ta: bản MCP HTTP của ta giữ **một** credential
Huly trong process, ai qua được `HULY_MCP_AUTH_TOKEN` là có toàn quyền token đó.

**b. Tool exposure mode `auto | native | proxy`** (`src/mcp/tool-mode.ts`).
522 tool thì không client nào tải nổi, nên `proxy` mode chỉ expose meta-tool
(`list_tool_categories`, `search_tools`, …) và cho agent tra cứu rồi gọi. `auto`
giữ native cho `claude-code`, chuyển proxy cho Codex/Cursor/Windsurf/Copilot.
Thêm `TOOLSETS` / `TOOLS` để lọc. Ta 28 tool nên chưa cần, nhưng ngưỡng đau là
~50–80 tool — nếu mở rộng thì đây là pattern nên bắt chước.

**c. Tool `get_huly_context`** — trả runtime/config đã sanitize (version,
transport, auth mode, origin/host, workspace, config source) **mà không kết nối
Huly**, và không bao giờ trả token/password/email. `huly_whoami` của ta phải
connect mới nói được gì, nên khi credential sai thì chẩn đoán khó hơn.

**d. Harness certification cho token.** `scripts/api-token-certification.ts`
chạy hai pha *active* và *revoked* trên cả stdio và HTTP, rồi **quét output/diagnostics
trong memory để bảo đảm token không bị in ra**; phát hiện secret thì fail. Mức độ
kỷ luật này ta không có.

## 4. Điểm khác biệt kiến trúc — và ai trả giá

Họ dùng **REST client** (`sdk.createRestClient`, `src/huly/client.ts:678`) trên
`@hcengineering/api-client@0.7.19` **có patch** (`patches/@hcengineering__api-client@0.7.19.patch`
— sửa xử lý `lookupMap` trong `lib/rest/rest.js`). Ta dùng **WebSocket platform
client** (`connect()`) trên `api-client@0.7.423`.

| | REST (họ) | WebSocket (ta) |
|---|---|---|
| Khởi động | không bootstrap model, nhanh | tải model qua WS, chậm hơn |
| Môi trường | chạy được serverless / Cloudflare Workers | cần `fake-indexeddb` + polyfill `window` |
| Bề mặt API | mỏng hơn, thiếu TxOperations/collab markup đầy đủ | đầy đủ hierarchy, markup, collab doc |
| Nợ kỹ thuật | **SDK pin 0.7.19** trong khi server 0.7.423, phải tự patch | SDK khớp version server |
| Rác stdout | không có vấn đề | phải redirect `console.log` sang stderr (`src/bootstrap.ts`) |

Vì sao ta chọn WebSocket — và cái giá REST bắt họ trả (họ phải tự dựng lại lớp
markup bằng `@hcengineering/collaborator-client`, `createMarkupOps` tại
`src/huly/client.ts:635-691`) — xem [ADR-0001](./adr-0001-websocket-transport.md).

**Về latency thì không kết luận một chiều được**: REST là một HTTP round-trip cho
mỗi lời gọi (`RestClientImpl` fetch + `withRetry` mỗi request), còn WS trả tiền
một lần lúc handshake rồi multiplex. Workload của ta là chuỗi query nhỏ liên tiếp
(list tasks → comments từng task → resolve person), tức là kiểu mà WS thường
thắng sau lần gọi đầu. Đây là suy luận từ kiến trúc, chưa phải số đo.

## 5. Điểm yếu của họ

- **89.600 LOC + Effect-TS** cho một MCP wrapper là chi phí nhận thức rất lớn.
  Repo có `RALPH.md` / `START_RALPH.md` — dấu hiệu code sinh bằng agent loop tự
  động; số commit (1.119 trong 6 tháng) củng cố suy đoán đó. Hệ quả: nhiều tầng
  trừu tượng cho một domain không phức tạp tương ứng (65 file trong `src/mcp/tools`,
  ~30 file `errors-*.ts`).
- **Một maintainer, bus factor = 1**, và stack (Effect 4 RC, `oxlint`, `dprint`,
  `effect-tsgo`) khiến người ngoài khó đóng góp.
- **Không có hướng dẫn cho SSO / 2FA.** README chỉ có `HULY_EMAIL`+`HULY_PASSWORD`
  hoặc `HULY_TOKEN`; phần troubleshooting có mục "account locked after failed login
  attempts" (họ đã đụng `isAccountPasswordLocked`), nhưng không nói gì về việc
  workspace dùng Google SSO thì lấy token ở đâu. Đúng cái khoảng trống ta vừa
  nghiên cứu.
- **522 tool là con dao hai lưỡi**: kể cả proxy mode, agent vẫn phải tra cứu thêm
  một vòng, và mỗi tool là một bề mặt có thể sai.

## 6. Xác nhận độc lập cho nghiên cứu authentication của ta

`INTEGRATION_TESTING.md:251-253` viết: harness của họ chỉ chứng nhận flow
"legacy-token"; **personal API-token compatibility vẫn `uncertified` cho tới khi
issue #205–#208 chạy được trên một bản Huly Platform *đã phát hành* có chứa PR
#10624**. Trùng khớp kết luận mục 4 trong [huly-auth.md](./huly-auth.md): PR
#10624 (revocable API tokens) chưa vào tag nào. Một dự án khác, theo dõi độc lập,
cùng kết luận — tăng độ tin cậy cho quyết định "Chọn 3 nhưng chưa implement".

## 7. Đo lường: "tinh gọn hơn" đúng tới đâu

Số đo thật, không phải cảm nhận:

| Trục | `@firfi/huly-mcp` | `huly-skill` | Tỷ lệ |
|---|---|---|---|
| LOC (src, trừ test) | 89.614 | 4.565 | **19,6x** |
| Số tool | 522 | 28 | **18,6x** |
| npm unpacked | 8.407.717 B (8,4 MB) | 2.916.942 B (2,9 MB) | **2,9x** |
| `tools/list` (native) | ~300–600 KB ước tính → ~75k–150k token | **15.721 B → ~3.930 token** | ~20–40x |

Cách đo cột cuối: chạy `initialize` + `tools/list` qua stdio vào `bin/mcp.cjs` →
28 tool, payload 15.721 byte. Bên họ không chạy (không đưa credential cho binary
của bên thứ ba), nên ước tính từ bảng tool trong README — vốn được sinh tự động từ
tool definition: **526 dòng, 121.390 byte chỉ riêng tên + description** (mean 203,
max 1.301 ký tự/description), chưa tính JSON input schema. Đây chính là lý do họ
phải làm proxy mode.

**Nhưng lợi thế context này bốc hơi khi họ bật proxy mode**: lúc đó họ chỉ expose
4 meta-tool (`list_tool_categories`, `search_tools`, `get_tool_schema`,
`invoke_tool`), nhẹ hơn cả 28 tool của ta, đổi lại một vòng discovery mỗi lần gọi.
Và `auto` mode bật proxy sẵn cho Codex/Cursor/Windsurf/Copilot.

**Chưa đo được**: latency khởi động và RAM. Về nguyên tắc kiến trúc REST của họ
khởi động nhẹ hơn ta — không bootstrap model qua WebSocket, không cần
`fake-indexeddb`, không polyfill `window`, không phải redirect `console.log` sang
stderr như `src/bootstrap.ts`. Muốn có số thật thì phải chạy binary của họ với
credential Huly của mình; đó là quyết định của bạn, không phải của tôi.

## 8. Kết luận

Họ ra trước ta 6 tuần và đi rất xa hơn về độ phủ, kỷ luật test và kênh phân phối.
Chỗ ta còn giữ được giá trị riêng: bề mặt nhỏ đủ để một người đọc hết, CLI +
agent skill tiếng Việt, SDK khớp version server, và (sau nghiên cứu vừa rồi) hiểu
biết về đường SSO/2FA mà họ chưa document.

Ba việc đáng làm, xếp theo tỷ lệ giá trị/chi phí:

1. **Credential theo request cho transport HTTP** (`x-huly-*` header) — xóa hẳn
   rủi ro "server giữ một token dùng chung".
2. **Một tool chẩn đoán không cần kết nối**, kiểu `get_huly_context`.
3. **Thêm test + CI**. Hiện ta 0 test, 0 workflow; họ 1.232 test và một quality
   gate. Đây là khoảng cách lớn nhất về mặt kỹ thuật, không phải số lượng tool.

Không đề xuất đua theo 522 tool: đó là hướng đi của họ, không phải của ta.
