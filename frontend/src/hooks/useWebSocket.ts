/**
 * React hooks for WebSocket market data streaming
 */

import { useEffect, useCallback, useRef, useState } from 'react'
import { wsService, type Instrument, type LTPUpdate, type QuoteUpdate, type DepthUpdate } from '@/lib/websocket'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Hook to manage WebSocket connection
 */
export function useWebSocketConnection() {
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { openalgo_ws_url, is_configured } = useSettingsStore()

  useEffect(() => {
    if (!is_configured || !openalgo_ws_url) {
      return
    }

    const handleConnect = () => {
      setIsConnected(true)
      setError(null)
    }

    const handleDisconnect = () => {
      setIsConnected(false)
    }

    const handleError = () => {
      setError('WebSocket connection failed')
    }

    wsService.onConnect(handleConnect)
    wsService.onDisconnect(handleDisconnect)
    wsService.onError(handleError)

    // Connect to WebSocket
    wsService.connect(openalgo_ws_url).catch((err) => {
      console.error('Failed to connect WebSocket:', err)
      setError('Failed to connect to market data stream')
    })

    return () => {
      wsService.removeHandler(handleConnect)
      wsService.removeHandler(handleDisconnect)
      wsService.removeHandler(handleError)
    }
  }, [openalgo_ws_url, is_configured])

  const reconnect = useCallback(() => {
    if (openalgo_ws_url) {
      wsService.disconnect()
      wsService.connect(openalgo_ws_url).catch((err) => {
        console.error('Failed to reconnect WebSocket:', err)
      })
    }
  }, [openalgo_ws_url])

  return { isConnected, error, reconnect }
}

/**
 * Hook to subscribe to LTP updates for a single instrument
 */
export function useLTP(symbol: string, exchange: string) {
  const [ltp, setLtp] = useState<number | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const callbackRef = useRef<(data: LTPUpdate | QuoteUpdate | DepthUpdate) => void>()

  useEffect(() => {
    if (!symbol || !exchange) return

    const instrument: Instrument = { symbol, exchange }

    callbackRef.current = (data) => {
      if (data.type === 'ltp') {
        const ltpData = data as LTPUpdate
        setLtp(ltpData.ltp)
        setLastUpdate(ltpData.timestamp)
      }
    }

    wsService.subscribeLTP([instrument], callbackRef.current)

    return () => {
      wsService.unsubscribeLTP([instrument])
    }
  }, [symbol, exchange])

  return { ltp, lastUpdate }
}

/**
 * Hook to subscribe to LTP updates for multiple instruments
 */
export function useMultipleLTP(instruments: Instrument[]) {
  const [prices, setPrices] = useState<Map<string, number>>(new Map())
  const callbackRef = useRef<(data: LTPUpdate | QuoteUpdate | DepthUpdate) => void>()

  useEffect(() => {
    if (!instruments || instruments.length === 0) return

    callbackRef.current = (data) => {
      if (data.type === 'ltp') {
        const ltpData = data as LTPUpdate
        const key = `${ltpData.exchange}:${ltpData.symbol}`
        setPrices(prev => {
          const next = new Map(prev)
          next.set(key, ltpData.ltp)
          return next
        })
      }
    }

    wsService.subscribeLTP(instruments, callbackRef.current)

    return () => {
      wsService.unsubscribeLTP(instruments)
    }
  }, [JSON.stringify(instruments)])

  const getPrice = useCallback((symbol: string, exchange: string) => {
    return prices.get(`${exchange}:${symbol}`) ?? null
  }, [prices])

  return { prices, getPrice }
}

/**
 * Hook to subscribe to full quote updates
 */
export function useQuote(symbol: string, exchange: string) {
  const [quote, setQuote] = useState<QuoteUpdate['data'] | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const callbackRef = useRef<(data: LTPUpdate | QuoteUpdate | DepthUpdate) => void>()

  useEffect(() => {
    if (!symbol || !exchange) return

    const instrument: Instrument = { symbol, exchange }

    callbackRef.current = (data) => {
      if (data.type === 'quote') {
        const quoteData = data as QuoteUpdate
        setQuote(quoteData.data)
        setLastUpdate(quoteData.timestamp)
      }
    }

    wsService.subscribeQuote([instrument], callbackRef.current)

    return () => {
      wsService.unsubscribeQuote([instrument])
    }
  }, [symbol, exchange])

  return { quote, lastUpdate }
}

/**
 * Hook to subscribe to market depth updates
 */
export function useDepth(symbol: string, exchange: string) {
  const [depth, setDepth] = useState<DepthUpdate['data'] | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const callbackRef = useRef<(data: LTPUpdate | QuoteUpdate | DepthUpdate) => void>()

  useEffect(() => {
    if (!symbol || !exchange) return

    const instrument: Instrument = { symbol, exchange }

    callbackRef.current = (data) => {
      if (data.type === 'depth') {
        const depthData = data as DepthUpdate
        setDepth(depthData.data)
        setLastUpdate(depthData.timestamp)
      }
    }

    wsService.subscribeDepth([instrument], callbackRef.current)

    return () => {
      wsService.unsubscribeDepth([instrument])
    }
  }, [symbol, exchange])

  return { depth, lastUpdate }
}
