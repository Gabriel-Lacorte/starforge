import { render } from 'preact'
import './styles/global.css'
import { App } from './App.tsx'

const root = document.getElementById('app')!

if (import.meta.env.DEV && window.location.pathname === '/dev/crdt') {
    void import('./dev/CrdtLab').then(({ CrdtLab }) => {
        render(<CrdtLab />, root)
    })
} else {
    render(<App />, root)
}
