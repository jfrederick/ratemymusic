# Daily automation (launchd)

Runs the full daily pipeline -- `npm run daily` (sync with `maxPages 30` → discover →
push-daily; see `scripts/daily.mjs`) -- once a day. Each step runs even if an earlier one
fails (e.g. sync hitting its crawl budget), so a failed sync doesn't also skip discover/
push-daily.

Copy the plist into `~/Library/LaunchAgents`, adjusting `WorkingDirectory`/log paths and the `npm` path (`which npm`) to match your machine, then load it:

```
cp ops/launchd/com.jim.ratemymusic.daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.jim.ratemymusic.daily.plist
launchctl list | grep com.jim.ratemymusic.daily
```

## Web server at login (`com.jim.ratemymusic.server.plist`)

Keeps the app server running at http://127.0.0.1:8787 from login, restarting it if it
crashes (`RunAtLoad` + `KeepAlive`, 15s throttle). Install the same way:

```
cp ops/launchd/com.jim.ratemymusic.server.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.jim.ratemymusic.server.plist
curl -s http://127.0.0.1:8787/api/health
```

Manage it with:

```
launchctl kickstart gui/$(id -u)/com.jim.ratemymusic.server   # start/restart now
launchctl unload ~/Library/LaunchAgents/com.jim.ratemymusic.server.plist  # stop + disable
```

Don't also run `npm run serve` manually while the agent is loaded — the port is taken.
Logs: `data/logs/server.{out,err}.log`.
