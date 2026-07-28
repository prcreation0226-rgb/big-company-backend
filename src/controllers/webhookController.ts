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
    const isSuccess = normalizedStatus === 'success' || normalizedStatus === 'completed';

    if (!isSuccess) {
       console.log(`ℹ️ [Webhook] Transaction ${activeReference} is not successful (Status: ${status}). No action taken.`);
       return res.json({ success: true, message: 'Status recognized' });
    }

    // 1. Identify what this is (TOPUP, GAS, ORD, POS)
    if (activeReference.startsWith('TOPUP-') || activeReference.startsWith('RTOP-') || activeReference.startsWith('TEST-')) {
      // Wallet Topup
      const transaction = await prisma.walletTransaction.findFirst({
        where: { reference: { contains: transaction_id || activeReference } }
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
                  new_balance: (retailer.walletBalance + transaction.amount).toLocaleString(),
                  transaction_id: activeReference,
                  topup_date: new Date().toLocaleDateString()
                },
                relatedEntity: { type: 'TRANSACTION', id: transaction.id.toString() }
              });
            }
        } else if (transaction.walletId) {
            await prisma.$transaction([
              prisma.walletTransaction.update({
                where: { id: transaction.id },
                data: { status: 'completed' }
              }),
              prisma.wallet.update({
                where: { id: transaction.walletId },
                data: { balance: { increment: transaction.amount } }
              })
            ]);

            // Notify Consumer of successful wallet top-up via webhook payment gateway (CUS-EMAIL-003)
            try {
              const wallet = await prisma.wallet.findUnique({
                where: { id: transaction.walletId },
                include: { consumerProfile: { include: { user: true } } }
              });
              
              if (wallet?.consumerProfile?.user?.email) {
                const { emailQueue } = await import('../queues/email.queue');
                await emailQueue.add('customer-wallet-topup-email', {
                  to: wallet.consumerProfile.user.email,
                  templateType: 'customer-wallet-topup-email', // Mapped to CUS-EMAIL-003
                  data: {
                    customer_name: wallet.consumerProfile.fullName || wallet.consumerProfile.user.name || 'Customer',
                    amount: transaction.amount.toLocaleString(),
                    new_balance: (wallet.balance + transaction.amount).toLocaleString(),
                    transaction_id: activeReference
                  },
                  relatedEntity: { type: 'WALLET_TRANSACTION', id: transaction.id.toString() }
                });
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
            await prisma.$transaction(async (tx) => {
                await tx.customerOrder.update({
                    where: { id: order.id },
                    data: { status: 'completed' }
                });
                
                const topup = await tx.gasTopup.findFirst({
                    where: { orderId: order.id.toString() }
                });
                
                if (topup) {
                    await tx.gasTopup.update({
                        where: { id: topup.id },
                        data: { status: 'completed' }
                    });
                }
            });
        }
    }
    else if (activeReference.startsWith('ORD-') || activeReference.startsWith('POS-')) {
       // Retail Order or POS Sale
       const sale = await prisma.sale.findFirst({
           where: { meterId: transaction_id || activeReference },
           include: { saleItems: { include: { product: true } } }
       });
       if (sale && (sale.status === 'pending' || sale.status === 'pending_payment')) {
           console.log(`✅ [Webhook] Completing sale for reference: ${activeReference}`);
           
           await prisma.$transaction(async (tx) => {
               // 1. Update status
               await tx.sale.update({
                   where: { id: sale.id },
                   data: { status: 'completed' }
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
       const order = await prisma.order.findFirst({
           where: { notes: transaction_id || activeReference }
       });
       if (order && order.status === 'pending_payment') {
           console.log(`✅ [Webhook] Completing wholesale order for reference: ${activeReference}`);
           await prisma.order.update({
               where: { id: order.id },
               data: { status: 'pending' }
           });
       }
    }
    else if (activeReference.startsWith('CREPAY-')) {
       const transaction = await prisma.walletTransaction.findFirst({
           where: { reference: { contains: transaction_id || activeReference } }
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
       const transaction = await prisma.walletTransaction.findFirst({
           where: { reference: { contains: transaction_id || activeReference } }
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
