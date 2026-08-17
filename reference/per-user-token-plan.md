# Mục tiêu: API token đi theo từng user — nhược điểm của ta và cách sửa

Ngày: 17/08/2026. Mục tiêu đã được chốt lại: **mỗi người một token, để Huly ghi
đúng ai làm gì**. Revocation và hạn dùng **không** phải mục tiêu.

## Điều này thay đổi bức tranh

Với mục tiêu đó, **Huly không còn là blocker**. PR #10624 (revocable API tokens),
tag chưa phát hành, npm ngừng publish từ 10/05/2026 — tất cả đều chỉ liên quan tới
*revocation* và *exp*. Token per-user thì làm được **ngay hôm nay** trên 0.7.423,
bằng hai đường đã kiểm chứng ([huly-auth.md](./huly-auth.md)):

- **Self-service**: mỗi người đăng nhập Google SSO rồi lấy token của chính mình
  (URL `/login/auth?token=`, cookie `presentation-metadata-Token`, hoặc WS URL
  `wss://<transactor>/<JWT>`). Không cần admin. 2FA không chặn vì đường SSO không
  kiểm `tfaSecret`.
- **Admin mint**: `generateToken(accountUuid, workspaceUuid, {})` bằng
  `SERVER_SECRET`, hoặc `tool generate-token <email> <workspace>`.

Vậy cái chặn ta **là kiến trúc và tooling của ta**, không phải upstream.

## Nhược điểm của ta, đo theo đúng mục tiêu này

Ghi chú phạm vi: mục tiêu là **hỗ trợ thêm** token theo user, **không bỏ** token
chung. Token chung vẫn là mặc định hợp lệ cho integration/automation không có người
đứng sau; per-user là đường thêm vào cho những ai muốn ghi đúng danh nghĩa mình.

**1. Credential bị đọc từ `process.env` ở sâu trong lõi.** `getApiKey()` /
`getHost()` / `getWorkspaceId()` ([src/utils/auth.ts](../src/utils/auth.ts)) được gọi
ngay trong `HulyClient.connect()` ([src/client.ts:128](../src/client.ts)). Hệ quả:
**một process = một identity**, không có đường nào truyền identity khác vào. Đây là
gốc của mọi nhược điểm còn lại.

**2. HTTP transport phá vỡ mục tiêu hoàn toàn.** `POST /mcp`
([src/mcp/index.ts:56](../src/mcp/index.ts)) tạo server mới mỗi request — kiến trúc
đã sẵn sàng cho per-request credential — nhưng credential vẫn lấy từ env, nên **mọi
caller ghi dưới danh nghĩa một người**. `HULY_MCP_AUTH_TOKEN` chỉ chặn cửa, không
phân biệt ai.

**3. `HULY_ACTOR` là attribution giả, và nó che mất vấn đề.** Nó chỉ dán
`Requested by: <tên>` vào task; Huly vẫn ghi author = chủ token. Ai đọc log Huly
sẽ thấy sai người. Nó tồn tại **vì** ta chưa giải được per-user — giữ nó sau khi
giải xong sẽ thành hai nguồn sự thật.

**4. README dạy sai đường.** Nó nói token "issued from workspace settings,
admin-only", nên người đọc kết luận phải xin admin từng cái. Thực tế mỗi người tự
lấy được từ session SSO của mình — đúng cái ta cần cho per-user.

**5. Không có cửa kiểm tra danh tính trước khi ghi.** `whoami` in ra cả actor và
chủ token nhưng **không cảnh báo khi hai cái lệch nhau**
([src/commands/whoami.ts:50-57](../src/commands/whoami.ts)), và phải kết nối được
mới nói được gì. Ghi sai danh nghĩa là lỗi im lặng.

**6. `HULY_WORKSPACE_ID` chỉ được doc là UUID.** Nếu ai lấy account token từ URL
redirect SSO (loại không bind workspace) thì `selectWorkspace` fail
`WorkspaceNotFound` — vì UUID chỉ chạy khi token đã bind workspace. Đúng cái bẫy mà
đường self-service sẽ đụng.

