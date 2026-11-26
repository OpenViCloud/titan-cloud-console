import { useState } from 'react'
import { useT } from '@/i18n/LanguageContext'
import { templateFamily } from '@/lib/templateFamily'

export interface PickableTemplate {
  id: string
  name: string
  description?: string | null
  os: string
}

interface Family {
  key: string
  label: string
  templates: PickableTemplate[]
}

// The family column and the search box appear only once there is something to narrow
// (titan-ops features/vm/design.md#vm-create-form).
const SEARCH_ABOVE = 6

function groupByFamily(templates: PickableTemplate[]): Family[] {
  const families: Family[] = []
  for (const template of templates) {
    const { key, label } = templateFamily(template.os)
    let family = families.find(f => f.key === key)
    if (family === undefined) {
      family = { key, label, templates: [] }
      families.push(family)
    }
    family.templates.push(template)
  }
  families.sort((a, b) => a.label.localeCompare(b.label))
  return families
}

function matches(template: PickableTemplate, query: string): boolean {
  const needle = query.toLowerCase()
  if (template.name.toLowerCase().includes(needle)) {
    return true
  }
  const description = template.description ?? ''
  return description.toLowerCase().includes(needle)
}

export function VmTemplatePicker({ templates, value, onChange, disabled, emptyText }: {
  templates: PickableTemplate[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  emptyText: string
}) {
  const t = useT()
  const [pickedFamily, setPickedFamily] = useState('')
  const [query, setQuery] = useState('')

  const families = groupByFamily(templates)
  const showFamilies = families.length >= 2
  const showSearch = templates.length > SEARCH_ABOVE
  const searching = showSearch && query.trim() !== ''

  let activeFamily = families.find(f => f.key === pickedFamily)
  if (activeFamily === undefined) {
    activeFamily = families.find(f => f.templates.some(template => template.id === value))
  }
  // Opened first: the family with the most templates, the one a customer is likeliest to want.
  if (activeFamily === undefined) {
    activeFamily = families[0]
    for (const family of families) {
      if (family.templates.length > activeFamily.templates.length) {
        activeFamily = family
      }
    }
  }

  let shown = templates
  if (searching) {
    shown = templates.filter(template => matches(template, query.trim()))
  } else if (showFamilies) {
    shown = activeFamily.templates
  }

  function pickFamily(key: string) {
    setPickedFamily(key)
    setQuery('')
  }

  return (
    <div className="space-y-1.5">
      <p id="vm-template-label" className="text-[13px] font-medium text-soft-foreground">{t.vmCreate.template}</p>
      {templates.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-[13px] text-faint">{emptyText}</div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {showSearch && (
            <div className="border-b border-border p-2">
              <input
                type="search"
                aria-label={t.vmCreate.templateSearch}
                placeholder={t.vmCreate.templateSearch}
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={disabled}
                className="w-full rounded-md border border-border bg-popover px-3 py-1.5 text-[13px] text-foreground placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          <div className={showFamilies ? 'grid grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[9rem_minmax(0,1fr)]' : ''}>
            {showFamilies && (
              <div className="max-h-56 space-y-0.5 overflow-y-auto border-r border-border p-1.5">
                {families.map(family => {
                  const pressed = !searching && family.key === activeFamily.key
                  return (
                    <button
                      key={family.key}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => pickFamily(family.key)}
                      disabled={disabled}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${pressed ? 'bg-muted font-medium text-foreground' : 'text-soft-foreground hover:bg-muted'}`}
                    >
                      {family.label} <span className="text-xs text-faint">{family.templates.length}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div role="radiogroup" aria-labelledby="vm-template-label" className="max-h-56 overflow-y-auto">
              {shown.length === 0 && (
                <p className="px-3 py-2 text-[13px] text-faint">{t.vmCreate.noTemplateMatch}</p>
              )}
              {shown.map(template => (
                <label
                  key={template.id}
                  className={`flex cursor-pointer items-start gap-2.5 border-b border-border px-3 py-2 last:border-b-0 ${value === template.id ? 'bg-primary-soft' : 'hover:bg-muted'}`}
                >
                  <input
                    type="radio"
                    name="vm-template"
                    value={template.id}
                    checked={value === template.id}
                    onChange={() => onChange(template.id)}
                    disabled={disabled}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-foreground">{template.name}</span>
                    {template.description && (
                      <span className="block text-xs text-faint">{template.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
