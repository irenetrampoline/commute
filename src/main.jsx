import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PinGate from './PinGate.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PinGate title="Commute">
      <App />
    </PinGate>
  </StrictMode>
)
