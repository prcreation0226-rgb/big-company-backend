"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUSSDRequest = exports.handleUSSDRequestCore = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const tokenMeter_service_1 = __importDefault(require("../services/tokenMeter.service"));
const pipingMeter_service_1 = __importDefault(require("../services/pipingMeter.service"));
const palmKash_service_1 = __importDefault(require("../services/palmKash.service"));
const storeController_1 = require("./storeController");
/**
 * Helper to normalize telephone numbers to 2507XXXXXXXX format for SMS / payments.
 */
function normalizePhoneNumber(phone) {
    let cleaned = phone.trim();
    if (cleaned.startsWith('07')) {
        cleaned = '250' + cleaned.substring(1);
    }
    else if (cleaned.startsWith('+250')) {
        cleaned = cleaned.substring(1);
    }
    else if (cleaned.startsWith('7')) {
        cleaned = '250' + cleaned;
    }
    return cleaned;
}
/**
 * Helper to find NFC card supporting friendly suffix lookup or direct UID lookup.
 */
function findNfcCard(cardNumInput) {
    return __awaiter(this, void 0, void 0, function* () {
        const cleaned = cardNumInput.replace(/[\s:]/g, '').toUpperCase();
        // 1. Direct search by uid (exactly as is)
        let card = yield prisma_1.default.nfcCard.findFirst({
            where: { uid: cardNumInput.trim() }
        });
        if (card)
            return card;
        // 2. Query all cards and find by cleaned/friendly match
        const cards = yield prisma_1.default.nfcCard.findMany();
        card = cards.find(c => {
            const dbCleaned = c.uid.replace(/[\s:]/g, '').toUpperCase();
            if (dbCleaned === cleaned)
                return true;
            if (cleaned.startsWith('NFC-')) {
                const suffix = cleaned.substring(4);
                return dbCleaned.endsWith(suffix);
            }
            if (cleaned.length === 4) {
                return dbCleaned.endsWith(cleaned);
            }
            return false;
        });
        return card || null;
    });
}
function isValidCardFormat(cardNumInput) {
    const cleaned = cardNumInput.replace(/[\s:]/g, '');
    return /^(NFC-)?[0-9A-Za-z]{4,20}$/.test(cleaned);
}
/**
 * Main stateless USSD handler.
 * POST /api/ussd
 * Body: { sessionId, phoneNumber, serviceCode, text }
 */
