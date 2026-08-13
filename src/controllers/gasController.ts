import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../utils/prisma';
import PipingMeterService from '../services/pipingMeter.service';
import TokenMeterService from '../services/tokenMeter.service';
import { gprsMapping } from '../config/gprsMapping';

// Get gas configuration (price, etc)
export const getGasConfig = async (req: AuthRequest, res: Response) => {
    try {
        // Fetch live config from DB, fallback to env/default if not found
        const config = await prisma.systemConfig.findFirst();
        const gasPrice = config?.gasPricePerM3 || Number(process.env.GAS_PRICE_PER_M3) || 3250;
        
        res.json({
            success: true,
            data: {
                price_per_m3: gasPrice,
                min_topup: config?.minGasTopup || 500,
                max_topup: config?.maxGasTopup || 100000,
                gas_reward_share: config?.gasRewardShare || 12
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Lookup meter info (auto-fill)
export const lookupMeter = async (req: AuthRequest, res: Response) => {
    try {
        const { meter_number } = req.params;
        console.log(`[LOOKUP] Searching for meter: ${meter_number}`);

        if (!meter_number) {
            return res.status(400).json({ success: false, error: 'Meter number is required' });
        }

        // 1. Check local DB first (maybe it was registered before or exists in system)
        const localMeter = await prisma.gasMeter.findFirst({
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
                    meter_type: (localMeter as any).meterType || 'PIPING'
                }
            });
        }

        // 2. If not local and looks like an IMEI (15 digits), try Energyy API
        if (meter_number.length >= 14 && /^\d+$/.test(meter_number)) {
            const remoteInfo = await PipingMeterService.getMeterInfo(meter_number);
            
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
    } catch (error: any) {
        console.error('Lookup meter error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get gas meters
export const getGasMeters = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;

        let consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId }
        });

        if (!consumerProfile) {
            consumerProfile = await prisma.consumerProfile.create({
                data: {
                    userId,
                    walletBalance: 0,
                    rewardsPoints: 0,
                    isVerified: false,
                    membershipType: 'standard'
                }
            });
        }

        const meters = await prisma.gasMeter.findMany({
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
                    meter_key: (m as any).meterKey,
                    serial_no: (m as any).serialNo,
                    alias_name: m.aliasName,
                    owner_name: m.ownerName,
                    owner_phone: m.ownerPhone,
                    status: m.status,
                    meter_type: (m as any).meterType || (m.isGprs ? 'PIPING' : 'TOKEN'),
                    current_units: m.currentUnits,
                    created_at: m.createdAt
                };
            })
        });
    } catch (error: any) {
        console.error('Get gas meters error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Add gas meter
export const addGasMeter = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { meter_number, alias_name, owner_name, owner_phone, meter_type, meter_key, serial_no } = req.body;

        if (!meter_number) {
            return res.status(400).json({ success: false, error: 'Meter number is required' });
        }

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }

        // Check if meter already exists for this consumer
        const existingMeter = await prisma.gasMeter.findFirst({
            where: { 
                meterNumber: meter_number,
                consumerId: consumerProfile.id 
            }
        });

        if (existingMeter) {
            return res.status(400).json({ success: false, error: 'Meter number already registered' });
        }

        const matchedGprs = gprsMapping.find(
            m => m.meterNo === meter_number || m.meterNo === meter_number.replace(/^MTR-/i, '')
        );

        const meter = await prisma.gasMeter.create({
            data: {
                consumerId: consumerProfile.id,
                meterNumber: meter_number,
                imei: matchedGprs ? matchedGprs.imei : null,
                serialNo: matchedGprs ? matchedGprs.serialNo : (serial_no || null),
                meterKey: matchedGprs ? matchedGprs.meterKey : (meter_key || null),
                isGprs: matchedGprs ? true : false,
                meterType: matchedGprs ? 'PIPING' : (meter_type === 'PIPING' || meter_type === 'GPRS' ? 'PIPING' : 'TOKEN'),
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
                meter_key: (meter as any).meterKey,
                serial_no: (meter as any).serialNo,
                alias_name: meter.aliasName,
                owner_name: meter.ownerName,
                owner_phone: meter.ownerPhone,
                status: meter.status
            },
            message: 'Gas meter added successfully'
        });
    } catch (error: any) {
        console.error('Add gas meter error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Remove gas meter
export const removeGasMeter = async (req: AuthRequest, res: Response) => {
    return res.status(403).json({
        success: false,
        error: 'Meters cannot be deleted once registered to preserve transaction history. Please contact the administrator.'
    });
};

// Topup gas
export const topupGas = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { meter_number, amount, payment_method } = req.body;

        if (!meter_number || !amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid request data' });
        }

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId },
            include: { user: true }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }

        const meter = await prisma.gasMeter.findFirst({
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
        const config = await prisma.systemConfig.findFirst();
        const gasPrice = config?.gasPricePerM3 || Number(process.env.GAS_PRICE_PER_M3) || 3250;
        const units = Number((amount / gasPrice).toFixed(4)); // Ensure clean precision

        const isMobileMoney = payment_method === 'mobile_money';

        // For mobile_money: call PalmKash FIRST before creating any DB records
        // This way, if PalmKash fails, nothing is created in the DB (no orphans)
        let palmKashRef: string | null = null;
        let palmKashTransactionId: string | null = null;

        if (isMobileMoney) {
            palmKashRef = `GAS-${Date.now()}`;
            const palmKash = (await import('../services/palmKash.service')).default;
            const pmResult = await palmKash.initiatePayment({
                amount: amount,
                phoneNumber: req.body.phone || (consumerProfile as any).user?.phone || req.body.customer_phone || '',
                referenceId: palmKashRef,
                description: `Gas topup for meter ${meter_number}`
            });

            if (!pmResult.success) {
                return res.status(400).json({ success: false, error: pmResult.error || 'PalmKash payment failed' });
            }
            palmKashTransactionId = pmResult.transactionId;
        }

        const result = await prisma.$transaction(async (tx) => {
            // Create topup record — status depends on payment method
            const topup = await tx.gasTopup.create({
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
            const order = await tx.customerOrder.create({
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
                    metadata: JSON.stringify(
                        isMobileMoney
                            ? {
                                paymentMethod: 'mobile_money',
                                gateway: 'palmkash',
                                externalRef: palmKashTransactionId,
                                reference: palmKashRef, // Webhook uses startsWith('GAS-') on this
                                paymentPhone: req.body.phone || (consumerProfile as any).user?.phone || req.body.customer_phone || null
                              }
                            : { paymentMethod: payment_method || 'wallet' }
                    )
                }
            });

            // Also link orderId to topup for mobile_money
            if (isMobileMoney) {
                await tx.gasTopup.update({
                    where: { id: topup.id },
                    data: { orderId: order.id.toString() }
                });

                // Return early — webhook will complete after PIN confirmed
                return { topup, order, newBalance: 0, rewardUnits: 0, isPending: true, transactionId: palmKashRef };
            }

            // Non-MoMo: process payment immediately
            let newBalance = 0;

            if (payment_method === 'wallet' || !payment_method) {
                const wallet = await tx.wallet.findFirst({
                    where: { consumerId: consumerProfile.id, type: 'dashboard_wallet' }
                });

                if (!wallet || wallet.balance < amount) {
                    throw new Error('Insufficient wallet balance');
                }

                const updatedWallet = await tx.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { decrement: amount } }
                });
                newBalance = updatedWallet.balance;

                await tx.walletTransaction.create({
                    data: {
                        walletId: wallet.id,
                        type: 'gas_purchase',
                        amount,
                        description: `Gas topup for meter ${meter_number}`,
                        reference: order.id.toString(),
                        status: 'completed'
                    }
                });
            } else if (payment_method === 'nfc_card') {
                const { card_id } = req.body;
                if (!card_id) throw new Error('Card ID is required for NFC payment');

                const card = await tx.nfcCard.findFirst({
                    where: { id: Number(card_id), consumerId: consumerProfile.id }
                });

                if (!card) throw new Error('NFC Card not found');
                if (card.balance < amount) {
                    throw new Error('Insufficient NFC card balance');
                }

                await tx.nfcCard.update({
                    where: { id: card.id },
                    data: { balance: { decrement: amount } }
                });

                const wallet = await tx.wallet.findFirst({
                    where: { consumerId: consumerProfile.id, type: 'dashboard_wallet' }
                });
                newBalance = wallet?.balance || 0;
            }

            const rewardUnits = 0;
            return { topup, order, newBalance, rewardUnits };
        });

        const { topup, order, newBalance, rewardUnits, isPending, transactionId } = result as any;

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
                await prisma.gasTopup.update({
                    where: { id: topup.id },
                    data: { status: 'Sent to Meter' }
                });

                // 1. GPRS/Piping Meter: Send remotelyTopUp command via LoRaWAN API
                const LorawanService = require('../services/gasLorawanService');
                const loraResult = await LorawanService.rechargeMeter(meter.meterNumber, amount);
                if (!loraResult.success) {
                    await prisma.gasTopup.update({
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
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        const statusResult = await LorawanService.getRechargeStatus(loraResult.orderId);
                        if (statusResult.success) {
                            if (statusResult.status === 2) {
                                acknowledged = true;
                                break;
                            } else if (statusResult.status === 3) {
                                break; // Delivery failed
                            }
                        }
                    } catch (e) {
                        console.error('Polling acknowledgment error:', e);
                    }
                }

                if (acknowledged) {
                    await prisma.gasTopup.update({
                        where: { id: topup.id },
                        data: { status: 'Recharge successful', orderId: token }
                    });
                } else {
                    // Keep status as 'Sent to Meter' so the background scheduler can check and retry later
                    await prisma.gasTopup.update({
                        where: { id: topup.id },
                        data: { orderId: token }
                    });
                }
            } else {
                // Token Generated: Token successfully created from STS湖南斯壮 API
                const tokenResult = await TokenMeterService.rechargeTokenMeter({
                    meterNumber: meter.meterNumber,
                    amount: amount,
                    customerRef: order.id.toString()
                });
                if (!tokenResult.success) {
                    await prisma.gasTopup.update({
                        where: { id: topup.id },
                        data: { status: 'Failed' }
                    });
                    return res.status(500).json({ success: false, error: `STS Token Vending failed: ${tokenResult.error}` });
                }
                token = tokenResult.token;

                // Sent to Meter: STS token transmission started
                await prisma.gasTopup.update({
                    where: { id: topup.id },
                    data: { status: 'Sent to Meter', orderId: token }
                });

                // Recharge successful: STS Meter successfully received/token generated successfully
                await prisma.gasTopup.update({
                    where: { id: topup.id },
                    data: { status: 'Recharge successful' }
                });
            }

        } catch (apiErr: any) {
            console.error('[Meter Recharge API Error]', apiErr);
            await prisma.gasTopup.update({
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
            const { emailQueue } = await import('../queues/email.queue');
            await emailQueue.add('gas-recharge-success', {
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
                await emailQueue.add('customer-gas-recharge-email', {
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
        } catch (err) {
            console.error('Gas recharge notifications failed:', err);
        }
    } catch (error: any) {
        console.error('Topup gas error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get gas usage
export const getGasUsage = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { meter_id } = req.query;

        let consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId }
        });

        if (!consumerProfile) {
            consumerProfile = await prisma.consumerProfile.create({
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
        const resetAlert = await prisma.systemAlert.findFirst({
            where: { apiName: 'GAS_REPORTING_PERIOD_RESET' },
            orderBy: { createdAt: 'desc' }
        });
        const lastGasResetDate = resetAlert ? new Date(resetAlert.errorMessage) : null;

        const where: any = { 
            consumerId: consumerProfile.id,
            ...(lastGasResetDate ? { createdAt: { gte: lastGasResetDate } } : {})
        };
        if (meter_id) {
            where.meterId = meter_id as string;
        }

        const topups = await prisma.gasTopup.findMany({
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
            data: topups.map(t => ({
                id: t.id,
                meter_number: t.gasMeter?.meterNumber || 'Unknown',
                meter_alias: t.gasMeter?.aliasName || 'Unknown',
                amount: t.amount,
                units: t.units,
                currency: t.currency,
                status: t.status,
                token_value: t.orderId,
                created_at: t.createdAt
            }))
        });
    } catch (error: any) {
        console.error('Get gas usage error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Record gas usage (Simulated)
export const recordGasUsage = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { meter_number, units_used, activity } = req.body;

        if (!meter_number || !units_used || units_used <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid usage data' });
        }

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }

        const meter = await prisma.gasMeter.findFirst({
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
        const usage = await prisma.gasTopup.create({
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
    } catch (error: any) {
        console.error('Record gas usage error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get gas rewards balance
export const getGasRewardsBalance = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }

        const rewards = await prisma.gasReward.findMany({
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
    } catch (error: any) {
        console.error('Get gas rewards balance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get gas rewards history
export const getGasRewardsHistory = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { limit = 20 } = req.query;

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }

        console.log(`DEBUG: Fetching history for userId ${userId}, Profile ${consumerProfile.id}`);

        const rewards = await prisma.gasReward.findMany({
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
    } catch (error: any) {
        console.error('Get gas rewards history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get gas rewards leaderboard
export const getGasRewardsLeaderboard = async (req: AuthRequest, res: Response) => {
    try {
        const { period = 'month' } = req.query;

        // Calculate date filter based on period
        let dateFilter: Date | undefined;
        const now = new Date();

        if (period === 'week') {
            dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (period === 'month') {
            dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        // Get all rewards with filter
        const rewards = await prisma.gasReward.findMany({
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
        const leaderboard = rewards.reduce((acc: any[], reward) => {
            const existing = acc.find(item => item.consumerId === reward.consumerId);
            if (existing) {
                existing.total_units += reward.units;
            } else {
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
    } catch (error: any) {
        console.error('Get gas rewards leaderboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get customer orders
export const getCustomerOrders = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { limit = 20, offset = 0 } = req.query;

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }

        const orders = await prisma.customerOrder.findMany({
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
    } catch (error: any) {
        console.error('Get customer orders error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get order details
export const getOrderDetails = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { id } = req.params;

        const consumerProfile = await prisma.consumerProfile.findUnique({
            where: { userId }
        });

        if (!consumerProfile) {
            return res.status(404).json({ success: false, error: 'Customer profile not found' });
        }

        const order = await prisma.customerOrder.findFirst({
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
    } catch (error: any) {
        console.error('Get order details error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
