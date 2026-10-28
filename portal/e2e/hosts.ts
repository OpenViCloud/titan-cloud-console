// Every e2e spec runs against a deployed environment the caller names. None picks a host by itself: a run that forgets
// the variable stops here instead of reaching production, where some specs change real prices and real wallets.
export function requiredHost(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set: name the environment this spec runs against, e.g. ${name}=https://<its host>`)
  }
  return value.replace(/\/+$/, '')
}

// A RegExp matching a URL on the origin of url, for waitForURL and toHaveURL. Anchored: a sign-in page carries the
// portal's address in its redirect_uri, and an unanchored match would take that page for the portal.
export function hostPattern(url: string): RegExp {
  return new RegExp('^' + new URL(url).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(/|$)')
}
