# TV Wallpaper

Wallpapers (including animated GIFs), custom candle colors, custom order-fill sounds, extra indicators and ad hiding for TradingView charts, in the browser and in the TradingView desktop app. It only changes what your screen shows: nothing is sent anywhere and your TradingView settings are never changed.

## Browser (Chrome, Edge, Brave)

1. Install the free [Tampermonkey](https://www.tampermonkey.net/) extension.
2. Open this link and click **Install**: https://raw.githubusercontent.com/antoniog06/tv-wallpaper/main/tvwp.user.js
3. Open or refresh a TradingView chart. A small square button with a candlestick logo appears near the bottom left. Click it to open the settings window, or drag it anywhere. **Alt+Shift+W** also opens it. The window has a page for each feature on the left, quick on/off switches at the bottom of the sidebar, and can be dragged by its title bar.

Tampermonkey checks for updates on its own.

## TradingView desktop app (Windows)

Paste this into a normal PowerShell window (no admin needed):

```powershell
$d="$env:LOCALAPPDATA\TVWallpaper"; New-Item -ItemType Directory -Force $d | Out-Null; Invoke-WebRequest https://raw.githubusercontent.com/antoniog06/tv-wallpaper/main/TV-Wallpaper.ps1 -UseBasicParsing -OutFile "$d\TV-Wallpaper.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$d\TV-Wallpaper.ps1" -InstallShortcut
```

This puts a **TradingView (Wallpaper)** shortcut on your desktop. Open TradingView with that shortcut from now on. It downloads the latest script each time and runs quietly in the background until you close TradingView.

The desktop app keeps its own wallpapers and settings, separate from the browser's.

**Note:** while TradingView is open through the shortcut, it accepts a local debug connection on port 9222. Other programs on the same PC could use that connection, so only use this on your own computer.

## Files

- `tvwp.user.js`: the script, used by both the browser and the desktop app
- `TV-Wallpaper.ps1`: the desktop launcher
- `Install-Desktop-Shortcut.bat`: another way to create the desktop shortcut from a downloaded copy

## Order sounds

The **Sounds** tab plays a sound when your orders fill. It works with any broker you connect inside TradingView (Paper Trading, Tradovate, NinjaTrader and others), because it listens to TradingView's own order updates. It only listens; it never places or changes orders.

- A separate sound for each fill type: market, limit, stop, stop limit, take profit, stop loss and trailing stop.
- Optional sounds for partial fills, placed, cancelled and rejected orders.
- **One sound for all fills** switch.
- Built-in tones, or upload your own MP3/WAV files (up to 10 MB each).
- **Mute TradingView's own fill sound** turns off TradingView's built-in sound while this is on, and turns it back on when you switch this off.

## Indicators

The **Indicators** tab draws EMA, SMA, WMA, daily VWAP and Bollinger Bands on the main chart pane, with their own settings (length, source, offset, color, line width and style, Bollinger multiplier and fill, VWAP anchor and bands). Together with the indicators you add in TradingView, the ones showing stay within your plan's indicators-per-chart limit, the same way TradingView counts hidden indicators as not taking a slot (Basic 2, Essential 5, Plus 10, Premium 25, Ultimate 50).

Also in the Indicators tab, written for this project (not copied from any TradingView script):

- **Quarterly Theory**: Daye's time quarters in New York time. 6-hour sessions (Asia, London, NY AM, NY PM), 90-minute and optional 22.5-minute quarters, session shading and labels, plus daily (00:00), session (2nd 90-minute quarter) and weekly (Monday 18:00) True Opens.
- **Power of Three**: the last few 1H / 4H / daily / weekly candles drawn to the right of price, with the current higher-timeframe candle's open, high and low lines.

## Streamer mode

In the **Extras** tab, or with **Alt+Shift+S**, Streamer mode blurs (or fully covers) your P&L and balances so they don't show on a stream or screen share: the account panel (Unrealized/Realized P&L, equity, margin, available funds), the balance on the account button, money columns in your history tables, any amount shown with a currency, or in ticks, pips or points, anywhere on the page, and the P&L on position lines on the chart. Prices, symbols and percentages stay visible. The settings button gets a red ring while it's on.

## Trade brackets (Tradovate and similar brokers)

Some brokers turn your take-profit and stop-loss brackets into plain limit and stop orders once you're in a trade, so TradingView stops showing what you'd win or lose. With **Show win / lose on TP & SL orders** on (Extras tab), the script labels those exit orders with the projected result, in ticks, money or both, using your position's average price and the contract's tick value. Brokers whose brackets TradingView already labels (like Paper Trading) are left alone. It only reads your orders and never changes them.

## Journal (trade recording)

The **Journal** page records every trade automatically once **Record my trades** is on: symbol, long/short, size, average entry and exit, ticks, gross and net P&L (after commission), and time held. It builds trades from your broker's actual fills, so scale-ins, scale-outs and long-to-short reversals are handled. It works with any broker connected in TradingView, keeps recording in a background tab or with the desktop app minimized, and when you reopen TradingView it catches up on trades made while it was closed (including trades placed on your broker's own app). Export everything to CSV for Excel or Google Sheets.

**Record chart video** films the chart from entry until 8 seconds after exit, as a WebM video you can watch or download from the trade's ▶ button. It needs no permission pop-ups and works in both Chrome and the desktop app. Only the newest videos are kept (you choose how many). Trades and videos are stored only on your computer, separately in Chrome and in the desktop app.
