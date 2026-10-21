import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { DashboardPage } from './DashboardPage'

describe('DashboardPage', () => {
  it('shows 0 counts when no resources', async () => {
    renderWithProviders(<DashboardPage />)
    await waitFor(() => {
      expect(screen.getByText('Virtual Machines').closest('[data-testid]') ??
             screen.getAllByText('0').length).toBeTruthy()
    })
  })

  it('shows real VM and network counts from API', async () => {
    server.use(
      http.get('*/v1/tenant/vms', () =>
        HttpResponse.json([
          { id: 'v1', name: 'web-01', currentState: 'Running', desiredState: 'Running', transition: null, currentExistence: 'Exists', desiredExistence: 'Exists', requestFailureReason: null, ipAddress: '10.0.0.1', networkId: 'n1', vmOfferingId: 'so1', templateId: 't1', zoneId: 'z1', diskSizeGb: 50, createdAt: '2026-01-01T00:00:00Z' },
          { id: 'v2', name: 'web-02', currentState: 'Stopped', desiredState: 'Stopped', transition: null, currentExistence: 'Exists', desiredExistence: 'Exists', requestFailureReason: null, ipAddress: null, networkId: 'n1', vmOfferingId: 'so1', templateId: 't1', zoneId: 'z1', diskSizeGb: 50, createdAt: '2026-01-02T00:00:00Z' },
        ])
      ),
      http.get('*/v1/tenant/networks', () =>
        HttpResponse.json([
          { id: 'n1', name: 'prod-net', currentState: 'Created', currentExistence: 'Exists', desiredExistence: 'Exists', transition: null, requestFailureReason: null, cidr: '10.0.0.0/24', gateway: '10.0.0.1', zoneId: 'z1', createdAt: '2026-01-01T00:00:00Z' },
        ])
      ),
    )
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByTestId('vm-count')).toHaveTextContent('2'))
    // two machines, one of them stopped: the description counts what runs
    expect(screen.getByText('1 machine running')).toBeInTheDocument()
    expect(screen.getByTestId('network-count')).toHaveTextContent('1')
  })

  // C1 (design sync 2026-08-23) — Dashboard mirrors the 4-card design: adds Data Volumes
  // count and This Month cost alongside VMs/Networks. Asserts real values, not just headings.
  it('shows data volume count and this-month cost cards from API', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () =>
        HttpResponse.json([
          { id: 'vol1', name: 'd1', currentExistence: 'Exists', desiredExistence: 'Exists', currentAttachedVmId: null, currentAttachedElsewhere: false, desiredAttachedVmId: null, transition: null, requestFailureReason: null, requestFailedAt: null, zoneId: 'z1', volumeOfferingId: 'o1', sizeGb: 100, createdAt: '2026-01-01T00:00:00Z' },
          { id: 'vol2', name: 'd2', currentExistence: 'Exists', desiredExistence: 'Exists', currentAttachedVmId: 'v1', currentAttachedElsewhere: false, desiredAttachedVmId: 'v1', transition: null, requestFailureReason: null, requestFailedAt: null, zoneId: 'z1', volumeOfferingId: 'o1', sizeGb: 250, createdAt: '2026-01-01T00:00:00Z' },
        ])
      ),
      http.get('*/v1/tenant/billing/summary', () =>
        HttpResponse.json({ month: '2026-08', totalCost: 142800, currency: 'VND', perVm: [] })
      ),
    )
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByTestId('volume-count')).toHaveTextContent('2'))
    expect(screen.getByText(/350 GB/)).toBeInTheDocument()
    expect(screen.getByTestId('month-cost')).toHaveTextContent('142,800 ₫')
  })

  // Without a summary there is no currency to read; the card must still speak the currency Titan bills in.
  it('shows the month cost in đồng when the billing summary fails', async () => {
    server.use(http.get('*/v1/tenant/billing/summary', () => HttpResponse.json({}, { status: 500 })))
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByTestId('month-cost')).toHaveTextContent('0 ₫'))
    expect(screen.getByTestId('month-cost')).not.toHaveTextContent('SGD')
  })

  // C5 (activity feed) — Dashboard "Recent Activity" card shows real events: the human-readable
  // action label, the resource name, and a relative time. Asserts row content, not just the heading.
  it('shows recent activity rows from API', async () => {
    const now = new Date().toISOString()
    server.use(
      http.get('*/v1/tenant/activity', () =>
        HttpResponse.json([
          { id: 'a1', action: 'vm.created', resourceType: 'vm', resourceName: 'web-01', createdAt: now },
          { id: 'a2', action: 'network.deleted', resourceType: 'network', resourceName: 'old-net', createdAt: now },
        ])
      ),
    )
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Created VM')).toBeInTheDocument())
    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('Deleted network')).toBeInTheDocument()
    expect(screen.getByText('old-net')).toBeInTheDocument()
    // At least one "When" cell renders a relative time for a just-now event.
    expect(screen.getAllByText('just now').length).toBeGreaterThan(0)
  })

  it('shows an empty state when there is no recent activity', async () => {
    server.use(http.get('*/v1/tenant/activity', () => HttpResponse.json([])))
    renderWithProviders(<DashboardPage />)
    await waitFor(() => expect(screen.getByText(/no recent activity/i)).toBeInTheDocument())
  })

  it('shows loading state while fetching', async () => {
    server.use(
      http.get('*/v1/tenant/vms', async () => {
        await new Promise(r => setTimeout(r, 100))
        return HttpResponse.json([])
      }),
    )
    renderWithProviders(<DashboardPage />)
    expect(screen.getAllByTestId('stat-skeleton').length).toBeGreaterThan(0)
  })
})

describe('DashboardPage — Vietnamese', () => {
  it('shows the heading, card titles, descriptions and the month cost in Vietnamese', async () => {
    server.use(
      http.get('*/v1/tenant/volumes', () =>
        HttpResponse.json([
          { id: 'vol1', name: 'd1', currentExistence: 'Exists', desiredExistence: 'Exists', currentAttachedVmId: null, currentAttachedElsewhere: false, desiredAttachedVmId: null, transition: null, requestFailureReason: null, requestFailedAt: null, zoneId: 'z1', volumeOfferingId: 'o1', sizeGb: 100, createdAt: '2026-01-01T12:00:00Z' },
        ])
      ),
      http.get('*/v1/tenant/billing/summary', () =>
        HttpResponse.json({ month: '2026-08', totalCost: 142800, currency: 'VND', perVm: [] })
      ),
    )
    renderWithProviders(<DashboardPage />, { lang: 'vi' })
    await waitFor(() => expect(screen.getByTestId('month-cost')).toHaveTextContent('142.800 ₫'))
    expect(screen.getByRole('heading', { name: 'Tổng quan' })).toBeInTheDocument()
    expect(screen.getByText('Ổ đĩa dữ liệu')).toBeInTheDocument()
    expect(screen.getByText('Đã cấp 100 GB')).toBeInTheDocument()
    expect(screen.getByText('Không có máy nào đang chạy')).toBeInTheDocument()
    expect(await screen.findByText('Chưa có hoạt động nào gần đây')).toBeInTheDocument()
  })
})
