# Huly authentication — nghiên cứu (17/08/2026)

Phạm vi: cơ chế xác thực của Huly platform, đối chiếu với instance đang dùng
(`https://work.yody.io`, version **0.7.423**, self-hosted) và với những gì
`huly-skill` đang làm trong [`src/client.ts`](../src/client.ts).

**Ràng buộc thực tế tại YODY** (do người dùng cung cấp, quyết định toàn bộ phần
khuyến nghị): mọi người **đăng nhập qua Google SSO**, và **2FA đang bật**. Vì vậy
flow `login(email, password)` không dùng được — phần dưới đã tính theo ràng buộc này.

Nguồn: source code đọc trực tiếp — `@hcengineering/api-client@0.7.423`,
`@hcengineering/account-client@0.7.423`, `@hcengineering/client-resources@0.7.423`
(trong `node_modules`), và `hcengineering/platform` tại tag `v0.7.423` cùng nhánh `develop`.

---

## 1. Kiến trúc xác thực

| Thành phần | Vai trò | URL trên instance YODY |
|---|---|---|
| Front / config | phát `/config.json` chứa endpoint các service | `https://work.yody.io/config.json` |
| Account service | cấp và ký JWT, quản lý account/workspace/role | `https://huly-account.yody.io` |
| Transactor (WS) | nhận JWT qua WebSocket, thực thi transaction | endpoint do `selectWorkspace` trả về |

Luồng của `connect()` trong `@hcengineering/api-client`:

1. `loadServerConfig(host)` → lấy `ACCOUNTS_URL`.
2. `getWorkspaceToken()`: `{ email, password }` → gọi `login()` lấy **account token**;
   hoặc `{ token }` → dùng luôn.
3. `selectWorkspace(workspace)` → đổi sang **workspace token** + `endpoint`.
4. Mở WebSocket: URL là `wss://<transactor>/<token>` — token nằm **trong path**
   (`client-resources/src/index.ts:104`).

## 2. Token là gì

JWT `HS256`, ký bằng `SERVER_SECRET` chia sẻ giữa các service
(`foundations/core/packages/token/src/token.ts`):

```
{ account, workspace?, extra?, grant?, sub?, exp?, nbf? }
```

- `extra` — metadata tự do: `admin: 'true'`, `authMethod: 'password'|'otp'`,
  `service`, `readonly: 'true'`, `apiTokenId`, `guest`.
- `grant` — `PermissionsGrant`: `{ workspace, role, spaces?, grantedBy? }`. Có
  `grant` mà không có `sub` thì **bắt buộc** `nbf` + `exp`.
- `exp` / `nbf` — `jwt-simple@0.5.6` kiểm tra ngay trong `decode()`
  (`package/lib/jwt.js:97-102`), nên hạn dùng **có hiệu lực kể cả trên 0.7.423**.
  Không có `exp` = sống tới khi đổi `SERVER_SECRET`.

**Có hai loại token, đừng lẫn:**

| | Account token | Workspace token |
|---|---|---|
| Payload | `{ account }`, **không** có `workspace` | `{ account, workspace }` |
| Nguồn | `login()`, SSO redirect, `validateOtp()` | `selectWorkspace()` |
| Dùng cho `connect()` được? | **chỉ khi** truyền `workspace` = **URL slug** | ✅ (UUID cũng được) |

Lý do: `selectWorkspace` tra workspace bằng `getWorkspaceByUrl(url)`; nếu không
thấy nó fallback sang `getWorkspaceById(decodedToken.workspace)`
(`server/account/src/utils.ts:733+`). `HULY_WORKSPACE_ID` là UUID nên chỉ chạy
được nhờ token hiện tại **đã bind workspace**. Nếu chuyển sang account token
(ví dụ token copy từ SSO redirect) thì phải đổi biến sang **workspace URL slug**,
nếu không sẽ ăn `WorkspaceNotFound`.

**Token hiện tại trong `.env`**: `extra` là `{}` rỗng, không `exp`, không `nbf`,
không `grant` — khớp `generateToken(account, workspace, {})`, tức là do màn hình
Settings hoặc `dev/tool generate-token` (không `--admin`) sinh ra. Credential
**vĩnh viễn, không thu hồi riêng lẻ được**.

## 3. Google SSO + 2FA: điều gì thực sự xảy ra

**2FA của Huly không áp cho SSO.** `loginOrSignUpWithProvider`
(`server/account/src/utils.ts:1521`) — hàm mà cả `/auth/google` và `/auth/openid`
gọi qua `handleProviderAuth` — kết thúc bằng:

```ts
token: generateToken(personUuid, undefined, extraToken)
```

