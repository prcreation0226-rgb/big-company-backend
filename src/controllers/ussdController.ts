import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { SMSService } from '../services/sms.service';
import { EmailService } from '../services/email.service';
import tokenMeterService from '../services/tokenMeter.service';
import pipingMeterService from '../services/pipingMeter.service';
import paymentService from '../services/palmKash.service';
import { createOrder } from './storeController';

/**
 * Helper to normalize telephone numbers to 2507XXXXXXXX format for SMS / payments.
 */
function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.trim();
  if (cleaned.startsWith('07')) {
    cleaned = '250' + cleaned.substring(1);
  } else if (cleaned.startsWith('+250')) {
    cleaned = cleaned.substring(1);
  } else if (cleaned.startsWith('7')) {
    cleaned = '250' + cleaned;
  }
  return cleaned;
}

/**
 * Helper to find NFC card supporting friendly suffix lookup or direct UID lookup.
 */
async function findNfcCard(cardNumInput: string) {
  const cleaned = cardNumInput.replace(/[\s:]/g, '').toUpperCase();
  
  // 1. Direct search by uid (exactly as is)
  let card = await prisma.nfcCard.findFirst({
    where: { uid: cardNumInput.trim() }
  });
  if (card) return card;

  // 2. Query all cards and find by cleaned/friendly match
  const cards = await prisma.nfcCard.findMany();
  card = cards.find(c => {
    const dbCleaned = c.uid.replace(/[\s:]/g, '').toUpperCase();
    if (dbCleaned === cleaned) return true;
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
}

function isValidCardFormat(cardNumInput: string): boolean {
  const cleaned = cardNumInput.replace(/[\s:]/g, '');
  return /^(NFC-)?[0-9A-Za-z]{4,20}$/.test(cleaned);
}

/**
 * Main stateless USSD handler.
 * POST /api/ussd
 * Body: { sessionId, phoneNumber, serviceCode, text }
 */
export const handleUSSDRequestCore = async (req: Request, res: Response) => {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      // Not a valid JSON string, keep as is
    }
  }

  const { sessionId, phoneNumber, serviceCode, text = '' } = body || {};

  if (!phoneNumber) {
    return res.send('END Error: Phone number is missing from session.');
  }

  // Parse path choices split by asterisk
  let parts = text.toString().split('*').map((s: string) => s.trim()).filter((s: string) => s !== '');
  
  // Strip service code prefix if present (e.g. 939*15, 939, 121, 123)
  if (parts.length > 0 && ['939', '121', '123'].includes(parts[0])) {
    if (parts[0] === '939' && parts[1] === '15') {
      parts = parts.slice(2);
    } else {
      parts = parts.slice(1);
    }
  }
  
  try {
    // ----------------------------------------------------
    // ROOT MENU
    // ----------------------------------------------------
    if (parts.length === 0) {
      const menu = [
        'CON Welcome to EMS Ltd',
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
      const meter = await prisma.gasMeter.findFirst({
        where: { meterNumber: meterId }
      });
      if (!meter) {
        return res.send('END Invalid Meter ID. Please check the code and try again.');
      }

      // Check if selected meter type matches actual meter type in database
      const expectedType = meterTypeChoice === '1' ? 'TOKEN' : 'PIPING';
      if (meter.meterType !== expectedType) {
        return res.send('END Invalid Meter ID. Please check the code and try again.');
      }

      // Step 3: Select Amount (Pricing Menu)
      if (parts.length === 3) {
        // Fetch predefined gas pricing plans from database
        const pricingPlans = await prisma.gasPricingPlan.findMany({
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
      const pricingPlans = await prisma.gasPricingPlan.findMany({
        where: { isActive: true },
        orderBy: { amount: 'asc' },
        take: 5
      });
      let selectedAmount = 0;
      if (pricingPlans.length > 0 && pricingPlans[planIdx]) {
        selectedAmount = pricingPlans[planIdx].amount;
      } else {
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
          await prisma.gasRechargeTransaction.create({
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
            await paymentService.initiatePayment({
              amount: selectedAmount,
              phoneNumber: targetPhone,
              referenceId: txRef,
              description: `Gas Meter Recharge USSD - ${meterId}`
            });
          } catch (e: any) {
            console.error('Mobile money push error:', e.message);
          }

          return res.send('END Mobile Money transaction initiated. Please complete on your phone.');
        } else {
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
          return res.send(`CON Confirm payment of ${selectedAmount} RWF for Meter ${meterId} from your ${walletTypeName}?\n1. Yes\n2. No`);
        }

        const confirmVal = parts[8];
        if (confirmVal === '1') {
          // Authenticate Card Number and PIN
          const card = await findNfcCard(cardNum);

          if (!card || card.pin !== cardPin) {
            return res.send('END Access denied.');
          }

          if (card.status !== 'active') {
            return res.send('END Error: Card is inactive or invalid.');
          }

          if (!card.consumerId) {
            return res.send('END Error: Card is not linked to any customer profile.');
          }

          // Balance check
          const dbWalletType = walletTypeChoice === '1' ? 'dashboard_wallet' : 'credit_wallet';
          const wallet = await prisma.wallet.findFirst({
            where: { consumerId: card.consumerId, type: dbWalletType }
          });

          if (!wallet || wallet.balance < selectedAmount) {
            return res.send('END Transaction failed. Insufficient balance.');
          }

          // Execute recharge under database transaction
          try {
            let createdTxId: number | undefined;

            await prisma.$transaction(async (tx) => {
              // Deduct balance
              await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: { decrement: selectedAmount } }
              });

              // Log Wallet transaction history
              await tx.walletTransaction.create({
                data: {
                  walletId: wallet.id,
                  type: 'gas_meter_recharge',
                  amount: -selectedAmount,
                  description: `Gas Meter Recharge - Meter ${meterId} via USSD`,
                  status: 'completed'
                }
              });

              // Log Gas Recharge Transaction as PENDING
              const gasTx = await tx.gasRechargeTransaction.create({
                data: {
                  customerId: card.consumerId,
                  meterNumber: meter.meterNumber,
                  meterType: meter.meterType || 'PIPING',
                  amount: selectedAmount,
                  paymentMethod: 'wallet',
                  status: 'PENDING'
                }
              });
              createdTxId = gasTx.id;
            });

            // Fetch System Configuration for Dynamic Pricing
            const config = await prisma.systemConfig.findFirst();
            const gasPrice = config?.gasPricePerM3 || 1500;
            // Calculate gas volume in m³ (vending by unit)
            const totalVolume = Math.floor((selectedAmount / gasPrice) * 10) / 10;

            // Trigger Gas recharge action using unit-based volume
            let apiResult: any;
            const provider = meter.isGprs ? 'zhongyi' : 'stronpower';

            if (provider === 'zhongyi') {
              const { default: zhongyiMeterService } = await import('../services/zhongyiMeter.service');
              apiResult = await zhongyiMeterService.rechargeMeter({
                meterNumber: meter.meterNumber,
                amount: totalVolume,
                customerRef: `GASRCH-USSD-${meter.meterNumber}-${Date.now()}`,
                isVendByUnit: true
              });
            } else {
              // Apply Stronpower API (tokenMeterService) for both TOKEN and PIPING meters
              apiResult = await tokenMeterService.rechargeTokenMeter({
                meterNumber: meter.meterNumber,
                amount: totalVolume,
                customerRef: `GASRCH-USSD-${meter.meterNumber}-${Date.now()}`,
                isVendByUnit: true
              });
            }

            // GPRS remote push integration
            let pushResult = { success: true, error: null as any };
            if (apiResult && apiResult.success && meter && meter.imei && apiResult.token) {
              try {
                const pushRes = await pipingMeterService.pushTokenToImei(meter.imei, apiResult.token);
                if (pushRes && !pushRes.success) {
                  pushResult.success = false;
                  pushResult.error = pushRes.error || 'Remote push rejected';
                }
              } catch (pushErr: any) {
                pushResult.success = false;
                pushResult.error = pushErr.message || 'Remote push connection error';
              }
            }

            const isFullySuccessful = apiResult && apiResult.success && pushResult.success;

            if (isFullySuccessful && createdTxId) {
              // Update transaction to SUCCESS and record token
              await prisma.gasRechargeTransaction.update({
                where: { id: createdTxId },
                data: {
                  status: 'SUCCESS',
                  tokenValue: apiResult.token || null,
                  apiReference: apiResult.apiReference || null
                }
              });

              // Track Gas Topup and update Gas Meter units
              try {
                const config = await prisma.systemConfig.findFirst();
                const gasPrice = config?.gasPricePerM3 || 1500;
                const unitsPurchased = (apiResult && apiResult.units) ? Number(apiResult.units) : (selectedAmount / gasPrice);

                await prisma.gasTopup.create({
                  data: {
                    consumerId: card.consumerId,
                    meterId: meter.id,
                    amount: selectedAmount,
                    units: unitsPurchased,
                    status: 'completed',
                    orderId: String(createdTxId)
                  }
                });

                await prisma.gasMeter.update({
                  where: { id: meter.id },
                  data: {
                    currentUnits: { increment: unitsPurchased }
                  }
                });
              } catch (topupErr) {
                console.error('[USSD Recharge] Failed to create gas topup / update units:', topupErr);
              }

              return res.send('END Gas recharge complete. Thank you!');
            } else {
              // Rollback/Refund wallet on failure
              await prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: selectedAmount } }
              });

              await prisma.walletTransaction.create({
                data: {
                  walletId: wallet.id,
                  type: 'refund',
                  amount: selectedAmount,
                  description: `Refund: Gas Meter Recharge failed - Meter ${meterId} via USSD`,
                  status: 'completed'
                }
              });

              if (createdTxId) {
                await prisma.gasRechargeTransaction.update({
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
          } catch (err: any) {
            console.error('Wallet payment USSD transaction error:', err);
            return res.send('END Transaction failed.');
          }
        } else {
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
      const card = await findNfcCard(cardNum);
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
        const wallet = await prisma.wallet.findFirst({
          where: { consumerId: card.consumerId, type: 'dashboard_wallet' }
        });
        if (!wallet) {
          return res.send('END Error: Dashboard wallet not found.');
        }

        // Log pending Wallet transaction
        await prisma.walletTransaction.create({
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
          await paymentService.initiatePayment({
            amount: topupAmount,
            phoneNumber: targetPhone,
            referenceId: txRef,
            description: `Wallet Topup USSD - Card ${cardNum}`
          });
        } catch (e: any) {
          console.error('Wallet topup push error:', e.message);
        }

        return res.send('END Mobile Money transaction initiated. Please complete on your phone.');
      } else {
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
      const districtMap: { [key: string]: string[] } = {
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
      const retailers = await prisma.retailerProfile.findMany({
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
          const registeredUser = await prisma.user.findFirst({
            where: { phone: orderPhone }
          });

          const mockReq = {
            user: registeredUser ? { id: registeredUser.id, role: registeredUser.role } : undefined,
            body: {
              retailerId: selectedRetailer.id,
              paymentMethod: 'ussd_callback',
              phone: orderPhone,
              retailer_email: selectedRetailer.user?.email || ''
            }
          } as any;

          const mockRes = {
            status: (code: number) => ({
              json: (data: any) => {}
            }),
            json: (data: any) => {}
          } as any;

          await createOrder(mockReq, mockRes);
        } catch (postErr: any) {
          console.error('[USSD Order] Failed to execute createOrder internally:', postErr.message);
        }

        return res.send('END Thank you. The retailer has been notified and will contact you shortly.');
      } else {
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
      const consumer = await prisma.consumerProfile.findFirst({
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

      const rewards = await prisma.gasReward.findMany({
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
      const targetMeter = await prisma.gasMeter.findFirst({
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
          } as any;

          const mockRes = {
            status: (code: number) => ({
              json: (data: any) => {}
            }),
            json: (data: any) => {}
          } as any;

          const { sendToMeter } = await import('./rewardsController');
          await sendToMeter(mockReq, mockRes);
        } catch (err: any) {
          console.error('[USSD Reward Share] Failed to execute sendToMeter internally:', err.message);
        }

        return res.send('END You have shared your gas rewards Successfully');
      } else {
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

      const card = await findNfcCard(cardNum);
      if (!card || card.pin !== cardPin) {
        return res.send('END Access denied.');
      }

      if (!card.consumerId) {
        return res.send('END Error: Card is not linked to any customer profile.');
      }

      const wallets = await prisma.wallet.findMany({
        where: { consumerId: card.consumerId, type: { in: ['dashboard_wallet', 'credit_wallet'] } }
      });

      const dashboardBalance = wallets.find(w => w.type === 'dashboard_wallet')?.balance || 0;
      const creditBalance = wallets.find(w => w.type === 'credit_wallet')?.balance || 0;

      return res.send(`END Your Dashboard Balance is: ${dashboardBalance} RWF. Your Credit Balance is: ${creditBalance} RWF.`);
    }

    // ====================================================
    // OPTION 6: Manage Orders (Pay / Confirm Delivery)
    // ====================================================
    if (choice === '6') {
      const targetPhone = normalizePhoneNumber(phoneNumber);

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
        const sales = await prisma.sale.findMany({
          where: {
            status: 'pending_payment',
            notes: { contains: targetPhone }
          },
          orderBy: { createdAt: 'desc' },
          take: 3
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
          // Check Wallet PIN
          if (parts.length === 4) {
            return res.send('CON Enter Card Number:');
          }
          const cardNum = parts[4];
          if (!isValidCardFormat(cardNum)) {
            return res.send('END Error: Invalid card number format.');
          }

          if (parts.length === 5) {
            return res.send('CON Enter Card PIN:');
          }
          const cardPin = parts[5];

          const card = await findNfcCard(cardNum);
          if (!card || card.pin !== cardPin) {
            return res.send('END Access denied.');
          }

          if (!card.consumerId) {
            return res.send('END Error: Card is not linked to a customer profile.');
          }

          // Check balance in consumerProfile or Wallet
          const consumer = await prisma.consumerProfile.findUnique({
            where: { id: card.consumerId }
          });

          if (!consumer || consumer.walletBalance < sale.totalAmount) {
            return res.send('END Error: Insufficient wallet balance.');
          }

          const saleItems = await prisma.saleItem.findMany({
            where: { saleId: sale.id }
          });

          // Deduct & update sale status to 'pending' (paid)
          await prisma.$transaction(async (tx) => {
            await tx.consumerProfile.update({
              where: { id: consumer.id },
              data: { walletBalance: { decrement: sale.totalAmount } }
            });

            await tx.sale.update({
              where: { id: sale.id },
              data: {
                status: 'pending',
                paymentMethod: 'wallet'
              }
            });

            // Decrement product stock
            for (const item of saleItems) {
              await tx.product.update({
                where: { id: item.productId },
                data: { stock: { decrement: item.quantity } }
              });
            }
          });

          return res.send(`END Payment successful! Your order #${sale.id} is now paid.`);
        }

        // PAYMENT METHOD 2: MTN Mobile Money
        if (payMethodChoice === '2') {
          const ordRef = `ORD-${Date.now()}`;
          await prisma.sale.update({
            where: { id: sale.id },
            data: { meterId: ordRef }
          });

          try {
            const palmKash = (await import('../services/palmKash.service')).default;
            await palmKash.initiatePayment({
              amount: sale.totalAmount,
              phoneNumber: targetPhone,
              referenceId: ordRef,
              description: `USSD Order #${sale.id} Payment`
            });
          } catch (e: any) {
            console.error('USSD MoMo pay error:', e.message);
          }

          return res.send('END Mobile Money transaction initiated. Please complete on your phone.');
        }

        // PAYMENT METHOD 3: Airtel Money
        if (payMethodChoice === '3') {
          const ordRef = `ORD-${Date.now()}`;
          await prisma.sale.update({
            where: { id: sale.id },
            data: { meterId: ordRef, paymentMethod: 'airtel' }
          });

          try {
            const palmKash = (await import('../services/palmKash.service')).default;
            await palmKash.initiatePayment({
              amount: sale.totalAmount,
              phoneNumber: targetPhone,
              referenceId: ordRef,
              description: `USSD Order #${sale.id} Airtel Payment`
            });
          } catch (e: any) {
            console.error('USSD Airtel pay error:', e.message);
          }

          return res.send('END Airtel Money transaction initiated. Please complete on your phone.');
        }

        return res.send('END Invalid selection.');
      }

      // ACTION 2: Confirm Delivery
      if (orderAction === '2') {
        const sale = await prisma.sale.findFirst({
          where: {
            status: { in: ['shipped', 'ready'] },
            notes: { contains: targetPhone }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (!sale) {
          return res.send('END You have no orders ready for delivery confirmation.');
        }

        if (parts.length === 2) {
          return res.send(`CON Confirm delivery of Order #${sale.id}?\n1. Yes\n2. No`);
        }

        const confirmVal = parts[2];
        if (confirmVal === '1') {
          await prisma.sale.update({
            where: { id: sale.id },
            data: { status: 'delivered' }
          });
          return res.send('END Delivery confirmed! Thank you.');
        } else {
          return res.send('END Confirmation cancelled.');
        }
      }

      return res.send('END Invalid selection.');
    }

    return res.send('END Invalid choice.');

  } catch (error: any) {
    console.error('USSD processing error:', error);
    return res.send('END System error occurred. Please try again later.');
  }
};

/**
 * Capture response body/headers for internal redirection/translation.
 */
class USSDResponseCapture {
  public sentText: string = '';
  public statusVal: number = 200;
  public headers: { [key: string]: string } = {};

  send(text: string) {
    this.sentText = text;
    return this;
  }
  status(val: number) {
    this.statusVal = val;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }
  header(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }
}

/**
 * Helper to parse fields from a raw XML string.
 */
function parseXMLField(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

/**
 * Wrapper USSD request router that handles MTN XML, Airtel Form Parameters, and JSON.
 */
export const handleUSSDRequest = async (req: Request, res: Response) => {
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
    } else if (req.body && (req.body.MSISDN || req.body.userid || req.body.clean)) {
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
        await prisma.ussdSession.deleteMany({ where: { sessionId } });
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
        await prisma.ussdSession.deleteMany({ where: { sessionId } });
        await prisma.ussdSession.create({
          data: { sessionId, phoneNumber: msisdn, accumulatedText: '' }
        });
        text = '';
      } else {
        // Continuing request
        let session = await prisma.ussdSession.findUnique({ where: { sessionId } });
        if (!session) {
          session = await prisma.ussdSession.create({
            data: { sessionId, phoneNumber: msisdn, accumulatedText: '' }
          });
        }
        
        let newText = '';
        if (session.accumulatedText) {
          newText = `${session.accumulatedText}*${subscriberInput}`;
        } else {
          newText = subscriberInput;
        }

        await prisma.ussdSession.update({
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
      } as Request;

      const capture = new USSDResponseCapture();
      await handleUSSDRequestCore(mockReq, capture as unknown as Response);

      const responseString = capture.sentText;
      let freeflowState = 'FC'; // Default: continue
      let displayMessage = responseString;

      if (responseString.startsWith('CON ')) {
        freeflowState = 'FC';
        displayMessage = responseString.substring(4);
      } else if (responseString.startsWith('END ')) {
        freeflowState = 'FB';
        displayMessage = responseString.substring(4);
        // Clean up session since it's ended
        await prisma.ussdSession.deleteMany({ where: { sessionId } });
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

    } catch (err) {
      console.error('MTN USSD Error:', err);
      return res.status(200).type('application/xml').send(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response>
    <freeflow>
        <freeflowState>FB</freeflowState>
    </freeflow>
    <applicationResponse>System error. Please try again later.</applicationResponse>
</response>`);
    }

  } else if (isAirtel) {
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
        await prisma.ussdSession.deleteMany({ where: { sessionId: airtelSessionId } });
        res.setHeader('Expires', '-1');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Cache-Control', 'max-age=0');
        return res.status(200).send('');
      }

      // Detect first request: either no session exists, or the input is root dial code (e.g. starts with * or equals 121)
      let session = await prisma.ussdSession.findUnique({ where: { sessionId: airtelSessionId } });
      const isFirstRequest = !session || (input && (input.startsWith('*') || input === '121'));

      let text = '';
      if (isFirstRequest) {
        await prisma.ussdSession.deleteMany({ where: { sessionId: airtelSessionId } });
        await prisma.ussdSession.create({
          data: { sessionId: airtelSessionId, phoneNumber: MSISDN, accumulatedText: '' }
        });
        text = '';
      } else {
        // Continuing request
        if (!session) {
          session = await prisma.ussdSession.create({
            data: { sessionId: airtelSessionId, phoneNumber: MSISDN, accumulatedText: '' }
          });
        }

        let newText = '';
        if (session.accumulatedText) {
          newText = `${session.accumulatedText}*${input}`;
        } else {
          newText = input;
        }

        await prisma.ussdSession.update({
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
      } as Request;

      const capture = new USSDResponseCapture();
      await handleUSSDRequestCore(mockReq, capture as unknown as Response);

      const responseString = capture.sentText;
      let freeflowState = 'FC'; // Default: continue
      let displayMessage = responseString;

      if (responseString.startsWith('CON ')) {
        freeflowState = 'FC';
        displayMessage = responseString;
      } else if (responseString.startsWith('END ')) {
        freeflowState = 'FB';
        displayMessage = responseString;
        await prisma.ussdSession.deleteMany({ where: { sessionId: airtelSessionId } });
      }

      // Set Airtel headers
      res.setHeader('Freeflow', freeflowState);
      res.setHeader('Expires', '-1');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Cache-Control', 'max-age=0');
      res.type('text/plain');

      return res.status(200).send(displayMessage);

    } catch (err) {
      console.error('Airtel USSD Error:', err);
      res.setHeader('Freeflow', 'FB');
      return res.status(200).type('text/plain').send('System error. Please try again later.');
    }

  } else {
    // ----------------------------------------------------
    // FALLBACK (JSON/Postman) FLOW
    // ----------------------------------------------------
    return handleUSSDRequestCore(req, res);
  }
};

