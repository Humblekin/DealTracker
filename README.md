# DealGuider

**Escrow workflow for peer-to-peer commerce in Ghana.**

DealGuider is a React and Supabase application for buyers and sellers who need
to agree on terms, fund a transaction, and track delivery before requesting
payment release. Paystack handles checkout and transfer requests.

## The problem and approach

Peer-to-peer buyers and sellers often transact without a shared way to record
terms or verify payment. DealGuider provides a shareable deal flow with
participant roles, payment status, delivery confirmation, and dispute review.
It is intended for Ghanaian buyers, sellers, and e-commerce merchants.

## Implemented workflows

- Create a deal as the buyer or seller and invite the counterparty by link.
- Join a deal, initialize Paystack checkout, and verify payment through a
  signed webhook or server-side status check.
- Track escrow, delivery, completion, payment failures, and disputes.
- Configure seller mobile-money details and request a payout after delivery.
- Admin review of deals, users, disputes, merchants, and payout operations.
- Merchant API endpoints for escrow creation, payment verification, shipment,
  release, and transaction lookup.

The interface and configured API routes do not by themselves guarantee that
Paystack transfers are enabled. Payout availability depends on the Paystack
account's transfer permissions and provider response.

## Demo assets

No verified deployment URL, application screenshots, or demo-video link is
currently included in this repository. Add only links and screenshots that
represent the current application before submitting a demo.

## Technology

- React 19, React Router, Vite, and CSS
- Supabase Auth, PostgreSQL, Realtime, and Edge Functions
- Paystack checkout, transfer, and signed webhook integration
- Node's built-in test runner, ESLint, and Vite production build

## Repository map

| Path | Purpose |
|---|---|
| `src/pages/` | Route-level UI |
| `src/components/` | Shared UI |
| `src/contexts/` and `src/hooks/` | Authentication, theme, and payment state |
| `src/lib/` and `src/utils/` | Supabase/Paystack clients and frontend utilities |
| `supabase/functions/` | Server-side consumer, admin, and merchant workflows |
| `supabase/migrations/` | Incremental database changes |
| `supabase_schema.sql` | SQL bootstrap schema |
| `tests/` | Existing security and workflow tests |
| `docs/` | Setup, architecture, accessibility, and audit notes |

## Getting started

See the detailed [local setup guide](docs/SETUP.md). In brief:

```bash
npm ci
cp .env.example .env
npm run dev
```

In PowerShell, use `Copy-Item .env.example .env` for the copy step.

