"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bankersRound = bankersRound;
exports.calculateWholesalePrice = calculateWholesalePrice;
exports.calculateRetailPrice = calculateRetailPrice;
function bankersRound(num) {
    const d = num * 1;
    const i = Math.floor(d);
    const f = d - i;
    if (f < 0.5) {
        return i;
    }
    else if (f > 0.5) {
        return i + 1;
    }
    else {
        return i % 2 === 0 ? i : i + 1;
    }
}
function calculateWholesalePrice(supplierCost, wholesalerMarkupPct, taxType, exciseDutyRatePct) {
    // 1. Calculate Pre-Tax Price
    const preTaxPrice = supplierCost * (1 + wholesalerMarkupPct / 100);
    // 2. Calculate Taxes
    let tax = 0;
    let exciseAmount = 0;
    let vatAmount = 0;
    let taxableSubtotal = preTaxPrice;
    if (taxType === 'A' || taxType === 'C') {
        tax = 0;
    }
    else if (taxType === 'B') {
        vatAmount = preTaxPrice * 0.18;
        tax = vatAmount;
    }
    else if (taxType === 'D') {
        exciseAmount = preTaxPrice * (exciseDutyRatePct / 100);
        taxableSubtotal = preTaxPrice + exciseAmount;
        vatAmount = taxableSubtotal * 0.18;
        tax = exciseAmount + vatAmount;
    }
    // 3. Final Wholesale Invoice Price
    const finalInvoicePrice = bankersRound(preTaxPrice + tax);
    return {
        preTaxPrice,
        exciseAmount,
        vatAmount,
        taxAmount: tax,
        finalInvoicePrice
    };
}
function calculateRetailPrice(cleanBaseCost, retailerMarkupPct, taxType, exciseDutyRatePct) {
    // 1. Calculate Retail Pre-Tax Price
    const retailPreTaxPrice = cleanBaseCost * (1 + retailerMarkupPct / 100);
    // 2. Calculate Taxes
    let tax = 0;
    let exciseAmount = 0;
    let vatAmount = 0;
    let taxableSubtotal = retailPreTaxPrice;
    if (taxType === 'A' || taxType === 'C') {
        tax = 0;
    }
    else if (taxType === 'B') {
        vatAmount = retailPreTaxPrice * 0.18;
        tax = vatAmount;
    }
    else if (taxType === 'D') {
        exciseAmount = retailPreTaxPrice * (exciseDutyRatePct / 100);
        taxableSubtotal = retailPreTaxPrice + exciseAmount;
        vatAmount = taxableSubtotal * 0.18;
        tax = exciseAmount + vatAmount;
    }
    // 3. Final Consumer Shelf Price
    const finalConsumerShelfPrice = bankersRound(retailPreTaxPrice + tax);
    return {
        retailPreTaxPrice,
        exciseAmount,
        vatAmount,
        taxAmount: tax,
        finalConsumerShelfPrice
    };
}
