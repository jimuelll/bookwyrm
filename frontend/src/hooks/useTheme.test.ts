import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockMatchMedia } from '../test/setup'
import { useTheme } from './useTheme'

describe('useTheme', () => {
  it('follows the OS setting when nothing is stored', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('prefers a stored choice over the OS setting', () => {
    mockMatchMedia(true)
    localStorage.setItem('bookwyrm-theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })

  it('toggles, applies to <html> and remembers the choice', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    act(() => result.current.toggle())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('bookwyrm-theme')).toBe('dark')
  })
})
