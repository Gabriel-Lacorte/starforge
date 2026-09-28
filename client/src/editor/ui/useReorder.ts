import { useEffect, useRef } from 'preact/hooks'

interface ReorderContainer {
    current: HTMLElement | null
}

interface Arming {
    pointerId: number
    item: HTMLElement
    x: number
    y: number
    timer: number
}

type ReorderCommit = (from: number, to: number) => void

const THRESHOLD_PX = 6
const LONG_PRESS_MS = 260
const SCROLL_INTENT_PX = 8

interface DragState {
    pointerId: number
    item: HTMLElement
    items: HTMLElement[]
    from: number
    to: number
    axis: 'x' | 'y'
    startX: number
    startY: number
    stride: number
}

export function useReorder(
    container: ReorderContainer,
    selector: string,
    onReorder: ReorderCommit,
): void {
    const commit = useRef(onReorder)
    commit.current = onReorder

    useEffect(() => {
        const root = container.current
        if (!root) return

        let drag: DragState | null = null
        let arming: Arming | null = null

        const strip = (state: DragState): void => {
            for (const el of state.items) {
                el.style.transform = ''
                el.style.transition = ''
                el.style.zIndex = ''
                el.style.opacity = ''
                el.classList.remove('reorder-source')
            }
        }

        const cancelArm = (): void => {
            if (!arming) return
            clearTimeout(arming.timer)
            arming = null
        }

        const end = (): void => {
            cancelArm()
            if (!drag) return
            const state = drag
            drag = null
            state.item.dataset.reorderDragged = '1'
            strip(state)
            document.removeEventListener('touchmove', preventTouchScroll)
            if (state.to !== state.from) commit.current(state.from, state.to)
        }

        const preventTouchScroll = (event: TouchEvent): void => {
            if (drag) event.preventDefault()
        }

        const begin = (
            pointerId: number,
            item: HTMLElement,
            x: number,
            y: number,
        ): DragState | null => {
            const items = [...root.querySelectorAll<HTMLElement>(selector)]
            if (items.length < 2) return null

            const from = items.indexOf(item)
            if (from === -1) return null

            for (const el of items) delete el.dataset.reorderDragged

            const a = items[0]!.getBoundingClientRect()
            const b = items[1]!.getBoundingClientRect()
            const axis: 'x' | 'y' = Math.abs(a.top - b.top) < 2 ? 'x' : 'y'
            const stride = axis === 'x' ? b.left - a.left : b.top - a.top || a.height

            try {
                item.setPointerCapture(pointerId)
            } catch {
                /* the pointer went away between down and now */
            }
            item.classList.add('reorder-source')
            for (const el of items) {
                if (el !== item) el.style.transition = 'transform 0.12s'
            }

            const state: DragState = {
                pointerId,
                item,
                items,
                from,
                to: from,
                axis,
                startX: x,
                startY: y,
                stride: Math.abs(stride) || 24,
            }
            drag = state
            document.addEventListener('touchmove', preventTouchScroll, {
                passive: false,
            })
            return state
        }

        const paint = (state: DragState, x: number, y: number): void => {
            const dx = x - state.startX
            const dy = y - state.startY
            state.item.style.transform = `translate(${dx}px, ${dy}px)`
            state.item.style.zIndex = '1'
            state.item.style.opacity = '0.85'

            const pointer = state.axis === 'x' ? x : y
            let to = 0
            for (let i = 0; i < state.items.length; i++) {
                if (i === state.from) continue
                const rect = state.items[i]!.getBoundingClientRect()
                const middle =
                    state.axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2
                if (pointer > middle) to++
            }
            state.to = to

            for (let i = 0; i < state.items.length; i++) {
                const el = state.items[i]!
                if (el === state.item) continue

                let shift = 0
                if (state.from < state.to && i > state.from && i <= state.to) shift = -state.stride
                else if (state.to < state.from && i >= state.to && i < state.from)
                    shift = state.stride

                el.style.transform = shift
                    ? `translate${state.axis === 'x' ? 'X' : 'Y'}(${shift}px)`
                    : ''
            }
        }

        const onPointerDown = (event: PointerEvent): void => {
            if (event.button !== 0 || drag) return
            const item = (event.target as HTMLElement).closest<HTMLElement>(selector)
            if (!item || !root.contains(item)) return

            const x = event.clientX
            const y = event.clientY
            const pointerId = event.pointerId

            if (event.pointerType === 'mouse') {
                arming = { pointerId, item, x, y, timer: 0 }
                return
            }

            const timer = window.setTimeout(() => {
                if (arming?.item !== item) return
                arming = null
                const state = begin(pointerId, item, x, y)
                if (state) paint(state, x, y)
            }, LONG_PRESS_MS)
            arming = { pointerId, item, x, y, timer }
        }

        const onPointerMove = (event: PointerEvent): void => {
            if (drag) {
                if (drag.pointerId !== event.pointerId) return
                paint(drag, event.clientX, event.clientY)
                return
            }
            if (arming?.pointerId !== event.pointerId) return

            const moved = Math.hypot(event.clientX - arming.x, event.clientY - arming.y)
            if (moved < SCROLL_INTENT_PX) return

            if (event.pointerType === 'mouse' && moved >= THRESHOLD_PX) {
                const { item, x, y, pointerId } = arming
                cancelArm()
                const state = begin(pointerId, item, x, y)
                if (state) paint(state, event.clientX, event.clientY)
            } else if (event.pointerType !== 'mouse') {
                cancelArm()
            }
        }

        const onPointerEnd = (event: PointerEvent): void => {
            if (drag?.pointerId === event.pointerId) end()
            else cancelArm()
        }

        const onContextMenu = (event: MouseEvent): void => {
            if (drag || arming?.timer) event.preventDefault()
        }

        const onClickGuard = (event: MouseEvent): void => {
            if (drag || arming) return
            const item = (event.target as HTMLElement).closest<HTMLElement>(selector)
            if (item?.dataset.reorderDragged) {
                event.stopPropagation()
                event.preventDefault()
                delete item.dataset.reorderDragged
            }
        }

        root.addEventListener('pointerdown', onPointerDown)
        root.addEventListener('pointermove', onPointerMove)
        root.addEventListener('pointerup', onPointerEnd)
        root.addEventListener('pointercancel', onPointerEnd)
        root.addEventListener('contextmenu', onContextMenu)
        root.addEventListener('click', onClickGuard, true)

        return () => {
            root.removeEventListener('pointerdown', onPointerDown)
            root.removeEventListener('pointermove', onPointerMove)
            root.removeEventListener('pointerup', onPointerEnd)
            root.removeEventListener('pointercancel', onPointerEnd)
            root.removeEventListener('contextmenu', onContextMenu)
            root.removeEventListener('click', onClickGuard, true)
            document.removeEventListener('touchmove', preventTouchScroll)
            if (drag) {
                drag.item.dataset.reorderDragged = '1'
                strip(drag)
                drag = null
            }
            cancelArm()
        }
    }, [container, selector])
}
