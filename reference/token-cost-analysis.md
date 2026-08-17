# Chi phí token thực tế: `huly-skill` vs `@firfi/huly-mcp`

Ngày: 18/08/2026. Giả thuyết cần kiểm chứng: "trên thực tế họ hao tốn token hơn ta
rất nhiều". **Kết quả: sai — ở chi phí tĩnh ta rẻ hơn, nhưng ở chi phí mỗi lời gọi
ta đắt hơn họ khoảng 18–30 lần, và đó mới là phần lặp lại suốt session.**

## Phương pháp

- Số của ta: đo thật. `initialize` + `tools/list` qua stdio vào `bin/mcp.cjs`; và
  `./bin/huly.cjs tasks --json` trên workspace thật (`work.yody.io`, 249 task).
- Số của họ: lấy từ chính tài liệu của họ (`docs/02_LAZY_TOOL_PRD.md`) và đọc source
  cho phần schema/limit. **Không chạy binary của họ** (không đưa credential cho code
  bên thứ ba).
- Quy đổi token: dùng đúng tỉ lệ họ đã đo bằng tokenizer của Claude — 435 KB ↔ 170K
  token, tức **~2,56 ký tự/token** cho JSON schema. Heuristic 4 ký tự/token là quá
  lạc quan với JSON.

## 1. Chi phí tĩnh — `tools/list` một lần mỗi session

| | Payload | Token |
|---|---|---|
| Ta (28 tool) | 15.721 B (đo) | **~6.100** |
| Họ, `native` (470 tool, số của họ) | 435 KB (họ đo) | **~170.000** (họ đo bằng `/context`) |
| Họ, `proxy` (6 tool: `get_version`, `get_huly_context`, `list_tool_categories`, `search_tools`, `get_tool_schema`, `invoke_tool`) | — | **~500** (họ ước tính) |

Ở đây ta rẻ hơn native của họ ~28x. **Nhưng native không phải mặc định của họ với
phần lớn client.** Bảng `auto` mode (`src/mcp/tool-mode.ts:85`, PRD dòng 150–161):

- `claude-code` (khớp chính xác) → **native**, vì Claude Code tự defer tool
  definitions từ 01/2026 khi tool surface vượt ~10% context window.
- `claude-ai`, `cursor*`, `windsurf*`, `copilot*`, `codex*`, `opencode*`, và
  client không rõ → **proxy** (~500 token).

Nghĩa là: với Cursor/Codex/Copilot, **họ rẻ hơn ta ~12x** ở chi phí tĩnh. Với Claude
Code, 170K token đó không nằm thẳng trong context mà bị defer sang tool search —
đúng cơ chế đang chạy trong session này. Ta 6.100 token thì nằm dưới ngưỡng defer
nên được nạp đủ, luôn sẵn sàng, không mất vòng tra cứu — đó là lợi thế thật của ta,
nhưng là lợi thế về *độ tiện*, không phải 28x tiết kiệm như con số thô gợi ra.

## 2. Chi phí mỗi lời gọi — chỗ ta thua nặng

Đo `huly_list_tasks` (không filter) trên workspace thật:

| | Kết quả |
|---|---|
| Số task trả về | 249 (**không có tham số `limit`**) |
| Mảng task | 204.071 B |
| Cả response | 273.771 B → **~107.000 token** |
| Số field mỗi task | **32** — trả nguyên raw doc của Huly (`...task`, `src/mcp/tools.ts:133`) |

Phân bổ byte theo field cho thấy phần lớn là rác với người đọc: `attachedToClass`
5,0%, `attachedTo` 4,5%, `space` 4,3%, `modifiedBy` 4,3%, `createdBy` 4,2%, `kind`
4,1%, `_class` 3,8%, `collection` 3,1%, cộng `rank`, `childInfo`, `docUpdateMessages`,
`relations`, `parents`, `reports`.

**Một lời gọi `huly_list_tasks` của ta ≈ 107K token — bằng ~63% toàn bộ tool surface
native của họ, và nó lặp lại mỗi lần gọi.** Trong thực tế Claude Code sẽ cắt bớt
tool result quá lớn, nên hậu quả thật là một trong hai: đốt context, hoặc **mất dữ
liệu âm thầm**. Cả hai đều tệ.

