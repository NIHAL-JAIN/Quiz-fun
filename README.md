# GLP-1 Quiz Funnel

An 8-step quiz built in plain HTML/CSS/JS, wired into GTM, Meta Pixel, and Klaviyo.

## Files

```
quiz-funnel/
├── index.html     8 quiz questions + final contact step
├── styles.css      styling, mobile responsive
├── script.js       navigation, tracking, Klaviyo API calls
└── README.md        this file
```

Open `index.html` directly in a browser to try it locally (no build step, no server required — though for the Klaviyo calls to actually succeed you'll need real API keys, see below).

---

## 1. What the quiz does

- 8 multiple-choice questions (goal, journey so far, weight-loss target, age
  range, health conditions, GLP-1 experience, motivation, timing), one per
  screen, with a progress bar and Back/Next controls.
- A 9th step collects **first name, email, phone**.
- On submit: fires a Meta Pixel `Lead` event, sends the contact + all quiz
  answers to Klaviyo, then redirects to
  `https://ledisa.com/products/glp-1`.
- Selections are held in a single `state.answers` object
  (`{ goal, journey, weight_goal, age_range, conditions, glp1_experience,
  motivation, start_timing }`) that's reused by every tracking call, so the
  same data reaches GTM, Meta, and Klaviyo consistently.

## 2. Before going live — replace these placeholders

In `index.html`:
- `GTM-XXXXXXX` (appears twice: `<head>` script + `<noscript>` tag) → your GTM container ID
- `YOUR_PIXEL_ID` → your Meta Pixel ID

In `script.js` (`CONFIG` object at the top):
- `KLAVIYO_COMPANY_ID` → Klaviyo **public** API key (Settings → API Keys)
- `KLAVIYO_LIST_ID` → the List ID you want quiz leads added to
- `KLAVIYO_REVISION` → keep this pinned to a current Klaviyo API revision date
- `REDIRECT_URL` → already set to the GLP-1 PDP, change if needed

> Note: only Klaviyo's **public** key is used client-side (this is what
> Klaviyo's Client API is designed for — it can create profiles, subscribe
> people, and log events, but it can't read data back or do anything
> destructive). Your **private** Klaviyo key should never appear in
> front-end code; it's only relevant later, inside the CKC plugin config
> described in Section 4.

## 3. How tracking is wired up

### GTM (`quiz_step_N` events)
Every time a step renders, `script.js` pushes to `dataLayer`:
```js
{ event: "quiz_step_3", quiz_step_number: 3, quiz_answers_so_far: {...} }
```
The contact step pushes `quiz_step_contact` instead of a numbered event.
In GTM, create a **Custom Event trigger** matching `quiz_step_.*` (regex) and
map `quiz_step_number` / `quiz_answers_so_far` as Data Layer Variables to
feed GA4 or Ads conversion tags.

### Meta Pixel (`Lead` on final submission)
Fired once, on successful form submit, with quiz answers passed as event
parameters (goal, weight target, age range, GLP-1 experience, start timing)
so Ads can build lookalike/optimization audiences off actual quiz intent,
not just "submitted a form."

### Klaviyo (profile, subscription, event)
Three calls fire in parallel on submit, all authenticated with the public
company_id (no server needed):
1. `POST /client/profiles/` — creates/updates the person's profile, saving
   every quiz answer as a custom property (`quiz_goal`, `quiz_weight_goal`,
   etc.) so you can segment and personalize flows in Klaviyo later.
2. `POST /client/subscriptions/` — subscribes the profile (email + SMS
   consent) to the list in `KLAVIYO_LIST_ID`.
3. `POST /client/events/` — logs a `Completed Quiz` metric on the profile
   with the full answer set as event properties, so you can trigger a flow
   directly off quiz completion (e.g. "Completed Quiz" → send results
   email) separate from the list-subscribe itself.

All three calls use `Promise.allSettled` and the redirect happens in a
`finally` block — so if Klaviyo is briefly slow or unreachable, the person
still lands on the product page instead of being stuck on a spinner.

---

## 4. CheckoutChamp → Klaviyo list activation (written explanation)

*No CKC access was used for this section — this is the setup approach
based on how CKC's Klaviyo integration and campaign structure work.*

**Goal:** when a customer completes a purchase in CheckoutChamp, add them
to a specific Klaviyo list automatically (e.g. a "Customers — GLP-1
Purchasers" list, to drive post-purchase flows and exclude them from
top-of-funnel lead nurture).

