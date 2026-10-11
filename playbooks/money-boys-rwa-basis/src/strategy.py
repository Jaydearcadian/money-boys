from decimal import Decimal
from typing import Optional

from nautilus_trader.config import StrategyConfig
from nautilus_trader.model.data import Bar, BarType
from nautilus_trader.model.enums import OrderSide, TimeInForce
from nautilus_trader.model.identifiers import InstrumentId
from nautilus_trader.model.instruments import Instrument
from nautilus_trader.model.objects import Quantity
from nautilus_trader.trading.strategy import Strategy


class MoneyBoysRwaBasisStrategyConfig(StrategyConfig):
    instrument_id: Optional[InstrumentId] = None
    bar_type: Optional[BarType] = None
    instrument_ids: tuple[InstrumentId, ...] = ()
    bar_types: tuple[BarType, ...] = ()
    trade_size: str = "0.05"
    entry_hurdle_bps: int = 20
    exit_hurdle_bps: int = 2
    take_profit_bps: int = 120
    stop_loss_bps: int = 65
    trend_window: int = 80
    max_hold_bars: int = 36
    lookback_window: int = 20


class MoneyBoysRwaBasisStrategy(Strategy):
    """Nautilus execution strategy for Money Boys RWA Basis Arbitrage Desk."""

    def __init__(self, config: MoneyBoysRwaBasisStrategyConfig) -> None:
        super().__init__(config)
        self.cfg = config
        self._closes: list[float] = []
        self._position: str = "NONE"
        self._entry_price: float = 0.0
        self._bars_in_position: int = 0
        self._instrument: Optional[Instrument] = None

    def on_start(self) -> None:
        bar_type = self.cfg.bar_type or (
            self.cfg.bar_types[0] if self.cfg.bar_types else None
        )
        instrument_id = self.cfg.instrument_id or (
            self.cfg.instrument_ids[0] if self.cfg.instrument_ids else None
        )
        if bar_type is None or instrument_id is None:
            raise RuntimeError("bar_type and instrument_id must be set")
        self._instrument = self.cache.instrument(instrument_id)
        self.subscribe_bars(bar_type)

    def on_bar(self, bar: Bar) -> None:
        close = float(bar.close)
        self._closes.append(close)

        window = self.cfg.lookback_window
        trend_window = int(getattr(self.cfg, "trend_window", 80) or 80)
        min_required = max(window, trend_window)
        if len(self._closes) < min_required:
            return

        # Compute rolling benchmark fair equilibrium
        recent = self._closes[-window:]
        fair_value = sum(recent) / float(window)
        if fair_value <= 0:
            return

        # Basis spread in basis points (contract vs rolling fair value)
        basis_bps = ((close - fair_value) / fair_value) * 10000.0

        # Macro trend baseline (moving average equilibrium filter)
        trend_sma = sum(self._closes[-trend_window:]) / float(trend_window)

        instrument = self._instrument
        if instrument is None:
            return

        qty = Quantity(Decimal(self.cfg.trade_size), instrument.size_precision)

        if self._position == "NONE":
            # Long entry: basis dip below entry hurdle with bullish macro trend alignment
            if basis_bps <= -float(self.cfg.entry_hurdle_bps) and close >= trend_sma:
                self._submit(instrument.id, OrderSide.BUY, qty)
                self._position = "LONG"
                self._entry_price = close
                self._bars_in_position = 0
            # Short entry: basis spike above entry hurdle with bearish macro trend alignment
            elif basis_bps >= float(self.cfg.entry_hurdle_bps) and close <= trend_sma:
                self._submit(instrument.id, OrderSide.SELL, qty)
                self._position = "SHORT"
                self._entry_price = close
                self._bars_in_position = 0
            return

        # Manage open position
        self._bars_in_position += 1
        entry_px = self._entry_price or close
        pnl_pct = (
            (close - entry_px) / entry_px
            if self._position == "LONG"
            else (entry_px - close) / entry_px
        )
        pnl_bps = pnl_pct * 10000.0

        tp_bps = float(getattr(self.cfg, "take_profit_bps", 120) or 120)
        sl_bps = float(self.cfg.stop_loss_bps)
        max_bars = int(getattr(self.cfg, "max_hold_bars", 36) or 36)

        # 1. Take-profit target (capturing 120 bps trend recovery)
        take_profit = pnl_bps >= tp_bps

        # 2. Strict stop-loss (cutting loss when trade moves 65 bps adverse)
        stop_loss = pnl_bps <= -sl_bps

        # 3. Maximum hold horizon
        time_stop = self._bars_in_position >= max_bars

        if take_profit or stop_loss or time_stop:
            exit_side = OrderSide.SELL if self._position == "LONG" else OrderSide.BUY
            self._close_open(instrument.id, exit_side)
            self._position = "NONE"
            self._entry_price = 0.0
            self._bars_in_position = 0

    def _submit(
        self,
        instrument_id: InstrumentId,
        side: OrderSide,
        quantity: Quantity,
    ) -> None:
        order = self.order_factory.market(
            instrument_id=instrument_id,
            order_side=side,
            quantity=quantity,
            time_in_force=TimeInForce.GTC,
        )
        self.submit_order(order)

    def _close_open(self, instrument_id: InstrumentId, side: OrderSide) -> None:
        for position in self.cache.positions_open(instrument_id=instrument_id):
            self._submit(instrument_id, side, position.quantity)

    def on_stop(self) -> None:
        if self._instrument is not None:
            self.cancel_all_orders(self._instrument.id)
            self.close_all_positions(self._instrument.id)
