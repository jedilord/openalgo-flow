"""
Price Monitor Service
Real-time WebSocket-based price monitoring for Price Alert triggers
"""
import asyncio
import logging
import threading
from typing import Dict, Any, Optional, Callable, List, Set
from dataclasses import dataclass, field
from datetime import datetime

from app.core.openalgo import OpenAlgoClient
from app.core.database import async_session_maker

logger = logging.getLogger(__name__)


@dataclass
class PriceAlert:
    """Represents an active price alert"""
    workflow_id: int
    symbol: str
    exchange: str
    condition: str
    target_price: float
    price_lower: Optional[float] = None  # For channel conditions
    price_upper: Optional[float] = None  # For channel conditions
    percentage: Optional[float] = None   # For percentage conditions
    last_price: Optional[float] = None   # Track last price for crossing detection
    triggered: bool = False
    created_at: datetime = field(default_factory=datetime.now)


class PriceMonitor:
    """
    Singleton service that monitors prices in real-time using WebSocket
    and triggers workflows when price conditions are met.
    """
    _instance: Optional['PriceMonitor'] = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._initialized = True
        self._client: Optional[OpenAlgoClient] = None
        self._alerts: Dict[int, PriceAlert] = {}  # workflow_id -> PriceAlert
        self._subscriptions: Dict[str, Set[int]] = {}  # "exchange:symbol" -> set of workflow_ids
        self._running = False
        self._monitor_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        logger.info("PriceMonitor initialized")

    def set_client(self, client: OpenAlgoClient):
        """Set the OpenAlgo client for WebSocket connections"""
        self._client = client
        logger.info("PriceMonitor client set")

    def _get_subscription_key(self, symbol: str, exchange: str) -> str:
        """Generate subscription key for symbol"""
        return f"{exchange}:{symbol}"

    def add_alert(
        self,
        workflow_id: int,
        symbol: str,
        exchange: str,
        condition: str,
        target_price: float,
        price_lower: Optional[float] = None,
        price_upper: Optional[float] = None,
        percentage: Optional[float] = None
    ) -> bool:
        """
        Add a price alert for a workflow

        Returns True if alert was added successfully
        """
        if not self._client:
            logger.error("PriceMonitor: No client configured")
            return False

        # Create alert
        alert = PriceAlert(
            workflow_id=workflow_id,
            symbol=symbol,
            exchange=exchange,
            condition=condition,
            target_price=target_price,
            price_lower=price_lower,
            price_upper=price_upper,
            percentage=percentage
        )

        # Store alert
        self._alerts[workflow_id] = alert

        # Track subscription
        key = self._get_subscription_key(symbol, exchange)
        if key not in self._subscriptions:
            self._subscriptions[key] = set()
        self._subscriptions[key].add(workflow_id)

        logger.info(f"Added price alert for workflow {workflow_id}: {symbol}@{exchange} {condition} {target_price}")

        # Start monitoring if not already running
        if not self._running:
            self._start_monitoring()
        else:
            # Subscribe to new instrument if already running
            self._subscribe_instrument(symbol, exchange)

        return True

    def remove_alert(self, workflow_id: int) -> bool:
        """
        Remove a price alert for a workflow

        Returns True if alert was removed
        """
        if workflow_id not in self._alerts:
            return False

        alert = self._alerts[workflow_id]
        key = self._get_subscription_key(alert.symbol, alert.exchange)

        # Remove from alerts
        del self._alerts[workflow_id]

        # Remove from subscriptions
        if key in self._subscriptions:
            self._subscriptions[key].discard(workflow_id)

            # Unsubscribe if no more alerts for this instrument
            if not self._subscriptions[key]:
                del self._subscriptions[key]
                self._unsubscribe_instrument(alert.symbol, alert.exchange)

        logger.info(f"Removed price alert for workflow {workflow_id}")

        # Stop monitoring if no more alerts
        if not self._alerts and self._running:
            self._stop_monitoring()

        return True

    def get_alert(self, workflow_id: int) -> Optional[PriceAlert]:
        """Get alert for a workflow"""
        return self._alerts.get(workflow_id)

    def get_active_alerts_count(self) -> int:
        """Get count of active alerts"""
        return len(self._alerts)

    def _subscribe_instrument(self, symbol: str, exchange: str):
        """Subscribe to WebSocket updates for an instrument"""
        if not self._client or not self._client.ws_is_connected():
            return

        try:
            instruments = [{"exchange": exchange, "symbol": symbol}]
            self._client.ws_subscribe_ltp(instruments, self._on_price_update)
            logger.info(f"Subscribed to LTP: {symbol}@{exchange}")
        except Exception as e:
            logger.error(f"Failed to subscribe to {symbol}@{exchange}: {e}")

    def _unsubscribe_instrument(self, symbol: str, exchange: str):
        """Unsubscribe from WebSocket updates for an instrument"""
        if not self._client:
            return

        try:
            instruments = [{"exchange": exchange, "symbol": symbol}]
            self._client.ws_unsubscribe_ltp(instruments)
            logger.info(f"Unsubscribed from LTP: {symbol}@{exchange}")
        except Exception as e:
            logger.error(f"Failed to unsubscribe from {symbol}@{exchange}: {e}")

    def _on_price_update(self, data: Dict[str, Any]):
        """
        Callback for WebSocket price updates

        Data format from OpenAlgo:
        {
            "type": "market_data",
            "symbol": "RELIANCE",
            "exchange": "NSE",
            "data": {"ltp": 1548.2, "timestamp": ...}
        }
        """
        try:
            # Debug: Log raw data received
            logger.debug(f"Price update received: {data}")

            symbol = data.get("symbol")
            exchange = data.get("exchange")

            # LTP is nested inside 'data' field
            market_data = data.get("data", {})
            ltp = market_data.get("ltp") if isinstance(market_data, dict) else data.get("ltp")

            if not all([symbol, exchange, ltp]):
                logger.warning(f"Incomplete price data: symbol={symbol}, exchange={exchange}, ltp={ltp}")
                return

            logger.info(f"LTP Update: {symbol}@{exchange} = {ltp}")

            key = self._get_subscription_key(symbol, exchange)
            workflow_ids = self._subscriptions.get(key, set())

            for workflow_id in workflow_ids:
                alert = self._alerts.get(workflow_id)
                if alert and not alert.triggered:
                    self._check_and_trigger(alert, float(ltp))

        except Exception as e:
            logger.error(f"Error processing price update: {e}")

    def _check_and_trigger(self, alert: PriceAlert, current_price: float):
        """Check if price condition is met and trigger workflow"""
        condition_met = self._evaluate_condition(alert, current_price)

        # Update last price for next check
        alert.last_price = current_price

        if condition_met and not alert.triggered:
            alert.triggered = True
            logger.info(
                f"Price alert triggered for workflow {alert.workflow_id}: "
                f"{alert.symbol}@{alert.exchange} {alert.condition} "
                f"(price: {current_price}, target: {alert.target_price})"
            )

            # Trigger workflow execution in background
            self._trigger_workflow(alert.workflow_id, current_price)

            # Remove the alert after triggering (one-time trigger)
            # If continuous monitoring is needed, don't remove here
            self.remove_alert(alert.workflow_id)

    def _evaluate_condition(self, alert: PriceAlert, current_price: float) -> bool:
        """
        Evaluate if the price condition is met

        Supported conditions:
        - greater_than: LTP > target price
        - less_than: LTP < target price
        - crossing: Price crosses the target (from either side)
        - crossing_up: Price crosses above target
        - crossing_down: Price crosses below target
        - entering_channel: Price enters the price range
        - exiting_channel: Price exits the price range
        - inside_channel: Price is within the range
        - outside_channel: Price is outside the range
        - moving_up: Price moving up from previous
        - moving_down: Price moving down from previous
        - moving_up_percent: Price moved up by X%
        - moving_down_percent: Price moved down by X%
        """
        condition = alert.condition
        target = alert.target_price
        last_price = alert.last_price

        # Tolerance for crossing detection (0.1% of price)
        tolerance = current_price * 0.001

        if condition == "greater_than":
            return current_price > target

        elif condition == "less_than":
            return current_price < target

        elif condition == "crossing":
            # Price is very close to target
            return abs(current_price - target) <= tolerance

        elif condition == "crossing_up":
            if last_price is None:
                return current_price > target
            # Was below (or at), now above
            return last_price <= target and current_price > target

        elif condition == "crossing_down":
            if last_price is None:
                return current_price < target
            # Was above (or at), now below
            return last_price >= target and current_price < target

        elif condition in ["entering_channel", "inside_channel"]:
            lower = alert.price_lower or target
            upper = alert.price_upper or target
            return lower <= current_price <= upper

        elif condition in ["exiting_channel", "outside_channel"]:
            lower = alert.price_lower or target
            upper = alert.price_upper or target
            return current_price < lower or current_price > upper

        elif condition == "moving_up":
            if last_price is None:
                return False
            return current_price > last_price

        elif condition == "moving_down":
            if last_price is None:
                return False
            return current_price < last_price

        elif condition == "moving_up_percent":
            if last_price is None or last_price == 0:
                return False
            pct_change = ((current_price - last_price) / last_price) * 100
            return pct_change >= (alert.percentage or 0)

        elif condition == "moving_down_percent":
            if last_price is None or last_price == 0:
                return False
            pct_change = ((last_price - current_price) / last_price) * 100
            return pct_change >= (alert.percentage or 0)

        return False

    def _trigger_workflow(self, workflow_id: int, trigger_price: float):
        """Trigger workflow execution asynchronously"""
        def run_async():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(self._execute_workflow_async(workflow_id, trigger_price))
            finally:
                loop.close()

        # Run in a separate thread to not block the WebSocket callback
        thread = threading.Thread(target=run_async, daemon=True)
        thread.start()

    async def _execute_workflow_async(self, workflow_id: int, trigger_price: float):
        """Execute workflow with price alert data"""
        try:
            from app.services.executor import execute_workflow

            # Pass the trigger price as webhook data for variable access
            webhook_data = {
                "trigger_type": "price_alert",
                "trigger_price": trigger_price,
                "triggered_at": datetime.now().isoformat()
            }

            result = await execute_workflow(workflow_id, webhook_data=webhook_data)
            logger.info(f"Workflow {workflow_id} execution result: {result}")

        except Exception as e:
            logger.error(f"Failed to execute workflow {workflow_id}: {e}")

    def _start_monitoring(self):
        """Start the WebSocket monitoring"""
        if self._running:
            return

        if not self._client:
            logger.error("Cannot start monitoring: No client configured")
            return

        try:
            # Connect WebSocket
            if not self._client.ws_is_connected():
                self._client.ws_connect()

            # Subscribe to all instruments
            for key in self._subscriptions:
                exchange, symbol = key.split(":", 1)
                self._subscribe_instrument(symbol, exchange)

            self._running = True
            logger.info(f"Price monitoring started with {len(self._alerts)} alerts")

        except Exception as e:
            logger.error(f"Failed to start price monitoring: {e}")

    def _stop_monitoring(self):
        """Stop the WebSocket monitoring"""
        if not self._running:
            return

        try:
            # Unsubscribe from all instruments
            for key in list(self._subscriptions.keys()):
                exchange, symbol = key.split(":", 1)
                self._unsubscribe_instrument(symbol, exchange)

            # Disconnect WebSocket if connected
            if self._client and self._client.ws_is_connected():
                self._client.ws_disconnect()

            self._running = False
            logger.info("Price monitoring stopped")

        except Exception as e:
            logger.error(f"Error stopping price monitoring: {e}")

    def is_running(self) -> bool:
        """Check if monitoring is active"""
        return self._running

    def get_status(self) -> Dict[str, Any]:
        """Get current monitor status"""
        return {
            "running": self._running,
            "alerts_count": len(self._alerts),
            "subscriptions_count": len(self._subscriptions),
            "ws_connected": self._client.ws_is_connected() if self._client else False,
            "alerts": [
                {
                    "workflow_id": alert.workflow_id,
                    "symbol": alert.symbol,
                    "exchange": alert.exchange,
                    "condition": alert.condition,
                    "target_price": alert.target_price,
                    "last_price": alert.last_price,
                    "triggered": alert.triggered
                }
                for alert in self._alerts.values()
            ]
        }


# Singleton instance
price_monitor = PriceMonitor()


def get_price_monitor() -> PriceMonitor:
    """Get the global price monitor instance"""
    return price_monitor
