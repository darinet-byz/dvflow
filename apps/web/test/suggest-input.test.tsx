// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SuggestInput } from '../src/ui/SuggestInput'

afterEach(cleanup)

describe('SuggestInput batch', () => {
  it('menampilkan saran tetapi tetap menerima ketikan bebas', () => {
    const onChange = vi.fn()
    render(
      <SuggestInput
        id="batch"
        ariaLabel="Filter batch"
        value=""
        onChange={onChange}
        options={[{ value: '122', label: 'Zul (01) · aktivitas terakhir 6 Nov 2026', hint: '3 order · 5 tiket' }]}
      />,
    )

    const input = screen.getByLabelText('Filter batch') as HTMLInputElement
    fireEvent.focus(input)
    expect(screen.getByText('Batch 122')).toBeTruthy()
    fireEvent.change(input, { target: { value: '999' } })
    expect(onChange).toHaveBeenLastCalledWith('999')
  })

  it('mengisi nilai saat saran diklik', () => {
    const onChange = vi.fn()
    render(
      <SuggestInput
        id="batch"
        ariaLabel="Filter batch"
        value="122"
        onChange={onChange}
        options={[{ value: '122', label: 'Zul (01)' }]}
      />,
    )
    fireEvent.focus(screen.getByLabelText('Filter batch'))
    fireEvent.click(screen.getByText('Batch 122'))
    expect(onChange).toHaveBeenCalledWith('122')
  })
})
