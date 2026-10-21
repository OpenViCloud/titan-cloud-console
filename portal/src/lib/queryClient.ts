import { MutationCache, QueryClient } from '@tanstack/react-query'

// The tenant portal's QueryClient. staleTime 30 s keeps navigation cheap, which is right for lists
// the page itself refreshes after its own mutations (each hook invalidates its own key). The activity
// feed is the one query EVERY action writes to, and no single hook owns it — so it is refreshed here,
// once, for any mutation that succeeded (INTENT-4 S-D, DASHBOARD-STALE). A failed mutation changed
// nothing, so it refreshes nothing.
export function createAppQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
    mutationCache: new MutationCache({
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: ['activity'] })
      },
    }),
  })
  return client
}