Không có bất kỳ nhánh `tfaSecret` nào. Đối chiếu: `login()` (password) và
`validateOtp()` đều mint token với `account = NIL_UUID` + `extra.tfaAccount` khi
account có `tfaSecret`, và token đó **không** `selectWorkspace` được cho tới khi
qua `verify2fa(code)`. Kiểm tra thêm trên nhánh `develop`: file `utils.ts` có **0**
lần xuất hiện `tfaSecret` — nghĩa là Huly chưa từng gate SSO bằng TOTP, không phải
chuyện riêng của 0.7.423.

Hệ quả hai chiều:

- *Về mặt vận hành, tốt cho ta*: 2FA **không** phải rào cản để lấy token
  per-person. Người đăng nhập Google xong là đã có token đầy đủ.
- *Về mặt bảo mật, cần biết*: nếu YODY coi TOTP là yếu tố thứ hai bắt buộc thì
  giả định đó **không đúng** với đường Google/OIDC — factor thứ hai thực tế là
  MFA của Google Workspace, không phải của Huly.

**Token của người dùng SSO nằm ở đâu** (3 chỗ, đều đọc được bởi chính chủ):

1. URL redirect sau khi Google trả về: `.../login/auth?token=<JWT>`
   (`pods/authProviders/src/utils.ts:115`) — đây là **account token**.
2. Cookie `presentation-metadata-Token`, scope `/files/<workspaceUuid>`
   (`packages/presentation/src/utils.ts:893`) — **workspace token**.
3. Network tab → WebSocket request: `wss://<transactor>/<JWT>` — **workspace token**.

## 4. Bốn cách lấy token — đối chiếu ràng buộc SSO + 2FA

| Cách | Chạy được với SSO+2FA? | Ai làm được | `exp` | Thu hồi | Có ở 0.7.423 |
|---|---|---|---|---|---|
| `login(email, password)` | ❌ không có password; 2FA chặn | — | ❌ | ❌ | ✅ |
| OTP (`loginOtp`/`validateOtp`) | ❌ 2FA chặn (trả `NIL_UUID`) | — | ❌ | ❌ | ✅ |
| Tự copy token session sau khi SSO | ✅ | mọi member | ❌ | ❌ | ✅ |
| Settings → General → *Generate API token* | ✅ | chỉ **Owner** | ❌ | ❌ | ✅ |
| `dev/tool generate-token` / script `generateToken` | ✅ (bypass hoàn toàn) | admin có shell + DB | ⚠️ script thì có | ❌ | ✅ |
| `createApiToken` (revocable API token) | ✅ | mọi member ≥ `User` | ✅ 1–365 ngày | ✅ | ❌ **chỉ `develop`** |

**Nút trong Settings không sinh API key.** `General.svelte:156` chỉ gọi
`accountClient.selectWorkspace(workspaceUrl)` rồi in ra popup — là **session token
của chính Owner đang bấm**. Màn hình bị gate `role: AccountRole.Owner`
(`models/setting/src/index.ts:284`). Tức là rào "admin-only" là rào **UI**, không
phải rào hệ thống: token nó trả về không hơn gì token mà member nào cũng tự lấy
được từ session của mình (mục 3).

