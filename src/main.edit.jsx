import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import EditApp from './EditApp.jsx'
import PinGate from './PinGate.jsx'
import './styles.edit.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PinGate title="Commute — Edit">
      <EditApp />
    </PinGate>
  </StrictMode>
)
