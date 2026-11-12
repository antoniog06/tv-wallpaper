# TV Wallpaper

Wallpapers (including animated GIFs), custom candle colors, custom order-fill sounds, extra indicators and ad hiding for TradingView charts, in the browser and in the TradingView desktop app. It only changes what your screen shows: nothing is sent anywhere and your TradingView settings are never changed.

## Browser (Chrome, Edge, Brave)

1. Install the free [Tampermonkey](https://www.tampermonkey.net/) extension.
2. Open this link and click **Install**: https://raw.githubusercontent.com/antoniog06/tv-wallpaper/main/tvwp.user.js
3. Open or refresh a TradingView chart. A round blue button appears near the bottom left. Click it to open the settings, or drag it anywhere. **Alt+Shift+W** also opens the settings.

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

The **Indicators** tab draws EMA, SMA, WMA, daily VWAP and Bollinger Bands on the main chart pane, with your own length and color. Together with the indicators you add in TradingView, they stay within your plan's indicators-per-chart limit (Basic 2, Essential 5, Plus 10, Premium 25, Ultimate 50).
