// Platform fee: 2% (min GHS 5, max GHS 50)
export function calculatePlatformFee(amount) {
  const fee = amount * 0.02;
  return Math.max(5, Math.min(fee, 50));
}

// Estimated mobile money transfer fee
export function calculateTransferFee(amount) {
  if (amount <= 100) return 1;
  if (amount <= 500) return 3;
  if (amount <= 2000) return 5;
  return 8;
}

// Full fee breakdown
export function calculateFees(amount) {
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return {
      dealAmount: 0,
      processingFee: 0,
      platformFee: 0,
      transferFee: 0,
      totalPayable: 0,
      sellerReceives: 0,
    };
  }

  const platformFee = calculatePlatformFee(parsedAmount);
  const transferFee = calculateTransferFee(parsedAmount);

  const totalPayable = parsedAmount + platformFee;
  const sellerReceives = parsedAmount - transferFee;

  return {
    dealAmount: round2(parsedAmount),
    platformFee: round2(platformFee),
    transferFee: round2(transferFee),
    totalPayable: round2(totalPayable),
    sellerReceives: round2(sellerReceives),
  };
}

function round2(num) {
  return Math.round(num * 100) / 100;
}

// Format currency
export function formatGHS(amount) {
  return `GH₵ ${(parseFloat(amount) || 0).toFixed(2)}`;
}
