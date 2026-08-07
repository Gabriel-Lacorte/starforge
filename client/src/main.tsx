import { render } from 'preact'
import './styles/global.css'
import { App } from './app.tsx'

const root = document.getElementById('app')
if (!root) throw new Error('missing #app root element')

render(<App />, root)
