# Ozone Salon ERP — Firebase + GitHub Pages Setup

Live, real-time salon ERP. **Firestore** is the database, **Firebase Anonymous Auth** gates writes, and the PWA is hosted free on **GitHub Pages**. No backend server, no Apps Script.

**Live URL:** <https://ashwinkanth52.github.io/Ozone-Salon/>

---

## Architecture

```
┌──────────────────────┐         ┌────────────────────────┐
│ PWA (index.html)     │ ──────► │ Cloud Firestore        │
│ Hosted on GitHub Pages│ ◄────── │ (real-time NoSQL DB)   │
│ (offline-capable)    │         └────────────────────────┘
└──────────────────────┘                    ▲
           │                                │
           ▼                                │
┌──────────────────────┐                    │
│ Firebase Anonymous   │ ───── auth token ──┘
│ Authentication       │
└──────────────────────┘
```

- **Frontend**: PWA — `index.html`, `manifest.json`, `service-worker.js`. Installable on phone.
- **Database**: Cloud Firestore (10 collections, auto-created on first write).
- **Auth**: Firebase Anonymous Auth — every device gets an auth token automatically; Firestore rules require it.
- **Offline**: Firestore SDK persists everything in IndexedDB; writes queue automatically and flush when back online. No manual queue.
- **Hosting**: GitHub Pages (free, HTTPS, no build step).

---

## One-Time Setup (~15 min)

### Step 1 — Create Firebase Project

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Name it `ozone-salon-erp` (or anything) → continue → **Disable** Google Analytics (not needed) → **Create project**.
3. In the project dashboard, click the **Web** icon `</>` to register a web app.
4. App nickname: `Ozone PWA` → **Register app**.
5. **Copy the entire `firebaseConfig` object** shown — looks like:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "ozone-salon-erp.firebaseapp.com",
     projectId: "ozone-salon-erp",
     storageBucket: "ozone-salon-erp.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123"
   };
   ```

   Save this — you'll paste it into the app in Step 4.

### Step 2 — Enable Firestore + Google Auth

1. Left sidebar → **Build → Firestore Database** → **Create database**.
   - Mode: **Start in production mode** → Next.
   - Region: pick closest (e.g. `asia-south1` for India) → **Enable**.
2. Left sidebar → **Build → Authentication** → **Get started**.
3. **Sign-in method** tab → click **Google** → enable toggle → set **support email** → **Save**.

> The app now uses **Google Sign-In** with role-based access. The first Google account that signs in becomes the Owner/Admin automatically. After that, the owner adds more accounts (admin or staff) from **Admin → Team**.

### Step 3 — Set Firestore Security Rules

1. Firestore Database → **Rules** tab.
2. Replace contents with the **role-aware** rules below. They check the signed-in Google account email against the `adminEmails` / `staffEmails` arrays stored in your `config/shop` doc.

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {

       // Signed-in user's verified Google email
       function userEmail() {
         return request.auth != null
           ? request.auth.token.email.lower()
           : null;
       }

       // Lookup once: the team lists from config/shop
       function shopCfg() {
         return get(/databases/$(database)/documents/config/shop).data;
       }
       function admins() {
         return shopCfg().adminEmails != null ? shopCfg().adminEmails : [];
       }
       function staff() {
         return shopCfg().staffEmails != null ? shopCfg().staffEmails : [];
       }

       function isAdmin() {
         return request.auth != null && admins().hasAny([userEmail()]);
       }
       function isStaff() {
         return request.auth != null
           && (admins().hasAny([userEmail()]) || staff().hasAny([userEmail()]));
       }

       // === Bootstrap: while no admins exist yet, the first signed-in user
       // can create the config/shop doc and seed services ===
       function noAdminsYet() {
         return !exists(/databases/$(database)/documents/config/shop)
           || shopCfg().adminEmails == null
           || shopCfg().adminEmails.size() == 0;
       }

       // config/shop: admins only (or first user during bootstrap)
       match /config/{doc} {
         allow read:  if request.auth != null;
         allow write: if isAdmin() || (request.auth != null && noAdminsYet());
       }

       // Append-only logs: any signed-in staff/admin can create.
       // Updates/deletes restricted to admin.
       match /transactions/{doc} {
         allow read:   if isStaff();
         allow create: if isStaff();
         allow update, delete: if isAdmin();
       }
       match /expenses/{doc} {
         allow read:   if isStaff();
         allow create: if isStaff();
         allow update, delete: if isAdmin();
       }
       match /salaries/{doc} {
         allow read, create, update, delete: if isAdmin();
       }
       match /attendance/{doc} {
         allow read:        if isStaff();
         allow create, update: if isStaff();
         allow delete:      if isAdmin();
       }
       match /footfall/{doc} {
         allow read, create, update: if isStaff();
         allow delete: if isAdmin();
       }

       // Setup-style lists: admin manages, staff can read.
       match /staff/{doc}         { allow read: if isStaff(); allow write: if isAdmin() || (request.auth != null && noAdminsYet()); }
       match /services/{doc}      { allow read: if isStaff(); allow write: if isAdmin() || (request.auth != null && noAdminsYet()); }
       match /fixedExpenses/{doc} { allow read: if isStaff(); allow write: if isAdmin(); }
       match /emi/{doc}           { allow read: if isStaff(); allow write: if isAdmin(); }

       // Audit log — append-only for everyone signed in; only admins read.
       match /audit/{doc} {
         allow create: if request.auth != null;
         allow read:   if isAdmin();
         allow update, delete: if false;
       }
     }
   }
   ```

