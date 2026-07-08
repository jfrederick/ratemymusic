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
