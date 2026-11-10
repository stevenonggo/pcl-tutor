# PCL Tutor Mobile (Phase 1)

React Native + TypeScript + Expo Router app that talks to the existing
PCL Tutor Django backend (`../backend`). Runs in **Expo Go** (managed
workflow) — no native builds needed.

## Phase 1 scope (approved decisions)

1. **Authentication**: Django JWT (SimpleJWT) — register, sign in, refresh,
   session restore. Tokens are stored in `expo-secure-store` (device Keychain
   / Keystore), never in plain storage.
2. **Out of scope**: tutors, requests, sessions. No backend endpoints exist
   for them yet; the dashboard marks those areas as "coming in Phase 2"
   instead of shipping dead UI.
3. **Study Plan**: uses the existing `POST /api/study-plan/generate/`
   OpenRouter proxy, **unchanged**. That endpoint is unauthenticated — a
   documented, temporary, local-development-only risk. See
   `docs/study-plan-security-risk.md`. Do not treat Phase 1 as production-ready.

## Study Plan — subject picker and design language

- **Subject input**: the free-text subject field was replaced with a
  searchable dropdown (`src/components/SubjectDropdown.tsx`) populated from
  the shared subject catalog. The mobile copy lives in `src/data/subjects.ts`
  and mirrors the web app's `frontend/src/data/catalog.js` — keep both lists
  in sync when the catalog changes. Search filtering is the pure
  `filterSubjects` function in `src/lib/subjects.ts` (unit-tested).
- **Generation flow**: unchanged. The request still goes to
  `POST /api/study-plan/generate/` (Django OpenRouter proxy) with the chosen
  subject and settings; results are normalized and rendered exactly as
  before. No hardcoded or template-based AI output is introduced.
- **Visual consistency**: the app now uses the web app's design language —
  accent `#0B8F68` (emerald), `#ECEEEF` background, ink/line text and border
  scales, web radii (cards 18px, inputs 9px, buttons 10px), and the brand
  fonts Inter (body) + Plus Jakarta Sans (headings), bundled in
  `assets/fonts/` and loaded via `expo-font` in `app/_layout.tsx` (the app
  falls back to system fonts if loading fails).

## Prerequisites

- Node.js 20+
- The PCL Tutor Django backend running locally (`../backend`)
- Expo Go installed on your device (iOS App Store / Android Play Store),
  or an Android/iOS emulator

## Backend setup (no changes made by this app)

```bash
cd ../backend
pip install -r requirements.txt
python manage.py runserver 0.0.0.0:8000
```

Bind with `0.0.0.0` so the emulator / phone can reach it. Note the dev
settings run `DEBUG=True` with `ALLOWED_HOSTS=[]`, which accepts
`localhost` only. For a **physical phone on your LAN** you must allow the
Host header your machine sees (dev-time tweak, do not commit):

```python
ALLOWED_HOSTS = ['*']   # local development only
```

Android emulators calling `http://10.0.2.2:8000` present `10.0.2.2` as the
Host, so this tweak is needed there too unless you test with a browser on
the host.

## Configure the API address

Copy `.env.example` to `.env` (a working `.env` is already provided):

```
EXPO_PUBLIC_API_BASE=http://10.0.2.2:8000/api     # Android emulator
EXPO_PUBLIC_API_BASE=http://localhost:8000/api     # iOS simulator
EXPO_PUBLIC_API_BASE=http://192.168.x.x:8000/api   # Expo Go on a phone
```

`EXPO_PUBLIC_*` values are inlined at bundle time — restart the dev server
after editing `.env`. The exact target this build talks to is shown on the
Profile tab so you can verify you are pointing at the right machine.

## Run

```bash
cd mobile
npm install
npx expo start
```

- Scan the QR code with **Expo Go** on your device, or
- Press `a` to run in an Android emulator, `i` for iOS.

## Scripts

| Command             | Purpose                              |
| ------------------- | ------------------------------------ |
| `npm run start`     | Start the Expo dev server            |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`)   |
| `npm test`          | Jest tests (plan normalizer)         |
| `npm run android`   | Build/run native Android (no Expo Go)|
| `npm run ios`       | Build/run native iOS (no Expo Go)    |

## Architecture

```
mobile/
  app/                  # Expo Router routes
    _layout.tsx         # Root: AuthProvider + (auth)/(tabs) groups
    (auth)/login.tsx    # Django sign-in (POST /api/login/)
    (auth)/register.tsx # Django register (POST /api/register/) + auto sign-in
    (tabs)/_layout.tsx  # Auth gate: unauthenticated -> login
    (tabs)/dashboard.tsx
    (tabs)/study-plan.tsx
    (tabs)/me.tsx       # Profile, API target, sign out
  src/
    lib/api.ts          # fetch wrapper: JWT auth, single-flight refresh on 401
    lib/tokens.ts       # SecureStore persistence + in-memory token cache
    lib/config.ts       # API_BASE resolution (env -> platform default)
    lib/studyPlan.ts    # Normalizer: raw OpenRouter plan -> safe UI shape
    lib/types.ts        # API types mirroring the backend serializers
    stores/AuthProvider.tsx # Global auth state (restore/signIn/signUp/signOut)
    components/         # LabeledInput, PrimaryButton
    theme.ts            # Design tokens (teal PCL branding)
  tests/                # Jest unit tests
  docs/                 # Security risk documentation
```

### Auth flow

- Sign in → `POST /api/login/` (SimpleJWT pair) → tokens to SecureStore →
  `GET /api/me/` loads the profile.
- App restart → tokens loaded from SecureStore → validated with `GET
  /api/me/` (15-minute access tokens are transparently refreshed via
  `POST /api/token/refresh/`, single-flight, before the session is declared
  dead).
- Sign out → tokens wiped from SecureStore and memory.

## Security notes

- No secrets in this folder. `.env` holds only the non-secret API base URL
  and is gitignored (root `.gitignore`).
- JWTs live only in `expo-secure-store`.
- The study-plan endpoint is open by decision (Phase 1) — see
  `docs/study-plan-security-risk.md` for what must happen before any public
  release.

## Phase 2 (not built)

- Django endpoints for tutors, availability, requests, sessions.
- Corresponding screens and the `find` tab.
- Auth on the study-plan endpoint + rate limiting.
