# SusuBox — real backend, no-custody MVP

This is a real, working app: accounts, shared groups (multiple people on
different phones see the same group), Ghana Card + selfie capture, payment
status tracking, and group chat — all backed by a live database (Netlify
Blobs). **No real money moves through it.** Members still pay each other
directly by MoMo; the app only records and displays that it happened.

## What this does NOT do (on purpose)

- Does not collect or hold anyone's money
- Does not send or receive MoMo payments
- Does not lend money or calculate interest
- Does not run automated ID verification (KYC photos are stored, not checked)

Those pieces need Bank of Ghana licensing before they can be built safely —
see the earlier conversation for what that involves.

## Deploying it (5–10 minutes)

Unlike the earlier demo, this has a real backend, so it can't just be
dragged onto Netlify — it needs the Netlify CLI to build and deploy the
functions correctly.

1. Install Node.js if you don't have it: https://nodejs.org (get the LTS version)
2. Open a terminal / command prompt in this folder
3. Run:
   ```
   npm install
   npm install -g netlify-cli
   netlify login
   netlify deploy --prod
   ```
4. When it asks "Create & configure a new site", say yes, pick a site name
5. It will print a live URL when it's done — that's your real, working app

Netlify Blobs (the database) works automatically once the site is deployed
on Netlify — no extra setup or account needed.

## Trying it out

1. Open the live URL, tap **Get started**, create an account with your name,
   phone number, and a password
2. Create a group, share the 6-character group code with the other people
   in your real susu group
3. Each of them creates their own account and taps **Join with code**
4. Now everyone sees the same ledger, live

## Known limitations (worth knowing before you show people)

- Payment status is self-reported — you mark your own payment as sent.
  A natural next step is having the *receiver* confirm it before it turns
  green, which closes the "I said I paid but didn't" gap.
- KYC photos are stored but not automatically checked against anything yet.
- Passwords are hashed properly, but this hasn't been security-reviewed —
  treat it as a working prototype, not something to trust with sensitive
  data at scale yet.
