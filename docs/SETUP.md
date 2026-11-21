# Local setup

## Prerequisites

- Node.js compatible with the Vite version in `package-lock.json`
- npm
- A Supabase project for authenticated and payment workflows
- A Paystack account; transfer capability is required for payouts
- Supabase CLI for database and Edge Function development/deployment

## Frontend

1. Install the locked dependencies:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env` and set:

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_PAYSTACK_PUBLIC_KEY`

   `VITE_` variables are public and included in browser assets. Never place a
   Supabase service-role key or Paystack secret key in `.env` or any `VITE_`
   variable.

3. Start the frontend:

   ```sh
   npm run dev
   ```

## Database

The repository contains a SQL bootstrap schema and incremental migrations but
does not yet have a clean, empty-database baseline migration. For an existing
project, inspect migration history and review a dry run before applying changes:

```sh
supabase link --project-ref <your-project-ref>
supabase migration list --remote
supabase db push --dry-run
```

Do not run a migration against production without a backup, review, and explicit
authorization. For a new project, `supabase_schema.sql` is the bootstrap
schema; apply the later security and payout migrations in order after the
bootstrap. Do not blindly replay historical policy-creation migrations on top
of the bootstrap schema. The `20261121010000_security-remediation.sql`
migration must be reviewed and applied before deploying the matching Edge
Functions or frontend changes; it adds protected RLS workflows and payout
reservation procedures.

## Edge Functions and secrets

Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are server-side
function environment variables. Set the Paystack secret only in Supabase:

```sh
supabase secrets set PAYSTACK_SECRET_KEY=your-paystack-secret
```

Deploy only the functions changed for the target environment:

```sh
supabase functions deploy <function-name>
```

Configure Paystack's webhook URL as
`https://<project-ref>.supabase.co/functions/v1/paystack-webhook`.
The webhook function verifies Paystack's signature before processing events.

For merchant checkout return URLs, configure the server-side
`PAYMENT_REDIRECT_ORIGINS` secret as a comma-separated list of exact HTTPS
origins (for example `https://shop.example.com`). Requests to any other origin
are rejected. Consumer payments always use the fixed Paystack webhook callback.
Existing merchant API keys retain their prior full-operation access unless
their stored scopes explicitly disable an operation; new keys can be created
with narrower scopes from the Developer API page.

## Quality checks

```sh
npm run lint
npm test
npm run build
```

These checks do not require production secrets. The existing tests include
in-memory workflow models; they are not a substitute for database-policy or
Paystack integration tests.
