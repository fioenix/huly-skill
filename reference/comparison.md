# `huly-skill` vs `@firfi/huly-mcp` — bảng so sánh tổng hợp

Ngày: 18/08/2026. Ta ở `v1.7.0`; họ ở `0.49.5` (commit cuối 13/08/2026).
Số liệu đo trực tiếp; phần của họ lấy từ source đã đọc và tài liệu của chính họ,
**không chạy binary của họ**. Quy đổi token dùng tỉ lệ 2,56 ký tự/token mà họ đã đo
bằng tokenizer của Claude.

Nền tảng: [review chi tiết](./review-firfi-huly-mcp.md) ·
[phân tích chi phí token](./token-cost-analysis.md) ·
[ADR transport](./adr-0001-websocket-transport.md)

---

## Bảng so sánh

| # | Tiêu chí | `huly-skill` (ta) | `@firfi/huly-mcp` (họ) | Ai tốt hơn |
|---|---|---|---|---|
| 1 | Số tool / độ phủ domain | 31 tool: tracker, document, milestone, label, comment, activity | 522 tool: thêm drive, boards, cards, mail, calendar, recruiting, inventory, planner, processes, test-management, love | **Họ** |
| 2 | Chi phí context, chế độ đầy đủ | `tools/list` 19.589 B ≈ **7.650 token** | native ~435 KB ≈ **170.000 token** (họ tự đo) | **Ta** (22x) |
| 3 | Chi phí context, chế độ tối giản | không có chế độ nào nhỏ hơn 7.650 token | `proxy`: 4 meta-tool ≈ **500 token** | **Họ** (14x) |
| 4 | Kỷ luật output mỗi lời gọi | cap 50 + projection dùng chung; `count`/`total`/`truncated`; `fields:"all"` để mở | `DEFAULT_LIMIT` 50, `MAX_LIMIT` 200, `resultSchema` gõ kiểu riêng từng tool | **Họ** nhích — output có schema, ta chỉ có field list |
| 5 | Đường "dữ liệu không vào context" | CLI + skill dạy `--limit/--fields` → `jq` → file; đo được 125x | có `@firfi/huly-cli@0.48.2`, skill hướng "dùng `--help` làm nguồn sự thật" | **Ngang** — cả hai có CLI; khác nhau ở cách dạy agent |
| 6 | Chi phí bản thân skill | `SKILL.md` 3.9 KB + `references/` 15 KB nạp theo nhu cầu | `SKILL.md` 2.1 KB + `references/automation.md` 1.3 KB | **Họ** — nhỏ hơn, nhưng ta nói rõ thứ tự đường đi rẻ nhất |
| 7 | Hợp đồng lỗi cho máy đọc | `{status, error, code, retryable}` + `hint` cho lỗi auth; 5 code; message người đọc giữ nguyên tiếng Việt | failure document `{code, message, retryable, hint, details}` + exit status theo lớp lỗi | **Ngang** (từ 18/08/2026) — cả hai đều có code, retryable và exit status theo lớp lỗi |
| 8 | Quản lý credential | `.env` + biến môi trường; header `x-huly-*` theo request; `HULY_REQUIRE_CALLER_TOKEN` fail-closed | `huly auth login` + `huly profile create/select` (token trong OS config dir); `HULY_EMAIL/PASSWORD` hoặc `HULY_TOKEN`; header `x-huly-*` | **Họ** về UX; **ta** về fail-closed và về việc dùng được với SSO+2FA |
| 9 | Hiểu biết auth của Huly | tài liệu hoá đường SSO/OIDC, 2FA không gate SSO, UUID-vs-slug, PR #10624 chưa phát hành | README chỉ có email/password hoặc token; không đề cập SSO | **Ta** |
| 10 | Chẩn đoán không cần kết nối | `huly_context` (465 B) + `whoami --offline`, có `warnings[]` chỉ đúng nguyên nhân | `get_huly_context` — context đã sanitize, không có phần cảnh báo cấu hình | **Ta** nhích |
| 11 | Test | 39 unit test (`node --test` + `tsx`, 0 dependency mới) + 1 smoke test opt-in trên workspace thật | 1.232 test + 800+ lời gọi integration trên workspace thật, harness certify token | **Họ**, cách biệt |
| 12 | Quality gate | CI: typecheck, test, chặn bundle lệch source | oxlint, dprint, jscpd, dpdm (circular), complexity gate, `effect-tsgo`, coverage | **Họ** |
| 13 | Version SDK so với server | `api-client@0.7.423` = server 0.7.423 | pin `0.7.19` + patch tự bảo trì (lệch 400+ patch) | **Ta** |
| 14 | Markup / collaborative doc | `MarkupOperations` có sẵn từ WS `PlatformClient` | tự dựng lại: thêm `collaborator-client`, `createMarkupOps`, 3 file markup | **Ta** — cùng khả năng, ít nợ hơn |
| 15 | Tầm với môi trường chạy | WS: cần Node (fake-indexeddb, polyfill `window`) | REST: chạy được serverless / Cloudflare Workers | **Họ** |
| 16 | Comment | một tool generic theo `_id` + class: issue, **milestone**, document, component; đọc + sửa + xoá, chạy được cả trên thread reply | `list_comments` chỉ issue, nhưng có update/delete, inline comment trong document, biến thể theo domain | **Ta** (từ 18/08/2026) — cùng CRUD, ta phủ nhiều loại object hơn; họ còn hơn ở inline comment trong document |
| 17 | Phân phối / mức được dùng | npm 39 lượt tải/tháng, 0 star | npm 4.892 lượt tải/tháng, 46 star, Docker, Smithery, Glama, MCP registry, site riêng | **Họ**, cách biệt |
| 18 | Tự động hoá release | `pnpm verify:release` (3 manifest + version binary tự khai + hash bundle + stdout sạch; `--packed` cho tarball), CI chặn bundle lệch | `verify-version`, `certify-packed-artifact`, `local_release.sh`, publish-registry workflow | **Ngang** (từ 18/08/2026) — họ tự động hoá cả bước publish, ta vẫn thủ công |
| 19 | Đọc hiểu codebase / bus factor | 4.918 dòng src, TS thuần, một người đọc hết trong một buổi | 89.614 dòng + Effect-TS 4 RC; dấu hiệu sinh bằng agent loop (`RALPH.md`) | **Ta** |
| 20 | Tài liệu quyết định cho người | ADR, nghiên cứu auth, phân tích chi phí, review đối thủ trong `reference/` | PRD lazy-tool rất tốt; phần còn lại là tài liệu quy trình | **Ngang** |
| 21 | Bản địa hoá | output + skill tiếng Việt, `HULY_ACTOR` cho token dùng chung | chỉ tiếng Anh | **Ta** (chỉ có giá trị với người Việt) |
| 22 | Xử lý rủi ro upstream | ghi rõ Huly đã tụt xuống bảo trì, npm ngừng publish từ 10/05/2026, SDK pin cứng | không đề cập | **Ta** |

