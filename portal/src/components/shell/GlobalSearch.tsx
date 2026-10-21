import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardDrive, Network as NetworkIcon, Search, Server, type LucideIcon } from 'lucide-react'
import { useVms } from '@/hooks/useVms'
import { useNetworks } from '@/hooks/useNetworks'
import { useVolumes } from '@/hooks/useVolumes'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n/LanguageContext'

interface Hit {
  key: string
  label: string
  detail: string
  kind: string
  icon: LucideIcon
  to: string
}

const MIN_CHARS = 2
const LISTBOX_ID = 'global-search-results'

function matches(query: string, ...values: (string | null | undefined)[]): boolean {
  return values.some(v => v !== null && v !== undefined && v.toLowerCase().includes(query))
}

// Mounted only while there is something to search for, so the lists load once and then come from the
// React Query cache: typing never sends a request.
function SearchResults({ query, activeIndex, onPick, onHits }: {
  query: string
  activeIndex: number
  onPick: (hit: Hit) => void
  onHits: (hits: Hit[]) => void
}) {
  const { data: vms = [] } = useVms()
  const { data: networks = [] } = useNetworks()
  const { data: volumes = [] } = useVolumes()
  const q = query.toLowerCase()
  const t = useT()

  const hits: Hit[] = [
    ...vms
      .filter(vm => matches(q, vm.name, vm.ipAddress, vm.publicIpv6Address))
      .map(vm => ({ key: `vm-${vm.id}`, label: vm.name, detail: vm.ipAddress ?? '', kind: t.search.kindVm, icon: Server, to: `/vms/${vm.id}` })),
    ...networks
      .filter(n => matches(q, n.name, n.cidr))
      .map(n => ({ key: `net-${n.id}`, label: n.name, detail: n.cidr ?? '', kind: t.search.kindNetwork, icon: NetworkIcon, to: `/networks?q=${encodeURIComponent(n.name)}` })),
    ...volumes
      .filter(v => matches(q, v.name))
      .map(v => ({ key: `vol-${v.id}`, label: v.name, detail: '', kind: t.search.kindVolume, icon: HardDrive, to: `/volumes?q=${encodeURIComponent(v.name)}` })),
  ].slice(0, 8)

  onHits(hits)

  return (
    <div
      id={LISTBOX_ID}
      role="listbox"
      aria-label={t.search.results}
      className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-xl shadow-overlay"
    >
      {hits.length === 0 && <p className="px-3 py-2.5 text-[13px] text-muted-foreground">{t.search.noMatch(query)}</p>}
      {hits.map((hit, index) => {
        const Icon = hit.icon
        return (
          <button
            key={hit.key}
            id={`${LISTBOX_ID}-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPick(hit)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2 text-left text-[13px]',
              index === activeIndex ? 'bg-muted' : 'hover:bg-muted',
            )}
          >
            <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{hit.label}</span>
            {hit.detail !== '' && <span className="font-mono text-[12px] text-faint">{hit.detail}</span>}
            <span className="text-[11px] text-faint">{hit.kind}</span>
          </button>
        )
      })}
    </div>
  )
}

function typingInAField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const hitsRef = useRef<Hit[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const showResults = open && query.trim().length >= MIN_CHARS
  const t = useT()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && !typingInAField(e.target)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function pick(hit: Hit) {
    setOpen(false)
    setQuery('')
    navigate(hit.to)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!showResults) {
      return
    }
    const count = hitsRef.current.length
    if (e.key === 'ArrowDown' && count > 0) {
      e.preventDefault()
      setActiveIndex((activeIndex + 1) % count)
    } else if (e.key === 'ArrowUp' && count > 0) {
      e.preventDefault()
      setActiveIndex((activeIndex - 1 + count) % count)
    } else if (e.key === 'Enter' && count > 0) {
      e.preventDefault()
      pick(hitsRef.current[Math.min(activeIndex, count - 1)])
    }
  }

  return (
    <div className="relative w-full max-w-[440px]">
      <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-faint focus-within:border-ring">
        <Search className="h-4 w-4 flex-shrink-0" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={t.search.label}
          aria-expanded={showResults}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={showResults ? `${LISTBOX_ID}-${activeIndex}` : undefined}
          value={query}
          placeholder={t.search.placeholder}
          onChange={e => {
            setQuery(e.target.value)
            setActiveIndex(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
        />
        <kbd className="rounded border border-border px-1.5 font-mono text-[11px]">/</kbd>
      </div>
      {showResults && (
        <SearchResults
          query={query.trim()}
          activeIndex={activeIndex}
          onPick={pick}
          onHits={hits => { hitsRef.current = hits }}
        />
      )}
    </div>
  )
}
