# NovaBlock.io — Investment Platform

NovaBlock.io is an investment platform for trading stocks and cryptocurrencies, with
deposits, withdrawals, swaps, portfolio tracking, KYC verification, referrals and a
full admin control panel. It is a Next.js project built for Vercel: the static
front-end lives in `public/`, and the Express + Postgres API in `backend/` runs inside a
single Next.js API route.

## Structure

```
broker/
├── package.json            → Next.js project (`npm run dev` / `build` / `start`)
├── next.config.js          → `/` → index.html, `/admin` → admin.html, security headers (CSP…)
├── pages/api/[...path].js  → hands every /api/* request to the Express app in backend/
├── public/                 → all front-end code + assets (served at the site root)
│   ├── index.html          → public landing page (marketing / entry to the app)
│   ├── dashboard.html      → user app: sidebar, topbar, views, modals, login screen
│   ├── signup.html         → standalone signup page (create your account)
│   ├── forgot.html         → password-reset request (emails a 6-digit code)
│   ├── reset.html          → enter the emailed code + new password
│   ├── legal.html          → Terms of Service · Privacy Policy · Risk Disclosure
│   ├── admin.html          → standalone admin panel (own login, controls user data)
│   ├── favicon.png/.svg    → brand icons
│   ├── logo.png            → brand logo
│   ├── css/                → styles.css, polish.css, glossy.css (custom styles)
│   └── js/
│       ├── tailwind.config.js  → Tailwind theme config (loads BEFORE the CDN)
│       ├── app.js              → utilities, modals, sidebar, toast, clipboard
│       ├── store.js            → shared data layer + server sync (balances, transactions, profile…)
│       ├── chart.js            → portfolio chart: rendering, crosshair + tooltip
│       ├── profile.js          → profile data, view switching, edit-profile
│       ├── kyc.js              → KYC system: 3 levels, file uploads, saved state
│       ├── transactions.js     → transactions data + filtered/searchable table
│       ├── referrals.js        → referral link, stats, tiers, referred-users table
│       ├── swap.js             → swap page: asset rates, live estimate, flip direction
│       ├── transfer.js         → transfer page: internal/external, fees, KYC gate
│       ├── trading.js          → trade page: 17 markets, live-flow chart, positions
│       ├── auth.js             → login/logout gate + account registration
│       ├── signup.js           → signup page logic
│       ├── forgot.js / reset.js → password-reset code flow
│       ├── search.js           → topbar live search (coins, transactions, pages)
│       ├── admin.js            → admin panel logic
│       └── main.js             → startup (auth check, draw chart, fill profile, route by #hash)
└── backend/                → Express API (never served over HTTP; bundled into the API route)
    ├── app.js              → Express app: middleware + /api/* route mounts
    ├── env.js              → central config (Vercel env vars, or backend/.env locally)
    ├── db/                 → Postgres pool, schema migrations, queries
    ├── routes/ controllers/ services/ middleware/ utils/
    ├── email.js            → nodemailer wrapper + branded email templates
    └── email-config.js     → SMTP settings (from env)
```

## Views

- **Dashboard** — KPI cards, chart, allocation, market, recent transactions
- **Profile** — personal info, address, security, KYC status
- **Transactions** — filter tabs (All / Deposits / Withdrawals / Swaps / Bonuses), live search
- **Verification Center (KYC)** — 3 levels (email/phone → government ID → proof of address),
  file uploads, levels unlock in order
- **Swap Crypto** — convert between BTC / ETH / USDT / BNB with live rate math
- **Trade** — buy and sell **17 markets** (AAPL, TSLA, GOOG, MSFT, AMZN, NVDA, META, NFLX, AMD
  stocks + BTC, ETH, SOL, ADA, XRP, DOGE, LINK, BNB crypto) with a **Live Flow** chart that
  animates the selected asset's price in real time
- **Transfer Funds** — internal (free, instant) or external wallet (0.5% fee)
- **Referrals** — copyable referral link, stats, commission tiers

## Search

The topbar search box searches **coins**, **transactions** and **pages** as you type.
Click a result to open the related view.

## Accounts & login

- The app is covered by a **login screen** until you sign in.
- **Create account** on the login screen or `signup.html` registers a real account on the
  backend — every user gets their **own balances, transactions, holdings, profile, referrals
  and KYC**, stored in SQLite.
- Passwords are hashed with scrypt (per-user salt) — never stored in plain text.
- Login verifies against the server; the session token lives in `sessionStorage`, so you stay
  logged in across reloads in the same tab.
- Duplicate emails are rejected; every signup triggers the **Welcome email** (see Email system).

## Admin panel

A separate page at **`/admin`** (`backend/admin.html`) with its own **password-only login**
(`BigGod123`). The user app never links to it. The admin panel manages **every registered
user** and their records, arranged in a searchable list.

