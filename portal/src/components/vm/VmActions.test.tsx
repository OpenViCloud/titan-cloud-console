import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { Vm } from '@/hooks/useVms'
import { VmStatusNote } from './VmActions'

const reason = 'The VM could not be stopped. Please try again or contact support.'

const vm = (fields: Partial<Vm>) =>
  ({
    currentState: 'Running',
    desiredState: 'Running',
    currentExistence: 'Exists',
    desiredExistence: 'Exists',
    transition: null,
    requestFailureReason: null,
    ...fields,
  }) as Vm

describe('VmStatusNote', () => {
  it('says why the request gave up and names the desired state, on a VM that also rests away from it', () => {
    renderWithProviders(<VmStatusNote vm={vm({ currentState: 'Frozen', requestFailureReason: reason })} />)

    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.getByText(/requested.*Running/i)).toBeInTheDocument()
  })

  it('says only why, on a VM at its desired state', () => {
    renderWithProviders(<VmStatusNote vm={vm({ requestFailureReason: reason })} />)

    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.queryByText(/requested/i)).not.toBeInTheDocument()
  })

  it('names the desired state on a VM that drifted with no failure', () => {
    renderWithProviders(<VmStatusNote vm={vm({ currentState: 'Stopped' })} />)

    expect(screen.getByText(/Running/)).toBeInTheDocument()
  })

  it('stays silent on a reason while a new request waits', () => {
    const { container } = renderWithProviders(
      <VmStatusNote vm={vm({ transition: 'Stopping', requestFailureReason: reason })} />,
    )

    expect(container).toHaveTextContent('')
  })
})
