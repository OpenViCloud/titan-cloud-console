// VietQR image for a top-up. SePay renders a dynamic QR (amount + memo baked in) from a plain image
// URL — no server call needed. The memo carries the TopUp's PaymentRef so the SePay webhook can match
// the transfer back to the purchase. Bank account/code come from build-time env; sensible placeholders
// keep the page from breaking in dev/preview where they are unset (A-CSP: the portal CSP img-src must
// allow qr.sepay.vn on staging).
export function vietQrUrl(amount: number, paymentRef: string): string {
  const acc = import.meta.env.VITE_SEPAY_ACC ?? '0000000000'
  const bank = import.meta.env.VITE_SEPAY_BANK ?? 'MBBank'
  const params = new URLSearchParams({
    acc,
    bank,
    amount: String(Math.round(amount)),
    des: paymentRef,
  })
  return `https://qr.sepay.vn/img?${params.toString()}`
}

// The merchant account details shown as a text fallback when the QR image cannot load.
export function sepayBankInfo() {
  return {
    account: import.meta.env.VITE_SEPAY_ACC ?? '0000000000',
    bank: import.meta.env.VITE_SEPAY_BANK ?? 'MBBank',
  }
}