const handleUSSDRequestCore = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        }
        catch (e) {
            // Not a valid JSON string, keep as is
        }
    }
    const { sessionId, phoneNumber, serviceCode, text = '' } = body || {};
    if (!phoneNumber) {
        return res.send('END Error: Phone number is missing from session.');
    }
    // Parse path choices split by asterisk
    let parts = text.toString().split('*').map((s) => s.trim()).filter((s) => s !== '');
    // Strip service code prefix if present (e.g. 939*15, 939, 121, 123)
    if (parts.length > 0 && ['939', '121', '123'].includes(parts[0])) {
        if (parts[0] === '939' && parts[1] === '15') {
            parts = parts.slice(2);
        }
        else {
            parts = parts.slice(1);
        }
    }
    try {
        // ----------------------------------------------------
        // ROOT MENU
        // ----------------------------------------------------
        if (parts.length === 0) {
            const menu = [
                'Welcome',
                '1. Gura Gas',
                '2. Ongera amafaranga',
                '3. Kora order',
                '4. Tanga Gas',
                '5. Reba balance',
                '6. Manage Orders'
            ].join('\n');
            return res.send(menu);
        }
        const choice = parts[0];
        // ====================================================
        // OPTION 1: Gura Gas (Gas Recharge)
        // ====================================================
        if (choice === '1') {
            // Step 1: Choose Meter type (Zamuka vs Tekana)
            if (parts.length === 1) {
                return res.send('CON Choose Meter type;\n1. Zamuka\n2. Tekana');
            }
            const meterTypeChoice = parts[1];
            if (meterTypeChoice !== '1' && meterTypeChoice !== '2') {
                return res.send('END Invalid meter type selection.');
            }
            // Step 2: Prompt Meter ID
            if (parts.length === 2) {
                return res.send('CON Enter Meter ID:');
            }
            const meterId = parts[2];
            // Verification: Check if Meter ID exists
            const targetPhone = normalizePhoneNumber(phoneNumber);
            const callerUser = yield prisma_1.default.user.findFirst({
                where: {
                    OR: [
                        { phone: targetPhone },
                        { phone: phoneNumber }
                    ]
                }
            });
            let callerConsumer = null;
            if (callerUser) {
                callerConsumer = yield prisma_1.default.consumerProfile.findFirst({
                    where: { userId: callerUser.id }
                });
            }
            let meter = null;
            if (callerConsumer) {
                meter = yield prisma_1.default.gasMeter.findFirst({
                    where: {
                        meterNumber: meterId,
                        consumerId: callerConsumer.id
                    }
                });
            }
            if (!meter) {
                meter = yield prisma_1.default.gasMeter.findFirst({
                    where: { meterNumber: meterId }
                });
            }
            if (!meter) {
                return res.send('END Invalid Meter ID. Please check the code and try again.');
            }
            // Check if selected meter type matches actual meter type in database
            const expectedType = meterTypeChoice === '1' ? 'TOKEN' : 'PIPING';
            if (meter.meterType !== expectedType) {
                const dbLabel = meter.meterType === 'TOKEN' ? 'Zamuka (TOKEN)' : 'Tekana (PIPING)';
                const selectLabel = expectedType === 'TOKEN' ? 'Zamuka (TOKEN)' : 'Tekana (PIPING)';
                return res.send(`END Error: This meter is registered as a ${dbLabel} meter, but you selected ${selectLabel}.`);
            }
            // Step 3: Select Amount (Pricing Menu)
            if (parts.length === 3) {
                // Fetch predefined gas pricing plans from database
                const pricingPlans = yield prisma_1.default.gasPricingPlan.findMany({
                    where: { isActive: true },
                    orderBy: { amount: 'asc' },
                    take: 5
                });
                if (pricingPlans.length === 0) {
                    // Fallback if no pricing plans in database
                    const fallbackMenu = [
                        'CON Select Amount:',
                        '1. 1000 RWF',
                        '2. 2000 RWF',
                        '3. 5000 RWF',
                        '4. 10000 RWF'
                    ].join('\n');
                    return res.send(fallbackMenu);
                }
                const planMenu = ['CON Select Amount:'];
                pricingPlans.forEach((plan, idx) => {
                    planMenu.push(`${idx + 1}. ${plan.amount} RWF`);
                });
                return res.send(planMenu.join('\n'));
            }
            // Extract amount
            const planIdx = parseInt(parts[3], 10) - 1;
            const pricingPlans = yield prisma_1.default.gasPricingPlan.findMany({
                where: { isActive: true },
                orderBy: { amount: 'asc' },
                take: 5
            });
            let selectedAmount = 0;
            if (pricingPlans.length > 0 && pricingPlans[planIdx]) {
                selectedAmount = pricingPlans[planIdx].amount;
            }
            else {
                // Fallback amounts
                const fallbacks = [1000, 2000, 5000, 10000];
                selectedAmount = fallbacks[planIdx] || 1000;
            }
            // Step 4: Select Payment Method
            if (parts.length === 4) {
                const paymentMenu = [
                    'CON Select Payment Method:',
                    '1. Mobile Money',
                    '2. Wallet'
                ].join('\n');
                return res.send(paymentMenu);
            }
            const paymentMethod = parts[4];
            // PAYMENT PATHWAY 1: Mobile Money
            if (paymentMethod === '1') {
                if (parts.length === 5) {
                    return res.send(`CON Confirm payment of ${selectedAmount} RWF for Meter ${meterId} via Mobile Money?\n1. Yes\n2. No`);
                }
                const confirmVal = parts[5];
                if (confirmVal === '1') {
                    // Trigger external Mobile Money API push (STK prompt) to the customer’s phone
                    const targetPhone = normalizePhoneNumber(phoneNumber);
                    const provider = meter.isGprs ? 'zhongyi' : 'stronpower';
                    const txRef = `GASRCH-${meter.meterType || 'TOKEN'}-${provider}-${Date.now()}`;
                    // Log pending Gas Recharge Transaction
                    yield prisma_1.default.gasRechargeTransaction.create({
                        data: {
                            customerId: meter.consumerId,
                            meterNumber: meter.meterNumber,
                            meterType: meter.meterType || 'PIPING',
                            amount: selectedAmount,
                            paymentMethod: 'mobile_money',
                            paymentPhone: targetPhone,
                            status: 'PENDING_PAYMENT',
                            apiReference: txRef
                        }
                    });
                    // Initiate MoMo transaction request (STK push)
                    try {
                        yield palmKash_service_1.default.initiatePayment({
                            amount: selectedAmount,
                            phoneNumber: targetPhone,
                            referenceId: txRef,
                            description: `Gas Meter Recharge USSD - ${meterId}`
                        });
                    }
                    catch (e) {
                        console.error('Mobile money push error:', e.message);
                    }
                    return res.send('END Mobile Money transaction initiated. Please complete on your phone.');
                }
                else {
                    return res.send('END Transaction cancelled.');
                }
            }
            // PAYMENT PATHWAY 2: Wallet
            if (paymentMethod === '2') {
                if (parts.length === 5) {
                    return res.send('CON Enter Card Number:');
                }
                const cardNum = parts[5];
                if (!isValidCardFormat(cardNum)) {
                    return res.send('END Error: Invalid card number format.');
                }
                if (parts.length === 6) {
                    return res.send('CON Enter Card PIN:');
                }
                const cardPin = parts[6];
                if (parts.length === 7) {
                    const walletTypeMenu = [
                        'CON Select Wallet Type:',
                        '1. Dashboard Balance',
                        '2. Credit Balance'
                    ].join('\n');
                    return res.send(walletTypeMenu);
                }
                const walletTypeChoice = parts[7];
                if (walletTypeChoice !== '1' && walletTypeChoice !== '2') {
                    return res.send('END Invalid selection.');
                }
                const walletTypeName = walletTypeChoice === '1' ? 'Dashboard Balance' : 'Credit Balance';
                if (parts.length === 8) {
                    return res.send('CON Enter phone number to receive SMS (e.g. 07XXXXXXXX):');
                }
                const customSmsPhone = normalizePhoneNumber(parts[8]);
                if (parts.length === 9) {
                    return res.send(`CON Confirm payment of ${selectedAmount} RWF for Meter ${meterId} from your ${walletTypeName}?\n1. Yes\n2. No`);
                }
                const confirmVal = parts[9];
                if (confirmVal === '1') {
                    // Authenticate Card Number and PIN
                    const card = yield findNfcCard(cardNum);
                    if (!card || card.pin !== cardPin) {
                        return res.send('END Access denied.');
                    }
                    if (card.status !== 'active') {
                        return res.send('END Error: Card is inactive or invalid.');
                    }
                    if (!card.consumerId) {
                        return res.send('END Error: Card is not linked to any customer profile.');
                    }
                    // Refine meter lookup to the one belonging to the card owner if duplicates exist
                    const refinedMeter = yield prisma_1.default.gasMeter.findFirst({
                        where: {
                            meterNumber: meterId,
                            consumerId: card.consumerId
                        }
                    });
                    if (refinedMeter) {
                        meter = refinedMeter;
                    }
                    // Balance check
                    const dbWalletType = walletTypeChoice === '1' ? 'dashboard_wallet' : 'credit_wallet';
                    const wallet = yield prisma_1.default.wallet.findFirst({
                        where: { consumerId: card.consumerId, type: dbWalletType }
                    });
                    if (!wallet || wallet.balance < selectedAmount) {
                        return res.send('END Transaction failed. Insufficient balance.');
                    }
                    // Execute recharge under database transaction
                    try {
                        let createdTxId;
                        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                            // Deduct balance
                            yield tx.wallet.update({
                                where: { id: wallet.id },
                                data: { balance: { decrement: selectedAmount } }
                            });
                            // Log Wallet transaction history
                            yield tx.walletTransaction.create({
                                data: {
                                    walletId: wallet.id,
                                    type: 'gas_meter_recharge',
                                    amount: -selectedAmount,
                                    description: `Gas Meter Recharge - Meter ${meterId} via USSD`,
                                    status: 'completed'
                                }
                            });
                            // Log Gas Recharge Transaction as PENDING
                            const gasTx = yield tx.gasRechargeTransaction.create({
                                data: {
                                    customerId: card.consumerId,
                                    meterNumber: meter.meterNumber,
                                    meterType: meter.meterType || 'PIPING',
                                    amount: selectedAmount,
                                    paymentMethod: 'wallet',
                                    paymentPhone: customSmsPhone,
                                    status: 'PENDING'
                                }
                            });
                            createdTxId = gasTx.id;
                        }));
                        // Fetch System Configuration for Dynamic Pricing
                        const config = yield prisma_1.default.systemConfig.findFirst();
                        const gasPrice = (config === null || config === void 0 ? void 0 : config.gasPricePerM3) || 1500;
                        // Calculate gas volume in m³ (vending by unit)
                        const totalVolume = Math.floor((selectedAmount / gasPrice) * 10) / 10;
                        // Trigger Gas recharge action using unit-based volume
                        let apiResult;
                        const provider = meter.isGprs ? 'zhongyi' : 'stronpower';
                        if (provider === 'zhongyi') {
                            const { default: zhongyiMeterService } = yield Promise.resolve().then(() => __importStar(require('../services/zhongyiMeter.service')));
                            apiResult = yield zhongyiMeterService.rechargeMeter({
                                meterNumber: meter.meterNumber,
                                amount: totalVolume,
                                customerRef: `GASRCH-USSD-${meter.meterNumber}-${Date.now()}`,
                                isVendByUnit: true
                            });
                        }
                        else {
                            // Apply Stronpower API (tokenMeterService) for both TOKEN and PIPING meters
                            apiResult = yield tokenMeter_service_1.default.rechargeTokenMeter({
                                meterNumber: meter.meterNumber,
                                amount: totalVolume,
                                customerRef: `GASRCH-USSD-${meter.meterNumber}-${Date.now()}`,
                                isVendByUnit: true
                            });
                        }
                        // GPRS remote push integration
                        let pushResult = { success: true, error: null };
                        if (apiResult && apiResult.success && meter && meter.imei && apiResult.token) {
                            try {
                                const pushRes = yield pipingMeter_service_1.default.pushTokenToImei(meter.imei, apiResult.token);
                                if (pushRes && !pushRes.success) {
                                    pushResult.success = false;
                                    pushResult.error = pushRes.error || 'Remote push rejected';
                                }
                            }
                            catch (pushErr) {
                                pushResult.success = false;
                                pushResult.error = pushErr.message || 'Remote push connection error';
                            }
                        }
                        const isFullySuccessful = apiResult && apiResult.success && pushResult.success;
                        if (isFullySuccessful && createdTxId) {
                            // Update transaction to SUCCESS and record token
                            yield prisma_1.default.gasRechargeTransaction.update({
                                where: { id: createdTxId },
                                data: {
                                    status: 'SUCCESS',
                                    tokenValue: apiResult.token || null,
                                    apiReference: apiResult.apiReference || null
                                }
                            });
                            // Track Gas Topup and update Gas Meter units
                            try {
                                const config = yield prisma_1.default.systemConfig.findFirst();
                                const gasPrice = (config === null || config === void 0 ? void 0 : config.gasPricePerM3) || 1500;
                                const unitsPurchased = (apiResult && apiResult.units) ? Number(apiResult.units) : (selectedAmount / gasPrice);
                                yield prisma_1.default.gasTopup.create({
                                    data: {
                                        consumerId: card.consumerId,
                                        meterId: meter.id,
                                        amount: selectedAmount,
                                        units: unitsPurchased,
                                        status: 'completed',
                                        orderId: String(createdTxId)
                                    }
                                });
                                yield prisma_1.default.gasMeter.update({
                                    where: { id: meter.id },
                                    data: {
                                        currentUnits: { increment: unitsPurchased }
                                    }
                                });
                            }
                            catch (topupErr) {
                                console.error('[USSD Recharge] Failed to create gas topup / update units:', topupErr);
                            }
                            // Send SMS notification
                            try {
                                const consumer = yield prisma_1.default.consumerProfile.findFirst({
                                    where: { id: card.consumerId || undefined },
                                    include: { user: true }
                                });
                                if (consumer) {
                                    const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
                                    const smsDestination = customSmsPhone || consumer.user.phone || consumer.user.email || '';
                                    if (smsDestination) {
                                        yield emailQueue.add('gas-recharge-success', {
                                            to: smsDestination,
                                            templateType: 'gas-recharge-success',
                                            data: {
                                                customer_name: consumer.fullName || consumer.user.name || 'Valued Customer',
                                                meter_name: 'Gas Meter',
                                                meter_id: meter.meterNumber,
                                                amount: selectedAmount.toLocaleString(),
                                                token: apiResult.token || 'Remote GPRS Topup',
                                                transaction_id: String(createdTxId),
                                                volume: totalVolume
                                            },
                                            relatedEntity: { type: 'USER', id: consumer.userId.toString() }
                                        });
                                    }
                                }
                            }
                            catch (notifyErr) {
                                console.error('[USSD Wallet Recharge] Failed to trigger notification:', notifyErr);
                            }
                            return res.send('END Gas recharge complete. Thank you!');
                        }
                        else {
                            // Rollback/Refund wallet on failure
                            yield prisma_1.default.wallet.update({
                                where: { id: wallet.id },
                                data: { balance: { increment: selectedAmount } }
                            });
                            yield prisma_1.default.walletTransaction.create({
                                data: {
                                    walletId: wallet.id,
                                    type: 'refund',
                                    amount: selectedAmount,
                                    description: `Refund: Gas Meter Recharge failed - Meter ${meterId} via USSD`,
                                    status: 'completed'
                                }
                            });
                            if (createdTxId) {
                                yield prisma_1.default.gasRechargeTransaction.update({
                                    where: { id: createdTxId },
                                    data: {
                                        status: 'FAILED',
                                        errorMessage: pushResult.error || (apiResult && apiResult.error) || 'Meter recharge failed'
                                    }
                                });
                            }
                            const failureReason = pushResult.error || (apiResult && apiResult.error) || 'Recharge failed';
                            return res.send(`END Transaction failed: ${failureReason}`);
                        }
                    }
                    catch (err) {
                        console.error('Wallet payment USSD transaction error:', err);
                        return res.send('END Transaction failed.');
                    }
                }
                else {
                    return res.send('END Transaction cancelled.');
                }
            }
            return res.send('END Invalid selection.');
        }
        // ====================================================
        // OPTION 2: Ongera amafaranga (Wallet Top-Up)
        // ====================================================
        if (choice === '2') {
            if (parts.length === 1) {
                return res.send('CON Enter Card Number:');
            }
            const cardNum = parts[1];
            if (!isValidCardFormat(cardNum)) {
                return res.send('END Error: Invalid card number format.');
            }
            // Validate Card Number is active and exists
            const card = yield findNfcCard(cardNum);
            if (!card || card.status !== 'active') {
                return res.send('END Error: Card is invalid or inactive.');
            }
            if (parts.length === 2) {
                return res.send('CON Enter Amount to Top Up:');
            }
            const topupAmount = parseFloat(parts[2]);
            if (isNaN(topupAmount) || topupAmount <= 0) {
                return res.send('END Error: Invalid amount.');
            }
            if (parts.length === 3) {
                return res.send(`CON Confirm top up of ${topupAmount} RWF to Card ${cardNum}?\n1. Yes\n2. No`);
            }
            const confirmVal = parts[3];
            if (confirmVal === '1') {
                const targetPhone = normalizePhoneNumber(phoneNumber);
                const txRef = `TOPUP-USSD-${cardNum}-${Date.now()}`;
                if (!card.consumerId) {
                    return res.send('END Error: Card is not linked to any customer profile.');
                }
                // Find Dashboard Wallet
                const wallet = yield prisma_1.default.wallet.findFirst({
                    where: { consumerId: card.consumerId, type: 'dashboard_wallet' }
                });
                if (!wallet) {
                    return res.send('END Error: Dashboard wallet not found.');
                }
                // Log pending Wallet transaction
                yield prisma_1.default.walletTransaction.create({
                    data: {
                        walletId: wallet.id,
                        type: 'topup',
                        amount: topupAmount,
                        status: 'pending',
                        reference: txRef,
                        paymentPhone: targetPhone
                    }
                });
                // Trigger Mobile Money push prompt
                try {
                    yield palmKash_service_1.default.initiatePayment({
                        amount: topupAmount,
                        phoneNumber: targetPhone,
                        referenceId: txRef,
                        description: `Wallet Topup USSD - Card ${cardNum}`
                    });
                }
                catch (e) {
                    console.error('Wallet topup push error:', e.message);
                }
                return res.send('END Mobile Money transaction initiated. Please complete on your phone.');
            }
            else {
                return res.send('END Top up cancelled.');
            }
        }
        // ====================================================
        // OPTION 3: Kora order (Order from Retailer)
        // ====================================================
        if (choice === '3') {
            // Step 1: Select Province
            const provinces = ['Kigali', 'Eastern', 'Western', 'Northern', 'Southern'];
            if (parts.length === 1) {
                const provMenu = ['CON Select province:'];
                provinces.forEach((p, idx) => provMenu.push(`${idx + 1}. ${p}`));
                return res.send(provMenu.join('\n'));
            }
            const selectedProv = provinces[parseInt(parts[1], 10) - 1];
            // Step 2: Select District
            const districtMap = {
                'Kigali': ['Nyarugenge', 'Gasabo', 'Kicukiro'],
                'Eastern': ['Rwamagana', 'Nyagatare', 'Gatsibo', 'Kayonza', 'Kirehe', 'Ngoma', 'Bugesera'],
                'Western': ['Rubavu', 'Karongi', 'Rutsiro', 'Nyamasheke', 'Rusizi', 'Ngororero', 'Nyabihu'],
                'Northern': ['Musanze', 'Rulindo', 'Gicumbi', 'Burera', 'Gakenke'],
                'Southern': ['Huye', 'Nyanza', 'Gisagara', 'Kamonyi', 'Muhanga', 'Ruhango', 'Nyamagabe', 'Nyaruguru']
            };
            const districts = districtMap[selectedProv] || ['Gasabo'];
            if (parts.length === 2) {
                const distMenu = ['CON select District:'];
                districts.forEach((d, idx) => distMenu.push(`${idx + 1}. ${d}`));
                return res.send(distMenu.join('\n'));
            }
            const selectedDist = districts[parseInt(parts[2], 10) - 1];
            // Step 3: Select Retailer
            const retailers = yield prisma_1.default.retailerProfile.findMany({
                where: { district: selectedDist },
                include: { user: true }
            });
            if (retailers.length === 0) {
                return res.send('END Error: No retailers available in this district.');
            }
            if (parts.length === 3) {
                const retMenu = ['CON Select a Retailer:'];
                retailers.forEach((r, idx) => retMenu.push(`${idx + 1}. ${r.shopName || 'Retailer'}`));
                return res.send(retMenu.join('\n'));
            }
            const retailerIdx = parseInt(parts[3], 10) - 1;
            const selectedRetailer = retailers[retailerIdx];
            if (!selectedRetailer) {
                return res.send('END Error: Invalid retailer selection.');
            }
            // Step 4: Enter phone number
            if (parts.length === 4) {
                return res.send('CON Enter your phone number:');
            }
            const orderPhone = parts[4];
            if (parts.length === 5) {
                return res.send(`CON Confirm order request to ${selectedRetailer.shopName} Phone number ${orderPhone}?\n1. Yes\n2. No`);
            }
            const confirmVal = parts[5];
            if (confirmVal === '1') {
                try {
                    const registeredUser = yield prisma_1.default.user.findFirst({
                        where: { phone: orderPhone }
                    });
                    const mockReq = {
                        user: registeredUser ? { id: registeredUser.id, role: registeredUser.role } : undefined,
                        body: {
                            retailerId: selectedRetailer.id,
                            paymentMethod: 'ussd_callback',
                            phone: orderPhone,
                            retailer_email: ((_a = selectedRetailer.user) === null || _a === void 0 ? void 0 : _a.email) || ''
                        }
                    };
                    const mockRes = {
                        status: (code) => ({
                            json: (data) => { }
                        }),
                        json: (data) => { }
                    };
                    yield (0, storeController_1.createOrder)(mockReq, mockRes);
                }
                catch (postErr) {
                    console.error('[USSD Order] Failed to execute createOrder internally:', postErr.message);
                }
                return res.send('END Thank you. The retailer has been notified and will contact you shortly.');
            }
            else {
                return res.send('END Order cancelled.');
            }
        }
        // ====================================================
        // OPTION 4: Tanga Gas (Share Rewards)
        // ====================================================
        if (choice === '4') {
            if (parts.length === 1) {
                return res.send('CON Enter Reward wallet ID:');
            }
            const rewardWalletId = parts[1];
            const normalized = '+' + normalizePhoneNumber(rewardWalletId);
            const consumer = yield prisma_1.default.consumerProfile.findFirst({
                where: {
                    OR: [
                        { gasRewardWalletId: rewardWalletId },
                        { gasRewardWalletId: normalized }
                    ]
                }
            });
            if (!consumer) {
                return res.send('END Error: Invalid Reward wallet ID.');
            }
            const rewards = yield prisma_1.default.gasReward.findMany({
                where: { consumerId: consumer.id }
            });
            const rewardBalance = rewards.reduce((sum, r) => sum + r.units, 0);
            if (parts.length === 2) {
                return res.send('CON Choose Meter Type:\n1. Zamuka\n2. Tekana');
            }
            const meterTypeChoice = parts[2];
            const meterType = meterTypeChoice === '1' ? 'TOKEN' : 'PIPING';
            if (parts.length === 3) {
                return res.send('CON Enter Meter ID:');
            }
            const meterId = parts[3];
            // Validate target meter ID exists and matches the selected type
            const targetMeter = yield prisma_1.default.gasMeter.findFirst({
                where: { meterNumber: meterId }
            });
            if (!targetMeter) {
                return res.send('END Invalid Meter ID. Please check the code and try again.');
            }
            if (targetMeter.meterType !== meterType) {
                const dbLabel = targetMeter.meterType === 'TOKEN' ? 'Zamuka' : 'Tekana';
                const selectLabel = meterType === 'TOKEN' ? 'Zamuka' : 'Tekana';
                return res.send(`END Error: Meter ID matches a ${dbLabel} meter, but you selected ${selectLabel}.`);
            }
            if (parts.length === 4) {
                return res.send('CON Enter Units:');
            }
            const rawUnits = parts[4];
            if (!/^\d+(\.\d)?$/.test(rawUnits)) {
                return res.send('END Error: Units cannot have more than one decimal place.');
            }
            const unitsValue = parseFloat(rawUnits);
            if (unitsValue <= 0) {
                return res.send('END Error: Units must be greater than zero.');
            }
            if (rewardBalance < unitsValue) {
                return res.send('END Insufficient rewards error.');
            }
            if (parts.length === 5) {
                return res.send('CON Enter number for SMS:');
            }
            const smsPhone = parts[5];
            if (parts.length === 6) {
                return res.send(`CON Confirm share gas of ${unitsValue} m3 to meter ${meterId}?\n1. Yes\n2. No`);
            }
            const confirmVal = parts[6];
            if (confirmVal === '1') {
                const normalizedSMSPhone = normalizePhoneNumber(smsPhone);
                try {
                    const mockReq = {
                        user: { id: consumer.userId, role: 'consumer' },
                        body: {
                            meterId: meterId,
                            amount: unitsValue,
                            meterType: targetMeter.isGprs ? 'GPRS' : 'LORA_NB',
                            phone: normalizedSMSPhone
                        }
                    };
                    const mockRes = {
                        status: (code) => ({
                            json: (data) => { }
                        }),
                        json: (data) => { }
                    };
                    const { sendToMeter } = yield Promise.resolve().then(() => __importStar(require('./rewardsController')));
                    yield sendToMeter(mockReq, mockRes);
                }
                catch (err) {
                    console.error('[USSD Reward Share] Failed to execute sendToMeter internally:', err.message);
                }
                return res.send('END You have shared your gas rewards Successfully');
            }
            else {
                return res.send('END Share cancelled.');
            }
        }
        // ====================================================
        // OPTION 5: Reba balance (Check Balance)
        // ====================================================
        if (choice === '5') {
            if (parts.length === 1) {
                return res.send('CON Enter Card Number:');
            }
            const cardNum = parts[1];
            if (!isValidCardFormat(cardNum)) {
                return res.send('END Error: Invalid card number format.');
            }
            if (parts.length === 2) {
                return res.send('CON Enter Card PIN:');
            }
            const cardPin = parts[2];
            const card = yield findNfcCard(cardNum);
            if (!card || card.pin !== cardPin) {
                return res.send('END Access denied.');
            }
            if (!card.consumerId) {
                return res.send('END Error: Card is not linked to any customer profile.');
            }
            const wallets = yield prisma_1.default.wallet.findMany({
                where: { consumerId: card.consumerId, type: { in: ['dashboard_wallet', 'credit_wallet'] } }
            });
            const dashboardBalance = ((_b = wallets.find(w => w.type === 'dashboard_wallet')) === null || _b === void 0 ? void 0 : _b.balance) || 0;
            const creditBalance = ((_c = wallets.find(w => w.type === 'credit_wallet')) === null || _c === void 0 ? void 0 : _c.balance) || 0;
            return res.send(`END Your Dashboard Balance is: ${dashboardBalance} RWF. Your Credit Balance is: ${creditBalance} RWF.`);
        }
        // ====================================================
        // OPTION 6: Manage Orders (Pay / Confirm Delivery)
        // ====================================================
        if (choice === '6') {
            const targetPhone = normalizePhoneNumber(phoneNumber); // e.g. 250788881264
            const shortPhone = targetPhone.startsWith('250') ? targetPhone.substring(3) : targetPhone; // e.g. 788881264
            // Level 1: Choose Action
            if (parts.length === 1) {
                const orderMenu = [
                    'CON Manage Orders:',
                    '1. Pay Pending Order',
                    '2. Confirm Delivery'
                ].join('\n');
                return res.send(orderMenu);
            }
            const orderAction = parts[1];
            // ACTION 1: Pay Pending Order
            if (orderAction === '1') {
                const sales = yield prisma_1.default.sale.findMany({
                    where: {
                        status: 'pending_payment',
                        OR: [
                            { notes: { contains: targetPhone } },
                            { notes: { contains: shortPhone } }
                        ]
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5
                });
                if (sales.length === 0) {
                    return res.send('END You have no pending orders awaiting payment.');
                }
                // Level 2: List pending orders to choose
                if (parts.length === 2) {
                    const listMenu = ['CON Select Order to Pay:'];
                    sales.forEach((s, idx) => {
                        listMenu.push(`${idx + 1}. Order #${s.id} (${s.totalAmount} RWF)`);
                    });
                    return res.send(listMenu.join('\n'));
                }
                const orderIdx = parseInt(parts[2], 10) - 1;
                const sale = sales[orderIdx];
                if (!sale) {
                    return res.send('END Invalid order selection.');
                }
                // Level 3: Select Payment Method
                if (parts.length === 3) {
                    const paymentMenu = [
                        `CON Order #${sale.id} total is ${sale.totalAmount} RWF.`,
                        'Select Payment Method:',
                        '1. Wallet Balance',
                        '2. MTN Mobile Money',
                        '3. Airtel Money'
                    ].join('\n');
                    return res.send(paymentMenu);
                }
                const payMethodChoice = parts[3];
                // PAYMENT METHOD 1: Wallet Balance
                if (payMethodChoice === '1') {
                    // Step 1: Select Wallet Type
                    if (parts.length === 4) {
                        const walletTypeMenu = [
                            'CON Select Wallet Type:',
                            '1. Dashboard Balance',
                            '2. Credit Balance'
                        ].join('\n');
                        return res.send(walletTypeMenu);
                    }
                    const walletTypeChoice = parts[4];
                    if (walletTypeChoice !== '1' && walletTypeChoice !== '2') {
                        return res.send('END Invalid selection.');
                    }
                    const walletTypeName = walletTypeChoice === '1' ? 'Dashboard Balance' : 'Credit Balance';
                    // Step 2: Enter Card Number
                    if (parts.length === 5) {
                        return res.send('CON Enter Card Number:');
                    }
                    const cardNum = parts[5];
                    if (!isValidCardFormat(cardNum)) {
                        return res.send('END Error: Invalid card number format.');
                    }
                    // Step 3: Enter Card PIN
                    if (parts.length === 6) {
                        return res.send('CON Enter Card PIN:');
                    }
                    const cardPin = parts[6];
                    // Authenticate Card and Wallet Check
                    const card = yield findNfcCard(cardNum);
                    if (!card || card.pin !== cardPin) {
                        return res.send('END Access denied.');
                    }
                    if (card.status !== 'active') {
                        return res.send('END Error: Card is inactive or invalid.');
                    }
                    if (!card.consumerId) {
                        return res.send('END Error: Card is not linked to a customer profile.');
                    }
                    const dbWalletType = walletTypeChoice === '1' ? 'dashboard_wallet' : 'credit_wallet';
                    const wallet = yield prisma_1.default.wallet.findFirst({
                        where: { consumerId: card.consumerId, type: dbWalletType }
                    });
                    if (!wallet || wallet.balance < sale.totalAmount) {
                        return res.send('END Error: Insufficient wallet balance.');
                    }
                    const saleItems = yield prisma_1.default.saleItem.findMany({
                        where: { saleId: sale.id }
                    });
                    // Deduct & update sale status to 'pending' (paid)
                    yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                        // Deduct from Wallet table
                        yield tx.wallet.update({
                            where: { id: wallet.id },
                            data: { balance: { decrement: sale.totalAmount } }
                        });
                        // Sync with ConsumerProfile walletBalance
                        yield tx.consumerProfile.update({
                            where: { id: card.consumerId },
                            data: { walletBalance: { decrement: sale.totalAmount } }
                        });
                        // Log Wallet Transaction
                        yield tx.walletTransaction.create({
                            data: {
                                walletId: wallet.id,
                                type: 'order_payment',
                                amount: -sale.totalAmount,
                                description: `Order Payment - Order #${sale.id} via USSD (${walletTypeName})`,
                                status: 'completed'
                            }
                        });
                        // Update Sale Status to 'pending' (paid)
                        yield tx.sale.update({
                            where: { id: sale.id },
                            data: {
                                status: 'pending',
                                paymentMethod: 'wallet'
                            }
                        });
                        // Decrement product stock
                        for (const item of saleItems) {
                            yield tx.product.update({
                                where: { id: item.productId },
                                data: { stock: { decrement: item.quantity } }
                            });
                        }
                    }));
                    return res.send(`END Payment successful! Your order #${sale.id} is now paid.`);
                }
                // PAYMENT METHOD 2: MTN Mobile Money
                if (payMethodChoice === '2') {
                    const ordRef = `ORD-${Date.now()}`;
                    yield prisma_1.default.sale.update({
                        where: { id: sale.id },
                        data: { meterId: ordRef }
                    });
                    try {
                        const palmKash = (yield Promise.resolve().then(() => __importStar(require('../services/palmKash.service')))).default;
                        yield palmKash.initiatePayment({
                            amount: sale.totalAmount,
                            phoneNumber: targetPhone,
                            referenceId: ordRef,
                            description: `USSD Order #${sale.id} Payment`
                        });
                    }
                    catch (e) {
                        console.error('USSD MoMo pay error:', e.message);
                    }
                    return res.send('END Mobile Money transaction initiated. Please complete on your phone.');
                }
                // PAYMENT METHOD 3: Airtel Money
                if (payMethodChoice === '3') {
                    const ordRef = `ORD-${Date.now()}`;
                    yield prisma_1.default.sale.update({
                        where: { id: sale.id },
                        data: { meterId: ordRef, paymentMethod: 'airtel' }
                    });
                    try {
                        const palmKash = (yield Promise.resolve().then(() => __importStar(require('../services/palmKash.service')))).default;
                        yield palmKash.initiatePayment({
                            amount: sale.totalAmount,
                            phoneNumber: targetPhone,
                            referenceId: ordRef,
                            description: `USSD Order #${sale.id} Airtel Payment`
                        });
                    }
                    catch (e) {
                        console.error('USSD Airtel pay error:', e.message);
                    }
                    return res.send('END Airtel Money transaction initiated. Please complete on your phone.');
                }
                return res.send('END Invalid selection.');
            }
            // ACTION 2: Confirm Delivery
            if (orderAction === '2') {
                const sales = yield prisma_1.default.sale.findMany({
                    where: {
                        status: { in: ['shipped', 'ready'] },
                        OR: [
                            { notes: { contains: targetPhone } },
                            { notes: { contains: shortPhone } }
                        ]
                    },
                    orderBy: { createdAt: 'desc' }
                });
                if (sales.length === 0) {
                    return res.send('END You have no orders ready for delivery confirmation.');
                }
                // Level 2: List orders to choose
                if (parts.length === 2) {
                    const listMenu = ['CON Select Order to Confirm:'];
                    sales.forEach((s, idx) => {
                        listMenu.push(`${idx + 1}. Order #${s.id} (${s.totalAmount} RWF)`);
                    });
                    return res.send(listMenu.join('\n'));
                }
                const orderIdx = parseInt(parts[2], 10) - 1;
                const sale = sales[orderIdx];
                if (!sale) {
                    return res.send('END Invalid order selection.');
                }
                // Level 3: Confirm action
                if (parts.length === 3) {
                    return res.send(`CON Confirm delivery of Order #${sale.id}?\n1. Yes\n2. No`);
                }
                const confirmVal = parts[3];
                if (confirmVal === '1') {
                    yield prisma_1.default.sale.update({
                        where: { id: sale.id },
                        data: { status: 'delivered' }
                    });
                    return res.send('END Delivery confirmed! Thank you.');
                }
                else {
                    return res.send('END Confirmation cancelled.');
                }
            }
            return res.send('END Invalid selection.');
        }
        return res.send('END Invalid choice.');
    }
    catch (error) {
        console.error('USSD processing error:', error);
        return res.send('END System error occurred. Please try again later.');
    }
});
exports.handleUSSDRequestCore = handleUSSDRequestCore;
/**
 * Capture response body/headers for internal redirection/translation.
 */
