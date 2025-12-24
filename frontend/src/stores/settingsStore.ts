import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  openalgo_host: string
  openalgo_ws_url: string
  is_configured: boolean
  has_api_key: boolean
  isLoading: boolean
  analyzerMode: boolean

  setSettings: (settings: {
    openalgo_host: string
    openalgo_ws_url: string
    is_configured: boolean
    has_api_key: boolean
  }) => void
  setLoading: (loading: boolean) => void
  setAnalyzerMode: (enabled: boolean) => void
  toggleAnalyzerMode: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      openalgo_host: 'http://127.0.0.1:5000',
      openalgo_ws_url: 'ws://127.0.0.1:8765',
      is_configured: false,
      has_api_key: false,
      isLoading: true,
      analyzerMode: false,

      setSettings: (settings) => set({
        ...settings,
        isLoading: false,
      }),

      setLoading: (loading) => set({ isLoading: loading }),

      setAnalyzerMode: (enabled) => set({ analyzerMode: enabled }),

      toggleAnalyzerMode: () => set((state) => ({ analyzerMode: !state.analyzerMode })),
    }),
    {
      name: 'openalgo-flow-settings',
      partialize: (state) => ({ analyzerMode: state.analyzerMode }),
    }
  )
)