Cùng thao tác đó bên họ: `list_issues` trả `IssueSummarySchema` — **11 field đã
chọn lọc** (`issueId`, `identifier`, `title`, `status`, `priority`, `assignee`,
`creator`, `parentIssue`, `subIssues`, `labels`, `milestone`, `modifiedOn`), với
`DEFAULT_LIMIT = 50`, `MAX_LIMIT = 200` (`src/domain/schemas/shared.ts:8-9`). Ước
tính ~250–350 B/issue → ~15 KB ≈ **~6K token** cho một lời gọi mặc định.

Đối chiếu trên cùng dữ liệu, nếu ta chỉ giữ 9 field cần dùng:

| Cấu hình | Bytes | ~Token | So với hiện tại |
|---|---|---|---|
| Hiện tại (32 field, 249 task) | 204.071 | ~80.000 | 1x |
| Lean 9 field, 249 task | 40.611 | ~15.900 | **5x nhỏ hơn** |
| Lean 9 field + `limit=50` | 6.900 | ~2.700 | **30x nhỏ hơn** |

## 3. Kết luận

- **Giả thuyết sai trong sử dụng thực tế.** Ta chỉ thắng ở lần nạp `tools/list`
  (một lần/session, và chỉ khi so với chế độ native của họ). Ta thua ở mọi lời gọi
  sau đó.
- Một session làm báo cáo tuần gọi 5–10 lần `list_tasks` sẽ đốt của ta hàng trăm
  nghìn token, trong khi họ trả 170K một lần rồi mỗi lời gọi chỉ vài nghìn.
- Điểm yếu của ta không phải "ít tool" mà là **không có projection và không có
  limit** — nghĩa là ta chưa có kỷ luật về output, thứ mà họ đã có bằng
  `resultSchema` cho từng tool.

## 4. Việc cần làm (xếp theo tác động đo được)

1. **`limit` + mặc định 50 cho mọi tool list** (`huly_list_tasks`,
   `huly_list_projects`, `huly_list_documents`, `huly_list_milestones`,
   `huly_list_labels`, `huly_list_users`, `huly_list_sub_issues`). Hiện chỉ
   `huly_get_activity` và `huly_get_comments` có `limit`, và mặc định 200 cũng còn cao.
2. **Field projection cho tool list**: trả tập field đã chọn thay cho `...task`
   (`src/mcp/tools.ts:133`), tương tự cho `...doc` (`:373`). Giữ raw doc chỉ ở
   `huly_get_task` / `huly_get_task_by_id`, nơi người ta thật sự cần chi tiết.
3. **Tham số `fields` (opt-in)** cho ai cần thêm field, thay vì trả tất cả theo mặc định.
4. **Cursor/offset để phân trang**, kèm `totalCount` để agent biết còn bao nhiêu.
5. **Test hồi quy về kích thước output**: một test khẳng định response của tool list
   không vượt ngưỡng byte đã chốt — chống trôi ngược về trạng thái hiện tại.

Ba mục đầu là thay đổi nhỏ trong `src/mcp/tools.ts` và cho **30x** giảm token trên
đúng đường nóng. Nhưng đây chỉ là **sàn**, không phải chiến lược — xem mục 5.

## 5. Tối ưu token thật của agent context

`limit` + projection chỉ chặn result tràn. Bốn trục dưới đây mới là chỗ quyết định
một session tốn 30K hay 300K token. Xếp theo tác động đã đo.

### a. Trả *câu trả lời*, không trả *tập dữ liệu* — đo được 20x

`huly_report weekly` (server tự tổng hợp) = **13.209 B ≈ 5.200 token** cho toàn bộ
bức tranh tuần. Cùng câu hỏi nếu đi đường `huly_list_tasks` rồi để model tự lọc và
đếm = **273.771 B ≈ 107.000 token**. Chênh **~20x**, và bản aggregate còn đúng hơn
vì phép đếm do code làm, không do model làm.

Suy ra: mỗi khi một câu hỏi nghiệp vụ lặp lại (tiến độ squad, việc quá hạn, rollup
milestone), thứ cần thêm là **một tool trả kết quả đã tổng hợp**, không phải một
tool trả thêm dữ liệu thô. Đây là trục ta đang có lợi thế (`huly_report`,
`huly_milestone_report`) nhưng chưa khai thác: SKILL.md chưa dạy agent ưu tiên
đường này trước khi gọi list.