class USSDResponseCapture {
    constructor() {
        this.sentText = '';
        this.statusVal = 200;
        this.headers = {};
    }
    send(text) {
        this.sentText = text;
        return this;
    }
    status(val) {
        this.statusVal = val;
        return this;
    }
    setHeader(name, value) {
        this.headers[name] = value;
        return this;
    }
    header(name, value) {
        this.headers[name] = value;
        return this;
    }
}
/**
 * Helper to parse fields from a raw XML string.
 */
function parseXMLField(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
    return match ? match[1].trim() : '';
}
/**
 * Wrapper USSD request router that handles MTN XML, Airtel Form Parameters, and JSON.
 */
const handleUSSDRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const contentType = (req.headers && req.headers['content-type']) || '';
    let bodyText = typeof req.body === 'string' ? req.body : '';
    let parsedBody = req.body;
    if (typeof req.body === 'object' && req.body !== null) {
        const keys = Object.keys(req.body);
        if (keys.length === 1 && keys[0].includes('<?xml')) {
            bodyText = keys[0] + '=' + req.body[keys[0]];
        }
    }
    const isXML = bodyText.trim().startsWith('<?xml') || bodyText.includes('<request') || contentType.includes('xml');
    let isAirtel = false;
    if (!isXML) {
        if (typeof req.body === 'string') {
            const urlParams = new URLSearchParams(req.body);
            if (urlParams.has('MSISDN') || urlParams.has('userid') || urlParams.has('clean')) {
                isAirtel = true;
                parsedBody = {};
                urlParams.forEach((val, key) => {
                    parsedBody[key] = val;
                });
            }
        }
        else if (req.body && (req.body.MSISDN || req.body.userid || req.body.clean)) {
            isAirtel = true;
        }
    }
    if (isXML) {
        // ----------------------------------------------------
        // MTN USSD FLOW (XML)
        // ----------------------------------------------------
        try {
            const xml = bodyText;
            const typeMatch = xml.match(/<request\s+[^>]*type=["']([^"']+)["']/i);
            const requestType = typeMatch ? typeMatch[1].trim() : 'pull';
            const sessionId = parseXMLField(xml, 'sessionId');
            const msisdn = parseXMLField(xml, 'msisdn');
            if (!sessionId || !msisdn) {
                return res.status(400).send('Missing sessionId or msisdn');
            }
            // Cleanup Request
            if (requestType === 'cleanup') {
                yield prisma_1.default.ussdSession.deleteMany({ where: { sessionId } });
                return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response>
  <status>cleaned</status>
</response>`);
            }
            const subscriberInput = parseXMLField(xml, 'subscriberInput');
            const newRequest = parseXMLField(xml, 'newRequest'); // '1' or '0'
            let text = '';
            if (newRequest === '1') {
                // Clear any old session
                yield prisma_1.default.ussdSession.deleteMany({ where: { sessionId } });
                yield prisma_1.default.ussdSession.create({
                    data: { sessionId, phoneNumber: msisdn, accumulatedText: '' }
                });
                text = '';
            }
            else {
                // Continuing request
                let session = yield prisma_1.default.ussdSession.findUnique({ where: { sessionId } });
                if (!session) {
                    session = yield prisma_1.default.ussdSession.create({
                        data: { sessionId, phoneNumber: msisdn, accumulatedText: '' }
                    });
                }
                let newText = '';
                if (session.accumulatedText) {
                    newText = `${session.accumulatedText}*${subscriberInput}`;
                }
                else {
                    newText = subscriberInput;
                }
                yield prisma_1.default.ussdSession.update({
                    where: { sessionId },
                    data: { accumulatedText: newText }
                });
                text = newText;
            }
            // Call original core logic
            const mockReq = {
                body: {
                    sessionId,
                    phoneNumber: msisdn,
                    serviceCode: '*123#',
                    text
                }
            };
            const capture = new USSDResponseCapture();
            yield (0, exports.handleUSSDRequestCore)(mockReq, capture);
            const responseString = capture.sentText;
            let freeflowState = 'FC'; // Default: continue
            let displayMessage = responseString;
            if (responseString.startsWith('CON ')) {
                freeflowState = 'FC';
                displayMessage = responseString.substring(4);
            }
            else if (responseString.startsWith('END ')) {
                freeflowState = 'FB';
                displayMessage = responseString.substring(4);
                // Clean up session since it's ended
                yield prisma_1.default.ussdSession.deleteMany({ where: { sessionId } });
            }
            // Build XML Response
            const responseXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response>
    <msisdn>${msisdn}</msisdn>
    <sessionid>${sessionId}</sessionid>
    <freeflow>
        <freeflowState>${freeflowState}</freeflowState>
    </freeflow>
    <applicationResponse>${displayMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</applicationResponse>
</response>`;
            return res.type('application/xml').status(200).send(responseXml);
        }
        catch (err) {
            console.error('MTN USSD Error:', err);
            return res.status(200).type('application/xml').send(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response>
    <freeflow>
        <freeflowState>FB</freeflowState>
    </freeflow>
    <applicationResponse>System error. Please try again later.</applicationResponse>
</response>`);
        }
    }
    else if (isAirtel) {
        // ----------------------------------------------------
        // AIRTEL USSD FLOW (Form URL-encoded)
        // ----------------------------------------------------
        try {
            const { MSISDN, input, clean, MSC } = parsedBody;
            if (!MSISDN) {
                return res.status(400).send('Missing MSISDN');
            }
            const airtelSessionId = `airtel-${MSISDN}`;
            // Cleanup Request
            if (clean === 'clean-session') {
                yield prisma_1.default.ussdSession.deleteMany({ where: { sessionId: airtelSessionId } });
                res.setHeader('Expires', '-1');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Cache-Control', 'max-age=0');
                return res.status(200).send('');
            }
            // Detect first request: either no session exists, or the input is root dial code (e.g. starts with * or equals 121)
            let session = yield prisma_1.default.ussdSession.findUnique({ where: { sessionId: airtelSessionId } });
            const isFirstRequest = !session || (input && (input.startsWith('*') || input === '121'));
            let text = '';
            if (isFirstRequest) {
                yield prisma_1.default.ussdSession.deleteMany({ where: { sessionId: airtelSessionId } });
                yield prisma_1.default.ussdSession.create({
                    data: { sessionId: airtelSessionId, phoneNumber: MSISDN, accumulatedText: '' }
                });
                text = '';
            }
            else {
                // Continuing request
                if (!session) {
                    session = yield prisma_1.default.ussdSession.create({
                        data: { sessionId: airtelSessionId, phoneNumber: MSISDN, accumulatedText: '' }
                    });
                }
                let newText = '';
                if (session.accumulatedText) {
                    newText = `${session.accumulatedText}*${input}`;
                }
                else {
                    newText = input;
                }
                yield prisma_1.default.ussdSession.update({
                    where: { sessionId: airtelSessionId },
                    data: { accumulatedText: newText }
                });
                text = newText;
            }
            // Call original core logic
            const mockReq = {
                body: {
                    sessionId: airtelSessionId,
                    phoneNumber: MSISDN,
                    serviceCode: MSC || '*121#',
                    text
                }
            };
            const capture = new USSDResponseCapture();
            yield (0, exports.handleUSSDRequestCore)(mockReq, capture);
            const responseString = capture.sentText;
            let freeflowState = 'FC'; // Default: continue
            let displayMessage = responseString;
            if (responseString.startsWith('CON ')) {
                freeflowState = 'FC';
                displayMessage = responseString;
            }
            else if (responseString.startsWith('END ')) {
                freeflowState = 'FB';
                displayMessage = responseString;
                yield prisma_1.default.ussdSession.deleteMany({ where: { sessionId: airtelSessionId } });
            }
            // Set Airtel headers
            res.setHeader('Freeflow', freeflowState);
            res.setHeader('Expires', '-1');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Cache-Control', 'max-age=0');
            res.type('text/plain');
            return res.status(200).send(displayMessage);
        }
        catch (err) {
            console.error('Airtel USSD Error:', err);
            res.setHeader('Freeflow', 'FB');
            return res.status(200).type('text/plain').send('System error. Please try again later.');
        }
    }
    else {
        // ----------------------------------------------------
        // FALLBACK (JSON/Postman) FLOW
        // ----------------------------------------------------
        return (0, exports.handleUSSDRequestCore)(req, res);
    }
});
exports.handleUSSDRequest = handleUSSDRequest;
