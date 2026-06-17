import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle, PartyPopper, XCircle, Clock, Key, RefreshCw, ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import './DeveloperAPI.css';

const endpoints = [
  {
    method: 'POST',
    path: '/merchant-create-escrow',
    title: 'Create Escrow',
    description: 'Create a new escrow transaction for a customer order. Returns a payment URL to redirect the customer to.',
    auth: 'X-Api-Key',
    request: `{
  "merchant_order_id": "ORD-12345",
  "amount": 150.00,
  "currency": "GHS",
  "customer_email": "buyer@example.com",
  "customer_name": "John Doe",
  "merchant_customer_id": "CUST-678",
  "metadata": { "source": "web" },
  "idempotency_key": "uniq-request-001"
}`,
    response: `{
  "success": true,
  "transaction_id": "uuid",
  "deal_id": "uuid",
  "status": "AWAITING_PAYMENT",
  "payment_url": "https://api.moolre.com/pay/...",
  "amount": 150.00,
  "currency": "GHS",
  "platform_fee": 4.50,
  "expires_at": "2026-06-14T12:30:00.000Z"
}`,
  },
  {
    method: 'GET',
    path: '/merchant-get-transaction/{id}',
    title: 'Get Transaction',
    description: 'Retrieve the current status and details of an escrow transaction.',
    auth: 'X-Api-Key',
    curlExample: `curl https://[PROJECT].supabase.co/functions/v1/merchant-get-transaction/{transaction_id} \\
  -H "X-Api-Key: dg_a1b2c3d4_..."`,
    queryParam: '?merchant_order_id=ORD-12345',
    response: `{
  "success": true,
  "transaction": {
    "id": "uuid",
    "merchant_order_id": "ORD-12345",
    "status": "IN_ESCROW",
    "amount": 150.00,
    "currency": "GHS",
    "payment_url": "...",
    "customer": { "name": "John", "email": "buyer@example.com" },
    "deal": { "id": "uuid", "title": "...", "status": "IN_ESCROW", ... },
    "timeline": { "created": "...", "shipped": null, "delivered": null },
    "audit_logs": [...]
  }
}`,
  },
  {
    method: 'POST',
    path: '/merchant-verify-payment',
    title: 'Verify Payment',
    description: 'Check if a customer has completed payment. Useful if you want to poll instead of waiting for a webhook.',
    auth: 'X-Api-Key',
    request: `{ "transaction_id": "uuid" }`,
    altRequest: `{ "merchant_order_id": "ORD-12345" }`,
    response: `{
  "success": true,
  "transaction_id": "uuid",
  "status": "IN_ESCROW",
  "payment_confirmed": true,
  "amount": 150.00,
  "currency": "GHS"
}`,
  },
  {
    method: 'POST',
    path: '/merchant-confirm-shipment',
    title: 'Confirm Shipment',
    description: 'Mark a transaction as shipped once you have fulfilled the order. The deal moves to DELIVERED status.',
    auth: 'X-Api-Key',
    request: `{ "transaction_id": "uuid" }`,
    altRequest: `{ "merchant_order_id": "ORD-12345" }`,
    response: `{
  "success": true,
  "transaction_id": "uuid",
  "status": "SHIPPED",
  "shipped_at": "2026-06-14T10:00:00.000Z",
  "message": "Shipment confirmed. Awaiting delivery confirmation to release funds."
}`,
  },
  {
    method: 'POST',
    path: '/merchant-release-funds',
    title: 'Release Funds',
    description: 'Release escrow funds to your mobile money account. Requires payout phone and network to be configured.',
    auth: 'X-Api-Key',
    request: `{
  "transaction_id": "uuid",
  "payout_phone": "233501234567",
  "payout_network": "mtn"
}`,
    altRequest: `{
  "merchant_order_id": "ORD-12345",
  "payout_phone": "233501234567",
  "payout_network": "vodafone"
}`,
    response: `{
  "success": true,
  "transaction_id": "uuid",
  "status": "COMPLETED",
  "amount_released": 145.50,
  "payout_reference": "MPO-uuid-...",
  "message": "Funds have been released to the merchant."
}`,
  },
]

const webhookEvents = [
  {
    event: 'escrow.created',
    description: 'A new escrow transaction has been created and is awaiting payment.',
  },
  {
    event: 'escrow.funded',
    description: 'Customer payment has been confirmed. Funds are secured in escrow.',
  },
  {
    event: 'escrow.shipped',
    description: 'Merchant has confirmed shipment of goods/services.',
  },
  {
    event: 'escrow.completed',
    description: 'Transaction completed and funds released to the merchant.',
  },
]

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

