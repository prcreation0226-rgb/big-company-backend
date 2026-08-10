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
exports.handleIntouchSMSWebhook = exports.handlePalmKashWebhook = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const email_queue_1 = require("../queues/email.queue");
const handlePalmKashWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        // DEBUG LOG Payload
        console.log('--- [PalmKash Webhook Received] ---');
        console.log('Body:', JSON.stringify(req.body, null, 2));
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        console.log('-----------------------------------');
        const { reference, status, transaction_id, amount, client_reference } = req.body;
        // PalmKash might use client_reference if that's what we sent
        const activeReference = client_reference || reference;
        console.log(`📎 [Webhook] Processing PalmKash update. Ref: ${activeReference}, ID: ${transaction_id}, Status: ${status}`);
        if (!activeReference) {
            console.warn('⚠️ [Webhook] Missing reference in payload');
            return res.status(400).json({ success: false, message: 'Missing reference' });
        }
        // Official PalmKash status is usually 'SUCCESS' or 'FAILED' or 'PENDING'
        const normalizedStatus = String(status || '').toLowerCase();
        const isSuccess = ['success', 'completed', 'approved', 'successful'].includes(normalizedStatus);
        if (!isSuccess) {
            console.log(`ℹ️ [Webhook] Transaction ${activeReference} is not successful (Status: ${status}).`);
            if (activeReference && (activeReference.startsWith('ORD-') || activeReference.startsWith('POS-'))) {
                const sale = yield prisma_1.default.sale.findFirst({
                    where: { meterId: activeReference }
                });
                if (sale && sale.status === 'pending_payment') {
                    console.log(`[Webhook] Cancelling sale ${sale.id} due to failed/cancelled payment.`);
                    yield prisma_1.default.sale.update({
                        where: { id: sale.id },
                        data: {
                            status: 'cancelled',
                            cancellationReason: `Payment failed/cancelled via Mobile Money (Status: ${status})`
                        }
                    });
                }
            }
            else if (activeReference && activeReference.startsWith('WHL-')) {
                const order = yield prisma_1.default.order.findFirst({
                    where: { notes: activeReference }
                });
                if (order && order.status === 'pending_payment') {
                    console.log(`[Webhook] Cancelling wholesale order ${order.id} due to failed/cancelled payment.`);
                    yield prisma_1.default.order.update({
                        where: { id: order.id },
                        data: {
                            status: 'cancelled'
                        }
                    });
                }
            }
            return res.json({ success: true, message: 'Status recognized' });
        }
        // 1. Identify what this is (TOPUP, GAS, ORD, POS)
        if (activeReference.startsWith('TOPUP-') || activeReference.startsWith('RTOP-') || activeReference.startsWith('TEST-')) {
            // Wallet Topup
            // Find by exact reference (what we sent to PalmKash as referenceId)
            const transaction = yield prisma_1.default.walletTransaction.findFirst({
                where: { reference: activeReference, status: 'pending' }
            });
            if (transaction && transaction.status === 'pending') {
                console.log(`✅ [Webhook] Completing wallet topup for reference: ${activeReference}`);
                // Determine if it's Retailer or Consumer based on fields
                if (transaction.retailerId) {
                    yield prisma_1.default.$transaction([
                        prisma_1.default.walletTransaction.update({
                            where: { id: transaction.id },
                            data: { status: 'completed' }
                        }),
                        prisma_1.default.retailerProfile.update({
                            where: { id: transaction.retailerId },
                            data: { walletBalance: { increment: transaction.amount } }
                        })
                    ]);
                    // Notify Retailer of successful recharge (PRD 2.A.ii)
                    const retailer = yield prisma_1.default.retailerProfile.findUnique({
                        where: { id: transaction.retailerId },
                        include: { user: true }
                    });
                    if ((_a = retailer === null || retailer === void 0 ? void 0 : retailer.user) === null || _a === void 0 ? void 0 : _a.email) {
                        yield email_queue_1.emailQueue.add('wallet-recharge-success', {
                            to: retailer.user.email,
                            templateType: 'wallet-topup-success', // Mapped to RET-EMAIL-006
                            data: {
                                retail_name: retailer.shopName,
                                amount: transaction.amount.toLocaleString(),
                                new_balance: retailer.walletBalance.toLocaleString(),
                                transaction_id: activeReference,
                                topup_date: new Date().toLocaleDateString()
                            },
                            relatedEntity: { type: 'TRANSACTION', id: transaction.id.toString() }
                        });
                    }
                }
                else if (transaction.walletId) {
                    const wallet = yield prisma_1.default.wallet.findUnique({
                        where: { id: transaction.walletId }
                    });
                    if (wallet) {
                        yield prisma_1.default.$transaction([
                            prisma_1.default.walletTransaction.update({
                                where: { id: transaction.id },
                                data: { status: 'completed' }
                            }),
                            prisma_1.default.wallet.update({
                                where: { id: transaction.walletId },
                                data: { balance: { increment: transaction.amount } }
                            }),
                            prisma_1.default.consumerProfile.update({
                                where: { id: wallet.consumerId },
                                data: { walletBalance: { increment: transaction.amount } }
                            })
                        ]);
                    }
                    // Notify Consumer of successful wallet top-up via webhook payment gateway (CUS-EMAIL-003 & CUS-SMS-003)
                    try {
                        const wallet = yield prisma_1.default.wallet.findUnique({
                            where: { id: transaction.walletId },
                            include: { consumerProfile: { include: { user: true } } }
                        });
                        if ((_b = wallet === null || wallet === void 0 ? void 0 : wallet.consumerProfile) === null || _b === void 0 ? void 0 : _b.user) {
                            const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
                            // 1. Send SMS (customer-wallet-topup -> CUS-SMS-003)
                            const smsDestination = wallet.consumerProfile.user.phone;
                            if (smsDestination) {
                                yield emailQueue.add('customer-wallet-topup-sms', {
                                    to: smsDestination,
                                    templateType: 'customer-wallet-topup',
                                    data: {
                                        customer_name: wallet.consumerProfile.fullName || wallet.consumerProfile.user.name || 'Customer',
                                        amount: transaction.amount.toLocaleString(),
                                        new_balance: wallet.balance.toLocaleString(),
                                        transaction_id: activeReference
                                    },
                                    relatedEntity: { type: 'WALLET_TRANSACTION', id: transaction.id.toString() }
                                });
                            }
                            // 2. Send Email (customer-wallet-topup-email -> CUS-EMAIL-003)
                            if (wallet.consumerProfile.user.email) {
                                yield emailQueue.add('customer-wallet-topup-email', {
                                    to: wallet.consumerProfile.user.email,
                                    templateType: 'customer-wallet-topup-email',
                                    data: {
                                        customer_name: wallet.consumerProfile.fullName || wallet.consumerProfile.user.name || 'Customer',
                                        amount: transaction.amount.toLocaleString(),
                                        new_balance: wallet.balance.toLocaleString(),
                                        transaction_id: activeReference
                                    },
                                    relatedEntity: { type: 'WALLET_TRANSACTION', id: transaction.id.toString() }
                                });
                            }
                        }
                    }
                    catch (err) {
                        console.error('[Webhook] Consumer topup notification failed:', err);
                    }
                }
            }
            else {
                console.log(`ℹ️ [Webhook] Transaction ${activeReference} already processed or not found.`);
            }
        }
        else if (activeReference.startsWith('GASRCH-')) {
            const txRecord = yield prisma_1.default.gasRechargeTransaction.findFirst({
                where: { apiReference: activeReference }
            });
            if (txRecord && txRecord.status === 'PENDING_PAYMENT') {
                console.log(`✅ [Webhook] Completing gas meter recharge for reference: ${activeReference}`);
                const parts = activeReference.split('-');
                const meterType = parts[1]; // TOKEN or PIPING
                const provider = isNaN(Number(parts[2])) ? parts[2] : 'stronpower'; // zhongyi or stronpower
                const config = yield prisma_1.default.systemConfig.findFirst();
                const gasPrice = (config === null || config === void 0 ? void 0 : config.gasPricePerM3) || Number(process.env.GAS_PRICE_PER_M3) || 1500;
                const rawVolume = txRecord.isVendByUnit ? txRecord.amount : (txRecord.amount / gasPrice);
                const totalVolume = Math.floor(rawVolume * 10) / 10;
                let apiResult;
                try {
                    if (provider === 'zhongyi') {
                        const { default: zhongyiMeterService } = yield Promise.resolve().then(() => __importStar(require('../services/zhongyiMeter.service')));
                        console.log(`[Webhook GasRecharge] Routing ${meterType} recharge via Zhongyi API (Volume: ${totalVolume})`);
                        apiResult = yield zhongyiMeterService.rechargeMeter({
                            meterNumber: txRecord.meterNumber,
                            amount: totalVolume,
                            customerRef: activeReference,
                            isVendByUnit: true
                        });
                    }
                    else {
                        const { default: tokenMeterService } = yield Promise.resolve().then(() => __importStar(require('../services/tokenMeter.service')));
                        console.log(`[Webhook GasRecharge] Routing ${meterType} recharge via Stronpower API (Volume: ${totalVolume})`);
                        apiResult = yield tokenMeterService.rechargeTokenMeter({
                            meterNumber: txRecord.meterNumber,
                            amount: totalVolume,
                            customerRef: activeReference,
                            isVendByUnit: true
                        });
                    }
                    let meter = yield prisma_1.default.gasMeter.findFirst({
                        where: {
                            OR: [
                                { meterNumber: txRecord.meterNumber },
                                { meterNumber: `MTR-${txRecord.meterNumber}` },
                                { meterNumber: txRecord.meterNumber.replace(/^MTR-/i, '') }
                            ]
                        }
                    });
                    // Auto-Register meter if it does not exist but exists in GPRS mappings
                    if (!meter) {
                        try {
                            const { gprsMapping } = yield Promise.resolve().then(() => __importStar(require('../config/gprsMapping')));
                            const matchedMapping = gprsMapping.find(m => m.meterNo === txRecord.meterNumber || m.meterNo === txRecord.meterNumber.replace(/^MTR-/i, ''));
                            if (matchedMapping && txRecord.customerId) {
                                console.log(`[Webhook GasRecharge] Auto-registering matched GPRS meter ${txRecord.meterNumber} for consumer ${txRecord.customerId}...`);
                                meter = yield prisma_1.default.gasMeter.create({
                                    data: {
                                        consumerId: txRecord.customerId,
                                        meterNumber: matchedMapping.meterNo,
                                        imei: matchedMapping.imei,
                                        serialNo: matchedMapping.serialNo,
                                        meterKey: matchedMapping.meterKey,
                                        isGprs: true,
                                        meterType: 'TOKEN',
                                        status: 'active'
                                    }
                                });
                            }
                        }
                        catch (lookupErr) {
                            console.error('[Webhook GasRecharge] Error during meter lookup/registration:', lookupErr.message);
                        }
                    }
                    let pushResult = { success: true, error: null };
                    if (apiResult.success && meter && meter.imei && apiResult.token) {
                        const { default: pipingMeterService } = yield Promise.resolve().then(() => __importStar(require('../services/pipingMeter.service')));
                        console.log(`[Webhook GasRecharge] Meter ${txRecord.meterNumber} has IMEI ${meter.imei}. Triggering remote token push...`);
                        try {
                            const pushRes = yield pipingMeterService.pushTokenToImei(meter.imei, apiResult.token);
                            if (pushRes && !pushRes.success) {
                                pushResult.success = false;
                                pushResult.error = pushRes.error || 'Remote push rejected by GPRS management system';
                            }
                        }
                        catch (pushErr) {
                            pushResult.success = false;
                            pushResult.error = pushErr.message || 'Remote push connection error';
                        }
                    }
                    const isFullySuccessful = apiResult.success && pushResult.success;
                    const finalStatus = isFullySuccessful ? 'SUCCESS' : 'FAILED';
                    const finalErrorMsg = isFullySuccessful ? null : (pushResult.error || apiResult.error || 'Meter recharge failed');
                    yield prisma_1.default.gasRechargeTransaction.update({
                        where: { id: txRecord.id },
                        data: {
                            status: finalStatus,
                            tokenValue: apiResult.token || null,
                            errorMessage: finalErrorMsg
                        }
                    });
                    if (isFullySuccessful) {
                        let retailerId = 1;
                        if (txRecord.operatorId) {
                            const rp = yield prisma_1.default.retailerProfile.findFirst({ where: { userId: txRecord.operatorId } });
                            if (rp)
                                retailerId = rp.id;
                        }
                        // Update corresponding GasTopup status to completed or create if not exists (USSD flow)
                        const existingTopup = yield prisma_1.default.gasTopup.findFirst({
                            where: { orderId: String(txRecord.id) }
                        });
                        if (existingTopup) {
                            yield prisma_1.default.gasTopup.update({
                                where: { id: existingTopup.id },
                                data: {
                                    status: 'completed',
                                    units: Number(apiResult.units) || totalVolume
                                }
                            });
                        }
                        else if (txRecord.customerId && meter) {
                            yield prisma_1.default.gasTopup.create({
                                data: {
                                    consumerId: txRecord.customerId,
                                    meterId: meter.id,
                                    amount: txRecord.amount,
                                    units: Number(apiResult.units) || totalVolume,
                                    status: 'completed',
                                    orderId: String(txRecord.id)
                                }
                            });
                        }
                        // Update GasMeter currentUnits
                        if (meter) {
                            yield prisma_1.default.gasMeter.update({
                                where: { id: meter.id },
                                data: {
                                    currentUnits: {
                                        increment: Number(apiResult.units) || totalVolume
                                    }
                                }
                            });
                        }
                        yield prisma_1.default.sale.create({
                            data: {
                                consumerId: txRecord.customerId || undefined,
                                retailerId: retailerId,
                                totalAmount: txRecord.amount,
                                status: 'completed',
                                paymentMethod: txRecord.paymentMethod,
                                meterId: txRecord.meterNumber
                            }
                        });
                        try {
                            const consumer = yield prisma_1.default.consumerProfile.findFirst({
                                where: { id: txRecord.customerId || undefined },
                                include: { user: true }
                            });
                            if (consumer) {
                                const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
                                const smsDestination = txRecord.paymentPhone || consumer.user.phone || consumer.user.email || '';
                                yield emailQueue.add('gas-recharge-success', {
                                    to: smsDestination,
                                    templateType: 'gas-recharge-success',
                                    data: {
                                        customer_name: consumer.fullName || consumer.user.name || 'Valued Customer',
                                        meter_name: 'Gas Meter',
                                        meter_id: txRecord.meterNumber,
                                        amount: txRecord.amount.toLocaleString(),
                                        token: apiResult.token || 'Remote GPRS Topup',
                                        transaction_id: txRecord.id.toString(),
                                        volume: totalVolume
                                    },
                                    relatedEntity: { type: 'USER', id: consumer.userId.toString() }
                                });
                                if (consumer.user.email) {
                                    yield emailQueue.add('customer-gas-recharge-email', {
                                        to: consumer.user.email,
                                        templateType: 'customer-gas-recharge-email',
                                        data: {
                                            customer_name: consumer.fullName || consumer.user.name || 'Valued Customer',
                                            meter_name: 'Gas Meter',
                                            meter_id: txRecord.meterNumber,
                                            amount: txRecord.amount.toLocaleString(),
                                            token: apiResult.token || 'Remote GPRS Topup',
                                            transaction_id: txRecord.id.toString(),
                                            volume: totalVolume
                                        },
                                        relatedEntity: { type: 'USER', id: consumer.userId.toString() }
                                    });
                                }
                            }
                        }
                        catch (notifyErr) {
                            console.error('Failed to trigger gas recharge notification:', notifyErr);
                        }
                    }
                }
                catch (err) {
                    console.error('[Webhook GasRecharge Error]:', err.message);
                    yield prisma_1.default.gasRechargeTransaction.update({
                        where: { id: txRecord.id },
                        data: {
                            status: 'FAILED',
                            errorMessage: err.message
                        }
                    });
                }
            }
        }
        else if (activeReference.startsWith('GAS-')) {
            const order = yield prisma_1.default.customerOrder.findFirst({
                where: { metadata: { contains: activeReference } }
            });
            if (order && order.status === 'pending') {
                console.log(`✅ [Webhook] Completing gas topup for reference: ${activeReference}`);
                const initialTopup = yield prisma_1.default.gasTopup.findFirst({
                    where: { orderId: order.id.toString() },
                    include: { gasMeter: true, consumerProfile: { include: { user: true } } }
                });
                if (initialTopup && initialTopup.gasMeter) {
                    const meter = initialTopup.gasMeter;
                    const consumerProfile = initialTopup.consumerProfile;
                    const isGprsMeter = meter.meterType === 'PIPING' || meter.isGprs;
                    let token = '';
                    try {
                        if (isGprsMeter) {
                            yield prisma_1.default.gasTopup.update({
                                where: { id: initialTopup.id },
                                data: { status: 'Sent to Meter' }
                            });
                            const LorawanService = require('../services/gasLorawanService');
                            const loraResult = yield LorawanService.rechargeMeter(meter.meterNumber, initialTopup.amount);
                            if (loraResult.success) {
                                token = `GPRS-${loraResult.orderId}`;
                                let statusText = 'Sent to Meter';
                                try {
                                    yield new Promise(resolve => setTimeout(resolve, 3000));
                                    const statusResult = yield LorawanService.getRechargeStatus(loraResult.orderId);
                                    if (statusResult.success && statusResult.status === 2) {
                                        statusText = 'Recharge successful';
                                    }
                                }
                                catch (e) {
                                    console.error('[Webhook] Polling acknowledgment error:', e);
                                }
                                yield prisma_1.default.gasTopup.update({
                                    where: { id: initialTopup.id },
                                    data: { status: statusText, orderId: token }
                                });
                            }
                            else {
                                console.error(`[Webhook] GPRS Meter Recharge failed: ${loraResult.error}`);
                                yield prisma_1.default.gasTopup.update({
                                    where: { id: initialTopup.id },
                                    data: { status: 'Failed' }
                                });
                            }
                        }
                        else {
                            const { default: tokenMeterService } = yield Promise.resolve().then(() => __importStar(require('../services/tokenMeter.service')));
                            const tokenResult = yield tokenMeterService.rechargeTokenMeter({
                                meterNumber: meter.meterNumber,
                                amount: initialTopup.amount,
                                customerRef: order.id.toString()
                            });
                            if (tokenResult.success) {
                                token = tokenResult.token;
                                yield prisma_1.default.gasTopup.update({
                                    where: { id: initialTopup.id },
                                    data: { status: 'Sent to Meter', orderId: token }
                                });
                            }
                            else {
                                console.error(`[Webhook] STS API recharge failed: ${tokenResult.error}`);
                                yield prisma_1.default.gasTopup.update({
                                    where: { id: initialTopup.id },
                                    data: { status: 'Failed' }
                                });
                            }
                        }
                        yield prisma_1.default.customerOrder.update({
                            where: { id: order.id },
                            data: { status: 'completed' }
                        });
                        if (token) {
                            try {
                                const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
                                let paymentPhone = null;
                                if (order.metadata) {
                                    try {
                                        const meta = JSON.parse(order.metadata);
                                        if (meta && meta.paymentPhone) {
                                            paymentPhone = meta.paymentPhone;
                                        }
                                    }
                                    catch (e) {
                                        console.error('Failed to parse order metadata for paymentPhone:', e);
                                    }
                                }
                                const smsDestination = paymentPhone || consumerProfile.user.phone;
                                yield emailQueue.add('gas-recharge-success', {
                                    to: smsDestination,
                                    templateType: 'gas-recharge-success',
                                    data: {
                                        customer_name: consumerProfile.fullName || consumerProfile.user.name || 'Valued Customer',
                                        meter_name: meter.aliasName || 'Meter',
                                        meter_id: meter.meterNumber,
                                        amount: initialTopup.amount.toLocaleString(),
                                        token: token,
                                        transaction_id: order.id.toString(),
                                        volume: initialTopup.units
                                    },
                                    relatedEntity: { type: 'USER', id: consumerProfile.userId.toString() }
                                });
                                if (consumerProfile.user.email) {
                                    yield emailQueue.add('customer-gas-recharge-email', {
                                        to: consumerProfile.user.email,
                                        templateType: 'customer-gas-recharge-email',
                                        data: {
                                            customer_name: consumerProfile.fullName || consumerProfile.user.name || 'Valued Customer',
                                            meter_name: meter.aliasName || 'Meter',
                                            meter_id: meter.meterNumber,
                                            amount: initialTopup.amount.toLocaleString(),
                                            token: token,
                                            transaction_id: order.id.toString(),
                                            volume: initialTopup.units
                                        },
                                        relatedEntity: { type: 'USER', id: consumerProfile.userId.toString() }
                                    });
                                }
                            }
                            catch (notifyErr) {
                                console.error('[Webhook] Gas recharge notification trigger failed:', notifyErr);
                            }
                        }
                    }
                    catch (rechargeErr) {
                        console.error('[Webhook] Gas recharge api exception:', rechargeErr);
                        yield prisma_1.default.gasTopup.update({
                            where: { id: initialTopup.id },
                            data: { status: 'Failed' }
                        });
                    }
                }
            }
        }
        else if (activeReference.startsWith('ORD-') || activeReference.startsWith('POS-')) {
            // Retail Order or POS Sale
            // meterId now stores our own ORD-/POS- reference (reliable), not PalmKash's transactionId
            const sale = yield prisma_1.default.sale.findFirst({
                where: { meterId: activeReference },
                include: { saleItems: { include: { product: true } } }
            });
            if (sale && (sale.status === 'pending' || sale.status === 'pending_payment')) {
                console.log(`✅ [Webhook] Completing sale for reference: ${activeReference}`);
                yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    // 1. Update status
                    yield tx.sale.update({
                        where: { id: sale.id },
                        data: { status: activeReference.startsWith('POS-') ? 'completed' : 'pending' }
                    });
                    // 2. Decrement Stock
                    for (const item of sale.saleItems) {
                        yield tx.product.update({
                            where: { id: item.productId },
                            data: { stock: { decrement: item.quantity } }
                        });
                    }
                    // 3. Process Gas Reward
                    if (sale.notes) {
                        try {
                            const meta = JSON.parse(sale.notes);
                            const { gasRewardWalletId, rewardConsumerId, consumerId } = meta;
                            const targetRewardId = gasRewardWalletId;
                            const targetConsumerId = rewardConsumerId || consumerId;
                            if (targetRewardId && targetConsumerId) {
                                // Calculate Profit
                                let totalProfit = 0;
                                for (const item of sale.saleItems) {
                                    if (item.product && item.product.costPrice != null) {
                                        let sellingPrice = Number(item.price);
                                        if (item.product.taxType === 'B') {
                                            sellingPrice = sellingPrice / 1.18;
                                        }
                                        const profitPerItem = sellingPrice - Number(item.product.costPrice);
                                        if (profitPerItem > 0) {
                                            totalProfit += profitPerItem * Number(item.quantity);
                                        }
                                    }
                                }
                                if (totalProfit > 0) {
                                    const config = yield tx.systemConfig.findFirst();
                                    const gasPrice = (config === null || config === void 0 ? void 0 : config.gasPricePerM3) || 6500;
                                    const gasRewardShare = (config === null || config === void 0 ? void 0 : config.gasRewardShare) !== undefined ? config.gasRewardShare / 100 : 0.12;
                                    const rewardAmountRWF = totalProfit * gasRewardShare;
                                    const rewardUnits = Number((rewardAmountRWF / gasPrice).toFixed(4));
                                    if (rewardUnits > 0) {
                                        yield tx.gasReward.create({
                                            data: {
                                                consumerId: targetConsumerId,
                                                saleId: sale.id,
                                                meterId: targetRewardId,
                                                units: rewardUnits,
                                                profitAmount: totalProfit,
                                                source: activeReference.startsWith('POS-') ? 'pos_reward' : 'purchase_reward',
                                                reference: `Reward for Sale #${sale.id}`
                                            }
                                        });
                                    }
                                }
                            }
                        }
                        catch (parseErr) {
                            console.error('Failed to process gas reward metadata in webhook:', parseErr);
                        }
                    }
                }));
                // Trigger Gas Reward Notifications (CUS-SMS-006 & CUS-EMAIL-006)
                try {
                    if (sale.notes) {
                        const meta = JSON.parse(sale.notes);
                        const targetConsumerId = meta.rewardConsumerId || meta.consumerId;
                        if (targetConsumerId) {
                            const consumer = yield prisma_1.default.consumerProfile.findUnique({
                                where: { id: targetConsumerId },
                                include: { user: true, gasRewards: true }
                            });
                            if (consumer) {
                                const latestReward = yield prisma_1.default.gasReward.findFirst({
                                    where: { consumerId: consumer.id, saleId: sale.id },
                                    orderBy: { id: 'desc' }
                                });
                                if (latestReward && latestReward.units > 0) {
                                    const totalUnits = consumer.gasRewards.reduce((sum, r) => sum + r.units, 0);
                                    const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
                                    // 1. Send SMS (gas-reward-update -> CUS-SMS-006)
                                    if ((_c = consumer.user) === null || _c === void 0 ? void 0 : _c.phone) {
                                        yield emailQueue.add('gas-reward-update', {
                                            to: consumer.user.phone,
                                            templateType: 'gas-reward-update',
                                            data: {
                                                customer_name: consumer.fullName || consumer.user.name || 'Customer',
                                                reward_amount: latestReward.units.toString(),
                                                new_reward_balance: totalUnits.toFixed(4)
                                            },
                                            relatedEntity: { type: 'GAS_REWARD', id: latestReward.id.toString() }
                                        });
                                    }
                                    // 2. Send Email (customer-reward-update-email -> CUS-EMAIL-006)
                                    if ((_d = consumer.user) === null || _d === void 0 ? void 0 : _d.email) {
                                        yield emailQueue.add('customer-reward-update-email', {
                                            to: consumer.user.email,
                                            templateType: 'customer-reward-update-email',
                                            data: {
                                                customer_name: consumer.fullName || consumer.user.name || 'Customer',
                                                reward_amount: latestReward.units.toString(),
                                                new_reward_balance: totalUnits.toFixed(4)
                                            },
                                            relatedEntity: { type: 'GAS_REWARD', id: latestReward.id.toString() }
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                catch (notifyErr) {
                    console.error('Failed to trigger gas reward notification in webhook:', notifyErr);
                }
                // 4. Low stock alerts (Post-transaction event)
                try {
                    for (const item of sale.saleItems) {
                        const updatedProduct = yield prisma_1.default.product.findUnique({
                            where: { id: item.productId },
                            include: { retailerProfile: { include: { user: true } } }
                        });
                        if (updatedProduct) {
                            const threshold = updatedProduct.lowStockThreshold || 10;
                            if (updatedProduct.stock <= 0 && ((_f = (_e = updatedProduct.retailerProfile) === null || _e === void 0 ? void 0 : _e.user) === null || _f === void 0 ? void 0 : _f.email)) {
                                yield email_queue_1.emailQueue.add('out-of-stock-alert', {
                                    to: updatedProduct.retailerProfile.user.email,
                                    templateType: 'out-of-stock',
                                    data: {
                                        product: updatedProduct.name,
                                        retailer_name: updatedProduct.retailerProfile.shopName
                                    },
                                    relatedEntity: { type: 'PRODUCT', id: updatedProduct.id.toString() }
                                });
                            }
                            else if (updatedProduct.stock <= threshold && ((_h = (_g = updatedProduct.retailerProfile) === null || _g === void 0 ? void 0 : _g.user) === null || _h === void 0 ? void 0 : _h.email)) {
                                yield email_queue_1.emailQueue.add('low-stock-alert', {
                                    to: updatedProduct.retailerProfile.user.email,
                                    templateType: 'low-stock',
                                    data: {
                                        product: updatedProduct.name,
                                        remaining_quantity: updatedProduct.stock,
                                        retailer_name: updatedProduct.retailerProfile.shopName
                                    },
                                    relatedEntity: { type: 'PRODUCT', id: updatedProduct.id.toString() }
                                });
                            }
                        }
                    }
                }
                catch (alertErr) {
                    console.error('Failed to trigger low stock alerts in webhook:', alertErr);
                }
            }
        }
        else if (activeReference.startsWith('WHL-')) {
            // notes stores our own WHL-xxx reference set at order creation (reliable exact match)
            const order = yield prisma_1.default.order.findFirst({
                where: { notes: activeReference, status: 'pending_payment' }
            });
            if (order) {
                console.log(`✅ [Webhook] Completing wholesale order for reference: ${activeReference}`);
                yield prisma_1.default.order.update({
                    where: { id: order.id },
                    data: { status: 'pending' }
                });
            }
        }
        else if (activeReference.startsWith('CREPAY-')) {
            // CREPAY reference in DB is stored as 'CREPAY-{loanId}-{activeReference}'
            // so we use 'contains' to match, but only on our own reference (not PalmKash's transaction_id)
            const transaction = yield prisma_1.default.walletTransaction.findFirst({
                where: { reference: { contains: activeReference }, status: 'pending' }
            });
            if (transaction && transaction.status === 'pending') {
                console.log(`✅ [Webhook] Completing customer loan repayment for reference: ${activeReference}`);
                const parts = transaction.reference.split('-');
                const loanId = Number(parts[1]);
                yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    var _a;
                    yield tx.walletTransaction.update({
                        where: { id: transaction.id },
                        data: { status: 'completed' }
                    });
                    const loan = yield tx.loan.findUnique({ where: { id: loanId } });
                    if (loan) {
                        const repayments = yield tx.walletTransaction.findMany({
                            where: {
                                type: 'loan_repayment_replenish',
                                status: 'completed',
                                OR: [
                                    { reference: loanId.toString() },
                                    { reference: { startsWith: `CREPAY-${loanId}-` } }
                                ]
                            }
                        });
                        const totalPaid = repayments.reduce((sum, t) => sum + t.amount, 0);
                        const config = yield tx.systemConfig.findFirst();
                        const rate = (_a = config === null || config === void 0 ? void 0 : config.customerLoanInterest) !== null && _a !== void 0 ? _a : 10;
                        const interestAmount = Math.round(loan.amount * (rate / 100));
                        const totalRepayable = loan.amount + interestAmount;
                        if (totalPaid >= totalRepayable) {
                            yield tx.loan.update({
                                where: { id: loanId },
                                data: { status: 'repaid' }
                            });
                        }
                    }
                }));
            }
        }
        else if (activeReference.startsWith('GCREPAY-')) {
            // Find by exact reference saved when payment was initiated
            const transaction = yield prisma_1.default.walletTransaction.findFirst({
                where: { reference: activeReference, status: 'pending' }
            });
            if (transaction && transaction.status === 'pending') {
                console.log(`✅ [Webhook] Completing retailer credit repayment for reference: ${activeReference}`);
                yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    var _a;
                    yield tx.walletTransaction.update({
                        where: { id: transaction.id },
                        data: { status: 'completed' }
                    });
                    const retailerProfile = yield tx.retailerProfile.findUnique({
                        where: { id: transaction.retailerId },
                        include: { user: true }
                    });
                    if (retailerProfile) {
                        const creditInfo = yield tx.retailerCredit.findUnique({ where: { retailerId: retailerProfile.id } });
                        if (creditInfo) {
                            const newUsedCredit = Math.max(0, creditInfo.usedCredit - transaction.amount);
                            const newAvailableCredit = Math.min(creditInfo.creditLimit, creditInfo.availableCredit + transaction.amount);
                            yield tx.retailerCredit.update({
                                where: { retailerId: retailerProfile.id },
                                data: {
                                    usedCredit: newUsedCredit,
                                    availableCredit: newAvailableCredit
                                }
                            });
                        }
                        if ((_a = retailerProfile.user) === null || _a === void 0 ? void 0 : _a.email) {
                            const updatedCreditInfo = yield tx.retailerCredit.findUnique({ where: { retailerId: retailerProfile.id } });
                            yield email_queue_1.emailQueue.add('credit-payment-confirmation', {
                                to: retailerProfile.user.email,
                                templateType: 'credit-payment-confirmation',
                                data: {
                                    retail_name: retailerProfile.shopName,
                                    paid_amount: transaction.amount.toLocaleString(),
                                    remaining_balance: ((updatedCreditInfo === null || updatedCreditInfo === void 0 ? void 0 : updatedCreditInfo.usedCredit) || 0).toLocaleString(),
                                    payment_date: new Date().toLocaleDateString(),
                                    transaction_id: transaction.reference
                                },
                                relatedEntity: { type: 'TRANSACTION', id: transaction.id.toString() }
                            });
                        }
                    }
                }));
            }
        }
        else if (activeReference.startsWith('WHL-')) {
            const order = yield prisma_1.default.order.findFirst({
                where: { notes: activeReference }
            });
            if (order && (order.status === 'pending' || order.status === 'pending_payment')) {
                console.log(`✅ [Webhook] Completing wholesale order for reference: ${activeReference}`);
                yield prisma_1.default.order.update({
                    where: { id: order.id },
                    data: { status: 'pending' }
                });
            }
        }
        else if (activeReference.startsWith('RREPAY-')) {
            // Retailer credit order repayment via MoMo
            // Reference format: RREPAY-{orderId}-{timestamp}
            console.log(`✅ [Webhook] Processing retailer order credit repayment for reference: ${activeReference}`);
            // Find the pending walletTransaction saved when payment was initiated
            const txRecord = yield prisma_1.default.walletTransaction.findFirst({
                where: { reference: activeReference, status: 'pending' }
            });
            if (txRecord && txRecord.retailerId) {
                // Extract orderId from reference: RREPAY-{orderId}-{timestamp}
                const parts = activeReference.split('-');
                const orderId = Number(parts[1]);
                yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    // Mark pending walletTransaction as completed
                    yield tx.walletTransaction.update({
                        where: { id: txRecord.id },
                        data: { status: 'completed' }
                    });
                    // Update retailer credit info
                    const creditInfo = yield tx.retailerCredit.findUnique({
                        where: { retailerId: txRecord.retailerId }
                    });
                    if (creditInfo) {
                        const newUsedCredit = Math.max(0, creditInfo.usedCredit - txRecord.amount);
                        const newAvailableCredit = Math.min(creditInfo.creditLimit, creditInfo.availableCredit + txRecord.amount);
                        yield tx.retailerCredit.update({
                            where: { retailerId: txRecord.retailerId },
                            data: { usedCredit: newUsedCredit, availableCredit: newAvailableCredit }
                        });
                    }
                    // Mark order as completed
                    const order = yield tx.order.findUnique({ where: { id: orderId } });
                    if (order && txRecord.amount >= Number(order.totalAmount)) {
                        yield tx.order.update({
                            where: { id: orderId },
                            data: { status: 'completed' }
                        });
                    }
                }));
                // Notify retailer via email
                const retailer = yield prisma_1.default.retailerProfile.findUnique({
                    where: { id: txRecord.retailerId },
                    include: { user: true }
                });
                if ((_j = retailer === null || retailer === void 0 ? void 0 : retailer.user) === null || _j === void 0 ? void 0 : _j.email) {
                    yield email_queue_1.emailQueue.add('credit-payment-confirmation', {
                        to: retailer.user.email,
                        templateType: 'credit-payment-confirmation',
                        data: {
                            retail_name: retailer.shopName,
                            paid_amount: txRecord.amount.toLocaleString(),
                            remaining_balance: '0',
                            payment_date: new Date().toLocaleDateString(),
                            transaction_id: activeReference
                        },
                        relatedEntity: { type: 'TRANSACTION', id: txRecord.id.toString() }
                    });
                }
            }
            else {
                console.warn(`⚠️ [Webhook] No pending RREPAY transaction found for reference: ${activeReference}`);
            }
        }
        else if (activeReference.startsWith('RLREPAY-')) {
            // Retailer loan repayment via MoMo
            // Reference format: RLREPAY-{loanId}-{timestamp}
            console.log(`✅ [Webhook] Processing retailer loan repayment for reference: ${activeReference}`);
            // Find the pending walletTransaction saved when payment was initiated
            const txRecord = yield prisma_1.default.walletTransaction.findFirst({
                where: { reference: activeReference, status: 'pending' }
            });
            if (txRecord && txRecord.retailerId) {
                // Extract loanId from reference: RLREPAY-{loanId}-{timestamp}
                const parts = activeReference.split('-');
                const loanId = Number(parts[1]);
                let newRemaining = 0;
                yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    // Mark the wallet transaction as completed
                    yield tx.walletTransaction.update({
                        where: { id: txRecord.id },
                        data: { status: 'completed' }
                    });
                    // Update the specific loan by ID
                    const loan = yield tx.retailerLoan.findUnique({ where: { id: loanId } });
                    if (loan) {
                        newRemaining = Math.max(0, loan.remainingAmount - txRecord.amount);
                        const newStatus = newRemaining === 0 ? 'paid' : 'active';
                        yield tx.retailerLoan.update({
                            where: { id: loan.id },
                            data: { remainingAmount: newRemaining, status: newStatus }
                        });
                    }
                }));
                // Notify retailer via email
                const retailer = yield prisma_1.default.retailerProfile.findUnique({
                    where: { id: txRecord.retailerId },
                    include: { user: true }
                });
                if ((_k = retailer === null || retailer === void 0 ? void 0 : retailer.user) === null || _k === void 0 ? void 0 : _k.email) {
                    yield email_queue_1.emailQueue.add('credit-payment-confirmation', {
                        to: retailer.user.email,
                        templateType: 'credit-payment-confirmation',
                        data: {
                            retail_name: retailer.shopName,
                            paid_amount: txRecord.amount.toLocaleString(),
                            remaining_balance: newRemaining.toLocaleString(),
                            payment_date: new Date().toLocaleDateString(),
                            transaction_id: activeReference
                        },
                        relatedEntity: { type: 'TRANSACTION', id: txRecord.id.toString() }
                    });
                }
            }
            else {
                console.warn(`⚠️ [Webhook] No pending RLREPAY transaction found for reference: ${activeReference}`);
            }
        }
        // Always respond with 200 to acknowledge
        res.json({ success: true });
    }
    catch (error) {
        console.error('❌ [Webhook Error]:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.handlePalmKashWebhook = handlePalmKashWebhook;
const handleIntouchSMSWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { messageid, status } = req.query;
        console.log(`📱 [IntouchSMS Webhook] Received DLR. MsgID: ${messageid}, Status: ${status}`);
        if (!messageid) {
            return res.status(400).send('Missing messageid');
        }
        // Map Intouch statuses to system status
        // P: Processed, D: Delivered, Q: Queued, E: Errored, S: Sent, U: Undelivered
        let systemStatus = 'SENT';
        if (status === 'D')
            systemStatus = 'DELIVERED';
        if (status === 'E' || status === 'U')
            systemStatus = 'FAILED';
        if (status === 'P' || status === 'Q')
            systemStatus = 'PENDING';
        // Find the log entry by external message ID
        const searchCriteria = { externalMessageId: messageid.toString() };
        const log = yield prisma_1.default.systemEmailLog.findFirst({
            where: searchCriteria
        });
        if (log) {
            yield prisma_1.default.systemEmailLog.update({
                where: { id: log.id },
                data: {
                    status: systemStatus,
                    errorMessage: status === 'E' || status === 'U' ? `Gateway reported status: ${status}` : null
                }
            });
            console.log(`✅ [IntouchSMS Webhook] Updated log ${log.id} to ${systemStatus}`);
        }
        else {
            console.warn(`⚠️ [IntouchSMS Webhook] No log found for messageid: ${messageid}`);
        }
        // Intouch expects 200 OK
        res.status(200).send('OK');
    }
    catch (error) {
        console.error('❌ [IntouchSMS Webhook Error]:', error.message);
        res.status(500).send('Error');
    }
});
exports.handleIntouchSMSWebhook = handleIntouchSMSWebhook;
