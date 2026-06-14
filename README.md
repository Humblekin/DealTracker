# DealGuider (MVP)

A trust-based escrow platform for safe peer-to-peer transactions in Ghana. Built with React (Vite), vanilla CSS, Supabase (Auth, PostgreSQL, Realtime), and **Moolre** for payments and payouts.

## 🚀 Getting Started

### 1. Prerequisites
- Node.js installed on your machine
- A [Supabase](https://supabase.com/) account
- A [Moolre](https://moolre.com/) account

### 2. Environment Variables
Create a `.env` file in the root of your project:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_MOOLRE_PUBLIC_KEY=your_moolre_public_key
```

### 3. Supabase Secrets (Edge Functions)
Set these secrets for the Edge Functions:
```bash
supabase secrets set MOOLRE_API_USER=your_username
supabase secrets set MOOLRE_PRIVATE_KEY=your_private_key
supabase secrets set MOOLRE_PUBLIC_KEY=your_public_key
supabase secrets set MOOLRE_ACCOUNT_NUMBER=your_account_number
supabase secrets set MOOLRE_BASE_URL=https://api.moolre.com
```

### 4. Supabase Database Setup
1. Go to your Supabase Dashboard → SQL Editor.
2. Copy the contents of `supabase_schema.sql` and run it.
3. This creates all tables, triggers, and RLS policies.

### 5. Deploy Edge Functions
```bash
# Core escrow functions
supabase functions deploy join-deal
supabase functions deploy moolre-init-payment
supabase functions deploy moolre-webhook
supabase functions deploy confirm-delivery
supabase functions deploy moolre-payout

# Merchant integration functions
supabase functions deploy merchant-register
supabase functions deploy merchant-apply
supabase functions deploy merchant-generate-api-key
supabase functions deploy merchant-create-escrow
supabase functions deploy merchant-verify-payment
supabase functions deploy merchant-confirm-shipment
supabase functions deploy merchant-release-funds
supabase functions deploy merchant-get-transaction
supabase functions deploy merchant-webhook
```

### 6. Running the App
```bash
npm install
npm run dev
```

## 🔐 Architecture

```
Buyer pays via Moolre
  → Moolre webhook updates Supabase DB
  → status = IN_ESCROW
  → Buyer confirms delivery
  → Edge Function triggers Moolre payout
  → status = COMPLETED
```

**Supabase** = escrow brain (truth source)
**Moolre** = money movement tool
**Frontend** = interaction layer

## Edge Functions

| Function | Purpose |
|---|---|---|
| `join-deal` | Counterparty joins a deal via share link, advances to AWAITING_PAYMENT |
| `moolre-init-payment` | Creates Moolre payment request, returns checkout URL |
| `moolre-webhook` | Receives Moolre payment confirmation, sets status to IN_ESCROW |
| `confirm-delivery` | Buyer confirms delivery → triggers Moolre payout → COMPLETED |
| `moolre-payout` | Manual admin payout trigger |
| `merchant-apply` | Public: e-commerce platform submits application for API access (status=PENDING) |
| `merchant-generate-api-key` | Admin-only: generate API key for an approved (ACTIVE) merchant |
| `merchant-register` | Admin-only: register a merchant and generate API key (status=ACTIVE, pre-approved) |
| `merchant-create-escrow` | Creates an escrow deal from a merchant order, returns Moolre payment URL |
| `merchant-verify-payment` | Checks payment status, auto-advances to IN_ESCROW if confirmed |
| `merchant-confirm-shipment` | Merchant confirms order has been shipped |
| `merchant-release-funds` | Triggers Moolre payout to merchant wallet |
| `merchant-get-transaction` | Returns full transaction details with timeline and audit logs |
| `merchant-webhook` | Handles Moolre payment callbacks for merchant deals |

## 🔐 Security
- **Edge Functions** authenticate users via Supabase Auth before any action
- **Merchant API** authenticates via SHA-256 hashed API keys (format: `dg_{prefix}_{secret}`)
- **RLS policies** protect all tables at the database level
- **Immutable audit logs** — cannot be updated or deleted
- **Service Role Key** is never exposed to the frontend
- **Webhook signatures** — all merchant webhooks include HMAC-SHA256 signature in `X-DealGuider-Signature` header
- **Idempotency** — merchant-create-escrow supports idempotency keys to prevent duplicate escrows
- **Double payout prevention** — audit log check prevents releasing funds twice for the same deal

## 💰 Fee Engine
`src/utils/fees.js` handles all fee calculations:
- **Platform Fee**: 2% (min GHS 5, max GHS 50)
- **Transfer Fee**: GHS 1–8 based on amount

## 🧑‍💻 Admin Dashboard
To access the Admin Dashboard:
1. Create an account via Register.
2. In Supabase Dashboard → Table Editor → `profiles` table.
3. Change your user's `role` to `admin`.
4. Refresh — you'll see Admin Panel in navigation.

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
2. Merchant calls POST merchant-create-escrow → receives Moolre payment URL
3. Merchant redirects customer to Moolre payment page
4. Customer pays → Moolre calls merchant-webhook → deal → IN_ESCROW
5. Merchant ships item → calls POST merchant-confirm-shipment
6. Merchant calls POST merchant-release-funds → Moolre payout → COMPLETED
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