function ApplyForm() {
  const [form, setForm] = useState({ name: '', email: '', platform_url: '', description: '' })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.email) return
    setSubmitting(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/merchant-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      toast.error(err.message || 'Failed to submit application.')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="apply-success">
        <div className="apply-success-icon"><CheckCircle size={32} /></div>
        <h3>Application Submitted!</h3>
        {result.application_id && (
          <div className="apply-credentials">
            <div className="form-group">
              <label>Your Application ID</label>
              <div className="apply-key-box">
                <code>{result.application_id}</code>
                <button className="btn btn-sm btn-ghost" onClick={() => { navigator.clipboard.writeText(result.application_id); toast.success('Copied!'); }}>Copy</button>
              </div>
            </div>
            <div className="form-group">
              <label>Your Access Token</label>
              <div className="apply-key-box">
                <code>{result.access_token}</code>
                <button className="btn btn-sm btn-ghost" onClick={() => { navigator.clipboard.writeText(result.access_token); toast.success('Copied!'); }}>Copy</button>
              </div>
            </div>
            <p className="confirm-sub" style={{ color: 'var(--color-danger)', fontWeight: 500 }}>
              Save these credentials. You need them to generate API keys once approved.
            </p>
          </div>
        )}
        <p>An admin will review your application. Once approved, come back to this page and use the <strong>Merchant Portal</strong> below to generate your API keys.</p>
      </div>
    )
  }

  return (
    <form className="apply-form" onSubmit={handleSubmit}>
      <div className="apply-form-row">
        <div className="form-group">
          <label>Platform Name *</label>
          <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Shopify Store" required />
        </div>
        <div className="form-group">
          <label>Contact Email *</label>
          <input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="store@example.com" required />
        </div>
      </div>
      <div className="form-group">
        <label>Platform URL</label>
        <input className="form-input" value={form.platform_url} onChange={e => setForm({ ...form, platform_url: e.target.value })} placeholder="https://store.example.com" />
      </div>
      <div className="form-group">
        <label>Tell us about your platform</label>
        <textarea className="form-input" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What does your e-commerce platform do? How many orders do you process?" />
      </div>
      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Submitting...' : 'Apply for API Access'}
      </button>
    </form>
  )
}

