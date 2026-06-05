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

export const MOOLRE_PUBLIC_KEY = import.meta.env.VITE_MOOLRE_PUBLIC_KEY || '';

export const CURRENCY = 'GHS';
export const CURRENCY_SYMBOL = 'GH₵';
