import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource/space-mono/400.css'
import './index.css'
import App from './App'
import { applyAppearance, readAppearance } from '@/lib/appearance'

applyAppearance(readAppearance())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