**Tổng: ta thắng 10, họ thắng 8, ngang/chia 4** (bản đầu 18/08/2026: 9–10–3). Nhưng đếm phiếu là cách đọc bảng
này sai. Chín ô ta thắng đều nằm ở *chi phí vận hành và độ tin cậy của một bề mặt
nhỏ*; mười ô họ thắng phần lớn nằm ở *quy mô* — độ phủ, số test, kênh phân phối —
tức là kết quả của 1.119 commit và 89.600 dòng. Hai bên tối ưu cho hai bài toán
khác nhau.

---

## Còn học tiếp được gì (không mâu thuẫn nguyên tắc lean)

Cập nhật 18/08/2026: ba trong bốn mục đã làm; mục thứ tư bị loại sau khi đo.

1. ~~**Hợp đồng lỗi cho máy đọc**~~ (tiêu chí 7) — **đã làm**. Mọi lỗi JSON của
   cả CLI lẫn MCP nay kèm `code` (`auth` · `connection` · `not_found` ·
   `invalid_input` · `unknown`) và `retryable`; chỉ `connection` là retryable.
   Message tiếng Việt giữ nguyên, các trường mới nằm cạnh nó.
   `src/utils/errors.ts`, 9 test. Chi phí: 1 file 95 dòng, 0 dependency.
2. ~~**Integration smoke test trên workspace thật**~~ (tiêu chí 11) — **đã làm**.
   `HULY_SMOKE=1 pnpm smoke` chạy create → read → list → comment → delete qua
   **binary đã build**, tự dọn issue kể cả khi giữa chừng lỗi. Không đưa vào CI
   vì cần credential và ghi vào workspace thật.
