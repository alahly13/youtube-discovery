# PWA Web Share Target Specification & Integration Guide (2026)

**Feature:** Progressive Web App (PWA) Web Share Target  
**Scope:** Android Google Chrome Native Share Sheet Integration → Review & Edit Workspace → Canonical Cloud Library Persistence  
**Target Environment:** Google Chrome on Android (WebAPK / Installed PWA)  
**Supported Standards:** W3C Web Share Target API (Level 1 & Level 2), Web App Manifest, Service Worker Cache Storage Handoff

---

## 1. Overview & Objectives

The **PWA Web Share Target** enables users to share web pages, articles, and video links directly from **Google Chrome on Android** to YouTube Discovery using the Android system Share menu.

### Example User Journey
1. The user navigates to an interesting webpage or scientific publication in Google Chrome on Android.
2. The user taps **Share** in Chrome's menu.
3. The user selects **YouTube Discovery** from the Android native share sheet.
4. Android Chrome launches the application's registered share receiver.
5. The application extracts, sanitizes, and normalizes the shared URL, title, and optional notes.
6. The user reviews the shared link, edits the title if desired, chooses the target destination (**Saved Titles & Links** or **Research Queue**), and taps **Save to Library**.
7. The item is committed locally to IndexedDB and immediately synchronized with Cloudflare R2 and Supabase PostgreSQL.

---

## 2. PWA Manifest & Service Worker Architecture

### 2.1 Web App Manifest (`public/manifest.webmanifest`)
The manifest configures the PWA identity and the Web Share Target specification:

```json
{
  "name": "YouTube Discovery Research Terminal",
  "short_name": "YouTube Discovery",
  "description": "Manifest-first YouTube public metadata discovery, filtering, saving, exporting, and scoped AI analysis.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#09090d",
  "theme_color": "#09090d",
  "share_target": {
    "action": "/share-target",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url"
    }
  },
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

### 2.2 Service Worker Handoff (`public/sw.js`)
Because Android WebAPK uses HTTP POST to transfer multipart share data, the service worker intercepts `POST /share-target`:
1. Reads `formData()` containing `title`, `text`, and `url`.
2. Sanitizes fields against length ceilings and control characters.
3. Generates a cryptographically random 128-bit hex token (`createToken()`).
4. Caches the payload in Cache Storage (`youtube-discovery-share-target-v1`) under the token key with an automatic 1-hour expiration.
5. Returns an HTTP `303 See Other` redirect to:
   ```
   GET /share-target?share=<token>
   ```
   This ensures that refreshing the browser does not re-submit form data.

---

## 3. Dedicated Share Review Route (`/share-target`)

The receiving page at `/share-target` provides a mobile-first, responsive interface:

- **Input Detection:** Seamlessly accepts:
  - Service worker handoff tokens: `?share=<token>`
  - Direct GET query parameters: `?url=...&title=...&text=...`
  - Manual paste fallback when opened without parameters.
- **Data Normalization:**
  - Extracts HTTP/HTTPS links even if the Android app placed the URL inside the `text` field.
  - Strips trailing punctuation, brackets, and quotes.
  - Automatically derives a readable title from the domain and pathname if the shared title was missing.
  - Separates contextual notes from the title.
- **Duplicate Prevention:**
  - Performs real-time server check (`POST /api/share-target/validate`) against `saved_references`.
  - Prominently warns if the link is already in the library, preventing accidental duplicate records.
- **Destination Selector:**
  - **Saved Titles & Links** (`REFERENCES` dataset) — default for external web pages and references.
  - **I Will Search For** (`RESEARCH_QUEUE` dataset) — for research queue items.
- **Local-First Durability:**
  - Commits to browser IndexedDB before reporting success.
  - Automatically triggers cloud synchronization (`saveAll()`).
  - Gracefully handles offline or network timeouts with a `PENDING` sync badge that retries automatically.

---

## 4. Security & Open-Redirect Protections

1. **Protocol Whitelist:** Only absolute `http:` and `https:` URLs are accepted. Schemes such as `javascript:`, `data:`, `file:`, `blob:`, and `ftp:` are strictly rejected.
2. **No Blind Server Fetches:** The server does NOT fetch arbitrary external URLs shared by the user, preventing Server-Side Request Forgery (SSRF).
3. **Session Handoff & Safe Redirects:**
   - If an unauthenticated user opens the share target, they are redirected to `/login?next=/share-target?share=...`.
   - The redirect path is sanitized through `sanitizeRedirectPath()`, rejecting protocol-relative URLs (`//attacker.com`) and backslash evasion (`/\attacker.com`).
4. **Input Ceilings:** Field sizes are capped (Title: 512 chars, URL: 2,048 chars, Notes: 4,000 chars) to prevent storage bloat or DoS attacks.

---

## 5. Android Chrome Testing Procedure

To test Web Share Target from Google Chrome on an Android device:

1. **Prerequisites:**
   - Deploy the application to an HTTPS host (or use ngrok/Cloudflare tunnel for local development, e.g. `https://your-tunnel.ngrok.app`).
   - Open the application in **Google Chrome on Android**.
2. **PWA Installation:**
   - Tap Chrome's menu (three dots) → **Install app** or **Add to Home screen**.
   - Wait for Chrome to complete the WebAPK installation (this registers the share target with Android OS).
3. **Trigger Share:**
   - Open any website in Chrome (e.g. `https://en.wikipedia.org/wiki/Antigravity`).
   - Tap Chrome's menu → **Share...**
   - In the Android native share sheet, find and tap **YouTube Discovery**.
4. **Review & Save:**
   - The application opens directly to `/share-target`.
   - Confirm that the title, URL, and domain preview are populated accurately.
   - Tap **Save to Library**.
   - Confirm the green success confirmation and tap **View in Library** to verify the record in `/saved-titles-links`.

---

## 6. Browser Compatibility & Technical Limitations

| Platform | Web Share Target Support | Behavior |
| :--- | :--- | :--- |
| **Chrome for Android (Installed PWA)** | ✅ Full Native Integration | Appears directly in Android Share sheet |
| **Chrome for Android (Browser Tab)** | ⚠️ Requires Installation | WebAPK registration occurs upon installation |
| **Desktop Chrome / Edge** | ⚠️ Partial (PWA installed on OS) | Appears in Windows/macOS share menu if PWA is installed |
| **Safari on iOS** | ❌ Not Supported by Apple | Web Share Target is not supported in WebKit/iOS |
| **Firefox / Other Mobile Browsers** | ⚠️ Limited / Fallback | Direct GET link or manual URL input fallback |

### Technical Limitations
- A website or PWA **cannot** enumerate open Chrome tabs automatically.
- A website **cannot** read Chrome browsing history or bookmarks.
- The feature receives only content **explicitly shared** by the user via the system Share menu.
- A manual URL input fallback is always available for unsupported browsers.
