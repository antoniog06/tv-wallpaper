# Wick

*Formerly TV Wallpaper. Same install: existing setups update to the new name on their own.*

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

This puts a **Wick** shortcut on your desktop. Open TradingView with that shortcut from now on. It downloads the latest script each time and runs quietly in the background until you close TradingView.

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

**Record chart video** films the chart from entry until 8 seconds after exit. Pick the quality under **Video quality**: Small (fits Notion's free plan), 720p, 1080p, 1440p, 4K, or **Native**, which records at your chart's real screen pixels (the sharpest your screen can give). 1440p and up are recorded as MP4 on your graphics card when it supports that, and the settings show whether it does; lower settings are WebM. It's a video you can watch or download from the trade's ▶ button. It needs no permission pop-ups and works in both Chrome and the desktop app. Only the newest videos are kept (you choose how many). Trades and videos are stored only on your computer, separately in Chrome and in the desktop app.

## Risk tools

- **Limits**: a daily loss limit (closed trades plus open P&L), max trades per day (with a trade counter on the chart you can drag anywhere: amber on your last trade, red when you're done) and an optional profit lock. When one is hit, TradingView turns down every new order until the next session (6 PM New York), however it's placed: Buy/Sell buttons, order panel, price ladder, right-click menus, the + on the price scale, hotkeys. You are never locked inside a trade: if you hit the limit while in a position you can still close or shrink it (but not add to it or reverse), and the lock starts once you're flat. While locked, your limits can't be changed, "Turn everything off" doesn't stop the lockout, recording can't be switched off, and clearing the journal doesn't reset today's count. With **Journal → Save to a folder** set to the same folder in Chrome and the desktop app, a lock in one locks the other (within about 10 seconds). Unlocking early takes a 5-minute wait and typing a sentence, and lasts only for that day. It covers TradingView only, not your broker's own app.
- **Trading symbols** (in Limits): list the markets you trade, e.g. `MNQ, MGC`. Orders on anything else are turned down and the Buy/Sell buttons dim, so charting NQ and clicking Buy can't put you in NQ. A banner offers one click to switch the chart to your micro. Closing a position always works.
- **Position size**: type how much you want to risk and it shows roughly how many contracts that is, for the chart's market and its micro or mini. With no stop entered, it assumes a typical stop of one average candle on your chart (adjustable), and a small table shows the count for tighter and wider stops. Switch the stop to **Manual** to type your own stop in points. A **Classic** style brings back the original layout (symbol, risk and stop distance). Under Options you can pick another symbol, set your own stop, or risk a % of your account. Tick values come from your broker or standard contract specs (NQ, MNQ, ES, MES, GC, MGC, CL, MCL and more).
- **Prop tracker**: starting balance, max loss limit (trailing end-of-day, trailing intraday or static, optionally stopping at the starting balance), daily loss limit, profit target and max contracts, tracked live from your connected account with warnings near each limit. Reaching the max loss limit (or a buffer before it you choose) or the daily loss limit locks new orders until 6 PM ET, even with the Limits lockout off. If you're in a trade you can still close it.
- **Consistency** (Prop page): set your firm's rule (your best day can be at most X% of total profit). Wick tracks your daily profit on the account, shows your best day, the total profit you actually need (a big day raises it), today's cap, and a day-by-day plan to the target with a 10% cushion under the cap. It warns as today nears the cap, and can lock trading for the day when you reach it. Works as a plain calculator too, from just the target and the rule.
- **Firm presets** (Prop page): pick your account (Lucid Flex 25K/50K/100K/150K evaluation) and its rules fill in: target, max loss limit and how it trails, daily loss limit, consistency and max contracts. Every field stays editable.
- **News**: high-impact US events from TradingView's economic calendar, a countdown banner on the chart before each one, an optional beep, and an optional pause on new entries for a few minutes either side.

### Where recordings are kept

Trades and videos live inside the browser's storage for tradingview.com (separately in Chrome and in the desktop app), and the script asks the browser to protect that storage from automatic cleanup. Clearing site data for tradingview.com, or uninstalling the desktop app, still deletes it.

To keep real files, turn on **Journal → Save to a folder** and pick a folder once. The script then keeps `trades.csv` (opens in Excel), `journal-backup.json` (a full copy you can restore from with **Restore trades from folder**) and a `Videos` subfolder with one `.webm` per trade, named like `2026-11-15 09-31-04 Long 2 MNQZ2026 WIN.webm`, up to date after every trade. Clearing the journal never deletes anything from the folder. After a browser restart Chrome may ask you to allow access again (one click, or choose "Allow on every visit").

## Send trades to Notion

`TV-Notion-Sync.ps1` copies each finished trade into your Notion trade journal database, with its chart video when it fits your Notion plan. It runs on your PC (Notion doesn't let web pages call it directly) and reads the folder from **Journal → Save to a folder**, so it covers both Chrome and the desktop app.

1. In Wick: **Journal → Save to a folder** on. On Notion's free plan, set **Video quality → Small** so videos of trades up to about 2 minutes fit under the 5 MB upload limit.
2. Go to notion.so/profile/integrations, create an **internal integration**, and copy its secret.
3. Open your Trades database in Notion, then **••• → Connections →** add your integration.
4. Download `TV-Notion-Sync.ps1`, right-click it → **Run with PowerShell** (or run `powershell -ExecutionPolicy Bypass -File TV-Notion-Sync.ps1 -Setup`), and paste the secret and your database link when asked.

It then checks every 5 minutes in the background. Each trade becomes a page with Trade, Ticker, Direction, Account, Market, Entry/Exit Price and Time, Size, Fees, Multiplier, Session and Timeframe, and only fills properties your database already has, with matching types. A video that's too big gets a note on the page saying where it is on your PC. Your secret is stored encrypted for your Windows user only, never in TradingView or this repo. `-Uninstall` removes the background task.
