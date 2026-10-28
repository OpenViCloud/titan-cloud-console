# `eslint-suppressions.json` — lý do từng dòng, và đường teo về 0

- Dựng: 2026-09-09, iteration `ddd-tactical-close`, story `US-PORTAL-01` (đóng `A-1`)
- Cơ chế: **ESLint 9 suppressions native** (v9.39.4). Không có allowlist tự viết.

## Gate hoạt động thế nào

`npm run lint` (= `eslint .`) đọc `eslint-suppressions.json` và **đỏ cả hai chiều**:

| Chiều | Điều gì xảy ra | Đã đo (2026-09-09) |
|---|---|---|
Vi phạm **mới** ở bất kỳ file nào | `exit 1`, nêu tên file + rule | ✅ `M-1`: probe `const probe: any = 1` ⇒ `no-explicit-any`, exit 1 |
Một vi phạm trong baseline **đã được sửa** mà baseline không cập nhật | `exit 2`, *"There are suppressions left that do not occur anymore"* | ✅ `M-2`: exit 2, đúng thông điệp |

⇒ Baseline **không thể** phình ra âm thầm, và **không thể** giữ một dòng đã chết. Sửa xong một mục
thì phải chạy `npx eslint . --prune-suppressions` — nếu không CI đỏ.

## Vì sao "48 error" là một con số gây hiểu sai

`A-1` bị dời **ba lần** dưới nhãn *"portal có 48 lỗi lint"*. Chẻ nó theo rule đổi hoàn toàn kết luận:

| Rule | Số | Ở đâu | Có ship tới khách? |
|---|---|---|---|
🔴 `react-hooks/set-state-in-effect` | **2** | `VmListPage.tsx`, `NetworkListPage.tsx` | **CÓ** — bug class thật |
`@typescript-eslint/no-explicit-any` | 33 | **toàn bộ** `e2e/*.spec.ts` | không |
`react-refresh/only-export-components` | 7 | `src/` | không (chỉ ảnh hưởng HMR lúc dev) |
`@typescript-eslint/no-unused-vars` | 1 (nay 0) | `src/test/` | không |

**2 dòng có hậu quả đã được SỬA, không suppress.** 46 dòng còn lại nằm trong baseline lúc dựng (2026-10-13 còn 40; 39 sau khi tách repo: 33 + 6; nay 12: 6 + 6, sau khi gỡ hai spec seed), và **không
dòng nào** ở code runtime của khách.

## Từng mục trong baseline

### `@typescript-eslint/no-explicit-any` — 6, tất cả ở `e2e/`

| File | Số |
|---|---|
`e2e/cleanup.spec.ts` | 6 |

**Lý do:** file này là **script cleanup** chạy tay qua Playwright trên một env đã deploy, không phải test hồi quy và
không nằm trong bundle. `any` ở đây là response JSON của API đọc một lần rồi bỏ.

**Đường teo:** khai `interface` cho response của từng endpoint nó gọi, hoặc xoá file khi nó hết dùng.
**Không có người đứng tên; đây là rủi ro chấp nhận, không phải nợ đã kiểm soát.**

### `react-refresh/only-export-components` — 6, ở `src/`

| File | Số | Xuất kèm |
|---|---|---|
`src/contexts/TenantContext.tsx` | 2 | `useTenant`, `TenantContext` |
`src/lib/router.tsx` | 2 | route object |
`src/components/ui/badge.tsx` | 1 | `badgeVariants` (CVA) |
`src/components/ui/button.tsx` | 1 | `buttonVariants` (CVA) |

**Lý do:** đây là **quy ước của shadcn/ui và React Router**, không phải sai sót. `badge.tsx` xuất
`badgeVariants` cạnh `Badge` vì consumer cần class variant mà không render component — đó là hình
dạng upstream ship. Hậu quả duy nhất là **Fast Refresh** remount thay vì hot-update file đó lúc dev.

**Đường teo:** tách phần không-phải-component ra file riêng (`badge-variants.ts`, `router-routes.ts`).
Rẻ và cơ học. **Chưa có story** — nhưng đây là 6 dòng **nên** teo, khác 33 dòng ở trên.

### `@typescript-eslint/no-unused-vars` — 0 (đã teo)

`src/test/renderWithProviders.tsx` từng destructure `tenant: _tenant` để loại nó khỏi `RenderOptions`. Không
test nào truyền `RenderOptions`, nên helper nay chỉ nhận `{ tenant, lang }` và dòng suppression đã gỡ.

## Điều file này KHÔNG nói

- Nó **không** nói các dòng này vô hại. Nó nói **vì sao** từng nhóm được hoãn, và ai/cái gì gỡ được.
- Nó **không** thay `git blame`. Nếu một mục hết đúng thì gate sẽ **đỏ**, và người sửa đọc file này.
