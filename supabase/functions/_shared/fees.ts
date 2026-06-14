export function calculatePlatformFee(amount: number): number {
  const fee = amount * 0.02
  return Math.max(5, Math.min(fee, 50))
}

export function calculateTransferFee(amount: number): number {
  if (amount <= 100) return 1
  if (amount <= 500) return 3
  if (amount <= 2000) return 5
  return 8
}

export interface FeeBreakdown {
  dealAmount: number
  processingFee: number
  platformFee: number
  transferFee: number
  totalPayable: number
  sellerReceives: number
}

export function calculateFees(amount: number): FeeBreakdown {
  if (amount <= 0) {
    return {
      dealAmount: 0,
      processingFee: 0,
      platformFee: 0,
      transferFee: 0,
      totalPayable: 0,
      sellerReceives: 0,
    }
  }

  const platformFee = calculatePlatformFee(amount)
  const transferFee = calculateTransferFee(amount)
  const totalPayable = amount + platformFee
  const sellerReceives = amount - transferFee

  return {
    dealAmount: round2(amount),
    platformFee: round2(platformFee),
    transferFee: round2(transferFee),
    totalPayable: round2(totalPayable),
    sellerReceives: round2(sellerReceives),
    processingFee: 0,
  }
}

function round2(num: number): number {
  return Math.round(num * 100) / 100
}
