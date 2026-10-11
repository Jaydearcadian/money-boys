"""Entry point for the Money Boys RWA Basis Desk Playbook.

Executes quantitative basis evaluation on Bitget tokenized US equities (NVDAUSDT).
Historical evaluation runs through the managed Nautilus replay engine;
Live runs enforce deterministic risk gates, transaction cost hurdles, and
refuse to trade when the basis does not clear the hurdle.
"""
import json
import math
from decimal import Decimal
from pathlib import Path
from typing import Any

from getagent import backtest, data, runtime


def _sanitize(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _sanitize_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    return {key: _sanitize(val) for key, val in metrics.items()}


def _run_historical() -> None:
    cfg = runtime.manifest.get("strategy_config", {}) or {}
    symbols = cfg.get("trading_symbols") or ["NVDAUSDT"]
    symbol = str(symbols[0])

    bars = data.crypto.futures.kline(
        symbol=symbol,
        interval="1h",
        exchange="bitget",
        limit=1000,
        closed_only=True,
    )
    replay_frame = backtest.prepare_frame(bars, datetime_index="date")

    if replay_frame.empty:
        runtime.emit_signal(
            action="watch",
            symbol=symbol,
            confidence=0.0,
            metrics={"rows": 0},
            meta={"reason": "no historical bars returned for symbol"},
        )
        return

    instrument_key = f"{symbol}.BITGET"
    result = backtest.run(
        ohlcv_data={instrument_key: replay_frame},
        spec=runtime.backtest_spec,
    )

    chart_path = backtest.generate_chart(result)
    summary = result.summary or {}
    net_pnl_raw = summary.get("net_pnl", 0)
    try:
        net_pnl = float(net_pnl_raw or 0)
    except (TypeError, ValueError):
        net_pnl = 0.0

    last_bar_ts = int(replay_frame.index.max().timestamp() * 1000)
    period_start_str = str(replay_frame.index.min().isoformat())
    period_end_str = str(replay_frame.index.max().isoformat())

    # Write output/backtest_report.json and output/equity_curve.csv for Studio UI ingestion
    try:
        out_dir = Path("/workspace/output") if Path("/workspace/output").exists() else Path("output")
        out_dir.mkdir(parents=True, exist_ok=True)

        # Output equity curve if available
        curves = getattr(result, "curves", None)
        if not curves and isinstance(summary, dict):
            curves = summary.get("curves")
        if curves and isinstance(curves, list):
            csv_lines = ["timestamp,value,nav"]
            for pt in curves:
                csv_lines.append(f"{pt.get('timestamp','')},{pt.get('value','')},{pt.get('nav','')}")
            (out_dir / "equity_curve.csv").write_text("\n".join(csv_lines) + "\n", encoding="utf-8")

        # Output formal backtest report
        report_data = {
            "period_start": period_start_str,
            "period_end": period_end_str,
            "total_trades": result.total_trades,
            "sharpe_ratio": result.sharpe_ratio,
            "max_drawdown_pct": result.max_drawdown_pct,
            "win_rate": result.win_rate,
            "total_return_pct": result.total_return_pct,
            "net_pnl": net_pnl,
            "starting_balance": summary.get("starting_balance", 100000.0),
        }
        (out_dir / "backtest_report.json").write_text(json.dumps(report_data, default=str), encoding="utf-8")
    except Exception:
        pass

    action = "long" if net_pnl > 0 else "watch"
    metrics = _sanitize_metrics(
        {
            "total_return_pct": result.total_return_pct,
            "net_pnl": net_pnl,
            "starting_balance": summary.get("starting_balance"),
            "sharpe_ratio": result.sharpe_ratio,
            "max_drawdown_pct": result.max_drawdown_pct,
            "win_rate": result.win_rate,
            "total_trades": result.total_trades,
            "profit_factor": result.profit_factor,
            "rows": len(replay_frame),
            "last_bar_ts": last_bar_ts,
            "period_start": period_start_str,
            "period_end": period_end_str,
        }
    )

    runtime.emit_signal(
        action=action,
        symbol=symbol,
        confidence=_sanitize(result.win_rate) or 0.0,
        metrics=metrics,
        meta={
            "chart_path": chart_path,
            "entry_hurdle_bps": cfg.get("entry_hurdle_bps"),
            "exit_hurdle_bps": cfg.get("exit_hurdle_bps"),
            "take_profit_bps": cfg.get("take_profit_bps"),
            "stop_loss_bps": cfg.get("stop_loss_bps"),
            "trend_window": cfg.get("trend_window"),
            "lookback_window": cfg.get("lookback_window"),
        },
    )


def _execute_contract_signal(
    *,
    symbol: str,
    action: str,
    margin_budget: str,
    leverage: int,
) -> dict[str, Any]:
    from getagent import trade

    current = trade.contract.current_position(symbol=symbol)
    position = trade.helpers.find_contract_position(current, symbol=symbol)

    if action == "close":
        if position is not None:
            closed = trade.contract.close_position(symbol=symbol, hold_side=position.hold_side)
            if not trade.is_success(closed):
                raise RuntimeError(f"contract close failed: {closed}")
            return {"status": "closed", "hold_side": position.hold_side}
        return {"status": "already_flat"}

    if position is not None and position.hold_side == action:
        return {"status": "already_positioned", "hold_side": position.hold_side}

    if position is not None:
        closed = trade.contract.close_position(symbol=symbol, hold_side=position.hold_side)
        if not trade.is_success(closed):
            raise RuntimeError(f"contract close failed: {closed}")

    qty_plan = trade.helpers.compute_qty(
        symbol=symbol,
        market="contract",
        budget_amount=margin_budget,
        leverage=leverage,
    )
    open_position = (
        trade.contract.open_long_market
        if action == "long"
        else trade.contract.open_short_market
    )
    result = open_position(symbol=symbol, qty=qty_plan.qty, leverage=leverage)
    if not trade.is_success(result):
        raise RuntimeError(f"contract open failed: {result}")
    return {"qty": str(qty_plan.qty), "result": result}


def _run_live() -> None:
    from getagent import trade

    cfg = runtime.manifest.get("strategy_config", {}) or {}
    symbol = str((cfg.get("trading_symbols") or ["NVDAUSDT"])[0])
    lookback_window = int(cfg.get("lookback_window", 20) or 20)
    trend_window = int(cfg.get("trend_window", 80) or 80)
    entry_hurdle_bps = float(cfg.get("entry_hurdle_bps", 20) or 20)
    exit_hurdle_bps = float(cfg.get("exit_hurdle_bps", 2) or 2)
    take_profit_bps = float(cfg.get("take_profit_bps", 120) or 120)
    stop_loss_bps = float(cfg.get("stop_loss_bps", 65) or 65)
    leverage = int(cfg.get("leverage", 3) or 3)
    margin_budget = str(cfg.get("margin_budget", "100") or "100")

    bars = data.crypto.futures.kline(
        symbol=symbol,
        interval="1h",
        exchange="bitget",
        limit=max(trend_window + 20, 100),
        closed_only=True,
    )
    closes = [
        Decimal(str(row["close"]))
        for row in data.to_records(bars)
        if row.get("close") not in (None, "")
    ]
    min_required = max(lookback_window, trend_window)
    if len(closes) < min_required:
        runtime.emit_signal(
            action="hold",
            symbol=symbol,
            confidence=0.0,
            metrics={"rows": len(closes)},
            meta={"reason": "insufficient closed bars for basis and trend window"},
        )
        return

    # Compute rolling synthetic equilibrium and macro trend SMA
    recent_closes = closes[-lookback_window:]
    fair_value = sum(recent_closes) / Decimal(lookback_window)
    trend_sma = sum(closes[-trend_window:]) / Decimal(trend_window)
    current_price = closes[-1]

    # Basis deviation in basis points
    basis_bps = float(((current_price - fair_value) / fair_value) * Decimal(10000))

    # Inspect current position state for asymmetric exit checks
    current = trade.contract.current_position(symbol=symbol)
    pos = trade.helpers.find_contract_position(current, symbol=symbol)
    hold_side = pos.hold_side if pos is not None else "NONE"

    action = "hold"
    confidence = 0.0
    reason = "basis spread within normal bounds"

    if hold_side in ("long", "short"):
        # Position PnL calculation
        open_px = Decimal(str(getattr(pos, "open_price_avg", None) or current_price))
        if open_px <= Decimal(0):
            open_px = current_price
        pnl_bps = float(
            ((current_price - open_px) / open_px if hold_side == "long" else (open_px - current_price) / open_px)
            * Decimal(10000)
        )

        if pnl_bps >= take_profit_bps:
            action = "close"
            confidence = 0.90
            reason = f"take profit: position pnl ({pnl_bps:.1f} bps) hit target ({take_profit_bps:.1f} bps)"
        elif pnl_bps <= -stop_loss_bps:
            action = "close"
            confidence = 0.95
            reason = f"stop loss: adverse drift ({pnl_bps:.1f} bps) hit risk limit (-{stop_loss_bps:.1f} bps)"
        else:
            action = "hold"
            confidence = 0.50
            reason = f"holding {hold_side} position awaiting target (current pnl: {pnl_bps:.1f} bps)"
    else:
        # Flat state: evaluate entry against hurdle with macro trend alignment
        if basis_bps <= -entry_hurdle_bps and current_price >= trend_sma:
            action = "long"
            confidence = 0.85
            reason = "basis dip clears entry hurdle with bullish trend alignment"
        elif basis_bps >= entry_hurdle_bps and current_price <= trend_sma:
            action = "short"
            confidence = 0.85
            reason = "basis spike clears entry hurdle with bearish trend alignment"
        else:
            action = "hold"
            confidence = 0.0
            reason = "basis spread does not clear hurdle or trend alignment (refusal to trade)"

    runtime.emit_signal_or_follow(
        action=action,
        symbol=symbol,
        confidence=confidence,
        metrics={
            "rows": len(closes),
            "current_price": float(current_price),
            "fair_value": float(fair_value),
            "trend_sma": float(trend_sma),
            "basis_bps": basis_bps,
            "entry_hurdle_bps": entry_hurdle_bps,
            "exit_hurdle_bps": exit_hurdle_bps,
            "take_profit_bps": take_profit_bps,
            "stop_loss_bps": stop_loss_bps,
            "hold_side": hold_side,
        },
        meta={
            "reason": reason,
            "lookback_window": lookback_window,
        },
        execute_trade=lambda: _execute_contract_signal(
            symbol=symbol,
            action=action,
            margin_budget=margin_budget,
            leverage=leverage,
        ),
    )


def run() -> None:
    if runtime.is_historical():
        _run_historical()
        return
    if runtime.is_live():
        _run_live()
        return
    raise ValueError(f"unsupported evaluation_mode={runtime.evaluation_mode!r}")


if __name__ == "__main__":
    run()