function MerchantPortal() {
  const [form, setForm] = useState({ application_id: '', access_token: '' })
  const [checking, setChecking] = useState(false)
  const [merchantInfo, setMerchantInfo] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [keyResult, setKeyResult] = useState(null)

  async function handleCheckStatus(e) {
    e.preventDefault()
    if (!form.application_id || !form.access_token) return
    setChecking(true)
    setMerchantInfo(null)
    setKeyResult(null)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/merchant-check-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: form.application_id,
          access_token: form.access_token,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMerchantInfo(data)
    } catch (err) {
      toast.error(err.message || 'Failed to check status.')
    } finally {
      setChecking(false)
    }
  }

  async function handleGenerateKey() {
    setGenerating(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/merchant-generate-api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: form.application_id,
          access_token: form.access_token,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setKeyResult(data)
      toast.success('API key generated!')
      // Re-check status to update key count
      const statusRes = await fetch(`${SUPABASE_URL}/functions/v1/merchant-check-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: form.application_id,
          access_token: form.access_token,
        }),
      })
      const statusData = await statusRes.json()
      if (statusRes.ok) setMerchantInfo(statusData)
    } catch (err) {
      toast.error(err.message || 'Failed to generate API key.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="merchant-portal">
      <h3>Merchant Portal</h3>
      <p>Already applied? Enter the <strong>Application ID</strong> and <strong>Access Token</strong> you received after submitting the form to check your status and generate API keys.</p>

      {!merchantInfo ? (
        <form className="apply-form" onSubmit={handleCheckStatus}>
          <div className="form-group">
            <label>Application ID</label>
            <input className="form-input" value={form.application_id} onChange={e => setForm({ ...form, application_id: e.target.value })} placeholder="Paste your application ID" required />
          </div>
          <div className="form-group">
            <label>Access Token</label>
            <input className="form-input" type="password" value={form.access_token} onChange={e => setForm({ ...form, access_token: e.target.value })} placeholder="Paste your access token" required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={checking}>
            {checking ? 'Checking...' : 'Check Status'}
          </button>
        </form>
      ) : (
        <div className="apply-success">
          <div className="apply-success-icon">
            {merchantInfo.status === 'ACTIVE' ? <PartyPopper size={28} /> : merchantInfo.status === 'REJECTED' ? <XCircle size={28} /> : <Clock size={28} />}
          </div>
          <h3>{merchantInfo.name}</h3>
          <div className="merchant-status-line">
            Status: <span className={`badge ${
              merchantInfo.status === 'ACTIVE' ? 'badge-escrow' :
              merchantInfo.status === 'PENDING' ? 'badge-dispute' :
              'badge-pending'
            }`}>{merchantInfo.status}</span>
          </div>
          <p style={{ marginTop: 8 }}>{merchantInfo.message}</p>

          {merchantInfo.status === 'ACTIVE' && (
            <>
              {merchantInfo.key_count > 0 && (
                <p style={{ color: 'var(--text-secondary)' }}>
                  Existing keys: {merchantInfo.key_count}
                </p>
              )}
              <button className="btn btn-primary" onClick={handleGenerateKey} disabled={generating} style={{ marginTop: 12 }}>
                {generating ? 'Generating...' : 'Generate API Key'}
              </button>
            </>
          )}

          {merchantInfo.status !== 'ACTIVE' && merchantInfo.status !== 'REJECTED' && (
            <button className="btn btn-ghost" onClick={() => setMerchantInfo(null)} style={{ marginTop: 8 }}>
              Back
            </button>
          )}

          {merchantInfo.status === 'REJECTED' && (
            <p style={{ marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={() => setMerchantInfo(null)}>Back</button>
            </p>
          )}
        </div>
      )}

      {keyResult && (
        <div className="modal-overlay" style={{ position: 'fixed' }} onClick={() => setKeyResult(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2>API Key Generated</h2>
              <button className="modal-close" onClick={() => setKeyResult(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Your New API Key</label>
                <div className="api-key-display">
                  <code className="api-key-code">{keyResult.api_key}</code>
                  <button className="btn btn-sm btn-ghost" onClick={() => { navigator.clipboard.writeText(keyResult.api_key); toast.success('API key copied!'); }}>
                    Copy
                  </button>
                </div>
                <p className="confirm-sub" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
                  Store this key securely. It will not be shown again.
                </p>
              </div>
              <button className="btn btn-primary btn-full" onClick={() => setKeyResult(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DeveloperAPI() {
  const { user } = useAuth();

  return (
    <div className="devapi">
      <div className="devapi-hero">
        <div className="container">
          <div className="devapi-badge">API Reference</div>
          <h1>Escrow-as-a-Service <span className="gradient-text">API</span></h1>
          <p className="devapi-subtitle">
            Integrate DealGuider's institutional-grade escrow into your e-commerce platform.
            Secure transactions, automated payouts, and real-time webhooks.
          </p>
          <div className="devapi-hero-actions">
            <a href="#getting-started" className="btn btn-primary">Get Started</a>
            <a href="#endpoints" className="btn btn-ghost">API Reference</a>
          </div>
        </div>
      </div>

      <div className="devapi-content container">
        {/* Getting Started */}
        <section id="getting-started" className="devapi-section">
          <h2>Getting Started</h2>
          <div className="devapi-step-card">
            <div className="devapi-step-number">1</div>
            <div className="devapi-step-body">
              <h3>Apply for API Access</h3>
              <p>Fill in the form below. An admin will review your application and approve it. After approval, an API key can be generated.</p>
            </div>
          </div>

          <ApplyForm />

          <div className="devapi-step-card">
            <div className="devapi-step-number">3</div>
            <div className="devapi-step-body">
              <h3>Generate Your API Key</h3>
              <p>Once approved, use the Merchant Portal below with your Application ID and Access Token to generate an API key.</p>
            </div>
          </div>
          <div className="devapi-step-card">
            <div className="devapi-step-number">2</div>
            <div className="devapi-step-body">
              <h3>Admin Approves Your Application</h3>
              <p>Once approved, your platform status changes to <strong>ACTIVE</strong>. You can then generate an API key yourself via the Merchant Portal.</p>
            </div>
          </div>
          <div className="devapi-step-card">
            <div className="devapi-step-number">4</div>
            <div className="devapi-step-body">
              <h3>Store Your API Key</h3>
              <p>You will receive a key in the format <code>dg_a1b2c3d4_...</code>. Store it securely — it will only be shown once. If lost, generate a new one from the Merchant Portal.</p>
            </div>
          </div>
          <div className="devapi-step-card">
            <div className="devapi-step-number">5</div>
            <div className="devapi-step-body">
              <h3>Configure Your Webhook URL</h3>
              <p>Provide a webhook endpoint so DealGuider can notify your platform of escrow events (payment received, shipped, completed).</p>
            </div>
          </div>
          <div className="devapi-step-card">
            <div className="devapi-step-number">6</div>
            <div className="devapi-step-body">
              <h3>Create Your First Escrow</h3>
              <p>When a customer places an order, call <code>merchant-create-escrow</code> to initiate escrow. Redirect the customer to the returned <code>payment_url</code>.</p>
            </div>
          </div>

          <MerchantPortal />
        </section>

        {/* Authentication */}
        <section id="authentication" className="devapi-section">
          <h2>Authentication</h2>
          <p>All API requests require your API key sent via the <code>X-Api-Key</code> header:</p>
          <div className="code-block">
            <div className="code-header">Shell</div>
            <pre><code>{`curl -X POST https://[PROJECT].supabase.co/functions/v1/merchant-create-escrow \
  -H "X-Api-Key: dg_a1b2c3d4_e5f6..." \
  -H "Content-Type: application/json" \
  -d '{{"merchant_order_id":"ORD-123","amount":150.00,"customer_email":"buyer@example.com"}}'`}</code></pre>
          </div>
          <div className="info-box">
            <strong>Security Note:</strong> API keys are hashed using SHA-256 before storage. DealGuider never stores raw keys. Always use HTTPS in production. Never expose your API key in client-side code.
          </div>
        </section>

        {/* Base URL */}
        <section id="base-url" className="devapi-section">
          <h2>Base URL</h2>
          <div className="code-block">
            <div className="code-header">Base URL</div>
            <pre><code>https://[PROJECT].supabase.co/functions/v1/</code></pre>
          </div>
          <p>Replace <code>[PROJECT]</code> with your DealGuider Supabase project reference. Contact the admin for the exact URL.</p>
        </section>

        {/* Endpoints */}
        <section id="endpoints" className="devapi-section">
          <h2>API Endpoints</h2>
          {endpoints.map((ep, i) => (
            <div key={i} className="endpoint-card">
              <div className="endpoint-header">
                <span className={`endpoint-method endpoint-${ep.method.toLowerCase()}`}>{ep.method}</span>
                <code className="endpoint-path">{ep.path}</code>
              </div>
              <h3>{ep.title}</h3>
              <p>{ep.description}</p>

              {ep.auth && (
                <div className="endpoint-auth">
                  Auth: <code>X-Api-Key</code> header
                </div>
              )}

              {ep.queryParam && (
                <div className="endpoint-extra">
                  <strong>Alternative:</strong> Pass <code>{ep.queryParam}</code> as a query parameter.
                </div>
              )}

              {ep.curlExample && (
                <div className="code-block">
                  <div className="code-header">curl</div>
                  <pre><code>{ep.curlExample}</code></pre>
                </div>
              )}

              {ep.request && (
                <div className="code-block">
                  <div className="code-header">Request Body</div>
                  <pre><code>{ep.request}</code></pre>
                </div>
              )}

              {ep.altRequest && (
                <div className="code-block">
                  <div className="code-header">Alternative Request Body</div>
                  <pre><code>{ep.altRequest}</code></pre>
                </div>
              )}

              <div className="code-block">
                <div className="code-header">Response</div>
                <pre><code>{ep.response}</code></pre>
              </div>
            </div>
          ))}
        </section>

        {/* Idempotency */}
        <section id="idempotency" className="devapi-section">
          <h2>Idempotency</h2>
          <p>
            The <code>merchant-create-escrow</code> endpoint supports idempotency via the <code>idempotency_key</code> field.
            If a request is sent with the same key, the existing transaction is returned instead of creating a duplicate.
            This prevents accidental duplicate escrows from network retries.
          </p>
          <div className="code-block">
            <div className="code-header">Example</div>
            <pre><code>{`{
  "merchant_order_id": "ORD-123",
  "amount": 150.00,
  "customer_email": "buyer@example.com",
  "idempotency_key": "unique-request-id-001"
}`}</code></pre>
          </div>
        </section>

        {/* Webhooks */}
        <section id="webhooks" className="devapi-section">
          <h2>Webhook Events</h2>
          <p>
            DealGuider sends HTTP POST requests to your configured <code>webhook_url</code> whenever the escrow status changes.
            Each request includes a signature header for verification.
          </p>

          <div className="info-box">
            <strong>Signature Verification:</strong> Each webhook includes an <code>X-Webhook-Signature</code> header.
            Compute the HMAC-SHA256 of the raw request body using your <code>webhook_secret</code> and compare it to this header.
            Never process unverified webhooks.
          </div>

          <div className="code-block">
            <div className="code-header">Node.js Verification</div>
            <pre><code>{`const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex') === signature;
}`}</code></pre>
          </div>

          <h3>Events</h3>
          <div className="webhook-table">
            {webhookEvents.map((ev, i) => (
              <div key={i} className="webhook-row">
                <code className="webhook-event">{ev.event}</code>
                <span>{ev.description}</span>
              </div>
            ))}
          </div>

          <div className="code-block">
            <div className="code-header">Webhook Payload Example (escrow.funded)</div>
            <pre><code>{`{
  "event": "escrow.funded",
  "transaction_id": "uuid",
  "merchant_id": "uuid",
  "deal_id": "uuid",
  "merchant_order_id": "ORD-12345",
  "status": "IN_ESCROW",
  "amount": 150.00,
  "currency": "GHS",
  "timestamp": "2026-06-14T10:00:00.000Z"
}`}</code></pre>
          </div>

          <div className="code-block">
            <div className="code-header">Python Verification</div>
            <pre><code>{`import hmac
import hashlib

def verify_webhook(payload: bytes, signature: str, secret: str) -> bool:
    computed = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(computed, signature)`}</code></pre>
          </div>
        </section>

        {/* Error Codes */}
        <section id="errors" className="devapi-section">
          <h2>Error Codes</h2>
          <div className="webhook-table">
            <div className="webhook-row"><code className="webhook-event">400</code><span>Bad Request — Missing or invalid parameters</span></div>
            <div className="webhook-row"><code className="webhook-event">401</code><span>Unauthorized — Missing or invalid API key</span></div>
            <div className="webhook-row"><code className="webhook-event">404</code><span>Not Found — Transaction or deal not found</span></div>
            <div className="webhook-row"><code className="webhook-event">409</code><span>Conflict — Duplicate order, double payout, or invalid state transition</span></div>
            <div className="webhook-row"><code className="webhook-event">502</code><span>Bad Gateway — Payment provider error (Moolre)</span></div>
          </div>
        </section>

        {/* Best Practices */}
        <section id="best-practices" className="devapi-section">
          <h2>Security Best Practices</h2>
          <div className="practices-grid">
            <div className="practice-card">
              <div className="practice-icon"><Key size={24} /></div>
              <h3>Protect Your API Key</h3>
              <p>Never expose your API key in client-side code, browser storage, or public repositories. Use environment variables on your backend.</p>
            </div>
            <div className="practice-card">
              <div className="practice-icon"><CheckCircle size={24} /></div>
              <h3>Verify Webhooks</h3>
              <p>Always verify the HMAC-SHA256 signature on incoming webhooks before processing the payload.</p>
            </div>
            <div className="practice-card">
              <div className="practice-icon"><RefreshCw size={24} /></div>
              <h3>Use Idempotency Keys</h3>
              <p>Send an <code>idempotency_key</code> with every <code>merchant-create-escrow</code> call to prevent duplicate escrows from network retries.</p>
            </div>
            <div className="practice-card">
              <div className="practice-icon"><ClipboardList size={24} /></div>
              <h3>Poll as Fallback</h3>
              <p>Use <code>merchant-verify-payment</code> as a polling fallback if you miss a webhook. Do not rely solely on webhooks.</p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="devapi-cta">
          <h2>Ready to integrate?</h2>
          <p>Contact the DealGuider admin to get your API key and start accepting escrow payments.</p>
          <div className="devapi-cta-actions">
            {user ? (
              <Link to="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
            ) : (
              <Link to="/register" className="btn btn-primary">Create Account</Link>
            )}
            <a href="#getting-started" className="btn btn-ghost">Getting Started Guide</a>
          </div>
        </section>
      </div>
    </div>
  );
}
