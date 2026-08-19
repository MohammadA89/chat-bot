import { useCallback, useEffect, useRef, useState } from 'react'

interface ResizeHandleProps {
  /** Which viewport edge the resized panel is flush against, in inline terms. */
  anchor: 'start' | 'end'
  width: number
  min: number
  max: number
  onResize(width: number): void
  label: string
}

const STEP = 16

/**
 * The drag divider between a docked panel and the conversation.
 *
 * Both panels sit flush against a viewport edge, so the new width follows
 * straight from the pointer position — no element measuring, and it stays
 * correct in the RTL layout where «start» is the right-hand edge.
 */
export function ResizeHandle({ anchor, width, min, max, onResize, label }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const frame = useRef(0)

  const widthAt = useCallback((clientX: number) => {
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
    const fromStart = rtl ? window.innerWidth - clientX : clientX
    const next = anchor === 'start' ? fromStart : window.innerWidth - fromStart
    return Math.round(Math.min(max, Math.max(min, next)))
  }, [anchor, max, min])

  useEffect(() => {
    if (!dragging) return

    const move = (event: PointerEvent) => {
      event.preventDefault()
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        onResize(widthAt(event.clientX))
      })
    }
    const stop = () => setDragging(false)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    document.body.classList.add('resizing')

    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('resizing')
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [dragging, onResize, widthAt])

  return (
    <div
      className={`resize-handle${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDoubleClick={() => onResize(Math.round((min + max) / 2))}
      onKeyDown={(event) => {
        // In RTL the visual direction of the arrow keys is mirrored, so widening
        // always follows the key that points away from the panel's own edge.
        const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
        const grow = anchor === 'start' ? (rtl ? 'ArrowLeft' : 'ArrowRight') : (rtl ? 'ArrowRight' : 'ArrowLeft')
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const next = event.key === grow ? width + STEP : width - STEP
        onResize(Math.round(Math.min(max, Math.max(min, next))))
      }}
    />
  )
}