**Revocable API tokens** — `createApiToken` / `listApiTokens` / `revokeApiToken`:
self-service từ role `User`, hạn 1–365 ngày, tối đa 100 token sống/account, revoke
được, transactor check revocation qua `verifyToken()` cache TTL 60s. Commit
`5a3d673e` ngày 04/08/2026 (PR #10624), đã ở `develop` nhưng **chưa vào tag nào**
(`v0.7.432` là tag mới nhất, vẫn chưa có), và npm `account-client@0.7.423` chưa
expose. **Quan trọng với YODY**: flow này xác thực bằng session token sẵn có, nên
nó hoạt động bình đẳng với SSO — đây là đích đến đúng, chỉ là chưa phát hành.

## 5. Access link — con đường bị bỏ qua

`createAccessLink(role, { spaces, nbf, expiration, personalized, extra })` mint
token cho `GUEST_ACCOUNT` kèm `grant`. Đây là **cơ chế duy nhất ở 0.7.423 cho
phép token vừa có hạn dùng vừa giới hạn phạm vi** (`spaces`). Trade-off: account
là guest chung → activity không attribute về người thật, role tối đa bị chặn bởi
role người tạo link. Phù hợp integration read-only hẹp, không phù hợp agent ghi dữ liệu.

## 6. Lớp bảo vệ khác trên account service

- **2FA (TOTP)**: `generate2faSecret` / `enable2fa` / `verify2fa` / `disable2fa`
  — chỉ hiệu lực trên đường password và OTP (mục 3).
- **Password lockout**: `isAccountPasswordLocked` + `recordFailedLoginAttempt`;
  lỗi trả về là `AccountNotFound` (không phân biệt sai pass vs không có account).
- **Password aging**: `passwordAgingRule` (ngày), đặt ở mức workspace.
- **Read-only guest**: workspace bật `allowReadOnlyGuest` thì token sai/thiếu vẫn
  `selectWorkspace` được, nhận `role = ReadOnlyGuest` + `extra.readonly = 'true'`.
- **SSO trên instance YODY**: `GET https://huly-account.yody.io/providers` →
  `[{ google }, { openid, displayName: "Yody" }]`.
- **`extra.admin === 'true'`**: bỏ qua kiểm tra membership, `selectWorkspace` cấp
  luôn role `Admin` (`server/account/src/utils.ts:830`). `tool generate-token --admin`
  sinh loại này — là chìa khóa toàn hệ thống, đừng dùng cho agent.

## 7. Rủi ro của setup hiện tại

1. **Token không hạn, không thu hồi được.** Muốn vô hiệu hóa phải đổi
   `SERVER_SECRET` → kill mọi session của mọi người.
2. **Token dùng chung = attribution sai.** Huly ghi author theo social ID của
   account trong token; `HULY_ACTOR` chỉ là nhãn text.
3. **MCP HTTP transport giữ credential Huly.** `HULY_MCP_AUTH_TOKEN` là bearer
   duy nhất chắn trước `POST /mcp`; qua được nó là có toàn quyền của token bên dưới.
4. **Token trong `.env` plaintext** (đã `.gitignore`, xác nhận bằng `git check-ignore`),
   nhưng mọi process của user đều đọc được.

## 8. Khuyến nghị (đã tính SSO + 2FA)

**Chọn 1 — admin mint token per-person bằng script, có `exp`.**
Self-host nên ta giữ `SERVER_SECRET`; viết script ~20 dòng gọi
`generateToken(accountUuid, workspaceUuid, {}, SECRET, { exp })` — mỗi người một
token, hạn 30–90 ngày, attribution đúng. Bypass SSO/2FA vì mint ở phía server, nên
ràng buộc Google SSO không ảnh hưởng. Giá phải trả: admin phải chạy lại khi rotate,
`SERVER_SECRET` bị đưa ra ngoài phạm vi server (phải xử lý như secret hạng nhất),
và **không có revocation** — chỉ có hết hạn.

**Chọn 2 — mỗi người tự copy session token của mình sau khi đăng nhập Google.**
Không cần admin, không cần code, chạy ngay hôm nay. Giá phải trả: token vô hạn và
không revoke được (logout **không** vô hiệu hóa nó); nếu copy từ URL redirect thì
là account token → phải đổi `HULY_WORKSPACE_ID` sang **workspace URL slug** (mục 2);
và hướng dẫn cả team tự lấy JWT từ DevTools là một quy trình dễ sai, dễ leak.

**Chọn 3 — nâng self-host lên bản có PR #10624 rồi dùng revocable API token.**
Đúng chuẩn nhất và hợp SSO nhất. Chưa có tag phát hành → hoặc build từ `develop`
(gánh rủi ro chạy nhánh chưa release cho production), hoặc chờ.

**Đề xuất: Chọn 1 ngay, Chọn 3 là đích.** Lý do: nó là phương án duy nhất vừa
sống được với SSO+2FA, vừa cho attribution đúng, vừa có hạn dùng — mà không bắt
cả team làm thao tác DevTools. Chọn 2 chỉ nên dùng như tình thế tạm cho 1–2 người
trong lúc chờ script. Khi Chọn 3 có bản phát hành thì đổi credential mà không đụng
kiến trúc, vì cả ba đều đi qua cùng một `ConnectOptions`.

Việc cần làm nếu chọn 1: script mint token (input: email → social ID → account
UUID), quy ước hạn dùng, và lịch rotate. Code `huly-skill` **không cần sửa** — vẫn
là `HULY_API_KEY`, chỉ khác là mỗi người một giá trị.

## 9. Cần sửa trong README

- Nút Settings → General được mô tả như "API access token"; chính xác hơn: nó trả
  về **session workspace token của Owner**, không sinh credential riêng.
- Câu "latest release expose no token-creation call" cần gắn mốc version: đúng cho
  `0.7.423`, nhưng `develop` đã có `createApiToken` (PR #10624).
- Nên bổ sung: với workspace dùng SSO, `HULY_API_KEY` lấy được từ session của
  chính người dùng, và nếu là account token thì `HULY_WORKSPACE_ID` phải là URL
  slug chứ không phải UUID.