3. ~~**`verify-version` và kiểm chứng artifact đã pack**~~ (tiêu chí 18) —
   **đã làm**. `pnpm verify:release` hỏi chính binary xem nó khai version gì
   (`--version` + handshake `initialize`), so hash `npm-package/huly-mcp.cjs`
   với `bin/mcp.cjs`, và chặn mọi dòng không phải JSON-RPC lọt ra stdout;
   `--packed` lặp lại trên tarball mà `npm publish` sẽ đẩy lên. CI chạy mỗi push.
4. **`outputSchema` cho tool** (tiêu chí 4) — **loại, sau khi đo**. Xem bảng
   phản biện bên dưới.

Cân nhắc, chưa quyết:

- **Profile cho credential** (tiêu chí 8) — `huly profile select` giải quyết thật
  bài toán nhiều workspace. Nhưng nó thêm một tầng state trên đĩa, trong khi
  `.env` + header per-request đã đủ cho mục tiêu per-user. Chờ khi có người thực
  sự cần hai workspace cùng lúc.
- ~~**Comment sâu hơn**~~ (tiêu chí 16) — **đã làm 18/08/2026**: `comments update`
  / `comments delete` trên CLI và `huly_update_comment` / `huly_delete_comment`
  trên MCP, chạy được cả trên thread reply. Còn lại chưa làm: inline comment
  trong document — cần lớp định vị trong markup, đợi có nhu cầu thật.

## Chỗ giữ tâm thế phản biện — không follow

| Họ làm | Vì sao ta không theo |
|---|---|
| 522 tool | Bằng chứng của chính họ: native mode tốn ~170K token, buộc phải phát minh `proxy` mode để chữa. Ta 31 tool nằm gọn dưới ngưỡng defer của Claude Code, nạp đủ, không mất vòng tra cứu. Thêm tool chỉ khi có người dùng thật cần, không thêm để phủ. **Ngưỡng xem lại: quá 60 tool thì phải bàn lại chuyện lazy loading.** |
| Effect-TS toàn bộ codebase | 89.600 dòng cho một wrapper quanh SDK. Ta 4.918 dòng làm được phần việc mình cần. Đổi sang Effect nghĩa là đổi thứ mạnh nhất của ta — một người đọc hết được — lấy type-safety mà `tsc --noEmit` + zod đã cho phần lớn. |
| Chuyển sang REST client | [ADR-0001](./adr-0001-websocket-transport.md): `RestClient` không có `MarkupOperations`, mà markup là đường ghi chính của ta. Họ phải tự dựng lại lớp markup + Tx để bù. Chỉ xem lại nếu cần deploy lên edge runtime. |
| Pin SDK cũ + patch tự bảo trì | Họ ở `api-client@0.7.19` với server 0.7.423. Ta khớp version, và với Huly đang bảo trì cầm chừng thì khớp version là tài sản, không phải sự cầu toàn. |
| Proxy / lazy tool mode | Đúng cho 522 tool, sai cho 29: nó đổi 7.650 token tĩnh thành một vòng discovery mỗi lời gọi, và làm `tools/list` mất tính cacheable của prefix — cái bẫy chính họ nêu trong PRD. |
| Khai `outputSchema` cho tool | Đo trực tiếp: thêm output schema cho **một** tool list (6 trường) làm `tools/list` từ 18.264 B lên 18.885 B — **+621 B**. Nhân cho 7 tool list với shape rộng hơn (task có 13 trường) là khoảng **+6 KB tĩnh ≈ +2.300 token mỗi phiên**. Nặng hơn: theo spec, đã khai `outputSchema` thì kết quả **bắt buộc** có `structuredContent`, và *nên* kèm cả bản text để tương thích ngược — tức **cùng một payload gửi hai lần**. Ta vừa cắt kết quả list 14x ở 1.7.0; đánh đổi lại 2x để client validate được schema là đi ngược đúng thứ vừa mua. Xem lại nếu client bỏ hẳn `content` khi có `structuredContent`. |
| Sinh code bằng agent loop quy mô lớn | 1.119 commit trong 6 tháng cho ra bề mặt lớn nhưng nhiều tầng trừu tượng không tương xứng domain. Ta chọn tăng trưởng theo nhu cầu có thật, đo được. |

## Cách đọc bảng này về sau

Ba con số nên đo lại mỗi lần thêm tool: **số tool**, **`tools/list` bytes**, và
**bytes của lời gọi list nặng nhất trên workspace thật**. Chừng nào cột 2 còn dưới
~10% context window của client và cột 3 còn dưới ~25 KB, nguyên tắc lean vẫn đang
trả lãi. Khi vượt, đọc lại mục "phản biện" — lúc đó lập luận của họ mới thành lập
luận của ta.