Set the public `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
`VITE_PAYSTACK_PUBLIC_KEY` values in `.env`. Never put a Supabase service-role
key or Paystack secret key in a `VITE_` variable. Configure server-side secrets
through Supabase.

## Architecture

The browser uses Supabase Auth and PostgREST for user-facing operations.
Server-side Edge Functions validate the caller and use privileged credentials
for payment, payout, and administrative operations. Paystack webhooks are
signature-verified before processing.

See [Architecture](docs/ARCHITECTURE.md) for the transaction lifecycle and
trust boundaries.

## Validation

```bash
npm run lint
npm test
npm run build
```

The GitHub Actions workflow runs these same commands on pushes and pull
requests. Current tests include in-memory workflow models; they do not
integration-test live Supabase policies or Paystack.

## Edge Functions

| Function | Purpose |
|---|---|
| `join-deal` | Counterparty joins a deal via share link, advances to AWAITING_PAYMENT |
| `paystack-init-payment` | Initializes a Paystack checkout session, returns authorization URL + access code |
| `paystack-webhook` | Verifies the Paystack signature and processes payment and transfer events |
| `paystack-verify` | Manual "check payment status" — queries Paystack and advances escrow if confirmed |
| `confirm-delivery` | Buyer confirms delivery and initiates/reconciles the seller payout |
| `paystack-payout` | Admin-only: manual payout trigger via Paystack Transfers |
| `admin-delete-user` | Admin-only: delete a user account and cleanly cancel deals |
| `admin-update-role` | Admin-only: securely assign or change user roles |
| `admin-refund-deal` | Admin-only: record a manually processed deal refund |
| `deal-action` | Validates and applies participant cancellation/dispute actions |
| `merchant-apply` | Authenticated user submits or updates a merchant application |
| `merchant-check-status` | Authenticated merchant: check application/merchant status |
| `create-api-key` | Admin/merchant: generate an API key for an ACTIVE merchant |
| `merchant-list-keys` | Merchant: list their API keys |
| `merchant-disable-key` | Merchant: revoke an API key |
| `merchant-register` | Admin-only: register a merchant and generate API key (status=ACTIVE, pre-approved) |
| `merchant-create-escrow` | Creates an escrow deal from a merchant order, returns Paystack payment URL |
| `merchant-verify-payment` | Checks payment status, auto-advances to IN_ESCROW if confirmed |
| `merchant-confirm-shipment` | Merchant confirms order has been shipped |
| `merchant-release-funds` | Triggers Paystack Transfer to merchant mobile money |
| `merchant-get-transaction` | Returns full transaction details with timeline and audit logs |

## Security and known limitations

- The Supabase anon key is public; database policies are the security boundary.
- Supabase service-role and Paystack secret keys must remain server-side.
- Paystack webhook signatures are checked with HMAC-SHA512. Merchant outbound
  callbacks are signed with HMAC-SHA256.
- Merchant API keys are stored as SHA-256 hashes and returned only when created.
- Merchant API-key operation scopes are checked server-side; create narrowly
  scoped keys in the Developer API page.
- Consumer, admin, and merchant payouts use atomic reservations in the current
  source. Several security fixes require applying the latest reviewed Supabase
  migration and deploying the changed Edge Functions before they protect a
  live project.
- The source audit documents high-priority database authorization and data
  exposure risks in [REPOSITORY_AUDIT.md](docs/REPOSITORY_AUDIT.md). Do not
  treat the presence of RLS alone as proof that all data access is safe.
- Paystack Starter business accounts may be unable to initiate third-party
  transfers. Contact Paystack to enable transfers before testing payouts.

See [Accessibility](docs/ACCESSIBILITY.md) for current interface support and
known gaps.

## 💰 Fee Engine
`src/utils/fees.js` handles all fee calculations:
- **Platform Fee**: 2% (min GHS 5, max GHS 50)
- **Transfer Fee**: GHS 1–8 based on amount

## Admin access

Admin access is assigned to trusted accounts by an authorized administrator.
Never grant roles through signup metadata or expose a role-management operation
to an untrusted client.

## Licensing and credits

No project license or team-credit list is currently included. Confirm the
project's ownership and licensing choice, and add verified contributor credits
before public distribution.

---

## 🏪 Merchant Integration API

DealGuider provides an Escrow-as-a-Service API for e-commerce platforms. External platforms can create escrow transactions without users needing DealGuider accounts.

### Authentication

All merchant API requests require an API key in the `X-Api-Key` header:
```
X-Api-Key: dg_a1b2c3d4_e5f6...secret
```

### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/functions/v1/merchant-create-escrow` | Create escrow deal from merchant order |
| POST | `/functions/v1/merchant-verify-payment` | Check/verify payment status |
| POST | `/functions/v1/merchant-confirm-shipment` | Confirm order has been shipped |
| POST | `/functions/v1/merchant-release-funds` | Release escrow funds to merchant |
| GET | `/functions/v1/merchant-get-transaction/:id` | Get transaction details |

### Merchant Escrow Flow

```
1. Customer places order on merchant platform
2. Merchant calls POST merchant-create-escrow → receives Paystack payment URL
3. Merchant redirects customer to Paystack checkout
4. Customer pays → Paystack calls paystack-webhook → deal → IN_ESCROW
5. Merchant ships item → calls POST merchant-confirm-shipment
6. Merchant calls POST merchant-release-funds → Paystack Transfer → COMPLETED
7. Merchant receives webhook notification at each state change
```

### Webhook Events

Merchants receive POST requests to their configured `webhook_url` for these events:

| Event | Triggered When |
|---|---|
| `escrow.created` | Escrow deal is created and payment URL ready |
| `escrow.funded` | Buyer payment confirmed, funds in escrow |
| `escrow.shipped` | Merchant confirms shipment |
| `escrow.completed` | Funds released to merchant |

Webhooks include an `X-DealGuider-Signature` header: `t={timestamp},v1={hmac_sha256_signature}`

### Admin Registration

To register a merchant, an admin calls:
```bash
curl -X POST https://[PROJECT].supabase.co/functions/v1/merchant-register \
  -H "Authorization: Bearer [ADMIN_TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Store", "email": "store@example.com", "webhook_url": "https://mystore.com/webhook"}'
```

Response includes the API key (shown once):
```json
{
  "merchant": { "id": "...", "name": "My Store", ... },
  "api_key": "dg_a1b2c3d4_e5f6...secret"
}
```

### Idempotency

The `merchant-create-escrow` endpoint supports an optional `idempotency_key` field. If a request with the same key is received, the existing transaction is returned instead of creating a duplicate.

---

**Made for Ghana 🇬🇭 — Escrow Infrastructure for Modern Commerce**
