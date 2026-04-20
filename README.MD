# DentalScan Assessment — Key Engineering Decisions

This document captures the main technical and product choices made while implementing the starter-kit challenges (scan flow, notifications, messaging). The runnable app lives under **`starter-kit/`**.

---

## 1. Scan capture & guidance (Task 1)

### Face quality and gating
- **Primary path:** browser **`FaceDetector`** when available for face presence and rough framing.
- **Fallback path:** **`face-api.js`** (browser UMD bundle from `starter-kit/public/vendor/face-api.min.js`) so we avoid bundling Node-only imports (`fs`, `encoding`) from the ESM package entry.
- **Models:** Tiny Face Detector + Tiny Face Landmark 68 weights are **vendored locally** under `starter-kit/public/models/` so there is **no runtime CDN** dependency for weights.
- **When `FaceDetector` exists:** we still initialize **face-api + landmarks** in the background so mouth pose, openness, and side-view yaw checks stay consistent across browsers.

### Mirrored selfie preview vs capture
- **Live `<video>`** is mirrored horizontally (`scale-x-[-1]`) for natural selfie alignment.
- **Captured frames** are read from the video element as-is (not double-flipped in canvas) so downstream/clinical orientation stays predictable.

### Mouth guide UX
- Guide is **anchored to detected mouth landmarks** (not a fixed viewport position).
- Horizontal position is **mirrored** in screen space so the guide moves the same way the user perceives their face on the mirrored preview.
- **Shape and color** encode openness vs step targets (flatter oval → rounder as openness improves; color moves toward “good” when approaching the target for upper/lower steps).

### Head direction (left/right steps)
- Uses **landmark-based yaw** (nose vs eye midline), with horizontal interpretation **adjusted for the mirrored preview** so “turn left/right” prompts match user motion.

### Capture lock
- User **cannot capture** until automated checks pass (centering, distance, direction where applicable, mouth openness on upper/lower). Messaging stresses **manual tap to capture** so users do not expect auto-shutter.

### Tuning detection strictness
- Adjust the **`FACE_TUNING`** object near the top of **`starter-kit/src/components/ScanningFlow.tsx`** (single place). Comments in that block describe each ratio; **increase** `maxCenterOffsetX` / `maxCenterOffsetY` or **decrease** `mouthOpenPassThreshold` / `targetMouthOpenUpperLower` to make capture easier.

---

## 2. Notifications (Task 2)

### Persistence model
- On scan completion, **`POST /api/notify`** runs a **Prisma `$transaction`**: update or create **`Scan`** (with required **`userId`** — body `userId` or demo default), **find-or-create `Thread`** keyed by **`Thread.patientId = scan.id`**, then insert **`Notification`** with **`read: false`** for unread tracking.
- Response includes **`threadId`** so the client can open messaging without `scanId`-based thread discovery.
- **`CLINIC_USER_ID`** is a **fixed UUID-shaped constant** (not `crypto.randomUUID()` at module load), so every notification targets the same demo clinic user across server restarts.

### Prisma in Next.js
- Shared **`starter-kit/src/lib/prisma.ts`** singleton to avoid connection proliferation during dev hot reload.

### Client trigger
- After five successful captures, **`ScanningFlow`** calls **`/api/notify`** once (guarded with a ref to avoid duplicate sends under React Strict Mode).

### Async semantics (not “fire-and-forget HTTP”)
- The **HTTP handler awaits** the DB transaction before responding so the client gets a definitive success/failure and the DB stays consistent. The UI still shows an explicit loading state while waiting.

---

## 3. Patient–clinic messaging (Task 3)

### Data model mapping
- **`GET /api/messaging`** loads **`Message`** rows with **`findMany({ where: { threadId } })`**. **`Message`** stores **`threadId`** as a **scalar** (no Prisma `@relation` to **`Thread`**) so there is no bidirectional Thread ↔ Message model coupling; integrity is enforced in application / API code.
- **`Thread.patientId`** is the **scan id** (one thread per completed scan), created in the same transaction as notify.
- The UI receives **`threadId`** from **`POST /api/notify`** and passes it to **`GET /api/messaging?threadId=…`** / **`POST /api/messaging`** with **`threadId`**.

### API behavior
- **GET:** requires **`threadId`**; loads **`Thread`** then **`message.findMany({ where: { threadId } })`** — **400** if missing, **404** if thread absent.
- **POST:** requires **`threadId`** and **`content`**; verifies thread exists, creates **`Message`** with **`sender: "patient"`** only (no clinic send from this UI), bumps **`Thread.updatedAt`**.

### UI / state
- **`QuickMessageSidebar`** on the **same post-scan screen** as results (no extra navigation).
- **Optimistic sends:** message appears immediately; on failure the optimistic bubble is removed and **draft text is restored** so nothing is silently lost.
- **Scroll layout:** post-scan shell uses **`100dvh` + `min-h-0` flex chain** so **only the message list scrolls**, not the whole page (header + thumbnails stay pinned).

---

## 4. IDs and database defaults

- Prisma **`@id`** fields use **`@default(uuid())`** instead of `cuid()` for standard UUID-shaped primary keys.
- Client-side **optimistic message ids** use **`crypto.randomUUID()`** so they match server id format until the real row is returned.

---

## 5. Operational notes

- From **`starter-kit/`**: `npm install`, `npx prisma db push`, `npm run dev`.
- After schema changes, run **`npx prisma generate`** (or rely on `npm run build` / dev which regenerates as needed).