### Step-by-step

**A. Connect the integration**
1. In CheckoutChamp: Admin → Integrations (or Plugins) → find **Klaviyo**
   and install/enable it.
2. Enter the Klaviyo **private API key** here (this is the one place it
   belongs — server-to-server, never in the quiz's front-end code).
3. Confirm the connection status shows "Active"/"Connected."

**B. Campaign routing setup**
CKC organizes offers under "Campaigns" (each campaign = a product/funnel
path, e.g. "GLP-1 Starter Kit," "GLP-1 Subscription"). The Klaviyo plugin
lets you map *specific campaigns* to *specific Klaviyo lists*, rather than
sending every CKC customer to one master list:
1. Inside the Klaviyo plugin settings, open **Campaign Mapping** (or
   "List Routing," naming varies by CKC version).
2. For each campaign you want to route:
   - Select the CKC **Campaign** (e.g. `GLP-1 Starter Kit`).
   - Select the destination **Klaviyo List** (pull via the API key
     connection, which lists all existing Klaviyo lists — e.g.
     `Customers – GLP-1`).
   - Save the mapping.
3. Repeat per campaign/brand if you run multiple brands through one CKC
   instance — each brand's campaigns route to that brand's own Klaviyo
   account/list, so lists stay clean and audience-specific.

**C. Event type selection**
CKC exposes several trigger points (event types) you can push to Klaviyo,
typically including things like: *Order Placed / Initial Sale*,
*Upsell Accepted*, *Rebill Success*, *Refund*, *Chargeback*, *Cancellation*.
1. For list-add-on-purchase specifically, select **"Order
   Placed"/"Initial Sale success"** as the trigger event — not "Rebill,"
   which would re-fire on every recurring charge and is better routed to a
   separate Klaviyo *event* (for a "still subscribed" flow) rather than a
   repeated list-add.
2. Make sure the event is set to push the standard **customer fields**
   (email, first name, last name, phone) plus **order-level fields**
   (product SKU, campaign name, order total) as event properties — these
   become available as Klaviyo event/metric properties even though the
   list-add itself is just a subscribe action.
3. Turn off any event types you don't want triggering a list-add (e.g. you
   likely don't want "Refund" or "Chargeback" adding someone to a
   *customer* list — those should either do nothing or route to a
   suppression/at-risk list instead).

**D. Handling multiple products**
Since one CKC instance often sells several SKUs (GLP-1 kit, sleep support,
metabolism boost, etc.), you have two reasonable structures — pick based on
how granular your Klaviyo flows need to be:

- **Option 1 — one list per product line.** Map each product's campaign to
  its own Klaviyo list (`Customers – GLP-1`, `Customers – Sleep`, etc.).
  Best if each product has its own dedicated post-purchase flow, cross-sell
  sequence, or replenishment reminder cadence.
- **Option 2 — one shared "Customers" list + product tagging via
  properties.** Route every campaign to a single master customer list, but
  make sure the "product/SKU purchased" field is passed through as an event
  property on the Order Placed event. Then build Klaviyo **segments** off
  that property (e.g. `Product Purchased = GLP-1 Kit`) instead of
  maintaining many lists. This scales better once you're past ~5-6 SKUs, and
  avoids "list sprawl" where a customer who buys 3 products ends up on 3
  separate lists with 3 separate suppression rules to manage.

In practice, a hybrid works well for most multi-brand operators: one list
per **brand** (so sending/suppression stays brand-safe), with
product-level **segments built from event properties** inside each brand's
list — you get clean send boundaries at the brand level without list
sprawl at the SKU level.

**E. Test before going live**
1. Run a test transaction (CKC sandbox mode if available, or a $0/low-value
   test SKU).
2. Confirm in Klaviyo: the profile appears, is subscribed to the correct
   list, and the Order Placed event properties (SKU, campaign, order value)
   show up on the profile's timeline.
3. Only then flip the mapping live for the full campaign.

---

## 5. What I'd do next with more time

- Add Meta **Conversions API** (server-side) alongside the client Pixel
  call, using the same `eventID` already generated in `trackMetaLead`, for
  proper event de-duplication and iOS/ad-blocker resilience.
- Add basic phone number formatting/E.164 normalization before sending to
  Klaviyo, since SMS consent generally requires a well-formed number.
- Persist `state.answers` to `sessionStorage` so a refresh mid-quiz doesn't
  lose progress.
