import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'

const signinRedirect = vi.fn()
vi.mock('./auth', () => ({ userManager: { signinRedirect: (...args: unknown[]) => signinRedirect(...args) } }))

describe('api 401 interceptor', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('sends the user to Keycloak in the language they saved', async () => {
    window.localStorage.setItem('ovc-lang', 'vi')
    server.use(http.get('*/v1/tenant/unauthorized-probe', () => new HttpResponse(null, { status: 401 })))
    const { api } = await import('./api')
    await expect(api.get('/v1/tenant/unauthorized-probe')).rejects.toBeTruthy()
    expect(signinRedirect).toHaveBeenCalledTimes(1)
    expect(signinRedirect).toHaveBeenCalledWith({ ui_locales: 'vi' })
  })
})