**7. Không test, không CI.** Refactor tầng credential mà không có lưới an toàn.

## Kế hoạch sửa, xếp theo giá trị/chi phí

### P0 — bắt buộc để đạt mục tiêu

**a. Đưa credential thành tham số tường minh.** Thêm `resolveCredentials(source)`
trả `{ host, workspace, token }`; `HulyClient.connect(creds)` và
`withClient(creds, fn)` nhận nó; `process.env` chỉ còn là **một** nguồn ở biên
(CLI đọc env, HTTP đọc header). Đây là thay đổi nhỏ nhưng mở khoá tất cả phần sau.
Phạm vi: `src/utils/auth.ts`, `src/client.ts:126-135`, `src/client.ts:838`.

**b. HTTP transport nhận credential theo request — thêm, không thay.** Header
`x-huly-token` (+ `x-huly-url`, `x-huly-workspace` nếu multi-instance). Token chung
trong env **vẫn giữ nguyên** làm mặc định; token theo caller chỉ ghi đè khi có header.

Thứ tự ưu tiên: header của request → env của process. Kèm một cờ
`HULY_REQUIRE_CALLER_TOKEN=true` để deployment nào muốn siết thì bật fail-closed
(thiếu header → `401`); mặc định **tắt**, nên cấu hình đang chạy không đổi hành vi.

Điều kiện bắt buộc dù dùng nguồn nào: mọi response phải nói rõ **đang ghi dưới danh
nghĩa ai** (xem P1-d), để "rơi về token chung" là một lựa chọn thấy được chứ không
phải chuyện xảy ra im lặng.

**c. Test + CI cho đúng tầng này.** Bốn ca tối thiểu: thứ tự ưu tiên nguồn
credential; fail-closed khi thiếu header; `maskToken` không lộ token; không có
token nào rơi vào stdout/stderr. Cộng một workflow chạy `typecheck` + `test`.

### P1 — chống ghi sai danh nghĩa

**d. Chẩn đoán không cần kết nối.** `huly whoami --offline` / tool `huly_context`:
decode payload JWT tại chỗ (không verify) để in `account`, `workspace`, host,
nguồn credential. Bắt được 90% lỗi cấu hình trước khi chạm Huly.

**e. Cảnh báo khi `HULY_ACTOR` ≠ chủ token**, và ghi rõ trong README rằng
`HULY_ACTOR` là **giải pháp tạm cho token dùng chung**; khi đã per-user thì bỏ nó.
Không xoá ngay để không phá cấu hình đang chạy.

**f. Nhận cả UUID và URL slug cho workspace**, kèm lỗi rõ ràng: "token này không
bind workspace → `HULY_WORKSPACE_ID` phải là URL slug". Cộng một mục README hướng
dẫn mỗi người tự lấy token qua SSO.

### P2 — chỉ khi cần

**g. `exp` cho token admin mint.** Không phục vụ mục tiêu per-user, chỉ giảm rủi ro
token vĩnh viễn. `jwt-simple` đã enforce `exp` ở `decode()` nên dùng được ngay trên
0.7.423 nếu muốn.

## Phạm vi thực tế nên làm trước

`.env` hiện tại đặt `HULY_MCP_TRANSPORT=stdio`. Với stdio, **mỗi người chạy process
riêng nên per-user đạt được chỉ bằng việc mỗi người đặt token của mình vào config
MCP** — không cần P0-b. Vậy thứ tự thực dụng:

1. **P0-a** (tham số hoá credential) + **P1-d/e/f** + **P0-c** → đủ để triển khai
   per-user trên stdio ngay, an toàn và có cảnh báo khi sai.
2. **P0-b** (header per-request) khi nào thực sự dựng deployment HTTP dùng chung.

Không làm: đua số lượng tool, đổi tên repo, viết lại theo Effect-TS, hay chờ Huly
phát hành PR #10624.
