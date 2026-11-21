# DealGuider Repository Audit

Audit date: 2026-11-21

## Scope and limits

This is a source and configuration review of the tracked repository. It is not
a penetration test, a legal review, a live payment test, or a claim of
production readiness. No payout was initiated and no database migration was
applied. Fixes that depend on the new migration will not protect a deployed
project until it is reviewed and applied, and the changed Edge Functions are
deployed.

## Strengths

- React/Vite frontend and Supabase Edge Functions are separated clearly.
- Privileged Paystack operations use server-side functions; the service-role
  key is not configured in the frontend.
- Paystack webhooks verify the raw-body HMAC-SHA512 signature.
- The payout reservation migration adds durable references and concurrency
  control for consumer payouts.
- `.env` is ignored and is not tracked; `.env.example` contains placeholders.
- Lint, the existing test suite, and the production build all pass.

## Findings

The findings below document the risks addressed by this remediation. The
corresponding source and migration changes are present locally but have not
been deployed.

### Critical

1. **Merchant fund release is vulnerable to concurrent double payouts.**
   The function checks audit history, then creates a transfer using a
   time-derived reference, and only marks the deal completed after Paystack
   accepts the transfer. Concurrent requests can pass the check and initiate
   separate transfers before either records completion.
   Evidence: [`merchant-release-funds/index.ts`](../supabase/functions/merchant-release-funds/index.ts#L87),
   [`merchant-release-funds/index.ts`](../supabase/functions/merchant-release-funds/index.ts#L132).

2. **The admin manual payout endpoint has a non-atomic duplicate guard.**
   It checks status/audit history and then writes `PROCESSING` with an
   unconditional update before starting the transfer. Concurrent requests can
   both pass those checks and initiate different Paystack transfers.
   Evidence: [`paystack-payout/index.ts`](../supabase/functions/paystack-payout/index.ts#L88),
   [`paystack-payout/index.ts`](../supabase/functions/paystack-payout/index.ts#L113),
   [`paystack-payout/index.ts`](../supabase/functions/paystack-payout/index.ts#L149).

3. **Deal parties can directly change financial and payout fields.**
   `Authorized users can update deals` allows either deal party to update a
   row without restricting columns or state transitions. This includes
   `status`, payment fields, amounts, and payout metadata. Critical transitions
   and financial values can be tampered with through PostgREST; server-side
   payout checks must not trust these mutable fields.
   Evidence: [`supabase_schema.sql`](../supabase_schema.sql#L184).

### High

1. **The shared-deal RLS policy exposes every row with a share token.**
   The policy checks only that `share_token IS NOT NULL`; it does not bind
   access to the token supplied by the caller. A public query can therefore
   read all share-enabled deal rows, including fields not required by the
   shared-deal page. Return a narrow, token-authorized projection through a
   server-side endpoint or carefully designed database function.
   Evidence: [`supabase_schema.sql`](../supabase_schema.sql#L191),
   [`SharedDeal.jsx`](../src/pages/SharedDeal.jsx#L24).

2. **Merchant owners can self-activate by updating their merchant row.**
   The owner update policy permits updates to every column, including
   `status` and `is_active`. A pending applicant can bypass the intended
   approval workflow unless these columns are protected at the database layer.
   Evidence: [`20260627150000_merchant_user_id.sql`](../supabase/migrations/20260627150000_merchant_user_id.sql#L38),
   [`supabase_schema.sql`](../supabase_schema.sql#L405).

3. **Merchant webhook delivery can make requests to merchant-controlled URLs.**
   Webhook delivery fetches the configured URL without validating the scheme,
   host, or resolved address. Merchant owners can update their own merchant
   records under the broad owner policy, so this creates an SSRF risk.
   Evidence: [`webhook.ts`](../supabase/functions/_shared/webhook.ts#L39),
   [`20260627150000_merchant_user_id.sql`](../supabase/migrations/20260627150000_merchant_user_id.sql#L38).

4. **Merchant API-key permissions are stored but never enforced.**
   Key creation accepts a `permissions` object and authentication returns it,
   but merchant operations do not check it. Any active merchant key therefore
   has the full authority of its merchant, regardless of permission metadata.
   Integrations must not assume these fields restrict access.
   Evidence: [`create-api-key/index.ts`](../supabase/functions/create-api-key/index.ts#L47),
   [`merchant-auth.ts`](../supabase/functions/_shared/merchant-auth.ts#L94).

### Medium

1. **All profile columns are readable by any database role with table access.**
   The `USING (true)` profile policy is not limited to public display fields.
   The same row includes email, phone, wallet balance, flags, and a Paystack
   recipient code. Use a minimal public profile projection and restrict full
   profile access to the owner and authorized administrators.
   Evidence: [`supabase_schema.sql`](../supabase_schema.sql#L7),
   [`supabase_schema.sql`](../supabase_schema.sql#L155).

2. **Authenticated clients can forge audit entries and payment rows.**
   The schema permits a buyer to insert arbitrary payment status values and
   permits users to insert arbitrary audit action/details for themselves.
   These rows should be written only by trusted server-side workflows or
   constrained by database policies/triggers.
   Evidence: [`supabase_schema.sql`](../supabase_schema.sql#L218),
   [`supabase_schema.sql`](../supabase_schema.sql#L272).

3. **Payment initialization accepts an arbitrary callback URL.**
   The client-supplied `redirect_url` is passed to Paystack as `callback_url`.
   Validate it against the application's configured callback origins to avoid
   unexpected post-payment redirects.
   Evidence: [`paystack-init-payment/index.ts`](../supabase/functions/paystack-init-payment/index.ts#L69).

## Remediated in this patch (deployment pending)

- Merchant/admin payouts use atomic database reservations and persist stable
  references before transfer calls; payout results cannot downgrade a
  successful state. The migration adds reservation/finalization procedures
  for manual admin and merchant payouts.
- Authenticated clients can no longer update deal amounts, parties, payment
  state, payout state, or status. Deal creation recalculates fees and replaces
  caller-provided share tokens. Cancellation, disputes, and refunds now use
  validated server workflows.
- Shared-deal pages load a narrow token-bound RPC projection instead of
  selecting all share-enabled deals. Profile reads are limited to the owner
  and admins; party display names are returned through a role-checked
  projection.
- Payment and audit records can no longer be inserted by untrusted clients.
  Their trusted Edge Function writes continue through the service role.
- Merchant self-activation is blocked by a database trigger. Webhook delivery
  requires HTTPS, rejects non-public DNS results and redirects, has a timeout,
  and caps the response body recorded in logs. DNS rebinding remains possible
  because the outbound fetch resolves the hostname again after validation;
  treat webhook SSRF mitigation as incomplete until outbound connections pin
  the validated address or use a controlled egress proxy.
- Merchant API-key operation scopes are checked at each endpoint and can be
  selected when keys are created.
- Consumer callbacks use the fixed Paystack webhook. Merchant checkout return
  URLs must match configured HTTPS origins.
- Merchant applications now require the authenticated user's confirmed email
  to match an unclaimed merchant record; an existing owner's record cannot be
  reassigned by another user. See
  [`merchant-apply/index.ts`](../supabase/functions/merchant-apply/index.ts).
- Merchant API-key authentication now selects `expires_at` and rejects expired
  or invalid expiry values. See
  [`merchant-auth.ts`](../supabase/functions/_shared/merchant-auth.ts).
- Merchant escrow idempotency replays now verify merchant ownership and return
  a generic conflict for keys already used by another merchant. See
  [`merchant-create-escrow/index.ts`](../supabase/functions/merchant-create-escrow/index.ts).

### Low / maintainability

- No license file is present. A license requires an owner decision and should
  not be guessed.
- Tests model authorization and payouts with in-memory mocks. They do not
  execute the actual SQL policies, Edge Functions, or Paystack integration.
- Fee calculations exist in both frontend and Edge Function code and can drift.
- Some controls still lack explicit label associations, and dialogs do not
  provide complete focus management. No automated accessibility test is
  configured.

## Improvement plan

1. Preserve the application-level security fixes and their regression coverage.
2. Keep the lightweight GitHub Actions workflow running lint, tests, and build.
3. Keep README/setup guidance and architecture/accessibility documentation
   accurate without inventing screenshots, demos, license, or capabilities.
4. Continue improving accessibility and evaluate the app with automated and
   assistive-technology checks.
5. Review and apply the new security migration, then deploy the changed Edge
   Functions. Validate RLS and payout concurrency against a staging Supabase
   project before production rollout.

## Baseline validation

| Command | Result |
|---|---|
| `npm run lint` | Passed |
| `npm test` | Passed: 18 tests |
| `npm run build` | Passed |

These results describe the current local source at audit time only.
