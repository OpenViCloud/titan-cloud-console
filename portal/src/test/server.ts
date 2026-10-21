import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const defaultTenant = { id: 'tenant-1', name: 'alice', status: 'Active', maxVms: 10, maxNetworks: 1 }

export const defaultBillingSummary = {
  month: '2026-04',
  totalCost: 0,
  currency: 'VND',
  perVm: [],
}

export const handlers = [
  http.get('*/v1/tenant', () => HttpResponse.json(defaultTenant)),
  http.get('*/v1/tenant/vms', () => HttpResponse.json([])),
  http.get('*/v1/tenant/networks', () => HttpResponse.json([])),
  http.get('*/v1/zones', () => HttpResponse.json([])),
  http.get('*/v1/templates', () => HttpResponse.json([])),
  http.get('*/v1/tenant/billing/summary', () => HttpResponse.json(defaultBillingSummary)),
  http.get('*/v1/tenant/volumes', () => HttpResponse.json([])),
  http.get('*/v1/tenant/volumes/*/snapshots', () => HttpResponse.json([])),
  http.get('*/v1/volume-offerings', () => HttpResponse.json([])),
  http.get('*/v1/vm-offerings', () => HttpResponse.json([])),
  http.get('*/v1/tenant/vms/*/snapshots', () => HttpResponse.json([])),
  http.get('*/v1/tenant/networks/*/firewall-rules', () => HttpResponse.json([])),
  http.get('*/v1/tenant/ssh-keys', () => HttpResponse.json([])),
  http.get('*/v1/tenant/api-tokens', () => HttpResponse.json([])),
  http.get('*/v1/tenant/activity', () => HttpResponse.json([])),
  // Legal consent (US-LEGAL) — default: caller has already accepted, so the gate is transparent to the
  // vast majority of tests. Tests that exercise the gate override this per-test.
  http.get('*/v1/legal/consent-status', () =>
    HttpResponse.json({ mustAcceptTerms: false, documentKey: 'terms', documentVersion: 'v0-placeholder' })),
  http.post('*/v1/legal/acceptance', () => new HttpResponse(null, { status: 204 })),
  // The text follows ?lang=, like the control plane: vi ⇒ Vietnamese, anything else ⇒ English.
  http.get('*/v1/legal/document', ({ request }) => {
    const vietnamese = new URL(request.url).searchParams.get('lang') === 'vi'
    return HttpResponse.json({
      key: 'terms',
      version: 'v0-placeholder',
      title: vietnamese ? 'Điều khoản dịch vụ' : 'Terms of Service',
      content: vietnamese ? '# Điều khoản dịch vụ (BẢN NHÁP)' : '# Terms of Service (DRAFT)',
      effectiveAt: '2026-09-01T00:00:00Z',
      lang: vietnamese ? 'vi' : 'en',
    })
  }),
]

export const server = setupServer(...handlers)
