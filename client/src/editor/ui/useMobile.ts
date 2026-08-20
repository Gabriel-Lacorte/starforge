import { useEffect, useState } from 'preact/hooks'

export const COMPACT_QUERY = '(max-width: 720px), (max-height: 480px)'

export function useMobile(): boolean {
    const [phone, setPhone] = useState(() => window.matchMedia(COMPACT_QUERY).matches)

    useEffect(() => {
        const query = window.matchMedia(COMPACT_QUERY)
        const onChange = () => {
            setPhone(query.matches)
        }
        query.addEventListener('change', onChange)
        return () => {
            query.removeEventListener('change', onChange)
        }
    }, [])

    return phone
}
