# PCL Tutor — Midterm Prototype

Practice Centered Learning (PCL) Tutor is a React-only prototype for the Midterm Web & Mobile Application Development project. Two roles, hardcoded data, role-based menus/dashboards, and a working tutoring-booking flow. 

## Demo accounts

**Student / Client**
- Username: `student`
- Password: `student123`

**Tutor / Administrator**
- Username: `tutor`
- Password: `tutor123`

## Run

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Assessed page families

The project is organized around the four midterm page families:

1. **Login** — simulated role-based login using hardcoded users.
2. **Dashboard** — conditional content based on the current role.
3. **Discovery / detail** — student tutor discovery and tutor profile/availability.
4. **Form** — the main booking/request flow.

The project also contains contextual routes for sessions, requests, activity/notifications, tutor availability, taught subjects, and profile. These are supporting workspace views so the prototype behaves like a coherent application instead of a set of dead mockup buttons.

## Important route behavior

### Student
- `/` — Home
- `/find` — Find a Tutor
- `/requests` — My Requests
- `/sessions` — My Sessions + interactive calendar
- `/activity` — Activity
- `/notifications` — Notification center
- `/profile` — Profile
- `/tutor/:id` — Tutor Detail
- `/booking` — Booking Form

### Tutor
- `/` — Home
- `/requests` — Incoming Requests
- `/availability` — Interactive availability manager
- `/sessions` — Sessions + calendar
- `/subjects` — Teaching subjects
- `/notifications` — Notification center
- `/profile` — Profile
- `/booking?mode=suggest&request=<id>` — Suggest another time

## Interaction rules

- Every primary button has a defined destination or state change.
- Search opens the dedicated discovery view so results appear at the top instead of below a hero panel.
- Tutor profiles expose an interactive mini calendar; selecting a date reveals slots.
- "View full calendar" opens the dedicated calendar route.
- "Suggest time" opens a dedicated response form and updates the matching request/session state.
- The top-right profile chip opens a functional editable profile page.
- Notifications link to the relevant workspace instead of being decorative.
- The sidebar collapses to a symbol-only rail on desktop and becomes a drawer on mobile.

## Code explanation guide

Be ready to explain:
- `useState` — form fields, filters, selected calendar day, role state.
- `useEffect` — persisted demo preferences and user profile state.
- props — parent state passed into reusable page/components.
- `map()` + `key` — rendering tutor cards, days, requests, notifications.
- `onChange` — controlled inputs.
- `preventDefault()` — stopping form reloads before validation/state updates.
- React Router — page navigation and role-aware workspace routes.
- conditional rendering — Student vs Tutor dashboard and menu.
- shared state in `App.jsx` — bookings, requests, availability and profile updates.

## GitHub Pages

`HashRouter` is used so the same route works after a GitHub Pages refresh. Use the included Vite configuration when deploying the `dist/` output.

## Note on scope

The real midterm brief explicitly says that the current stage is hardcoded frontend work. The backend, database, real authentication, and mobile client belong to the later Final stage. Keep this prototype explainable: do not replace the simulated role login with JWT/Firebase/Auth0 or another backend authentication system for the midterm.

## Code guide

See `CODE_GUIDE.md` for the file map and the React concepts used in the demo.
