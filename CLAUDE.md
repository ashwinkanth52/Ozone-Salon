# Ozone Salon & Spa — ERP

## Project layout
- `index.html` — single-file PWA (all HTML, CSS, JS inline)
- `service-worker.js` — PWA cache & update logic
- `manifest.json` — PWA manifest
- `Code.gs` — Google Apps Script (server-side, not deployed here)

## MANDATORY before every `git push`

### 1. Bump the service worker cache version
File: `service-worker.js`, line 3
```
const CACHE = 'ozone-erp-vNN-YYYY-MM-DD';
```
- Increment `vNN` by 1 (v75 → v76 → v77 …)
- Set `YYYY-MM-DD` to today's date
- **Why:** This is the ONLY way devices detect a new version. Without it, all browsers keep serving the stale cached `index.html` indefinitely.

### 2. Update the deployed timestamp
File: `index.html`, inside `#screen-landing` near the bottom
```html
<div style="margin-top:5px;font-size:10px;opacity:.65;">DEPLOYED · D Mon YYYY, H:MM AM/PM</div>
```
- Use IST time (UTC+5:30)
- Lets any device confirm which version it is running

## File editing rules
- **Never** use PowerShell `WriteAllText` with `[System.Text.Encoding]::UTF8` — it writes a UTF-8 BOM that breaks `<!DOCTYPE html>` rendering.
- Use `New-Object System.Text.UTF8Encoding($false)` for BOM-free writes.
- Prefer the Edit tool for HTML changes to avoid encoding issues.

## Deployment flow
```
1. Make changes to index.html / service-worker.js
2. Bump CACHE version in service-worker.js
3. Update DEPLOYED timestamp in index.html
4. git add index.html service-worker.js
5. git commit -m "..."
6. git push origin main
```
GitHub Pages auto-publishes from `main`. The SW update propagates to all devices within one page load.

## Sync mechanism (how device updates work)
1. Browser fetches `service-worker.js` on every page load (network-first)
2. If the file changed (cache version bumped), new SW installs and calls `skipWaiting()`
3. Old cache is deleted; new cache created
4. `controllerchange` fires → page auto-reloads
5. User sees the updated app with new deployed timestamp

## GitHub repo
https://github.com/ashwinkanth52/Ozone-Salon
