# Coupon Finder

Local web app: search a company, get its active coupon and discount codes.

## Run

```
npm run install:all   # first time only
npm run dev           # starts API (:3001) + UI (http://localhost:5173)
```

The UI is also reachable from other devices on your local network at
`http://<this-machine's-IP>:5173` (Vite prints the Network URL on startup).
The API binds to loopback only — network devices use it through Vite's proxy.

## Phone access (including away from home)

1. Install Tailscale on this PC and on your phone, sign in to the same account
   on both (free personal plan). This creates a private VPN between your
   devices — nothing is exposed to the public internet.
2. On the phone, open `http://<pc-tailscale-name>.ts.net:5173` (or the PC's
   `100.x.y.z` Tailscale IP). Vite is preconfigured to accept `.ts.net` hosts.
3. In Safari: Share → **Add to Home Screen**. The app installs with its own
   icon and opens fullscreen (PWA manifest + icons are included).

Caveats: the PC must be on and `npm run dev` running (disable sleep, or set
Tailscale to run at login); scrapes started from the phone take the same few
seconds as on desktop.

## How it works

- **Company lookup** — the search box autocompletes company names to domains via Clearbit's free suggest endpoint.
- **Sources** — three scrapers run in parallel (`server/scrapers/`): PromoCodes.com (full copyable codes + verification/expiry data from its embedded Next.js state), CouponFollow and DealDrop (offer listings; their codes are click-to-reveal on the source site). A source that fails or blocks is skipped and a banner notes it.
- **Verification status** — codes can't be test-applied at most retailers' checkouts (bot protection, requires a real cart session), so a code is marked **✓ Verified** when a source validated it within the last 30 days or the same offer appears on multiple sources, and **? Unconfirmed** when it couldn't be auto-checked. Expired codes are dropped. The logic lives in `server/scrapers/index.js` (`assignStatus`) and is pluggable if you later add per-site live checkers.
- **Weekly flyers & grocery savings** — the Weekly flyers tab searches current circulars near your ZIP (Flipp), or shows a specific store's whole flyer when you type its name. Local chains Flipp doesn't carry (e.g. Donelan's) are covered via their Freshop APIs — including **unadvertised in-store specials** beyond the printed ad.
- **Caching** — results are stored in SQLite (`server/coupons.db`) and reused for 6 hours; **⟳ Refresh & re-check** forces a fresh scrape and re-runs verification.
- **History & favorites** — recent searches and starred companies persist in the same database.

## Notes

- Scraper selectors can break when source sites change markup; each adapter in `server/scrapers/` is independent.
- For personal/local use — coupon sites' terms generally prohibit large-scale scraping.
