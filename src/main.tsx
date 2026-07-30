import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './api/queryClient.ts'
import App from './App.tsx'
import './index.css'
import './styles/apple-design.css'
import { registerServiceWorker } from './utils/registerServiceWorker.ts'
import { applyTheme, resolveInitialTheme } from './utils/theme.ts'
import { initPwaInstallPrompt } from './hooks/usePwaInstall.ts'
import { installGlobalClientErrorReporter } from './utils/clientErrorReporter.ts'

initPwaInstallPrompt()
installGlobalClientErrorReporter()
registerServiceWorker()
applyTheme(resolveInitialTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
