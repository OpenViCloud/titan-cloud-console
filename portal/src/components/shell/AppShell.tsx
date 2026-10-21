import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, Menu, Monitor, Moon, Sun, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useThemeChoice } from './useThemeChoice'
import type { ThemeChoice } from '@/lib/theme'
import { useLang, useT } from '@/i18n/LanguageContext'
import type { Messages } from '@/i18n/en'
import type { Lang } from '@/i18n/lang'

export interface NavEntry {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export interface NavGroup {
  title?: string
  items: NavEntry[]
}

export interface Crumb {
  label: string
  to?: string
}

interface AppShellProps {
  brand: string
  brandSuffix?: string
  groups: NavGroup[]
  crumbs: Crumb[]
  accountLabel: string
  accountSub?: string
  accountItems: ReactNode
  sidebarFooter?: ReactNode
  search?: ReactNode
  children: ReactNode
}

function themeOptions(t: Messages): { value: ThemeChoice; label: string; icon: LucideIcon }[] {
  return [
    { value: 'system', label: t.shell.themeSystem, icon: Monitor },
    { value: 'light', label: t.shell.themeLight, icon: Sun },
    { value: 'dark', label: t.shell.themeDark, icon: Moon },
  ]
}

function languageOptions(t: Messages): { value: Lang; label: string }[] {
  return [
    { value: 'en', label: t.language.english },
    { value: 'vi', label: t.language.vietnamese },
  ]
}

function BrandMark() {
  return (
    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="2.2" />
      </svg>
    </span>
  )
}

export function AppShell({
  brand,
  brandSuffix,
  groups,
  crumbs,
  accountLabel,
  accountSub,
  accountItems,
  sidebarFooter,
  search,
  children,
}: AppShellProps) {
  const location = useLocation()
  // The drawer belongs to the page it was opened on, so any navigation (a link, the back button) closes it.
  const [navOpenOn, setNavOpenOn] = useState<string | null>(null)
  const navOpen = navOpenOn === location.pathname
  const [theme, setTheme] = useThemeChoice()
  const { lang, setLang } = useLang()
  const t = useT()

  function setNavOpen(open: boolean) {
    if (open) {
      setNavOpenOn(location.pathname)
    } else {
      setNavOpenOn(null)
    }
  }

  const initial = accountLabel.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-border bg-card px-4 min-[900px]:px-5">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground min-[900px]:hidden"
          aria-label={t.shell.openNavigation}
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          onClick={() => setNavOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to="/" className="flex items-center gap-2.5 font-bold tracking-tight">
          <BrandMark />
          <span className="text-[15px]">{brand}</span>
          {brandSuffix && <span className="text-[13px] font-medium text-faint">{brandSuffix}</span>}
        </Link>

        {search && <div className="ml-6 hidden flex-1 min-[900px]:block">{search}</div>}

        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-muted"
                aria-label={t.shell.accountMenuFor(accountLabel)}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-[13px] font-bold text-primary-ink">
                  {initial}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-[13px] font-semibold">{accountLabel}</span>
                  {accountSub && <span className="block text-[11.5px] text-faint">{accountSub}</span>}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              {accountItems}
              <DropdownMenuSeparator />
              <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{t.shell.theme}</div>
              {themeOptions(t).map(option => {
                const Icon = option.icon
                const selected = theme === option.value
                return (
                  <DropdownMenuItem
                    key={option.value}
                    role="menuitemradio"
                    aria-checked={selected}
                    onSelect={() => setTheme(option.value)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                    {selected && <span className="ml-auto text-primary-ink" aria-hidden="true">●</span>}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{t.language.title}</div>
              {languageOptions(t).map(option => {
                const selected = lang === option.value
                return (
                  <DropdownMenuItem
                    key={option.value}
                    role="menuitemradio"
                    aria-checked={selected}
                    lang={option.value}
                    onSelect={() => setLang(option.value)}
                  >
                    {option.label}
                    {selected && <span className="ml-auto text-primary-ink" aria-hidden="true">●</span>}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex">
        {navOpen && (
          <div
            className="fixed inset-0 z-40 bg-overlay min-[900px]:hidden"
            aria-hidden="true"
            onClick={() => setNavOpen(false)}
          />
        )}
        <aside
          id="app-sidebar"
          data-open={navOpen}
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-sidebar-border bg-sidebar max-[899px]:transition-transform max-[899px]:duration-200',
            'min-[900px]:sticky min-[900px]:top-[60px] min-[900px]:z-0 min-[900px]:h-[calc(100vh-60px)] min-[900px]:w-[240px] min-[900px]:translate-x-0',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex h-[60px] items-center justify-between border-b border-sidebar-border px-4 min-[900px]:hidden">
            <span className="flex items-center gap-2.5 font-bold">
              <BrandMark />
              {brand}
            </span>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label={t.shell.closeNavigation}
              onClick={() => setNavOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav aria-label={t.shell.mainNavigation} className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
            {groups.map((group, index) => (
              <div key={group.title ?? index} className="flex flex-col gap-0.5">
                {group.title && (
                  <h2 className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{group.title}</h2>
                )}
                {group.items.map(item => {
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setNavOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
                          isActive
                            ? 'bg-primary-soft font-semibold text-primary-ink'
                            : 'text-sidebar-foreground hover:bg-muted hover:text-sidebar-foreground-active',
                        )
                      }
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} />
                      {item.label}
                    </NavLink>
                  )
                })}
              </div>
            ))}
          </nav>
          {sidebarFooter && (
            <div className="border-t border-sidebar-border px-5 py-3 text-[12px] text-faint">{sidebarFooter}</div>
          )}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 min-[900px]:px-8 min-[900px]:py-7">
          <div className="mx-auto max-w-[1180px]">
            {crumbs.length > 0 && (
              <nav aria-label={t.shell.breadcrumb} className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-faint">
                {crumbs.map((crumb, index) => (
                  <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                    {index > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                    {crumb.to ? (
                      <Link to={crumb.to} className="text-muted-foreground hover:text-primary-ink hover:underline">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current="page">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