3. Click **Publish**.

> These rules give true role-based access at the database level. Even someone with the API key cannot write outside the rules unless their Google account email is on the team list.

### Step 4 — Authorize Your GitHub Pages Domain

1. Firebase Console → **Authentication → Settings → Authorized domains** tab.
2. Click **Add domain** → enter `ashwinkanth52.github.io` → **Add**.

   *(Without this step, anonymous sign-in will fail with `auth/unauthorized-domain`.)*

### Step 5 — Deploy to GitHub Pages

1. Create a public GitHub repo named **`Ozone-Salon`** (matches your URL).
2. Push these 4 files to the `main` branch root:
   - `index.html`
   - `manifest.json`
   - `service-worker.js`
   - `SETUP.md` (optional)
3. Repo → **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: **main** / **/ (root)** → **Save**.
4. Wait ~1 min, then open **<https://ashwinkanth52.github.io/Ozone-Salon/>**.

### Step 6 — First-Time App Setup

1. Open the live URL on your phone.
2. **Setup wizard, Step 1**: Paste the `firebaseConfig` object from Step 1 → **Test Connection** → expect `✓ Connected to Firebase project "..."` → **Next**.
3. **Step 2**: Shop name, location, UPI ID, GST % → **Next**.
4. **Step 3**: Set 4-digit Staff PIN + 4-digit Admin PIN (used for sensitive actions like discount approval) → **Complete Setup**.
5. App writes initial config + default service menu to Firestore.
6. **Sign in with Google** — the first Google account becomes the Owner/Admin.
7. Add to Home Screen (iOS Share → *Add to Home Screen* / Android: install prompt).

### Step 7 — Add Team, Staff & Customise Services

- Open **Admin → Team** → add Google account emails for other admins or counter staff. Each user must sign in with that exact Google account.
- **Setup** tab → **Staff** → add staff names + salaries (used in payroll).
- **Setup → Services** → edit prices/items → **Save Services**.
- All changes sync to Firestore in real time.

---

## Firestore Collections (auto-created)

