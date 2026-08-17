# ADR-0001 — Dùng WebSocket `PlatformClient` thay vì `RestClient`

- **Trạng thái**: Accepted
- **Ngày**: 17/08/2026 (ghi lại quyết định đã có từ đầu dự án; trước đó chỉ tồn tại
  ngầm trong code)
- **Phạm vi ảnh hưởng**: [`src/client.ts`](../src/client.ts),
  [`src/bootstrap.ts`](../src/bootstrap.ts), toàn bộ đường ghi của CLI và MCP

## Bối cảnh

`@hcengineering/api-client` cho hai đường vào workspace Huly:

- `connect(url, options)` → `PlatformClient`, đi qua WebSocket tới transactor.
- `connectRest(url, options)` / `createRestClient(endpoint, ws, token)` →
  `RestClient`, đi qua HTTP `/api/v1`.

Cần chọn một đường cho `huly-skill` — CLI + MCP server chạy trên Node, workload là
đọc/ghi issue, comment, document, milestone, label.

## Quyết định

Dùng **WebSocket `PlatformClient`** (`src/client.ts:133`).

## Lý do

`RestClient` (`api-client@0.7.423`, `src/rest/types.ts`) chỉ là
`Storage & FulltextStorage` cộng bốn method: `getAccount`, `getModel`,
`domainRequest`, `ensurePerson`. `PlatformClient` (`src/types.ts`) là
`FindOperations & DocOperations & CollectionOperations & MixinOperations &
MarkupOperations`.

Ba năng lực REST **không có**, mà đường ghi của ta phụ thuộc:

1. **MarkupOperations** — `uploadMarkup`, `fetchMarkup`, và
   `client.markup.collaborator.updateMarkup`. Dùng ở `src/client.ts:381`, `:475`,
   `:599`, `:624`, `:818`. Không có nó thì description của issue và nội dung
   document (markdown ↔ collaborative doc) không đọc/ghi được: `huly_create_document`,
   `huly_read_document`, và `--description` của task mất hết.
2. **DocOperations / CollectionOperations** — `createDoc`, `updateDoc`,
   `addCollection`, `removeDoc`. REST chỉ đưa `tx` thô từ `Storage`, nên phải tự
   dựng Tx: rank, bộ đếm collection, `attachedTo` / `attachedToClass`.
3. **Hierarchy tại chỗ** — `getHierarchy()` đồng bộ. REST là `getModel()` async
   phải fetch trước khi dùng.

**Bằng chứng đối chứng**: `dearlordylord/huly-mcp` chọn REST và phải tự dựng lại
lớp markup — thêm dependency `@hcengineering/collaborator-client`, tự viết
`createMarkupOps` (`src/huly/client.ts:635-691`), `toInternalMarkup`, cùng
`operations/markup.ts`, `native-reference-markup.ts`, `huly-text.ts`. REST không
rẻ hơn về lượng code; nó đổi một tập chi phí lấy một tập khác. Xem
[review-firfi-huly-mcp.md](./review-firfi-huly-mcp.md).

## Phương án đã cân nhắc

**A. REST `RestClient`.** Được: không cần polyfill browser API, chạy được trên
serverless / Cloudflare Workers, khởi động không phải tải model. Mất: tự dựng
markup qua collaborator client, tự dựng Tx, tự lo hierarchy. Không chọn vì markup
là đường ghi chính của ta, không phải tính năng phụ.

**B. Hybrid — REST cho đọc, WS cho ghi markup.** Được: có thể giảm latency đọc.
Mất: hai client, hai vòng auth, hai tập lỗi, hai chỗ cache person/project. Không
chọn vì kích thước dự án không đỡ được chi phí phức tạp đó.

**C. WS `PlatformClient`** — đã chọn.

## Hệ quả

**Phải chịu** (đều nằm trong `src/bootstrap.ts`, không phải hack tuỳ tiện):

- `fake-indexeddb/auto` và polyfill `window` / `localStorage` / `navigator`, vì
  `client-resources` được viết cho môi trường browser.
- Redirect `console.log|info|debug` sang stderr: `client-resources` in log kết nối
  ra stdout, làm hỏng cả `--json` của CLI và khung JSON-RPC của MCP stdio.
- Tự viết WebSocket factory nhận proxy (`src/client.ts:17`) cho môi trường có
  `HTTPS_PROXY` (sandbox Cowork).
- Chi phí bootstrap mỗi lần kết nối: tải model qua WS.
- **Không** chạy được trên runtime không có WebSocket client kiểu Node (Cloudflare
  Workers). Nếu sau này muốn host MCP trên edge thì ADR này phải mở lại.

**Được**: markup/collab miễn phí, TxOperations miễn phí, SDK khớp đúng version
server (0.7.423 ↔ 0.7.423 trên `work.yody.io`), và multiplex nhiều lời gọi trên một
kết nối — hợp với workload chuỗi query nhỏ liên tiếp (list tasks → comment từng
task → resolve person). Ghi chú: phần multiplex là suy luận kiến trúc, chưa đo.

## Khi nào mở lại quyết định này

- Muốn deploy MCP lên edge runtime (Cloudflare Workers, Deno Deploy).
- Huly bổ sung markup operations vào `RestClient`.
- Đo được rằng bootstrap model qua WS là bottleneck thật của các lệnh ngắn.
