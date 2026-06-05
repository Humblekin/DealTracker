// Deal statuses
export const DEAL_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  IN_ESCROW: 'IN_ESCROW',
  COMPLETED: 'COMPLETED',
  DISPUTE_OPEN: 'DISPUTE_OPEN',
  REFUNDED: 'REFUNDED',
};

// User roles
export const ROLES = {
  BUYER: 'buyer',
  SELLER: 'seller',
  ADMIN: 'admin',
};

// Status labels and colors
export const STATUS_CONFIG = {
  PENDING_PAYMENT: { label: 'Pending Payment', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  IN_ESCROW: { label: 'In Escrow', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
  COMPLETED: { label: 'Completed', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  DISPUTE_OPEN: { label: 'Dispute Open', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  REFUNDED: { label: 'Refunded', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};



// Moolre public key (safe for frontend)
export const MOOLRE_PUBLIC_KEY = import.meta.env.VITE_MOOLRE_PUBLIC_KEY || '';

// Currency
export const CURRENCY = 'GHS';
export const CURRENCY_SYMBOL = 'GH₵';
