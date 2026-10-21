import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/renderWithProviders'
import { GlobalSearch } from './GlobalSearch'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderSearch() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/']}>
      <GlobalSearch />
      <input aria-label="Other field" />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

function seed() {
  let calls = 0
  server.use(
    http.get('*/v1/tenant/vms', () => {
      calls++
      return HttpResponse.json([
        { id: 'vm-1', name: 'web-01', ipAddress: '10.20.0.11', publicIpv6Address: null },
        { id: 'vm-2', name: 'db-01', ipAddress: '10.20.0.12', publicIpv6Address: null },
      ])
    }),
    http.get('*/v1/tenant/networks', () => {
      calls++
      return HttpResponse.json([{ id: 'n-1', name: 'web-net', cidr: '10.30.0.0/24' }])
    }),
    http.get('*/v1/tenant/volumes', () => {
      calls++
      return HttpResponse.json([{ id: 'v-1', name: 'web-data' }])
    }),
  )
  return () => calls
}

const box = () => screen.getByRole('combobox', { name: /search/i })

describe('GlobalSearch', () => {
  it('lists VMs, networks and volumes matching by name once 2 characters are typed', async () => {
    seed()
    renderSearch()
    await userEvent.type(box(), 'w')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await userEvent.type(box(), 'e')
    const options = await screen.findAllByRole('option')
    await waitFor(() => expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      expect.stringContaining('web-01'),
      expect.stringContaining('web-net'),
      expect.stringContaining('web-data'),
    ]))
    expect(options.length).toBeGreaterThan(0)
  })

  it('matches a VM by its IP and opens its page', async () => {
    seed()
    renderSearch()
    await userEvent.type(box(), '10.20.0.12')
    await userEvent.click(await screen.findByRole('option', { name: /db-01/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/vms/vm-2')
  })

  it('opens the network list filtered to the chosen network', async () => {
    seed()
    renderSearch()
    await userEvent.type(box(), 'web-n')
    await userEvent.click(await screen.findByRole('option', { name: /web-net/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/networks?q=web-net')
  })

  it('focuses on / unless another field has focus, and Escape closes the results', async () => {
    seed()
    renderSearch()
    await userEvent.click(screen.getByRole('textbox', { name: 'Other field' }))
    await userEvent.keyboard('/')
    expect(box()).not.toHaveFocus()
    await userEvent.click(document.body)
    await userEvent.keyboard('/')
    expect(box()).toHaveFocus()
    await userEvent.type(box(), 'web')
    await screen.findAllByRole('option')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('makes no request per keystroke', async () => {
    const calls = seed()
    renderSearch()
    await userEvent.type(box(), 'we')
    await screen.findAllByRole('option')
    const afterFirstResults = calls()
    await userEvent.type(box(), 'b-0')
    await screen.findAllByRole('option')
    expect(calls()).toBe(afterFirstResults)
  })
})
