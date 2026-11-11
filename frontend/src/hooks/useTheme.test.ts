import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('ignores a stored value that is not light or dark', () => {
    mockMatchMedia(true)
    localStorage.setItem('bookwyrm-theme', 'purple')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark') // fell back to the OS setting
  })

  it('still works when storage is unavailable', () => {
    mockMatchMedia(false)
    // Storage methods live on the prototype, so spy there (spyOn on the instance does not intercept them)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    act(() => result.current.toggle())
    expect(result.current.theme).toBe('dark') // the choice holds for this visit even though it can't be saved
    vi.restoreAllMocks()
  })

  it('toggles, applies to <html> and remembers the choice', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    act(() => result.current.toggle())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('bookwyrm-theme')).toBe('dark')
  })
})
