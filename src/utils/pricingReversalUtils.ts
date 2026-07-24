import { bankersRound } from './pricingUtils';

/**
 * Reverses a tax-inclusive final price to extract its base cost and tax components.
 * 
 * Formulas:
 * Type B (18% Standard VAT):
 *   Base Cost = Price / 1.18
 *   VAT = Price - Base Cost
 * 
 * Type D (10% Excise + 18% VAT compounded):
 *   Price = Base Cost * 1.10 * 1.18 = Base Cost * 1.298
 *   Base Cost = Price / 1.298
 *   Excise = Base Cost * 0.10
 *   VAT = (Base Cost + Excise) * 0.18
 */
export function reverseVATCalculation(inclusivePrice: number, taxType: string, exciseRate = 10) {
  let cleanBaseCost = inclusivePrice;
  let vatAmount = 0;
  let exciseAmount = 0;

  if (taxType === 'B') {
    cleanBaseCost = bankersRound(inclusivePrice / 1.18);
    vatAmount = inclusivePrice - cleanBaseCost;
  } else if (taxType === 'D') {
    cleanBaseCost = bankersRound(inclusivePrice / 1.298);
    exciseAmount = bankersRound(cleanBaseCost * (exciseRate / 100));
    vatAmount = bankersRound((cleanBaseCost + exciseAmount) * 0.18);
    
    // Adjust slightly for precision to match the final inclusive price
    const calculatedInclusive = cleanBaseCost + exciseAmount + vatAmount;
    if (calculatedInclusive !== inclusivePrice) {
      const difference = inclusivePrice - calculatedInclusive;
      cleanBaseCost += difference;
    }
  }

  return {
    cleanBaseCost,
    vatAmount,
    exciseAmount,
    totalTax: vatAmount + exciseAmount,
  };
}
