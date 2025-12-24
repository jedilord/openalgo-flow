/**
 * WebSocket Service for Real-time Market Data
 * Connects to OpenAlgo WebSocket for LTP, Quote, and Depth streaming
 */

type MessageHandler = (data: LTPUpdate | QuoteUpdate | DepthUpdate) => void
type ConnectionHandler = () => void
type ErrorHandler = (error: Event) => void

export interface LTPUpdate {
  type: 'ltp'
  symbol: string
  exchange: string
  ltp: number
  timestamp: number
}

export interface QuoteUpdate {
  type: 'quote'
  symbol: string
  exchange: string
  data: {
    open: number
    high: number
    low: number
    ltp: number
    prev_close: number
    volume: number
    bid: number
    ask: number
    oi?: number
  }
  timestamp: number
}

export interface DepthUpdate {
  type: 'depth'
  symbol: string
  exchange: string
  data: {
    bids: Array<{ price: number; quantity: number }>
    asks: Array<{ price: number; quantity: number }>
    totalbuyqty: number
    totalsellqty: number
  }
  timestamp: number
}

export interface Instrument {
  symbol: string
  exchange: string
}

type SubscriptionType = 'ltp' | 'quote' | 'depth'

interface Subscription {
  type: SubscriptionType
  instrument: Instrument
  callback: MessageHandler
}

class WebSocketService {
  private ws: WebSocket | null = null
  private wsUrl: string = ''
  private subscriptions: Map<string, Subscription[]> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private isConnecting = false
  private messageQueue: Array<Record<string, unknown>> = []

  private onConnectHandlers: ConnectionHandler[] = []
  private onDisconnectHandlers: ConnectionHandler[] = []
  private onErrorHandlers: ErrorHandler[] = []

