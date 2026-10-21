import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { renderWithProviders } from '@/test/renderWithProviders'
import { NotFoundPage, RouteErrorPage } from './NotFoundPage'
import { createRouter } from '@/lib/router'

// A path no route matches, or a page that throws, used to fall through to react-router's own English error screen.
describe('NotFoundPage', () => {
  it('says the page does not exist and links back to the overview', () => {
    renderWithProviders(<MemoryRouter><NotFoundPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/')
  })

  it('speaks Vietnamese', () => {
    renderWithProviders(<MemoryRouter><NotFoundPage /></MemoryRouter>, { lang: 'vi' })

    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang tổng quan' })).toBeInTheDocument()
  })

  it('has a page for a failure too, with the same way back', () => {
    renderWithProviders(<MemoryRouter><RouteErrorPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/')
  })

  it('is what the portal router serves for an unknown path and for a failing page', () => {
    const app = createRouter().routes.find(route => route.path === '/')
    if (app === undefined) {
      throw new Error('the portal router has no / route')
    }
    const errorElement = app.errorElement as { type: unknown }
    expect(errorElement.type).toBe(RouteErrorPage)

    if (app.children === undefined) {
      throw new Error('the / route has no children')
    }
    const unknownPath = app.children.find(route => route.path === '*')
    if (unknownPath === undefined) {
      throw new Error('the / route has no * child')
    }
    const notFound = unknownPath.element as { type: unknown }
    expect(notFound.type).toBe(NotFoundPage)
  })
})
