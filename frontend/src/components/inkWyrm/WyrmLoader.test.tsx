import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InkWyrm } from './InkWyrm'
import { WyrmLoader } from './WyrmLoader'

describe('Ink-glyph Wyrm', () => {
  it('a loader announces what is happening, and the animation stays decorative', () => {
    render(<WyrmLoader label="Logging you in…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Logging you in…')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('a wyrm shown on its own can carry a description', () => {
    render(<InkWyrm width={84} height={76} label="The wyrm, asleep on a stack of books" />)
    expect(screen.getByRole('img', { name: 'The wyrm, asleep on a stack of books' })).toBeInTheDocument()
  })
})
