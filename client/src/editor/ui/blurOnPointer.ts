export function blurOnPointer(event: MouseEvent): void {
    if (event.detail === 0) return
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur()
}
