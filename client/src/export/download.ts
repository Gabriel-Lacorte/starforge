export interface DownloadFile {
    readonly blob: Blob
    readonly filename: string
}

export interface DownloadEnvironment {
    createObjectURL(blob: Blob): string
    revokeObjectURL(url: string): void
    click(url: string, filename: string): void
    defer(task: () => void): void
}

export function downloadFile(
    file: DownloadFile,
    environment: DownloadEnvironment = browserDownloadEnvironment(),
): void {
    const url = environment.createObjectURL(file.blob)
    try {
        environment.click(url, file.filename)
    } catch (error) {
        environment.revokeObjectURL(url)
        throw error
    }
    environment.defer(() => environment.revokeObjectURL(url))
}

export function browserDownloadEnvironment(): DownloadEnvironment {
    return {
        createObjectURL: (blob) => URL.createObjectURL(blob),
        revokeObjectURL: (url) => URL.revokeObjectURL(url),
        click: (url, filename) => {
            const link = document.createElement('a')
            link.href = url
            link.download = filename
            document.body.append(link)
            link.click()
            link.remove()
        },
        defer: (task) => {
            setTimeout(task, 60_000)
        },
    }
}
