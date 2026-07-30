import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { emailQueue } from '../queues/email.queue';
import { TemplateService } from '../services/template.service';

export const handlePalmKashWebhook = async (req: Request, res: Response) => {
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
          const sale = await prisma.sale.findFirst({
              where: { meterId: activeReference }
          });
          if (sale && sale.status === 'pending_payment') {
              console.log(`[Webhook] Cancelling sale ${sale.id} due to failed/cancelled payment.`);
              await prisma.sale.update({
                  where: { id: sale.id },
                  data: {
                      status: 'cancelled',
                      cancellationReason: `Payment failed/cancelled via Mobile Money (Status: ${status})`
                  }
              });
          }
       } else if (activeReference && activeReference.startsWith('WHL-')) {
           const order = await prisma.order.findFirst({
               where: { notes: activeReference }
           });
           if (order && order.status === 'pending_payment') {
               console.log(`[Webhook] Cancelling wholesale order ${order.id} due to failed/cancelled payment.`);
               await prisma.order.update({
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
      const transaction = await prisma.walletTransaction.findFirst({
        where: { reference: activeReference, status: 'pending' }
      });

      if (transaction && transaction.status === 'pending') {
        console.log(`✅ [Webhook] Completing wallet topup for reference: ${activeReference}`);
        // Determine if it's Retailer or Consumer based on fields
        if (transaction.retailerId) {
            await prisma.$transaction([
              prisma.walletTransaction.update({
                where: { id: transaction.id },
                data: { status: 'completed' }
              }),
              prisma.retailerProfile.update({
                where: { id: transaction.retailerId },
                data: { walletBalance: { increment: transaction.amount } }
              })
            ]);

            // Notify Retailer of successful recharge (PRD 2.A.ii)
            const retailer = await prisma.retailerProfile.findUnique({
              where: { id: transaction.retailerId },
              include: { user: true }
            });
            if (retailer?.user?.email) {
              await emailQueue.add('wallet-recharge-success', {
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
        } else if (transaction.walletId) {
            const wallet = await prisma.wallet.findUnique({
                where: { id: transaction.walletId }
            });
            if (wallet) {
                await prisma.$transaction([
                  prisma.walletTransaction.update({
                    where: { id: transaction.id },
                    data: { status: 'completed' }
                  }),
                  prisma.wallet.update({
                    where: { id: transaction.walletId },
                    data: { balance: { increment: transaction.amount } }
                  }),
                  prisma.consumerProfile.update({
                    where: { id: wallet.consumerId },
                    data: { walletBalance: { increment: transaction.amount } }
                  })
                ]);
            }

            // Notify Consumer of successful wallet top-up via webhook payment gateway (CUS-EMAIL-003 & CUS-SMS-003)
            try {
              const wallet = await prisma.wallet.findUnique({
                where: { id: transaction.walletId },
                include: { consumerProfile: { include: { user: true } } }
              });
              
              if (wallet?.consumerProfile?.user) {
                const { emailQueue } = await import('../queues/email.queue');

                // 1. Send SMS (customer-wallet-topup -> CUS-SMS-003)
                const smsDestination = (transaction as any).paymentPhone || wallet.consumerProfile.user.phone;
                if (smsDestination) {
                  await emailQueue.add('customer-wallet-topup-sms', {
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
                  await emailQueue.add('customer-wallet-topup-email', {
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
            } catch (err) {
              console.error('[Webhook] Consumer topup notification failed:', err);
            }
        }
      } else {
        console.log(`ℹ️ [Webhook] Transaction ${activeReference} already processed or not found.`);
      }
    } 
    else if (activeReference.startsWith('GASRCH-')) {
        const txRecord = await prisma.gasRechargeTransaction.findFirst({
            where: { apiReference: activeReference }
        });

        if (txRecord && txRecord.status === 'PENDING_PAYMENT') {
            console.log(`✅ [Webhook] Completing gas meter recharge for reference: ${activeReference}`);
            
            const parts = activeReference.split('-');
            const meterType = parts[1]; // TOKEN or PIPING
            const provider = isNaN(Number(parts[2])) ? parts[2] : 'stronpower'; // zhongyi or stronpower

            const config = await prisma.systemConfig.findFirst();
            const gasPrice = config?.gasPricePerM3 || Number(process.env.GAS_PRICE_PER_M3) || 1500;
            
            const rawVolume = txRecord.isVendByUnit ? txRecord.amount : (txRecord.amount / gasPrice);
            const totalVolume = Math.floor(rawVolume * 10) / 10;

            let apiResult: any;

            try {
                if (provider === 'zhongyi') {
                    const { default: zhongyiMeterService } = await import('../services/zhongyiMeter.service');
                    console.log(`[Webhook GasRecharge] Routing ${meterType} recharge via Zhongyi API (Volume: ${totalVolume})`);
                    apiResult = await zhongyiMeterService.rechargeMeter({
                        meterNumber: txRecord.meterNumber,
                        amount: totalVolume,
                        customerRef: activeReference,
                        isVendByUnit: true
                    });
                } else {
                    const { default: tokenMeterService } = await import('../services/tokenMeter.service');
                    console.log(`[Webhook GasRecharge] Routing ${meterType} recharge via Stronpower API (Volume: ${totalVolume})`);
                    apiResult = await tokenMeterService.rechargeTokenMeter({
                        meterNumber: txRecord.meterNumber,
                        amount: totalVolume,
                        customerRef: activeReference,
                        isVendByUnit: true
                    });
                }

                let meter = await prisma.gasMeter.findFirst({
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
                        const { gprsMapping } = await import('../config/gprsMapping');
                        const matchedMapping = gprsMapping.find(
                            m => m.meterNo === txRecord.meterNumber || m.meterNo === txRecord.meterNumber.replace(/^MTR-/i, '')
                        );

                        if (matchedMapping && txRecord.customerId) {
                            console.log(`[Webhook GasRecharge] Auto-registering matched GPRS meter ${txRecord.meterNumber} for consumer ${txRecord.customerId}...`);
                            meter = await prisma.gasMeter.create({
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
                    } catch (lookupErr: any) {
                        console.error('[Webhook GasRecharge] Error during meter lookup/registration:', lookupErr.message);
                    }
                }

                let pushResult = { success: true, error: null as any };
                if (apiResult.success && meter && meter.imei && apiResult.token) {
                    const { default: pipingMeterService } = await import('../services/pipingMeter.service');
                    console.log(`[Webhook GasRecharge] Meter ${txRecord.meterNumber} has IMEI ${meter.imei}. Triggering remote token push...`);
                    try {
                        const pushRes = await pipingMeterService.pushTokenToImei(meter.imei, apiResult.token);
                        if (pushRes && !pushRes.success) {
                            pushResult.success = false;
                            pushResult.error = pushRes.error || 'Remote push rejected by GPRS management system';
                        }
                    } catch (pushErr: any) {
                        pushResult.success = false;
                        pushResult.error = pushErr.message || 'Remote push connection error';
                    }
                }

                const isFullySuccessful = apiResult.success && pushResult.success;
                const finalStatus = isFullySuccessful ? 'SUCCESS' : 'FAILED';
                const finalErrorMsg = isFullySuccessful ? null : (pushResult.error || apiResult.error || 'Meter recharge failed');

                await prisma.gasRechargeTransaction.update({
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
                        const rp = await prisma.retailerProfile.findFirst({ where: { userId: txRecord.operatorId } });
                        if (rp) retailerId = rp.id;
                    }

                    await prisma.sale.create({
                        data: {
                            consumerId: txRecord.customerId || undefined,
                            retailerId: retailerId,
                            totalAmount: txRecord.amount,
                            status: 'completed',
                            paymentMethod: txRecord.paymentMethod,
                            meterId: txRecord.meterNumber,
                            saleItems: {
                                create: [{
                                    productId: 1, 
                                    quantity: totalVolume,
                                    price: gasPrice
                                }]
                            }
                        }
                    });

                    try {
                        const consumer = await prisma.consumerProfile.findFirst({
                            where: { id: txRecord.customerId || undefined },
                            include: { user: true }
                        });
                        if (consumer) {
                            const { emailQueue } = await import('../queues/email.queue');
                             const smsDestination = (txRecord as any).paymentPhone || consumer.user.phone || consumer.user.email || '';
                             await emailQueue.add('gas-recharge-success', {
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
                                await emailQueue.add('customer-gas-recharge-email', {
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
                    } catch (notifyErr) {
                        console.error('Failed to trigger gas recharge notification:', notifyErr);
                    }
                }

            } catch (err: any) {
                console.error('[Webhook GasRecharge Error]:', err.message);
                await prisma.gasRechargeTransaction.update({
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
        const order = await prisma.customerOrder.findFirst({
            where: { metadata: { contains: activeReference } } 
        });
        
        if (order && order.status === 'pending') {
            console.log(`✅ [Webhook] Completing gas topup for reference: ${activeReference}`);
            
            const initialTopup = await prisma.gasTopup.findFirst({
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
                        await prisma.gasTopup.update({
                            where: { id: initialTopup.id },
                            data: { status: 'Sent to Meter' }
                        });

                        const LorawanService = require('../services/gasLorawanService');
                        const loraResult = await LorawanService.rechargeMeter(meter.meterNumber, initialTopup.amount);
                        if (loraResult.success) {
                            token = `GPRS-${loraResult.orderId}`;
                            
                            let statusText = 'Sent to Meter';
                            try {
                                await new Promise(resolve => setTimeout(resolve, 3000));
                                const statusResult = await LorawanService.getRechargeStatus(loraResult.orderId);
                                if (statusResult.success && statusResult.status === 2) {
                                    statusText = 'Recharge successful';
                                }
                            } catch (e) {
                                console.error('[Webhook] Polling acknowledgment error:', e);
                            }

                            await prisma.gasTopup.update({
                                where: { id: initialTopup.id },
                                data: { status: statusText, orderId: token }
                            });
                        } else {
                            console.error(`[Webhook] GPRS Meter Recharge failed: ${loraResult.error}`);
                            await prisma.gasTopup.update({
                                where: { id: initialTopup.id },
                                data: { status: 'Failed' }
                            });
                        }
                    } else {
                        const { default: tokenMeterService } = await import('../services/tokenMeter.service');
                        const tokenResult = await tokenMeterService.rechargeTokenMeter({
                            meterNumber: meter.meterNumber,
                            amount: initialTopup.amount,
                            customerRef: order.id.toString()
                        });

                        if (tokenResult.success) {
                            token = tokenResult.token;
                            await prisma.gasTopup.update({
                                where: { id: initialTopup.id },
                                data: { status: 'Sent to Meter', orderId: token }
                            });
                        } else {
                            console.error(`[Webhook] STS API recharge failed: ${tokenResult.error}`);
                            await prisma.gasTopup.update({
                                where: { id: initialTopup.id },
                                data: { status: 'Failed' }
                            });
                        }
                    }

                    await prisma.customerOrder.update({
                        where: { id: order.id },
                        data: { status: 'completed' }
                    });

                    if (token) {
                        try {
                            const { emailQueue } = await import('../queues/email.queue');
                            
                            let paymentPhone: string | null = null;
                             if (order.metadata) {
                                 try {
                                     const meta = JSON.parse(order.metadata);
                                     if (meta && meta.paymentPhone) {
                                         paymentPhone = meta.paymentPhone;
                                     }
                                 } catch (e) {
                                     console.error('Failed to parse order metadata for paymentPhone:', e);
                                 }
                             }
                             const smsDestination = paymentPhone || consumerProfile.user.phone;
                             
                             await emailQueue.add('gas-recharge-success', {
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
                                await emailQueue.add('customer-gas-recharge-email', {
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
                        } catch (notifyErr) {
                            console.error('[Webhook] Gas recharge notification trigger failed:', notifyErr);
                        }
                    }

                } catch (rechargeErr: any) {
                    console.error('[Webhook] Gas recharge api exception:', rechargeErr);
                    await prisma.gasTopup.update({
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
       const sale = await prisma.sale.findFirst({
           where: { meterId: activeReference },
           include: { saleItems: { include: { product: true } } }
       });
       if (sale && (sale.status === 'pending' || sale.status === 'pending_payment')) {
           console.log(`✅ [Webhook] Completing sale for reference: ${activeReference}`);
           
           await prisma.$transaction(async (tx) => {
                // 1. Update status
                await tx.sale.update({
                    where: { id: sale.id },
                    data: { status: 'pending' }
                });

               // 2. Decrement Stock
               for (const item of sale.saleItems) {
                   await tx.product.update({
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
                               const config = await tx.systemConfig.findFirst();
                               const gasPrice = config?.gasPricePerM3 || 6500;
                               const gasRewardShare = config?.gasRewardShare !== undefined ? config.gasRewardShare / 100 : 0.12;
                               const rewardAmountRWF = totalProfit * gasRewardShare;
                               const rewardUnits = Number((rewardAmountRWF / gasPrice).toFixed(4));

                               if (rewardUnits > 0) {
                                   await tx.gasReward.create({
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
                   } catch (parseErr) {
                       console.error('Failed to process gas reward metadata in webhook:', parseErr);
                   }
               }
            });

            // Trigger Gas Reward Notifications (CUS-SMS-006 & CUS-EMAIL-006)
            try {
                if (sale.notes) {
                    const meta = JSON.parse(sale.notes);
                    const targetConsumerId = meta.rewardConsumerId || meta.consumerId;
                    if (targetConsumerId) {
                        const consumer = await prisma.consumerProfile.findUnique({
                            where: { id: targetConsumerId },
                            include: { user: true, gasRewards: true }
                        });
                        
                        if (consumer) {
                            const latestReward = await prisma.gasReward.findFirst({
                                where: { consumerId: consumer.id, saleId: sale.id },
                                orderBy: { id: 'desc' }
                            });

                            if (latestReward && latestReward.units > 0) {
                                const totalUnits = consumer.gasRewards.reduce((sum, r) => sum + r.units, 0);
                                const { emailQueue } = await import('../queues/email.queue');

                                // 1. Send SMS (gas-reward-update -> CUS-SMS-006)
                                if (consumer.user?.phone) {
                                    await emailQueue.add('gas-reward-update', {
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
                                if (consumer.user?.email) {
                                    await emailQueue.add('customer-reward-update-email', {
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
            } catch (notifyErr) {
                console.error('Failed to trigger gas reward notification in webhook:', notifyErr);
            }

           // 4. Low stock alerts (Post-transaction event)
           try {
               for (const item of sale.saleItems) {
                   const updatedProduct = await prisma.product.findUnique({
                       where: { id: item.productId },
                       include: { retailerProfile: { include: { user: true } } }
                   });
                   if (updatedProduct) {
                       const threshold = updatedProduct.lowStockThreshold || 10;
                       if (updatedProduct.stock <= 0 && updatedProduct.retailerProfile?.user?.email) {
                           await emailQueue.add('out-of-stock-alert', {
                               to: updatedProduct.retailerProfile.user.email,
                               templateType: 'out-of-stock',
                               data: {
                                   product: updatedProduct.name,
                                   retailer_name: updatedProduct.retailerProfile.shopName
                               },
                               relatedEntity: { type: 'PRODUCT', id: updatedProduct.id.toString() }
                           });
                       } else if (updatedProduct.stock <= threshold && updatedProduct.retailerProfile?.user?.email) {
                           await emailQueue.add('low-stock-alert', {
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
           } catch (alertErr) {
               console.error('Failed to trigger low stock alerts in webhook:', alertErr);
           }
       }
    }
    else if (activeReference.startsWith('WHL-')) {
       // notes stores our own WHL-xxx reference set at order creation (reliable exact match)
       const order = await prisma.order.findFirst({
           where: { notes: activeReference, status: 'pending_payment' }
       });
       if (order) {
           console.log(`✅ [Webhook] Completing wholesale order for reference: ${activeReference}`);
           await prisma.order.update({
               where: { id: order.id },
               data: { status: 'pending' }
           });
       }
    }
    else if (activeReference.startsWith('CREPAY-')) {
       // CREPAY reference in DB is stored as 'CREPAY-{loanId}-{activeReference}'
       // so we use 'contains' to match, but only on our own reference (not PalmKash's transaction_id)
       const transaction = await prisma.walletTransaction.findFirst({
           where: { reference: { contains: activeReference }, status: 'pending' }
       });
       if (transaction && transaction.status === 'pending') {
           console.log(`✅ [Webhook] Completing customer loan repayment for reference: ${activeReference}`);
           const parts = transaction.reference.split('-');
           const loanId = Number(parts[1]);

           await prisma.$transaction(async (tx) => {
               await tx.walletTransaction.update({
                   where: { id: transaction.id },
                   data: { status: 'completed' }
               });

               const loan = await tx.loan.findUnique({ where: { id: loanId } });
               if (loan) {
                   const repayments = await tx.walletTransaction.findMany({
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

                   const config = await tx.systemConfig.findFirst();
                   const rate = config?.customerLoanInterest ?? 10;
                   const interestAmount = Math.round(loan.amount * (rate / 100));
                   const totalRepayable = loan.amount + interestAmount;

                   if (totalPaid >= totalRepayable) {
                       await tx.loan.update({
                           where: { id: loanId },
                           data: { status: 'repaid' }
                       });
                   }
               }
           });
       }
    }
    else if (activeReference.startsWith('GCREPAY-')) {
       // Find by exact reference saved when payment was initiated
       const transaction = await prisma.walletTransaction.findFirst({
           where: { reference: activeReference, status: 'pending' }
       });
       if (transaction && transaction.status === 'pending') {
           console.log(`✅ [Webhook] Completing retailer credit repayment for reference: ${activeReference}`);
           await prisma.$transaction(async (tx) => {
               await tx.walletTransaction.update({
                   where: { id: transaction.id },
                   data: { status: 'completed' }
               });

               const retailerProfile = await tx.retailerProfile.findUnique({
                   where: { id: transaction.retailerId },
                   include: { user: true }
               });
               if (retailerProfile) {
                   const creditInfo = await tx.retailerCredit.findUnique({ where: { retailerId: retailerProfile.id } });
                   if (creditInfo) {
                       const newUsedCredit = Math.max(0, creditInfo.usedCredit - transaction.amount);
                       const newAvailableCredit = Math.min(creditInfo.creditLimit, creditInfo.availableCredit + transaction.amount);
                       await tx.retailerCredit.update({
                           where: { retailerId: retailerProfile.id },
                           data: {
                               usedCredit: newUsedCredit,
                               availableCredit: newAvailableCredit
                           }
                       });
                   }

                   if (retailerProfile.user?.email) {
                       const updatedCreditInfo = await tx.retailerCredit.findUnique({ where: { retailerId: retailerProfile.id } });
                       await emailQueue.add('credit-payment-confirmation', {
                           to: retailerProfile.user.email,
                           templateType: 'credit-payment-confirmation',
                           data: {
                               retail_name: retailerProfile.shopName,
                               paid_amount: transaction.amount.toLocaleString(),
                               remaining_balance: (updatedCreditInfo?.usedCredit || 0).toLocaleString(),
                               payment_date: new Date().toLocaleDateString(),
                               transaction_id: transaction.reference
                           },
                           relatedEntity: { type: 'TRANSACTION', id: transaction.id.toString() }
                       });
                   }
               }
           });
       }
    }
    else if (activeReference.startsWith('WHL-')) {
       const order = await prisma.order.findFirst({
           where: { notes: activeReference }
       });
       if (order && (order.status === 'pending' || order.status === 'pending_payment')) {
           console.log(`✅ [Webhook] Completing wholesale order for reference: ${activeReference}`);
            await prisma.order.update({
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
      const txRecord = await prisma.walletTransaction.findFirst({
        where: { reference: activeReference, status: 'pending' }
      });

      if (txRecord && txRecord.retailerId) {
        // Extract orderId from reference: RREPAY-{orderId}-{timestamp}
        const parts = activeReference.split('-');
        const orderId = Number(parts[1]);

        await prisma.$transaction(async (tx) => {
          // Mark pending walletTransaction as completed
          await tx.walletTransaction.update({
            where: { id: txRecord.id },
            data: { status: 'completed' }
          });

          // Update retailer credit info
          const creditInfo = await tx.retailerCredit.findUnique({
            where: { retailerId: txRecord.retailerId! }
          });
          if (creditInfo) {
            const newUsedCredit = Math.max(0, creditInfo.usedCredit - txRecord.amount);
            const newAvailableCredit = Math.min(creditInfo.creditLimit, creditInfo.availableCredit + txRecord.amount);
            await tx.retailerCredit.update({
              where: { retailerId: txRecord.retailerId! },
              data: { usedCredit: newUsedCredit, availableCredit: newAvailableCredit }
            });
          }

          // Mark order as completed
          const order = await tx.order.findUnique({ where: { id: orderId } });
          if (order && txRecord.amount >= Number(order.totalAmount)) {
            await tx.order.update({
              where: { id: orderId },
              data: { status: 'completed' }
            });
          }
        });

        // Notify retailer via email
        const retailer = await prisma.retailerProfile.findUnique({
          where: { id: txRecord.retailerId! },
          include: { user: true }
        });
        if (retailer?.user?.email) {
          await emailQueue.add('credit-payment-confirmation', {
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
      } else {
        console.warn(`⚠️ [Webhook] No pending RREPAY transaction found for reference: ${activeReference}`);
      }
    }
    else if (activeReference.startsWith('RLREPAY-')) {
      // Retailer loan repayment via MoMo
      // Reference format: RLREPAY-{loanId}-{timestamp}
      console.log(`✅ [Webhook] Processing retailer loan repayment for reference: ${activeReference}`);

      // Find the pending walletTransaction saved when payment was initiated
      const txRecord = await prisma.walletTransaction.findFirst({
        where: { reference: activeReference, status: 'pending' }
      });

      if (txRecord && txRecord.retailerId) {
        // Extract loanId from reference: RLREPAY-{loanId}-{timestamp}
        const parts = activeReference.split('-');
        const loanId = Number(parts[1]);

        let newRemaining = 0;
        await prisma.$transaction(async (tx) => {
          // Mark the wallet transaction as completed
          await tx.walletTransaction.update({
            where: { id: txRecord.id },
            data: { status: 'completed' }
          });

          // Update the specific loan by ID
          const loan = await (tx as any).retailerLoan.findUnique({ where: { id: loanId } });
          if (loan) {
            newRemaining = Math.max(0, loan.remainingAmount - txRecord.amount);
            const newStatus = newRemaining === 0 ? 'paid' : 'active';
            await (tx as any).retailerLoan.update({
              where: { id: loan.id },
              data: { remainingAmount: newRemaining, status: newStatus }
            });
          }
        });

        // Notify retailer via email
        const retailer = await prisma.retailerProfile.findUnique({
          where: { id: txRecord.retailerId! },
          include: { user: true }
        });
        if (retailer?.user?.email) {
          await emailQueue.add('credit-payment-confirmation', {
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
      } else {
        console.warn(`⚠️ [Webhook] No pending RLREPAY transaction found for reference: ${activeReference}`);
      }
    }

    // Always respond with 200 to acknowledge
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ [Webhook Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const handleIntouchSMSWebhook = async (req: Request, res: Response) => {
  try {
    const { messageid, status } = req.query;

    console.log(`📱 [IntouchSMS Webhook] Received DLR. MsgID: ${messageid}, Status: ${status}`);

    if (!messageid) {
      return res.status(400).send('Missing messageid');
    }

    // Map Intouch statuses to system status
    // P: Processed, D: Delivered, Q: Queued, E: Errored, S: Sent, U: Undelivered
    let systemStatus: any = 'SENT';
    if (status === 'D') systemStatus = 'DELIVERED';
    if (status === 'E' || status === 'U') systemStatus = 'FAILED';
    if (status === 'P' || status === 'Q') systemStatus = 'PENDING';

    // Find the log entry by external message ID
    const searchCriteria: any = { externalMessageId: messageid.toString() };
    const log = await prisma.systemEmailLog.findFirst({
      where: searchCriteria
    });

    if (log) {
      await prisma.systemEmailLog.update({
        where: { id: log.id },
        data: {
          status: systemStatus,
          errorMessage: status === 'E' || status === 'U' ? `Gateway reported status: ${status}` : null
        }
      });
      console.log(`✅ [IntouchSMS Webhook] Updated log ${log.id} to ${systemStatus}`);
    } else {
      console.warn(`⚠️ [IntouchSMS Webhook] No log found for messageid: ${messageid}`);
    }

    // Intouch expects 200 OK
    res.status(200).send('OK');
  } catch (error: any) {
    console.error('❌ [IntouchSMS Webhook Error]:', error.message);
    res.status(500).send('Error');
  }
};