  /**
   * Initialize WebSocket connection
   */
  connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      if (this.isConnecting) {
        // Wait for existing connection attempt
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection)
            resolve()
          }
        }, 100)
        return
      }

      this.isConnecting = true
      this.wsUrl = wsUrl

      try {
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected to', wsUrl)
          this.isConnecting = false
          this.reconnectAttempts = 0

          // Process queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift()
            if (msg) this.send(msg)
          }

          // Resubscribe to all existing subscriptions
          this.resubscribeAll()

          this.onConnectHandlers.forEach(handler => handler())
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            this.handleMessage(data)
          } catch (e) {
            console.error('[WebSocket] Failed to parse message:', e)
          }
        }

        this.ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error)
          this.isConnecting = false
          this.onErrorHandlers.forEach(handler => handler(error))
          reject(error)
        }

        this.ws.onclose = () => {
          console.log('[WebSocket] Disconnected')
          this.isConnecting = false
          this.onDisconnectHandlers.forEach(handler => handler())

          // Attempt reconnection
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            console.log(`[WebSocket] Reconnecting... Attempt ${this.reconnectAttempts}`)
            setTimeout(() => {
              this.connect(this.wsUrl).catch(() => {})
            }, this.reconnectDelay * this.reconnectAttempts)
          }
        }
      } catch (error) {
        this.isConnecting = false
        reject(error)
      }
    })
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.subscriptions.clear()
    this.messageQueue = []
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Subscribe to LTP updates
   */
  subscribeLTP(instruments: Instrument[], callback: MessageHandler): void {
    instruments.forEach(instrument => {
      this.addSubscription('ltp', instrument, callback)
    })

    this.send({
      action: 'subscribe',
      type: 'ltp',
      instruments: instruments.map(i => ({ symbol: i.symbol, exchange: i.exchange }))
    })
  }

  /**
   * Unsubscribe from LTP updates
   */
  unsubscribeLTP(instruments: Instrument[]): void {
    instruments.forEach(instrument => {
      this.removeSubscription('ltp', instrument)
    })

    this.send({
      action: 'unsubscribe',
      type: 'ltp',
      instruments: instruments.map(i => ({ symbol: i.symbol, exchange: i.exchange }))
    })
  }

  /**
   * Subscribe to Quote updates
   */
  subscribeQuote(instruments: Instrument[], callback: MessageHandler): void {
    instruments.forEach(instrument => {
      this.addSubscription('quote', instrument, callback)
    })

    this.send({
      action: 'subscribe',
      type: 'quote',
      instruments: instruments.map(i => ({ symbol: i.symbol, exchange: i.exchange }))
    })
  }

  /**
   * Unsubscribe from Quote updates
   */
  unsubscribeQuote(instruments: Instrument[]): void {
    instruments.forEach(instrument => {
      this.removeSubscription('quote', instrument)
    })

    this.send({
      action: 'unsubscribe',
      type: 'quote',
      instruments: instruments.map(i => ({ symbol: i.symbol, exchange: i.exchange }))
    })
  }

  /**
   * Subscribe to Market Depth updates
   */
  subscribeDepth(instruments: Instrument[], callback: MessageHandler): void {
    instruments.forEach(instrument => {
      this.addSubscription('depth', instrument, callback)
    })

    this.send({
      action: 'subscribe',
      type: 'depth',
      instruments: instruments.map(i => ({ symbol: i.symbol, exchange: i.exchange }))
    })
  }

  /**
   * Unsubscribe from Market Depth updates
   */
  unsubscribeDepth(instruments: Instrument[]): void {
    instruments.forEach(instrument => {
      this.removeSubscription('depth', instrument)
    })

    this.send({
      action: 'unsubscribe',
      type: 'depth',
      instruments: instruments.map(i => ({ symbol: i.symbol, exchange: i.exchange }))
    })
  }

  /**
   * Register connection handler
   */
  onConnect(handler: ConnectionHandler): void {
    this.onConnectHandlers.push(handler)
  }

  /**
   * Register disconnection handler
   */
  onDisconnect(handler: ConnectionHandler): void {
    this.onDisconnectHandlers.push(handler)
  }

  /**
   * Register error handler
   */
  onError(handler: ErrorHandler): void {
    this.onErrorHandlers.push(handler)
  }

  /**
   * Remove event handler
   */
  removeHandler(handler: ConnectionHandler | ErrorHandler): void {
    this.onConnectHandlers = this.onConnectHandlers.filter(h => h !== handler)
    this.onDisconnectHandlers = this.onDisconnectHandlers.filter(h => h !== handler)
    this.onErrorHandlers = this.onErrorHandlers.filter(h => h !== handler as ErrorHandler)
  }

  // Private methods

  private getSubscriptionKey(type: SubscriptionType, instrument: Instrument): string {
    return `${type}:${instrument.exchange}:${instrument.symbol}`
  }

  private addSubscription(type: SubscriptionType, instrument: Instrument, callback: MessageHandler): void {
    const key = this.getSubscriptionKey(type, instrument)
    const existing = this.subscriptions.get(key) || []
    existing.push({ type, instrument, callback })
    this.subscriptions.set(key, existing)
  }

  private removeSubscription(type: SubscriptionType, instrument: Instrument): void {
    const key = this.getSubscriptionKey(type, instrument)
    this.subscriptions.delete(key)
  }

  private handleMessage(data: Record<string, unknown>): void {
    // Handle different message types from OpenAlgo WebSocket
    const type = data.type as SubscriptionType
    const symbol = data.symbol as string
    const exchange = data.exchange as string

    if (!type || !symbol || !exchange) {
      // May be a confirmation or error message
      if (data.action === 'subscribed' || data.action === 'unsubscribed') {
        console.log(`[WebSocket] ${data.action}:`, data.instruments)
      }
      return
    }

    const key = this.getSubscriptionKey(type, { symbol, exchange })
    const subscriptions = this.subscriptions.get(key)

    if (subscriptions) {
      const update = {
        type,
        symbol,
        exchange,
        ...(type === 'ltp' ? { ltp: data.ltp, timestamp: Date.now() } : {}),
        ...(type === 'quote' ? { data: data.data, timestamp: Date.now() } : {}),
        ...(type === 'depth' ? { data: data.data, timestamp: Date.now() } : {}),
      } as LTPUpdate | QuoteUpdate | DepthUpdate

      subscriptions.forEach(sub => {
        try {
          sub.callback(update)
        } catch (e) {
          console.error('[WebSocket] Callback error:', e)
        }
      })
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      // Queue message for when connection is established
      this.messageQueue.push(message)
    }
  }

  private resubscribeAll(): void {
    // Group subscriptions by type
    const ltpInstruments: Instrument[] = []
    const quoteInstruments: Instrument[] = []
    const depthInstruments: Instrument[] = []

    this.subscriptions.forEach((subs, key) => {
      if (subs.length > 0) {
        const [type, exchange, symbol] = key.split(':')
        const instrument = { symbol, exchange }

        if (type === 'ltp') ltpInstruments.push(instrument)
        else if (type === 'quote') quoteInstruments.push(instrument)
        else if (type === 'depth') depthInstruments.push(instrument)
      }
    })

    // Resubscribe in batches
    if (ltpInstruments.length > 0) {
      this.send({
        action: 'subscribe',
        type: 'ltp',
        instruments: ltpInstruments
      })
    }

    if (quoteInstruments.length > 0) {
      this.send({
        action: 'subscribe',
        type: 'quote',
        instruments: quoteInstruments
      })
    }

    if (depthInstruments.length > 0) {
      this.send({
        action: 'subscribe',
        type: 'depth',
        instruments: depthInstruments
      })
    }
  }
}

// Export singleton instance
export const wsService = new WebSocketService()

// Export class for testing
export { WebSocketService }
