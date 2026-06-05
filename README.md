# SecureTrade (MVP)

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
VITE_MOOLRE_ACCOUNT_NUMBER=your_moolre_account_number
```

### 3. Supabase Secrets (Edge Functions)
Set these secrets for the Edge Functions:
```bash
supabase secrets set MOOLRE_API_USER=your_username
supabase secrets set MOOLRE_API_KEY=your_api_key
supabase secrets set MOOLRE_PUBLIC_KEY=your_public_key
supabase secrets set MOOLRE_BASE_URL=https://sandbox.moolre.com
```

### 4. Supabase Database Setup
1. Go to your Supabase Dashboard → SQL Editor.
2. Copy the contents of `supabase_schema.sql` and run it.
3. This creates all tables, triggers, and RLS policies.

### 5. Deploy Edge Functions
```bash
supabase functions deploy moolre-init-payment
supabase functions deploy moolre-webhook
supabase functions deploy confirm-delivery
supabase functions deploy moolre-payout
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
|---|---|
| `moolre-init-payment` | Creates Moolre payment request, returns checkout URL |
| `moolre-webhook` | Receives Moolre payment confirmation, sets status to IN_ESCROW |
| `confirm-delivery` | Buyer confirms delivery → triggers Moolre payout → COMPLETED |
| `moolre-payout` | Manual admin payout trigger |

## 🔐 Security
- **Edge Functions** authenticate users via Supabase Auth before any action
- **RLS policies** protect all tables at the database level
- **Immutable audit logs** — cannot be updated or deleted
- **Service Role Key** is never exposed to the frontend

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

**Made for Ghana 🇬🇭**
