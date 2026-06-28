import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle, PartyPopper, XCircle, Clock, Key, RefreshCw, ClipboardList, Plus, Trash2, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import './DeveloperAPI.css';

const endpoints = [
  {
    method: 'POST',
    path: '/merchant-create-escrow',
    title: 'Create Escrow',
    description: 'Create a new escrow transaction for a customer order. Returns a payment URL to redirect the customer to.',
    auth: 'X-Api-Key',
    request: [
      '{',
      '  "merchant_order_id": "ORD-12345",',
      '  "amount": 150.00,',
      '  "currency": "GHS",',
      '  "customer_email": "buyer@example.com",',
      '  "customer_name": "John Doe",',
      '  "merchant_customer_id": "CUST-678",',
      '  "metadata": { "source": "web" },',
      '  "idempotency_key": "uniq-request-001"',
      '}',
    ].join('\n'),
    response: [
      '{',
      '  "success": true,',
      '  "transaction_id": "uuid",',
      '  "deal_id": "uuid",',
      '  "status": "AWAITING_PAYMENT",',
      '  "payment_url": "https://api.moolre.com/pay/...",',
      '  "amount": 150.00,',
      '  "currency": "GHS",',
      '  "platform_fee": 4.50,',
      '  "expires_at": "2026-06-14T12:30:00.000Z"',
      '}',
    ].join('\n'),
  },
  {
    method: 'GET',
    path: '/merchant-get-transaction/{id}',
    title: 'Get Transaction',
    description: 'Retrieve the current status and details of an escrow transaction.',
    auth: 'X-Api-Key',
    curlExample: [
      'curl https://[PROJECT].supabase.co/functions/v1/merchant-get-transaction/{transaction_id} \\',
      '  -H "X-Api-Key: dg_live_a1b2_..."',
    ].join('\n'),
    queryParam: '?merchant_order_id=ORD-12345',
    response: [
      '{',
      '  "success": true,',
      '  "transaction": {',
      '    "id": "uuid",',
      '    "merchant_order_id": "ORD-12345",',
      '    "status": "IN_ESCROW",',
      '    "amount": 150.00,',
      '    "currency": "GHS",',
      '    "payment_url": "...",',
      '    "customer": { "name": "John", "email": "buyer@example.com" },',
      '    "deal": { "id": "uuid", "title": "...", "status": "IN_ESCROW", ... },',
      '    "timeline": { "created": "...", "shipped": null, "delivered": null },',
      '    "audit_logs": [...]',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    method: 'POST',
    path: '/merchant-verify-payment',
    title: 'Verify Payment',
    description: 'Check if a customer has completed payment. Useful if you want to poll instead of waiting for a webhook.',
    auth: 'X-Api-Key',
    request: '{ "transaction_id": "uuid" }',
    altRequest: '{ "merchant_order_id": "ORD-12345" }',
    response: [
      '{',
      '  "success": true,',
      '  "transaction_id": "uuid",',
      '  "status": "IN_ESCROW",',
      '  "payment_confirmed": true,',
      '  "amount": 150.00,',
      '  "currency": "GHS"',
      '}',
    ].join('\n'),
  },
  {
    method: 'POST',
    path: '/merchant-confirm-shipment',
    title: 'Confirm Shipment',
    description: 'Mark a transaction as shipped once you have fulfilled the order. The deal moves to DELIVERED status.',
    auth: 'X-Api-Key',
    request: '{ "transaction_id": "uuid" }',
    altRequest: '{ "merchant_order_id": "ORD-12345" }',
    response: [
      '{',
      '  "success": true,',
      '  "transaction_id": "uuid",',
      '  "status": "SHIPPED",',
      '  "shipped_at": "2026-06-14T10:00:00.000Z",',
      '  "message": "Shipment confirmed. Awaiting delivery confirmation to release funds."',
      '}',
    ].join('\n'),
  },
  {
    method: 'POST',
    path: '/merchant-release-funds',
    title: 'Release Funds',
    description: 'Release escrow funds to your mobile money account. Requires payout phone and network to be configured.',
    auth: 'X-Api-Key',
    request: [
      '{',
      '  "transaction_id": "uuid",',
      '  "payout_phone": "233501234567",',
      '  "payout_network": "mtn"',
      '}',
    ].join('\n'),
    altRequest: [
      '{',
      '  "merchant_order_id": "ORD-12345",',
      '  "payout_phone": "233501234567",',
      '  "payout_network": "vodafone"',
      '}',
    ].join('\n'),
    response: [
      '{',
      '  "success": true,',
      '  "transaction_id": "uuid",',
      '  "status": "COMPLETED",',
      '  "amount_released": 145.50,',
      '  "payout_reference": "MPO-uuid-...",',
      '  "message": "Funds have been released to the merchant."',
      '}',
    ].join('\n'),
  },
]

const webhookEvents = [
  { event: 'escrow.created', description: 'A new escrow transaction has been created and is awaiting payment.' },
  { event: 'escrow.funded', description: 'Customer payment has been confirmed. Funds are secured in escrow.' },
  { event: 'escrow.shipped', description: 'Merchant has confirmed shipment of goods/services.' },
  { event: 'escrow.completed', description: 'Transaction completed and funds released to the merchant.' },
]

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const codeExamples = {
  idempotency: [
    '{',
    '  "merchant_order_id": "ORD-123",',
    '  "amount": 150.00,',
    '  "customer_email": "buyer@example.com",',
    '  "idempotency_key": "unique-request-id-001"',
    '}',
  ].join('\n'),
  webhookPayload: [
    '{',
    '  "event": "escrow.funded",',
    '  "transaction_id": "uuid",',
    '  "merchant_id": "uuid",',
    '  "deal_id": "uuid",',
    '  "merchant_order_id": "ORD-12345",',
    '  "status": "IN_ESCROW",',
    '  "amount": 150.00,',
    '  "currency": "GHS",',
    '  "timestamp": "2026-06-14T10:00:00.000Z"',
    '}',
  ].join('\n'),
  nodeVerify: [
    'const crypto = require(\'crypto\');',
    '',
    'function verifyWebhook(payload, signature, secret) {',
    '  const hmac = crypto.createHmac(\'sha256\', secret);',
    '  hmac.update(JSON.stringify(payload));',
    '  return hmac.digest(\'hex\') === signature;',
    '}',
  ].join('\n'),
  pythonVerify: [
    'import hmac',
    'import hashlib',
    '',
    'def verify_webhook(payload: bytes, signature: str, secret: str) -> bool:',
    '    computed = hmac.new(',
    '        secret.encode(),',
    '        payload,',
    '        hashlib.sha256',
    '    ).hexdigest()',
    '    return hmac.compare_digest(computed, signature)',
  ].join('\n'),
}

function DeveloperDashboard() {
  const { user, getAccessToken } = useAuth()
  const [loading, setLoading] = useState(true)
  const [merchant, setMerchant] = useState(null)
  const [keys, setKeys] = useState([])
  const [showApplyForm, setShowApplyForm] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyForm, setApplyForm] = useState({ name: '', email: '', platform_url: '', description: '' })
  const [generating, setGenerating] = useState(false)
  const [newKey, setNewKey] = useState(null)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [showNewKeyForm, setShowNewKeyForm] = useState(false)
  const [keyForm, setKeyForm] = useState({ name: '', environment: 'test' })

  async function loadMerchantData() {
    setLoading(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/merchant-check-status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      console.log('merchant-check-status response:', res.status, data)
      if (data.applied && data.merchant) {
        setMerchant(data.merchant)
        if (data.merchant.status === 'ACTIVE') loadKeys()
      }
    } catch (err) {
      console.error('Failed to load merchant data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) loadMerchantData()
  }, [user])

  async function loadKeys() {
    try {
      const token = await getAccessToken()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/merchant-list-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) setKeys(data.keys)
    } catch (err) {
      console.error('Failed to load keys:', err)
    }
  }

  async function handleApply(e) {
    e.preventDefault()
    if (!applyForm.name || !applyForm.email) {
      toast.error('Name and email are required.')
      return
    }
    setApplying(true)
    try {
      const token = await getAccessToken()
      console.log('SUPABASE_URL:', SUPABASE_URL)
      console.log('Submitting application:', applyForm)
      const res = await fetch(`${SUPABASE_URL}/functions/v1/merchant-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(applyForm),
      })
      const data = await res.json()
      console.log('merchant-apply response:', res.status, data)
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message || 'Application submitted!')
      setShowApplyForm(false)
      loadMerchantData()
    } catch (err) {
      toast.error(err.message || 'Failed to submit application.')
    } finally {
      setApplying(false)
    }
  }

  async function handleGenerateKey(e) {
    e.preventDefault()
    if (!keyForm.name) return
    setGenerating(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(keyForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNewKey(data)
      setShowKeyModal(true)
      setShowNewKeyForm(false)
      setKeyForm({ name: '', environment: 'test' })
      loadKeys()
    } catch (err) {
      toast.error(err.message || 'Failed to generate API key.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleDisableKey(keyId) {
    if (!confirm('Disable this API key? This cannot be undone.')) return
    try {
      const token = await getAccessToken()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/merchant-disable-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key_id: keyId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('API key disabled.')
      loadKeys()
    } catch (err) {
      toast.error(err.message || 'Failed to disable key.')
    }
  }

  if (loading) {
    return <div className="apply-form" style={{ textAlign: 'center', padding: 40 }}>Loading...</div>
  }

  if (!merchant) {
    if (showApplyForm) {
      return (
        <form className="apply-form" onSubmit={handleApply}>
          <h3 style={{ margin: 0 }}>Apply for API Access</h3>
          <div className="form-group">
            <label>Platform Name *</label>
            <input className="form-input" value={applyForm.name} onChange={e => setApplyForm({ ...applyForm, name: e.target.value })} placeholder="e.g. My E-Commerce Store" required />
          </div>
          <div className="form-group">
            <label>Contact Email *</label>
            <input className="form-input" type="email" value={applyForm.email} onChange={e => setApplyForm({ ...applyForm, email: e.target.value })} placeholder="store@example.com" required />
          </div>
          <div className="form-group">
            <label>Platform URL</label>
            <input className="form-input" value={applyForm.platform_url} onChange={e => setApplyForm({ ...applyForm, platform_url: e.target.value })} placeholder="https://mystore.com" />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea className="form-input" rows={3} value={applyForm.description} onChange={e => setApplyForm({ ...applyForm, description: e.target.value })} placeholder="Tell us about your platform..." />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={applying}>
              {applying ? 'Submitting...' : 'Submit Application'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowApplyForm(false)}>Cancel</button>
          </div>
        </form>
      )
    }

    return (
      <div className="apply-success">
        <div className="apply-success-icon"><Key size={32} /></div>
        <h3>No Merchant Application</h3>
        <p>Apply for API access to start integrating DealGuider escrow into your platform.</p>
        <button className="btn btn-primary" onClick={() => setShowApplyForm(true)} style={{ marginTop: 16 }}>
          Apply Now
        </button>
      </div>
    )
  }

  const statusColors = {
    ACTIVE: 'badge-escrow',
    PENDING: 'badge-dispute',
    REJECTED: 'badge-pending',
  }

  return (
    <>
      <div className="apply-success" style={{ textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="apply-success-icon" style={{ margin: 0, display: 'inline-block' }}>
              {merchant.status === 'ACTIVE' ? <PartyPopper size={28} /> : merchant.status === 'REJECTED' ? <XCircle size={28} /> : <Clock size={28} />}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>{merchant.name}</h3>
            <div className="merchant-status-line" style={{ margin: '4px 0 0' }}>
              Status: <span className={`badge ${statusColors[merchant.status] || 'badge-pending'}`}>{merchant.status}</span>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => {
            setApplyForm({
              name: merchant.name || '',
              email: merchant.email || '',
              platform_url: merchant.platform_url || '',
              description: merchant.settings?.description || '',
            })
            setShowApplyForm(true)
          }}>
            Edit Application
          </button>
        </div>

        {showApplyForm && (
          <form className="apply-form" onSubmit={handleApply} style={{ marginTop: 24, padding: 20 }}>
            <h4 style={{ margin: 0, marginBottom: 16 }}>Update Application Details</h4>
            <div className="form-group">
              <label>Platform Name *</label>
              <input className="form-input" value={applyForm.name} onChange={e => setApplyForm({ ...applyForm, name: e.target.value })} placeholder="e.g. My E-Commerce Store" required />
            </div>
            <div className="form-group">
              <label>Contact Email *</label>
              <input className="form-input" type="email" value={applyForm.email} onChange={e => setApplyForm({ ...applyForm, email: e.target.value })} placeholder="store@example.com" required />
            </div>
            <div className="form-group">
              <label>Platform URL</label>
              <input className="form-input" value={applyForm.platform_url} onChange={e => setApplyForm({ ...applyForm, platform_url: e.target.value })} placeholder="https://mystore.com" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea className="form-input" rows={3} value={applyForm.description} onChange={e => setApplyForm({ ...applyForm, description: e.target.value })} placeholder="Tell us about your platform..." />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" type="submit" disabled={applying}>
                {applying ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setShowApplyForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        {!showApplyForm && merchant.status === 'ACTIVE' && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h4 style={{ margin: 0 }}>API Keys ({keys.length})</h4>
              <button className="btn btn-primary btn-sm" onClick={() => setShowNewKeyForm(true)}>
                <Plus size={16} /> New Key
              </button>
            </div>

            {showNewKeyForm && (
              <form className="apply-form" onSubmit={handleGenerateKey} style={{ marginBottom: 16, padding: 20 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="form-group" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
                    <label>Key Name</label>
                    <input className="form-input" value={keyForm.name} onChange={e => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="e.g. Production" required />
                  </div>
                  <div className="form-group" style={{ minWidth: 120, marginBottom: 0 }}>
                    <label>Environment</label>
                    <select className="form-input" value={keyForm.environment} onChange={e => setKeyForm({ ...keyForm, environment: e.target.value })}>
                      <option value="test">Test</option>
                      <option value="live">Live</option>
                    </select>
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={generating} style={{ marginBottom: 0 }}>
                    {generating ? 'Generating...' : 'Generate'}
                  </button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowNewKeyForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            {keys.length === 0 && !showNewKeyForm && (
              <div className="empty-state" style={{ padding: '40px 24px' }}>
                <p style={{ color: 'var(--text-muted)' }}>No API keys yet. Create one to start integrating.</p>
              </div>
            )}

            {keys.map(k => (
              <div key={k.id} className="glass-card" style={{ padding: 16, marginBottom: 12, opacity: k.is_active ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <strong style={{ fontSize: '0.95rem' }}>{k.name}</strong>
                      <span className={`badge ${k.environment === 'live' ? 'badge-completed' : 'badge-pending'}`} style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                        {k.environment}
                      </span>
                      {!k.is_active && <span className="badge badge-dispute" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>Disabled</span>}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      <div><code style={{ fontSize: '0.78rem' }}>dg_{k.environment}_{k.key_prefix}_...</code></div>
                      <div style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: '0.78rem' }}>
                        Created: {new Date(k.created_at).toLocaleDateString()}
                        {k.last_used_at && <span> &middot; Last used: {new Date(k.last_used_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  </div>
                  {k.is_active && (
                    <button className="btn btn-ghost" onClick={() => handleDisableKey(k.id)} title="Disable key" style={{ color: 'var(--color-danger)', minHeight: 40, padding: '8px 12px', flexShrink: 0 }}>
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!showApplyForm && merchant.status === 'PENDING' && (
          <p style={{ color: 'var(--text-secondary)', marginTop: 16 }}>
            Your application is being reviewed. You will be able to generate API keys once approved.
          </p>
        )}

        {!showApplyForm && merchant.status === 'REJECTED' && (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: 'var(--color-danger)' }}>
              Your application has been rejected. Use "Edit Application" above to update your details and re-submit for review.
            </p>
            {merchant.settings?.rejection_reason && (
              <div style={{
                marginTop: 12,
                padding: '12px 16px',
                background: 'var(--color-danger-bg, rgba(220, 38, 38, 0.08))',
                borderRadius: 8,
                border: '1px solid var(--color-danger)',
                fontSize: '0.875rem',
                lineHeight: 1.6,
              }}>
                <strong>Reason:</strong> {merchant.settings.rejection_reason}
              </div>
            )}
          </div>
        )}
      </div>

      {showKeyModal && newKey && (
        <div className="bottom-sheet-overlay" onClick={() => { setShowKeyModal(false); setNewKey(null) }}>
          <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="bottom-sheet-handle" />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700, marginBottom: 20 }}>API Key Generated</h2>
            <div className="form-group">
              <label className="form-label">Your New API Key</label>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#0f172a', border: '1px solid rgba(148,163,184,0.12)',
                borderRadius: 'var(--radius-md)', padding: '12px 14px',
              }}>
                <code style={{ flex: 1, fontSize: '0.78rem', wordBreak: 'break-all', lineHeight: 1.5, color: '#e2e8f0' }}>
                  {newKey.key}
                </code>
                <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(newKey.key); toast.success('API key copied!') }} style={{ flexShrink: 0 }}>
                  <Copy size={16} />
                </button>
              </div>
              <p style={{ color: 'var(--color-danger)', fontWeight: 600, marginTop: 10, fontSize: '0.88rem' }}>
                Store this key securely. It will not be shown again.
              </p>
            </div>
            <button className="btn btn-primary btn-full" onClick={() => { setShowKeyModal(false); setNewKey(null) }} style={{ marginTop: 8 }}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default function DeveloperAPI() {
  const { user } = useAuth()

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
        <section id="getting-started" className="devapi-section">
          <h2>Developer Dashboard</h2>
          {user ? (
            <DeveloperDashboard />
          ) : (
            <div className="apply-success">
              <div className="apply-success-icon"><Key size={32} /></div>
              <h3>Sign in to access the Developer Dashboard</h3>
              <p>Create an account or sign in to apply for API access and manage your integration.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
                <Link to="/login" className="btn btn-primary">Sign In</Link>
                <Link to="/register" className="btn btn-ghost">Create Account</Link>
              </div>
            </div>
          )}
        </section>

        {user && (
          <>
            <section id="authentication" className="devapi-section">
              <h2>Authentication</h2>
              <p>All API requests require your API key sent via the <code>X-Api-Key</code> header:</p>
              <div className="code-block">
                <div className="code-header">Shell</div>
                <pre><code>{`curl -X POST https://[PROJECT].supabase.co/functions/v1/merchant-create-escrow \
  -H "X-Api-Key: dg_live_a1b2_e5f6..." \
  -H "Content-Type: application/json" \
  -d '{"merchant_order_id":"ORD-123","amount":150.00,"customer_email":"buyer@example.com"}'`}</code></pre>
              </div>
              <div className="info-box">
                <strong>Security Note:</strong> API keys use the format <code>dg_{'{environment}'}_{'{prefix}'}_{'{secret}'}</code> and are hashed using SHA-256 before storage. Always use HTTPS in production. Never expose your API key in client-side code.
              </div>
            </section>

            <section id="base-url" className="devapi-section">
              <h2>Base URL</h2>
              <div className="code-block">
                <div className="code-header">Base URL</div>
                <pre><code>https://[PROJECT].supabase.co/functions/v1/</code></pre>
              </div>
              <p>Replace <code>[PROJECT]</code> with your DealGuider Supabase project reference.</p>
            </section>

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

            <section id="idempotency" className="devapi-section">
              <h2>Idempotency</h2>
              <p>
                The <code>merchant-create-escrow</code> endpoint supports idempotency via the <code>idempotency_key</code> field.
                If a request is sent with the same key, the existing transaction is returned instead of creating a duplicate.
              </p>
              <div className="code-block">
                <div className="code-header">Example</div>
                <pre><code>{codeExamples.idempotency}</code></pre>
              </div>
            </section>

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
                <pre><code>{codeExamples.nodeVerify}</code></pre>
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
                <pre><code>{codeExamples.webhookPayload}</code></pre>
              </div>

              <div className="code-block">
                <div className="code-header">Python Verification</div>
                <pre><code>{codeExamples.pythonVerify}</code></pre>
              </div>
            </section>

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

            <section className="devapi-cta">
              <h2>Ready to integrate?</h2>
              <p>Use your API keys from the Developer Dashboard above to start accepting escrow payments.</p>
              <div className="devapi-cta-actions">
                <a href="#getting-started" className="btn btn-primary">Back to Dashboard</a>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