| Collection       | Doc ID                          | Fields                                                                                              |
|------------------|---------------------------------|-----------------------------------------------------------------------------------------------------|
| `config`         | `shop` (single doc)             | shopName, location, gstRate, upiId, qrImage, receiptFooter, adminPin, staffPin, discountRequiresPin |
| `staff`          | auto                            | id, name, salary                                                                                    |
| `services`       | auto                            | id, category, name, price                                                                           |
| `transactions`   | auto                            | id, date (YYYY-MM-DD), time, services, subtotal, discount, discountLabel, gst, total, paymentMethod, staffName |
| `expenses`       | auto                            | id, date, category, description, amount                                                             |
| `fixedExpenses`  | auto                            | id, name, amount                                                                                    |
| `salaries`       | auto                            | id, staffId, staffName, month, year, amount, paidDate                                               |
| `emi`            | auto                            | id, name, totalAmount, monthlyEMI, startDate, monthsPaid                                            |
| `attendance`     | `YYYY-MM-DD_StaffName`          | date, staffName, checkIn (auto-deduped per day)                                                     |
| `footfall`       | `YYYY-MM-DD`                    | date, count                                                                                         |

---

## How Real-Time / Offline Works

- **Writes**: Every billing/check-in/expense call goes through Firestore SDK. SDK writes optimistically to local IndexedDB cache and flushes to network whenever connectivity allows.
- **Reads**: Admin tabs do a fresh `get()` per open. Cache returns instantly when offline.
- **Multi-device**: Open the URL on any phone, paste the same `firebaseConfig` in setup. Everything syncs through Firestore. PINs are stored in the `config/shop` document so all devices share them automatically.
- **Conflict handling**: Firestore is last-write-wins by document. The app uses deterministic IDs for attendance (`date_staffName`) and footfall (`date`) to prevent same-day duplicates.

---

## Troubleshooting

| Symptom                                                | Fix                                                                                                   |
|--------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `⚠ Connection failed: auth/unauthorized-domain`        | Add `ashwinkanth52.github.io` to Firebase → Authentication → Settings → Authorized domains.           |
| `⚠ Connection failed: auth/admin-restricted-operation` | Anonymous sign-in is not enabled. Firebase → Authentication → Sign-in method → enable **Anonymous**.  |
| `Missing or insufficient permissions`                  | Firestore rules block writes. Re-paste rules from Step 3 and click **Publish**.                       |
| Setup wizard rejects pasted config                     | Make sure you pasted the **whole object** (including `apiKey` and `projectId`). The wizard accepts both `{…}` JSON and the JS `const firebaseConfig = {…};` form. |
| App stuck on "Connecting to Firebase…"                 | DevTools → Application → Local Storage → delete `oz_fb_config` and `oz_setup_done`, reload, redo setup.|
| Service worker serves stale code after deploy          | DevTools → Application → Service Workers → **Unregister**, then hard reload (Ctrl+Shift+R). Cache version is `ozone-erp-v2` — bump in `service-worker.js` before each major release. |
| Anonymous user accidentally logged out                 | Firestore writes fail until next page load (`signInAnonymously` runs on init). Just reload the app.   |

---

## Updating the App

```powershell
# from this folder
git add index.html service-worker.js manifest.json SETUP.md
git commit -m "update"
git push
```

GitHub Pages re-publishes within ~30 sec. Users get the new code on next reload (service worker cache key changes if you bump the version).

---

## Hardening (optional)

The default rules let any anonymous user read/write your shop's data if they have the Firebase config. Tighter options:

1. **Custom claims** — write a Cloud Function that promotes specific anon UIDs to "shop_admin" via custom claim, then restrict rules to that claim.
2. **Per-shop sub-collections** — namespace everything under `shops/{shopId}/...` and only allow access if `request.auth.uid` is in `shops/{shopId}.allowedUids`.
3. **Phone Auth or Email link** — replace anonymous with an authenticated login screen.
4. **App Check** — enable Firebase App Check (reCAPTCHA v3) so only your domain can call Firestore.

The current setup is fine for a single small business; lock down further before sharing the config publicly.

---

## Files in this folder

```
Ozone-Salon/
├── index.html         ← PWA frontend (Firebase-powered, ~2300 lines)
├── manifest.json      ← PWA install manifest
├── service-worker.js  ← Offline cache (does NOT cache Firebase calls)
├── Code.gs            ← LEGACY — Apps Script backend, no longer used
└── SETUP.md           ← This file
```

`Code.gs` is left in the folder for reference / rollback. It is not used by the Firebase build and you can safely delete it once Firebase is verified working.
