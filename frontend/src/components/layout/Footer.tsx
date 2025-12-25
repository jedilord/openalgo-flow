import { useLocation } from 'react-router-dom'
import { APP_NAME, APP_FULL_VERSION } from '@/lib/constants'

export function Footer() {
  const location = useLocation()

  // Hide footer on editor page (full-screen workflow editor)
  if (location.pathname.startsWith('/editor')) {
    return null
  }

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-card/80 backdrop-blur-sm">
      <div className="flex h-8 items-center justify-center px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{APP_NAME}</span>
          <span className="text-muted-foreground/60">|</span>
          <span>v{APP_FULL_VERSION}</span>
          <span className="text-muted-foreground/60">|</span>
          <span>Powered by OpenAlgo API</span>
        </div>
      </div>
    </footer>
  )
}
