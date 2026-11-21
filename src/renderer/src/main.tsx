import React from 'react'
import ReactDOM from 'react-dom/client'
import { copy } from '@shared/copy'
import App from './App'
import './styles.css'
import { applyRestoredPreferences } from './library-backup'

document.title = copy('app.name')

const root = ReactDOM.createRoot(document.getElementById('root')!)
void applyRestoredPreferences().then(() => root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)).catch(() => root.render(<main role="alert">
  <p>{copy('backup.preferencesFailed')}</p>
  <button type="button" onClick={() => location.reload()}>{copy('backup.retryStartup')}</button>
</main>))
