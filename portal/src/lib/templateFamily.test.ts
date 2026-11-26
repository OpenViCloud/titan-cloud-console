import { describe, expect, it } from 'vitest'
import { templateFamily } from './templateFamily'

describe('templateFamily', () => {
  it('names the family from the part before the slash', () => {
    expect(templateFamily('ubuntu/22.04')).toEqual({ key: 'ubuntu', label: 'Ubuntu' })
    expect(templateFamily('almalinux/9')).toEqual({ key: 'almalinux', label: 'AlmaLinux' })
    expect(templateFamily('rockylinux/9')).toEqual({ key: 'rockylinux', label: 'Rocky Linux' })
    expect(templateFamily('debian/12')).toEqual({ key: 'debian', label: 'Debian' })
    expect(templateFamily('fedora/41')).toEqual({ key: 'fedora', label: 'Fedora' })
  })

  it('shows an unknown prefix as it is', () => {
    expect(templateFamily('plan9')).toEqual({ key: 'plan9', label: 'plan9' })
    expect(templateFamily('openwrt/23.05')).toEqual({ key: 'openwrt', label: 'openwrt' })
  })
})
