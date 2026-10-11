# Money Boys RWA Basis Desk

Autonomous 24/7 quantitative basis arbitrage desk designed for tokenized Real World Asset (RWA) US equities on Bitget.

## 策略 / Strategy

The Money Boys RWA Basis Desk captures systematic basis mispricing between tokenized Real World Asset (RWA) equity contracts (such as NVDAUSDT) and their synthetic fair value reference benchmarks. In 24/7 crypto markets, synthetic and perpetual contracts on US equities frequently trade at transient premiums or discounts to their underlying equilibrium due to asynchronous liquidity flows, retail leverage imbalances, and overnight trading demand while Wall Street is closed.

Rather than predicting directional equity drift, the desk operates on a mean-reverting basis model:
- When contract pricing stretches too far above equilibrium, it signals synthetic basis dislocation.
- When the spread between observed prices and the rolling equilibrium exceeds execution transaction costs (including exchange maker/taker fees and slippage buffers), the desk enters to capture spread convergence.
- Crucially, when basis spread is less than the transaction cost hurdle, the desk **refuses to trade**, avoiding fee drag and churn.

## 开仓 / Entry

The desk enters positions deterministically based on basis spread expansion relative to an adaptive rolling window:
- **Long Entry**: Opened when the contract price deviates below fair value by more than the configured entry hurdle (positive basis convergence opportunity).
- **Short Entry**: Opened when the contract price deviates above fair value by more than the configured entry hurdle.
- **Refusal Gate (Hold)**: If the observed dislocation does not clear the transaction fee hurdle, the engine outputs a neutral signal and places zero orders.

Every proposed entry is subject to hard risk invariants:
1. Maximum margin utilization ceiling (capped strictly below conservative risk limits).
2. Per-trade position sizing scaled to the subscriber's configured margin budget and leverage.

## 平仓 / Exit

The strategy manages position unwinds systematically:
- **Spread Mean Reversion (Target Exit)**: When the basis spread contracts back within the tighter exit hurdle threshold, the strategy closes the position to harvest the captured spread.
- **Trend Reversal Inversion**: If the basis flips sign decisively, existing exposure is closed immediately before considering new directional positioning.
- **Emergency Session Stop**: In the event of system shutdown or session lifecycle completion, all working orders are cancelled and active positions are closed (`cancel_all_orders` and `close_all_positions`).

## 参数配置 / Parameters

Subscribers can adjust operational parameters when subscribing:
- **leverage**: Sets leverage multiplier for margin efficiency. Higher leverage amplifies returns and drawdowns proportionately.
- **margin_budget**: Denominator and maximum margin allocation (USDT) dedicated to the Playbook instance.
- **entry_hurdle_bps**: Minimum basis spread required to trigger an entry.
- **exit_hurdle_bps**: Tighter spread boundary at which existing trades take profit and exit.
- **lookback_window**: Historical candle depth used to compute rolling equilibrium.

## 风险 / Risk

Key risk factors to consider before enabling live or follow-trade execution:
- **Prolonged Basis Dislocation**: During severe macroeconomic shocks or unexpected corporate events (such as earnings announcements or regulatory changes), basis spreads may widen persistently instead of reverting cleanly.
- **Liquidity & Slippage**: RWA token books may experience wider bid-ask spreads during off-hours, impacting execution quality.
- **Funding Rate Friction**: Prolonged holding periods in perpetual contracts may incur funding rate payments that erode basis gains.
- **Past Performance**: Historical backtest results do not guarantee future profitability. Subscribers should size capital prudently according to their risk tolerance.