- **Users** *(default view)* — every account in a table: name, email, phone, balance, KYC
  badge, join date, with stats cards above (total users, total balance, pending approvals,
  emails sent). Search filters as you type. **Add user** creates an account directly (welcome
  email is sent/logged). Click a user to open their full records; **Manage** arrows, **✉** and
  **🗑** act on that account.
- **Overview** — the selected user's balance + Total Bonus / Deposit / Withdrawal, "Reset user
  data", and editable deposit wallets. Admin controls user **balances only**.
- **Transactions** — add, approve or decline the selected user's deposit/withdrawal requests;
  approve a deposit credits the coin holding + balance, approve a withdrawal deducts them.
- **KYC** — verify/revoke each level for the selected user; uploaded documents are stored on
  disk. A verification sends the **KYC Verified email**.
- **Profile** — edit every profile field for the selected user.
- **Referrals** — pending-rewards stat plus add/edit/delete referred users.
- **Email** — send the selected user an email from the built-in templates (Welcome / KYC
  Verified / Custom) or the message log of every outgoing email.

Every edit is pushed to the backend immediately, so it shows up on the user dashboard live.

## Email system

The backend sends branded emails through **nodemailer** using `backend/email-config.js`.
Templates use `{{name}} {{email}} {{accountId}}` placeholders and are auto-filled.

- **Welcome** — sent automatically when a user signs up (in-app modal or `signup.html`).
- **KYC Verified** — sent automatically when a user's identity is verified (Level 1 or admin).
- **Custom** — composed by the admin from the **Email** tab and sent to the selected user.

**Do I need to provide an email? — Yes, for real delivery.** Add SMTP credentials in
`backend/email-config.js` (or the `SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM`
environment variables):

| Provider  | Host                    | Port | Notes                              |
|-----------|-------------------------|------|------------------------------------|
| Gmail     | smtp.gmail.com          | 465  | requires an **App Password**       |
| Brevo     | smtp-relay.brevo.com    | 587  | free tier, monthly limit           |
| SendGrid  | smtp.sendgrid.net       | 587  | API-key based                      |
| Resend    | smtp.resend.com         | 587  | free tier                          |

Until credentials are added, **nothing breaks**: every email is stored in the admin **Email
log** with status **Logged** (the full body is saved). Once SMTP is configured the status
flips to **Sent** and messages reach real inboxes — no code change needed.

### Notifications (user bell)

Notifications are **auto-generated only** — they are never sent manually. The topbar bell
receives one notification per **completed** transaction: approved deposits/withdrawals,
completed trades and swaps.

### Deposit / withdrawal flow

- Deposit offers Bitcoin / USDT / Ethereum (wallets editable by the admin).
- Submitting a deposit or withdrawal creates a **pending** transaction that appears in the
  user's Transactions view until the admin approves or declines it.
- Approve a deposit → credits the coin holding, account balance and Total Deposit.
- Approve a withdrawal → deducts the coin holding, balance and adds to Total Withdrawal.

### Swap Crypto

Balances start at zero and grow from **approved deposits**. The Swap page moves value between
coins at the current rate; a completed swap is added to the transaction history.

## Legal

`legal.html` contains the **Terms of Service**, **Privacy Policy** and **Risk Disclosure**,
reachable from the login screen, signup page and the footer. Company identity:
**NovaBlock.io Markets Ltd.** — update the placeholders with your real legal details before
going live.

## How to run locally

```bash
npm install
npm run dev      # → http://localhost:3000  (user app at /, admin at /admin)
```

Settings are read from `backend/.env` (copy `backend/.env.example`). A Postgres database
is required — the schema is created automatically on the first API request.

## Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel (framework preset: **Next.js**, root
   directory: the repo root — no build settings to change).
2. Under **Settings → Environment Variables** add everything from `backend/.env.example`:
   at minimum `DATABASE_URL` (Neon / Supabase), `ADMIN_PASS`, `KYC_URL_SECRET`, and the
   `SMTP_*` / `MAIL_FROM` values. Set `SITE_URL` and `APP_ORIGIN` to your Vercel domain.
   `NODE_ENV` and `TRUST_PROXY` are handled automatically.
3. Deploy. For Supabase use the **transaction pooler** connection string (port 6543) —
   serverless functions open many short-lived connections.

Vercel limits: request bodies are capped at **4.5 MB**, so very large KYC PDFs will be
rejected (photos are downscaled in the browser and are fine). Rate limits are kept in
memory per serverless instance, so they are looser than on a single server. Logs appear
in the Vercel dashboard instead of `backend/logs/`.

## Notes

- Fonts, Tailwind and FontAwesome load from CDN, so internet is required.
