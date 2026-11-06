import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { Vm } from '@/hooks/useVms'
import { VmStatusNote } from './VmActions'

const reason = 'The VM could not be stopped. Please try again or contact support.'

const vm = (fields: Partial<Vm>) =>
  ({
    status: 'Running',
    requestFailureReason: null,
    ...fields,
  }) as Vm

describe('VmStatusNote', () => {
  it('says why the request gave up, beside the status Incus left the VM in', () => {
    renderWithProviders(<VmStatusNote vm={vm({ status: 'Frozen', requestFailureReason: reason })} />)

    expect(screen.getByText(reason)).toBeInTheDocument()
  })

  it('says nothing on a VM with no failed request, whatever its status', () => {
    const { container } = renderWithProviders(<VmStatusNote vm={vm({ status: 'Stopped' })} />)

    expect(container).toHaveTextContent('')
  })

  it('stays silent on a reason while a new request waits', () => {
    const { container } = renderWithProviders(
      <VmStatusNote vm={vm({ status: 'Stopping', requestFailureReason: reason })} />,
    )

    expect(container).toHaveTextContent('')
  })
})