### b. Dữ liệu không cần vào context — CLI pipeline, đo được 125x

Đây là trục mà **MCP thuần không bao giờ làm được**: mọi tool result buộc phải đi
qua context. CLI thì không — agent viết một lệnh, dữ liệu thô chảy qua `jq`/`awk`
hoặc ra file, **chỉ kết quả cuối vào context**.

Đo thật trên cùng dữ liệu 249 task:

| Đường đi | Vào context | So sánh |
|---|---|---|
| `huly_list_tasks` (MCP) | 273.771 B ≈ 107.000 token | 1x |
| `huly tasks --json \| <reduce>` (CLI) | **2.178 B ≈ 850 token** | **~125x nhỏ hơn** |

Anthropic báo cáo cùng pattern (code execution với MCP) đưa một workflow từ ~150K
xuống ~2K token (98,7%); PRD của chính đối thủ thừa nhận các cách proxy meta-tool
**không** giải quyết được phần intermediate results (`docs/02_LAZY_TOOL_PRD.md:54`).

**Lưu ý về lợi thế**: ta có CLI, nhưng họ cũng có — `@firfi/huly-cli@0.48.2` đã
publish, có skill riêng. Nên lợi thế không nằm ở việc *có* CLI mà ở việc **skill có
dạy agent dùng pipeline thay vì gọi bulk tool hay không**. Hiện SKILL.md của ta
không dạy điều đó → lợi thế đang bỏ không.

### c. Chi phí bản thân skill — ta đang nặng 6x

Skill body được nạp vào context khi kích hoạt, trước cả tool nào được gọi.

| | Kích thước |
|---|---|
| `skills/huly-skill/SKILL.md` (ta) | **13.059 B** — một khối, nạp hết |
| `AGENTS.md` (ta, cho Codex/Antigravity) | 10.333 B |
| `packages/huly-cli/skills/huly-cli/SKILL.md` (họ) | **2.112 B** + `references/automation.md` 1.296 B nạp khi cần |

Họ dùng progressive disclosure: lõi 2 KB, chi tiết để trong `references/` và chỉ đọc
khi thật cần. Ta nạp 13 KB mỗi lần. Đây là chi phí cố định, trả mọi session, và là
chỗ dễ sửa nhất trong cả bốn trục.

### d. Số vòng gọi và tính cache-friendly

Mỗi tool call là một cặp request/response nằm lại trong history và được gửi lại ở
mọi turn sau đó cho tới khi compaction — nên một result 107K không phải chi phí một
lần, nó là thuế thu suốt phần còn lại của session. Giảm **số** lời gọi cần để hoàn
thành một việc (tool theo tác vụ, không theo endpoint) vì thế đáng giá hơn giảm kích
thước từng lời gọi.

Về prompt cache: `tools/list` của ta tĩnh, không mutate giữa session → prefix
cacheable. Họ nêu đúng cái bẫy này trong PRD (`:124`): mutate tool list giữa session
làm mất cache prefix, và cache miss có thể đắt hơn phần schema tiết kiệm được. Ta
đang ở phía đúng, chỉ cần đừng đánh mất nó khi thêm tool.

### Việc cần làm, xếp lại theo tác động thật

| # | Việc | Tác động đo được | Chi phí |
|---|---|---|---|
| 1 | SKILL.md dạy thứ tự ưu tiên: **report/aggregate → CLI pipeline → tool list** | quyết định trục a và b có được dùng hay không | rất thấp |
| 2 | Tách SKILL.md thành lõi ~2 KB + `references/` | 13 KB → ~2 KB mỗi session | thấp |
| 3 | Thêm `--fields` / `--limit` cho CLI để pipeline gọn | mở đường cho 125x | thấp |
| 4 | Mở rộng họ tool aggregate (rollup theo squad/milestone/assignee) | ~20x cho câu hỏi lặp lại | trung bình |
| 5 | `limit` + projection cho mọi tool list (mục 4 ở trên) | 30x cho lời gọi lẻ | thấp |

Thứ tự này khác với mục 4: mục 1–3 rẻ hơn và tác động lớn hơn mục 5, vì chúng thay
đổi **đường agent chọn đi**, còn mục 5 chỉ làm rẻ con đường cũ.
