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
exports.getOrderDetails = exports.getCustomerOrders = exports.getGasRewardsLeaderboard = exports.getGasRewardsHistory = exports.getGasRewardsBalance = exports.recordGasUsage = exports.getGasUsage = exports.topupGas = exports.removeGasMeter = exports.addGasMeter = exports.getGasMeters = exports.lookupMeter = exports.getGasConfig = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const pipingMeter_service_1 = __importDefault(require("../services/pipingMeter.service"));
const tokenMeter_service_1 = __importDefault(require("../services/tokenMeter.service"));
const gprsMapping_1 = require("../config/gprsMapping");
// Get gas configuration (price, etc)
const getGasConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Fetch live config from DB, fallback to env/default if not found
        const config = yield prisma_1.default.systemConfig.findFirst();
        const gasPrice = (config === null || config === void 0 ? void 0 : config.gasPricePerM3) || Number(process.env.GAS_PRICE_PER_M3) || 3250;
        res.json({
            success: true,
            data: {
                price_per_m3: gasPrice,
                min_topup: (config === null || config === void 0 ? void 0 : config.minGasTopup) || 500,
                max_topup: (config === null || config === void 0 ? void 0 : config.maxGasTopup) || 100000,
                gas_reward_share: (config === null || config === void 0 ? void 0 : config.gasRewardShare) || 12
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getGasConfig = getGasConfig;
// Lookup meter info (auto-fill)
const lookupMeter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { meter_number } = req.params;
        console.log(`[LOOKUP] Searching for meter: ${meter_number}`);
        if (!meter_number) {
            return res.status(400).json({ success: false, error: 'Meter number is required' });
        }
        // 1. Check local DB first (maybe it was registered before or exists in system)
        const localMeter = yield prisma_1.default.gasMeter.findFirst({
            where: { meterNumber: meter_number },
            orderBy: { createdAt: 'desc' }
        });
        if (localMeter) {
            return res.json({
                success: true,
                source: 'local',
                data: {
                    owner_name: localMeter.ownerName,
                    owner_phone: localMeter.ownerPhone,
                    meter_type: localMeter.meterType || 'PIPING'
                }
            });
        }
        // 2. If not local and looks like an IMEI (15 digits), try Energyy API
        if (meter_number.length >= 14 && /^\d+$/.test(meter_number)) {
            const remoteInfo = yield pipingMeter_service_1.default.getMeterInfo(meter_number);
            if (remoteInfo && (remoteInfo.errcode === 0 || remoteInfo.errcode === "0") && remoteInfo.value) {
                // Energyy API usually returns owner info in 'value' object
                // Note: Actual field names depend on Energyy API response
                return res.json({
                    success: true,
                    source: 'remote',
                    data: {
                        owner_name: remoteInfo.value.customerName || remoteInfo.value.ownerName || '',
                        owner_phone: remoteInfo.value.phone || remoteInfo.value.ownerPhone || '',
                        meter_type: 'PIPING'
                    }
                });
            }
        }
        res.status(404).json({ success: false, error: 'Meter information not found' });
    }
    catch (error) {
        console.error('Lookup meter error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.lookupMeter = lookupMeter;
// Get gas meters
const getGasMeters = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        let consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            consumerProfile = yield prisma_1.default.consumerProfile.create({
                data: {
                    userId,
                    walletBalance: 0,
                    rewardsPoints: 0,
                    isVerified: false,
                    membershipType: 'standard'
                }
            });
        }
        const meters = yield prisma_1.default.gasMeter.findMany({
            where: {
                consumerId: consumerProfile.id,
                status: { not: 'removed' }
            },
            include: {
                gasTopups: {
                    where: { status: 'completed' }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json({
            success: true,
            data: meters.map(m => {
                return {
                    id: m.id,
                    meter_number: m.meterNumber,
                    meter_key: m.meterKey,
                    serial_no: m.serialNo,
                    alias_name: m.aliasName,
                    owner_name: m.ownerName,
                    owner_phone: m.ownerPhone,
                    status: m.status,
                    meter_type: m.meterType || (m.isGprs ? 'PIPING' : 'TOKEN'),
                    current_units: m.currentUnits,
                    created_at: m.createdAt
                };
            })
        });
    }
    catch (error) {
        console.error('Get gas meters error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getGasMeters = getGasMeters;
// Add gas meter
const addGasMeter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { meter_number, alias_name, owner_name, owner_phone, meter_type, meter_key, serial_no } = req.body;
        if (!meter_number) {
            return res.status(400).json({ success: false, error: 'Meter number is required' });
        }
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        // Check if meter already exists for this consumer
        const existingMeter = yield prisma_1.default.gasMeter.findFirst({
            where: {
                meterNumber: meter_number,
                consumerId: consumerProfile.id
            }
        });
        if (existingMeter) {
            return res.status(400).json({ success: false, error: 'Meter number already registered' });
        }
        const matchedGprs = gprsMapping_1.gprsMapping.find(m => m.meterNo === meter_number || m.meterNo === meter_number.replace(/^MTR-/i, ''));
        const meter = yield prisma_1.default.gasMeter.create({
            data: {
                consumerId: consumerProfile.id,
                meterNumber: meter_number,
                imei: matchedGprs ? matchedGprs.imei : null,
                serialNo: matchedGprs ? matchedGprs.serialNo : (serial_no || null),
                meterKey: matchedGprs ? matchedGprs.meterKey : (meter_key || null),
                isGprs: matchedGprs ? true : false,
                meterType: matchedGprs ? 'TOKEN' : (meter_type === 'PIPING' || meter_type === 'GPRS' ? 'PIPING' : 'TOKEN'),
                aliasName: alias_name || 'My Meter',
                ownerName: owner_name,
                ownerPhone: owner_phone,
                status: 'active'
            }
        });
        res.json({
            success: true,
            data: {
                id: meter.id,
                meter_number: meter.meterNumber,
                meter_key: meter.meterKey,
                serial_no: meter.serialNo,
                alias_name: meter.aliasName,
                owner_name: meter.ownerName,
                owner_phone: meter.ownerPhone,
                status: meter.status
            },
            message: 'Gas meter added successfully'
        });
    }
    catch (error) {
        console.error('Add gas meter error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.addGasMeter = addGasMeter;
// Remove gas meter
const removeGasMeter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const meter = yield prisma_1.default.gasMeter.findUnique({
            where: { id: Number(id) }
        });
        if (!meter || meter.consumerId !== consumerProfile.id) {
            return res.status(404).json({ success: false, error: 'Gas meter not found' });
        }
        // Hard delete
        // We delete related topups first to avoid foreign key constraints
        yield prisma_1.default.gasTopup.deleteMany({
            where: { meterId: Number(id) }
        });
        yield prisma_1.default.gasMeter.delete({
            where: { id: Number(id) }
        });
        res.json({
            success: true,
            message: 'Gas meter removed successfully'
        });
    }
    catch (error) {
        console.error('Remove gas meter error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.removeGasMeter = removeGasMeter;
// Topup gas
const topupGas = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = req.user.id;
        const { meter_number, amount, payment_method } = req.body;
        if (!meter_number || !amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid request data' });
        }
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId },
            include: { user: true }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const meter = yield prisma_1.default.gasMeter.findFirst({
            where: {
                meterNumber: meter_number,
                consumerId: consumerProfile.id,
                status: 'active'
            }
        });
        if (!meter) {
            return res.status(404).json({ success: false, error: 'Gas meter not found' });
        }
        // Calculate units based on system-wide dynamic rate from database
        const config = yield prisma_1.default.systemConfig.findFirst();
        const gasPrice = (config === null || config === void 0 ? void 0 : config.gasPricePerM3) || Number(process.env.GAS_PRICE_PER_M3) || 3250;
        const units = Number((amount / gasPrice).toFixed(4)); // Ensure clean precision
        const isMobileMoney = payment_method === 'mobile_money';
        // For mobile_money: call PalmKash FIRST before creating any DB records
        // This way, if PalmKash fails, nothing is created in the DB (no orphans)
        let palmKashRef = null;
        let palmKashTransactionId = null;
        if (isMobileMoney) {
            palmKashRef = `GAS-${Date.now()}`;
            const palmKash = (yield Promise.resolve().then(() => __importStar(require('../services/palmKash.service')))).default;
            const pmResult = yield palmKash.initiatePayment({
                amount: amount,
                phoneNumber: req.body.phone || ((_a = consumerProfile.user) === null || _a === void 0 ? void 0 : _a.phone) || req.body.customer_phone || '',
                referenceId: palmKashRef,
                description: `Gas topup for meter ${meter_number}`
            });
            if (!pmResult.success) {
                return res.status(400).json({ success: false, error: pmResult.error || 'PalmKash payment failed' });
            }
            palmKashTransactionId = pmResult.transactionId;
        }
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            // Create topup record — status depends on payment method
            const topup = yield tx.gasTopup.create({
                data: {
                    consumerId: consumerProfile.id,
                    meterId: meter.id,
                    amount,
                    units,
                    currency: 'RWF',
                    status: isMobileMoney ? 'pending' : 'Pending'
                }
            });
            // Create customer order — correct status from the start
            const order = yield tx.customerOrder.create({
                data: {
                    consumerId: consumerProfile.id,
                    orderType: 'gas',
                    status: isMobileMoney ? 'pending' : 'completed',
                    amount,
                    currency: 'RWF',
                    items: JSON.stringify([{
                            meterNumber: meter_number,
                            units,
                            amount
                        }]),
                    metadata: JSON.stringify(isMobileMoney
                        ? {
                            paymentMethod: 'mobile_money',
                            gateway: 'palmkash',
                            externalRef: palmKashTransactionId,
                            reference: palmKashRef, // Webhook uses startsWith('GAS-') on this
                            paymentPhone: req.body.phone || ((_a = consumerProfile.user) === null || _a === void 0 ? void 0 : _a.phone) || req.body.customer_phone || null
                        }
                        : { paymentMethod: payment_method || 'wallet' })
                }
            });
            // Also link orderId to topup for mobile_money
            if (isMobileMoney) {
                yield tx.gasTopup.update({
                    where: { id: topup.id },
                    data: { orderId: order.id.toString() }
                });
                // Return early — webhook will complete after PIN confirmed
                return { topup, order, newBalance: 0, rewardUnits: 0, isPending: true, transactionId: palmKashRef };
            }
            // Non-MoMo: process payment immediately
            let newBalance = 0;
            if (payment_method === 'wallet' || !payment_method) {
                const wallet = yield tx.wallet.findFirst({
                    where: { consumerId: consumerProfile.id, type: 'dashboard_wallet' }
                });
                if (!wallet || wallet.balance < amount) {
                    throw new Error('Insufficient wallet balance');
                }
                const updatedWallet = yield tx.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { decrement: amount } }
                });
                newBalance = updatedWallet.balance;
                yield tx.walletTransaction.create({
                    data: {
                        walletId: wallet.id,
                        type: 'gas_purchase',
                        amount,
                        description: `Gas topup for meter ${meter_number}`,
                        reference: order.id.toString(),
                        status: 'completed'
                    }
                });
            }
            else if (payment_method === 'nfc_card') {
                const { card_id } = req.body;
                if (!card_id)
                    throw new Error('Card ID is required for NFC payment');
                const card = yield tx.nfcCard.findFirst({
                    where: { id: Number(card_id), consumerId: consumerProfile.id }
                });
                if (!card)
                    throw new Error('NFC Card not found');
                if (card.balance < amount) {
                    throw new Error('Insufficient NFC card balance');
                }
                yield tx.nfcCard.update({
                    where: { id: card.id },
                    data: { balance: { decrement: amount } }
                });
                const wallet = yield tx.wallet.findFirst({
                    where: { consumerId: consumerProfile.id, type: 'dashboard_wallet' }
                });
                newBalance = (wallet === null || wallet === void 0 ? void 0 : wallet.balance) || 0;
            }
            const rewardUnits = 0;
            return { topup, order, newBalance, rewardUnits };
        }));
        const { topup, order, newBalance, rewardUnits, isPending, transactionId } = result;
        if (isPending) {
            res.json({
                success: true,
                message: 'Payment initiated. Please check your phone.',
                data: {
                    order_id: order.id,
                    status: 'pending',
                    transaction_id: transactionId
                }
            });
            return;
        }
        // Call STS or GPRS APIs depending on meter type to deliver gas volume/token
        let token = '';
        const isGprsMeter = meter.meterType === 'PIPING' || meter.isGprs;
        try {
            if (isGprsMeter) {
                // Sent to Meter: GPRS token transmission started
                yield prisma_1.default.gasTopup.update({
                    where: { id: topup.id },
                    data: { status: 'Sent to Meter' }
                });
                // 1. GPRS/Piping Meter: Send remotelyTopUp command via LoRaWAN API
                const LorawanService = require('../services/gasLorawanService');
                const loraResult = yield LorawanService.rechargeMeter(meter.meterNumber, amount);
                if (!loraResult.success) {
                    yield prisma_1.default.gasTopup.update({
                        where: { id: topup.id },
                        data: { status: 'Failed' }
                    });
                    return res.status(500).json({ success: false, error: `GPRS Meter Recharge failed: ${loraResult.error}` });
                }
                token = `GPRS-${loraResult.orderId}`;
                // Poll for acknowledgment (Status check)
                let acknowledged = false;
                for (let i = 0; i < 3; i++) {
                    try {
                        yield new Promise(resolve => setTimeout(resolve, 3000));
                        const statusResult = yield LorawanService.getRechargeStatus(loraResult.orderId);
                        if (statusResult.success) {
                            if (statusResult.status === 2) {
                                acknowledged = true;
                                break;
                            }
                            else if (statusResult.status === 3) {
                                break; // Delivery failed
                            }
                        }
                    }
                    catch (e) {
                        console.error('Polling acknowledgment error:', e);
                    }
                }
                if (acknowledged) {
                    yield prisma_1.default.gasTopup.update({
                        where: { id: topup.id },
                        data: { status: 'Recharge successful', orderId: token }
                    });
                }
                else {
                    // Keep status as 'Sent to Meter' so the background scheduler can check and retry later
                    yield prisma_1.default.gasTopup.update({
                        where: { id: topup.id },
                        data: { orderId: token }
                    });
                }
            }
            else {
                // Token Generated: Token successfully created from STS湖南斯壮 API
                const tokenResult = yield tokenMeter_service_1.default.rechargeTokenMeter({
                    meterNumber: meter.meterNumber,
                    amount: amount,
                    customerRef: order.id.toString()
                });
                if (!tokenResult.success) {
                    yield prisma_1.default.gasTopup.update({
                        where: { id: topup.id },
                        data: { status: 'Failed' }
                    });
                    return res.status(500).json({ success: false, error: `STS Token Vending failed: ${tokenResult.error}` });
                }
                token = tokenResult.token;
                // Sent to Meter: STS token transmission started
                yield prisma_1.default.gasTopup.update({
                    where: { id: topup.id },
                    data: { status: 'Sent to Meter', orderId: token }
                });
                // Recharge successful: STS Meter successfully received/token generated successfully
                yield prisma_1.default.gasTopup.update({
                    where: { id: topup.id },
                    data: { status: 'Recharge successful' }
                });
            }
        }
        catch (apiErr) {
            console.error('[Meter Recharge API Error]', apiErr);
            yield prisma_1.default.gasTopup.update({
                where: { id: topup.id },
                data: { status: 'Failed' }
            });
            return res.status(500).json({ success: false, error: `Meter API communication failed: ${apiErr.message}` });
        }
        res.json({
            success: true,
            data: {
                topup_id: topup.id,
                order_id: order.id,
                meter_number,
                amount,
                units,
                token,
                reward_units: rewardUnits,
                new_wallet_balance: newBalance
            },
            message: 'Gas topup successful'
        });
        // Trigger Customer Gas Recharge SMS (CUS-SMS-004)
        try {
            const { emailQueue } = yield Promise.resolve().then(() => __importStar(require('../queues/email.queue')));
            yield emailQueue.add('gas-recharge-success', {
                to: consumerProfile.user.phone,
                templateType: 'gas-recharge-success', // Mapped to CUS-SMS-004
                data: {
                    customer_name: consumerProfile.fullName || consumerProfile.user.name || 'Valued Customer',
                    meter_name: meter.aliasName || 'Meter',
                    meter_id: meter_number,
                    amount: amount.toLocaleString(),
                    token: token,
                    transaction_id: order.id.toString(),
                    volume: units
                },
                relatedEntity: { type: 'GAS_ORDER', id: order.id.toString() }
            });
            // Trigger Email (if email exists)
            if (consumerProfile.user.email) {
                yield emailQueue.add('customer-gas-recharge-email', {
                    to: consumerProfile.user.email,
                    templateType: 'customer-gas-recharge-email', // Mapped to CUS-EMAIL-004
                    data: {
                        customer_name: consumerProfile.fullName || consumerProfile.user.name || 'Valued Customer',
                        meter_name: meter.aliasName || 'Meter',
                        meter_id: meter_number,
                        amount: amount.toLocaleString(),
                        token: token,
                        transaction_id: order.id.toString(),
                        volume: units
                    },
                    relatedEntity: { type: 'GAS_ORDER', id: order.id.toString() }
                });
            }
        }
        catch (err) {
            console.error('Gas recharge notifications failed:', err);
        }
    }
    catch (error) {
        console.error('Topup gas error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.topupGas = topupGas;
// Get gas usage
const getGasUsage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { meter_id } = req.query;
        let consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            consumerProfile = yield prisma_1.default.consumerProfile.create({
                data: {
                    userId,
                    walletBalance: 0,
                    rewardsPoints: 0,
                    isVerified: false,
                    membershipType: 'standard'
                }
            });
        }
        // Fetch global lastGasResetDate
        const resetAlert = yield prisma_1.default.systemAlert.findFirst({
            where: { apiName: 'GAS_REPORTING_PERIOD_RESET' },
            orderBy: { createdAt: 'desc' }
        });
        const lastGasResetDate = resetAlert ? new Date(resetAlert.errorMessage) : null;
        const where = Object.assign({ consumerId: consumerProfile.id }, (lastGasResetDate ? { createdAt: { gte: lastGasResetDate } } : {}));
        if (meter_id) {
            where.meterId = meter_id;
        }
        const topups = yield prisma_1.default.gasTopup.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                gasMeter: {
                    select: {
                        meterNumber: true,
                        aliasName: true
                    }
                }
            }
        });
        res.json({
            success: true,
            data: topups.map(t => {
                var _a, _b;
                return ({
                    id: t.id,
                    meter_number: ((_a = t.gasMeter) === null || _a === void 0 ? void 0 : _a.meterNumber) || 'Unknown',
                    meter_alias: ((_b = t.gasMeter) === null || _b === void 0 ? void 0 : _b.aliasName) || 'Unknown',
                    amount: t.amount,
                    units: t.units,
                    currency: t.currency,
                    status: t.status,
                    token_value: t.orderId,
                    created_at: t.createdAt
                });
            })
        });
    }
    catch (error) {
        console.error('Get gas usage error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getGasUsage = getGasUsage;
// Record gas usage (Simulated)
const recordGasUsage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { meter_number, units_used, activity } = req.body;
        if (!meter_number || !units_used || units_used <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid usage data' });
        }
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const meter = yield prisma_1.default.gasMeter.findFirst({
            where: {
                meterNumber: meter_number,
                consumerId: consumerProfile.id,
                status: 'active'
            }
        });
        if (!meter) {
            return res.status(404).json({ success: false, error: 'Gas meter not found' });
        }
        // Create a negative topup record to represent consumption
        // This avoids schema changes while maintaining accurate dynamic balance
        const usage = yield prisma_1.default.gasTopup.create({
            data: {
                consumerId: consumerProfile.id,
                meterId: meter.id,
                amount: 0,
                units: -units_used, // Negative units subtract from total
                currency: 'RWF',
                status: 'consumed',
                orderId: activity || 'Cooking Session'
            }
        });
        res.json({
            success: true,
            data: {
                usage_id: usage.id,
                units_used,
                meter_number
            },
            message: 'Gas usage recorded successfully'
        });
    }
    catch (error) {
        console.error('Record gas usage error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.recordGasUsage = recordGasUsage;
// Get gas rewards balance
const getGasRewardsBalance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const rewards = yield prisma_1.default.gasReward.findMany({
            where: { consumerId: consumerProfile.id }
        });
        console.log(`DEBUG: Found ${rewards.length} rewards for customer ${consumerProfile.id}`);
        const totalUnits = rewards.reduce((sum, r) => sum + r.units, 0);
        res.json({
            success: true,
            data: {
                total_units: totalUnits,
                points: Math.round(totalUnits * 100), // Standard: 1 m3 = 100 points
                currency: 'm³',
                tier: totalUnits > 100 ? 'Gold' : totalUnits > 50 ? 'Silver' : 'Bronze'
            }
        });
    }
    catch (error) {
        console.error('Get gas rewards balance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getGasRewardsBalance = getGasRewardsBalance;
// Get gas rewards history
const getGasRewardsHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { limit = 20 } = req.query;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        console.log(`DEBUG: Fetching history for userId ${userId}, Profile ${consumerProfile.id}`);
        const rewards = yield prisma_1.default.gasReward.findMany({
            where: { consumerId: consumerProfile.id },
            orderBy: { createdAt: 'desc' },
            take: Number(limit)
        });
        console.log(`DEBUG: Found ${rewards.length} history records`);
        res.json({
            success: true,
            data: {
                transactions: rewards.map(r => ({
                    id: r.id,
                    type: r.source,
                    points: r.units * 100, // 1 m3 = 100 points
                    description: r.source === 'purchase_reward' ? `Purchase Bonus (${r.units} m³)` :
                        r.source === 'sent' ? `Sent ${Math.abs(r.units)} m³ to Meter ${r.meterId || ''}` :
                            r.source === 'purchase' ? `Earned from purchase (${r.units} m³)` :
                                `Gas Reward (${r.units} m³)`,
                    created_at: r.createdAt,
                    meter_id: r.meterId,
                    order_id: r.reference
                }))
            }
        });
    }
    catch (error) {
        console.error('Get gas rewards history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getGasRewardsHistory = getGasRewardsHistory;
// Get gas rewards leaderboard
const getGasRewardsLeaderboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { period = 'month' } = req.query;
        // Calculate date filter based on period
        let dateFilter;
        const now = new Date();
        if (period === 'week') {
            dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }
        else if (period === 'month') {
            dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        // Get all rewards with filter
        const rewards = yield prisma_1.default.gasReward.findMany({
            where: dateFilter ? { createdAt: { gte: dateFilter } } : {},
            include: {
                consumerProfile: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                phone: true
                            }
                        }
                    }
                }
            }
        });
        // Group by consumer and sum units
        const leaderboard = rewards.reduce((acc, reward) => {
            const existing = acc.find(item => item.consumerId === reward.consumerId);
            if (existing) {
                existing.total_units += reward.units;
            }
            else {
                acc.push({
                    consumerId: reward.consumerId,
                    customer_name: reward.consumerProfile.user.name || 'Anonymous',
                    total_units: reward.units
                });
            }
            return acc;
        }, []);
        // Sort by total units and take top 10
        leaderboard.sort((a, b) => b.total_units - a.total_units);
        const top10 = leaderboard.slice(0, 10);
        res.json({
            success: true,
            data: top10.map((item, index) => ({
                rank: index + 1,
                customer_name: item.customer_name,
                total_units: item.total_units
            }))
        });
    }
    catch (error) {
        console.error('Get gas rewards leaderboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getGasRewardsLeaderboard = getGasRewardsLeaderboard;
// Get customer orders
const getCustomerOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { limit = 20, offset = 0 } = req.query;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const orders = yield prisma_1.default.customerOrder.findMany({
            where: { consumerId: consumerProfile.id },
            orderBy: { createdAt: 'desc' },
            take: Number(limit),
            skip: Number(offset)
        });
        res.json({
            success: true,
            data: orders.map(o => ({
                id: o.id,
                order_type: o.orderType,
                status: o.status,
                amount: o.amount,
                currency: o.currency,
                items: o.items,
                metadata: o.metadata,
                created_at: o.createdAt,
                updated_at: o.updatedAt
            }))
        });
    }
    catch (error) {
        console.error('Get customer orders error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getCustomerOrders = getCustomerOrders;
// Get order details
const getOrderDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const consumerProfile = yield prisma_1.default.consumerProfile.findUnique({
            where: { userId }
        });
        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }
        const order = yield prisma_1.default.customerOrder.findFirst({
            where: {
                id: Number(id),
                consumerId: consumerProfile.id
            }
        });
        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        res.json({
            success: true,
            data: {
                id: order.id,
                order_type: order.orderType,
                status: order.status,
                amount: order.amount,
                currency: order.currency,
                items: order.items,
                metadata: order.metadata,
                created_at: order.createdAt,
                updated_at: order.updatedAt
            }
        });
    }
    catch (error) {
        console.error('Get order details error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
exports.getOrderDetails = getOrderDetails;
