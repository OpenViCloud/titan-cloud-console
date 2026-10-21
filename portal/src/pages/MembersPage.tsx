import { Users } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { useMembers } from '@/hooks/useMembers'
import { useFormat, useT } from '@/i18n/LanguageContext'

export function MembersPage() {
  const { data: members = [], isLoading, isError } = useMembers()
  const t = useT()
  const f = useFormat()

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">{t.members.title}</h1>
          <p className="text-[13px] text-faint mt-1">{t.members.subtitle}</p>
        </div>
      </div>

      {isError && (
        <p className="mb-4 text-sm text-bad bg-bad-soft border border-bad-border rounded-lg px-4 py-3">
          {t.members.loadFailed}
        </p>
      )}

      {!isError && (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.members.memberId}</TableHead>
                <TableHead>{t.members.joined}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={2}>
                      <div className="h-3 w-full bg-muted rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : members.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-faint mb-1">
                        <Users className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <p className="text-[13px] text-faint font-medium">{t.members.empty}</p>
                      <p className="text-xs text-faint">{t.members.emptyHint}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                members.map(member => (
                  <TableRow key={member.id}>
                    <TableCell className="font-mono text-xs text-soft-foreground">{member.keycloakUserId}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.date(member.joinedAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
