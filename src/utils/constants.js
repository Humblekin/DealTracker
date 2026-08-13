export const DEAL_STATUS = {
  AWAITING_COUNTERPARTY: 'AWAITING_COUNTERPARTY',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  IN_ESCROW: 'IN_ESCROW',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  DISPUTED: 'DISPUTED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
};

export const ROLES = {
  BUYER: 'buyer',
  SELLER: 'seller',
  ADMIN: 'admin',
};

export const STATUS_CONFIG = {
  AWAITING_COUNTERPARTY: { label: 'Awaiting Counterparty', color: '#6366f1', bg: 'rgba(99,102,241,0.15)' },
  AWAITING_PAYMENT: { label: 'Awaiting Payment', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  IN_ESCROW: { label: 'In Escrow', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
  DELIVERED: { label: 'Delivered', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  COMPLETED: { label: 'Completed', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  DISPUTED: { label: 'Disputed', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  REFUNDED: { label: 'Refunded', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  CANCELLED: { label: 'Cancelled', color: '#dc2626', bg: 'rgba(220,38,38,0.15)' },
};

// Paystack public key — used by the Paystack Inline checkout popup.
// Set via VITE_PAYSTACK_PUBLIC_KEY in .env. The secret key is
// server-side only (edge function secrets) and never exposed.
export const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || '';

export const PAYMENT_STATUS = {
  INITIALIZED: 'INITIALIZED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  ABANDONED: 'ABANDONED',
  REVERSED: 'REVERSED',
};

export const PAYMENT_STATUS_CONFIG = {
  INITIALIZED: { label: 'Initialized', color: '#6366f1', bg: 'rgba(99,102,241,0.15)' },
  PENDING: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  PROCESSING: { label: 'Processing', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  SUCCESS: { label: 'Successful', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  FAILED: { label: 'Failed', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  ABANDONED: { label: 'Abandoned', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  REVERSED: { label: 'Reversed', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};

export const CURRENCY = 'GHS';
export const CURRENCY_SYMBOL = 'GH₵';
