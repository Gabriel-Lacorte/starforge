import type { ComponentType, JSX } from 'preact'
import type { ToolId } from '../store'
import { ICON_PATHS, type IconName } from './iconPaths'

const GRID = 24

function pathIcon(name: IconName, cls = 'tool-ico'): JSX.Element {
    return (
        <svg
            class={cls}
            viewBox={`0 0 ${GRID} ${GRID}`}
            fill="currentColor"
            shape-rendering="crispEdges"
            aria-hidden="true"
        >
            <path d={ICON_PATHS[name]} />
        </svg>
    )
}

function glyph(rows: string[], cls = 'tool-ico'): JSX.Element {
    const rects: JSX.Element[] = []
    for (const [y, row] of rows.entries()) {
        let x = 0
        while (x < row.length) {
            if (row[x] !== '#') {
                x++
                continue
            }

            let w = 1
            while (row[x + w] === '#') w++
            rects.push(<rect key={`${x},${y}`} x={x} y={y} width={w} height={1} />)
            x += w
        }
    }

    return (
        <svg
            class={cls}
            viewBox={`0 0 ${GRID} ${GRID}`}
            fill="currentColor"
            shape-rendering="crispEdges"
            aria-hidden="true"
        >
            {rects}
        </svg>
    )
}

const SELECT_ELLIPSE = [
    '........................',
    '........................',
    '..........####..........',
    '..........####..........',
    '....####........####....',
    '....####........####....',
    '....##............##....',
    '....##............##....',
    '........................',
    '........................',
    '..##................##..',
    '..##................##..',
    '..##................##..',
    '..##................##..',
    '........................',
    '........................',
    '....##............##....',
    '....##............##....',
    '....####........####....',
    '....####........####....',
    '..........####..........',
    '..........####..........',
    '........................',
    '........................',
]

export const TOOL_ICON: Record<ToolId, ComponentType> = {
    select: () => pathIcon('section'),
    selectEllipse: () => glyph(SELECT_ELLIPSE),
    lasso: () => pathIcon('lasso'),
    wand: () => pathIcon('sparkles'),
    eyedropper: () => pathIcon('pipette'),
    pencil: () => pathIcon('pencil'),
    eraser: () => pathIcon('eraser'),
    line: () => pathIcon('scale'),
    rect: () => pathIcon('checkbox-sharp'),
    ellipse: () => pathIcon('circle'),
    bucket: () => pathIcon('potion'),
}

export const FileIcon = () => pathIcon('file', 'mini-ico')
export const LibraryIcon = () => pathIcon('images', 'mini-ico')
export const OpenIcon = () => pathIcon('folder', 'mini-ico')
export const SaveIcon = () => pathIcon('save', 'mini-ico')
export const ExportIcon = () => pathIcon('download', 'mini-ico')
export const SizeIcon = () => pathIcon('expand', 'mini-ico')
export const PanelIcon = () => pathIcon('layout', 'mini-ico')
export const CloseIcon = () => pathIcon('close', 'mini-ico')
export const KeysIcon = () => pathIcon('keyboard', 'mini-ico')
export const UndoIcon = () => pathIcon('undo', 'mini-ico')
export const RedoIcon = () => pathIcon('redo', 'mini-ico')

export const EyeOpenIcon = () => pathIcon('eye', 'mini-ico')
export const EyeClosedIcon = () => pathIcon('eye-off', 'mini-ico')
export const LockedIcon = () => pathIcon('lock', 'mini-ico')
export const UnlockedIcon = () => pathIcon('unlock', 'mini-ico')
export const PlusIcon = () => pathIcon('plus', 'mini-ico')
export const DuplicateIcon = () => pathIcon('copy', 'mini-ico')
export const TrashIcon = () => pathIcon('trash', 'mini-ico')
export const UpIcon = () => pathIcon('arrow-up', 'mini-ico')
export const DownIcon = () => pathIcon('arrow-down', 'mini-ico')
export const FlipXIcon = () => pathIcon('flip-horizontal-2', 'mini-ico')
export const FlipYIcon = () => pathIcon('flip-vertical-2', 'mini-ico')
export const RotateIcon = () => pathIcon('reload', 'mini-ico')
export const PlayIcon = () => pathIcon('play', 'mini-ico')
export const PauseIcon = () => pathIcon('pause', 'mini-ico')
export const LeftIcon = () => pathIcon('arrow-left', 'mini-ico')
export const RightIcon = () => pathIcon('arrow-right', 'mini-ico')
