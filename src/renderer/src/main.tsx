import React from 'react'
import ReactDOM from 'react-dom/client'
import { copy } from '@shared/copy'
import App from './App'
import './styles.css'

document.title = copy('app.name')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
