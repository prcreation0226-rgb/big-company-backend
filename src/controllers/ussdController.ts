import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { SMSService } from '../services/sms.service';
import { EmailService } from '../services/email.service';
import tokenMeterService from '../services/tokenMeter.service';
import pipingMeterService from '../services/pipingMeter.service';
import paymentService from '../services/palmKash.service';

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
        '5. Reba balance'
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

      // Step 3: Select Amount (Pricing Menu)
      if (parts.length === 3) {
        // Fetch predefined gas pricing plans from database
        const pricingPlans = await prisma.gasPricingPlan.findMany({
          where: { isActive: true },
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
          const card = await prisma.nfcCard.findFirst({
            where: { uid: cardNum }
          });

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

              // Log Gas Recharge Transaction
              await tx.gasRechargeTransaction.create({
                data: {
                  customerId: card.consumerId,
                  meterNumber: meter.meterNumber,
                  meterType: meter.meterType || 'PIPING',
                  amount: selectedAmount,
                  paymentMethod: 'wallet',
                  status: 'SUCCESS'
                }
              });
            });

            // Trigger Gas recharge action
            if (meter.meterType === 'TOKEN') {
              await tokenMeterService.rechargeTokenMeter({
                meterNumber: meter.meterNumber,
                amount: selectedAmount,
                customerRef: `GASRCH-USSD-${meter.meterNumber}-${Date.now()}`
              });
            } else {
              await pipingMeterService.rechargePipingMeter({
                meterNumber: meter.meterNumber,
                amount: selectedAmount,
                customerRef: `GASRCH-USSD-${meter.meterNumber}-${Date.now()}`
              });
            }

            return res.send('END Gas recharge complete. Thank you!');
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

      // Validate Card Number is active and exists
      const card = await prisma.nfcCard.findFirst({
        where: { uid: cardNum }
      });
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
        const registeredUser = await prisma.user.findFirst({
          where: { phone: orderPhone }
        });
        const customerName = registeredUser?.name || 'Unregistered Guest';

        const retailerEmail = selectedRetailer.user?.email;

        if (retailerEmail) {
          const emailSubject = `New Order Request from USSD Client - ${orderPhone}`;
          const emailBody = `
            <h3>New USSD Call-back Order Request</h3>
            <p><strong>Customer Name:</strong> ${customerName}</p>
            <p><strong>Customer Phone Number:</strong> ${orderPhone}</p>
            <p><strong>Selected Retailer:</strong> ${selectedRetailer.shopName}</p>
            <p><strong>Location:</strong> Province: ${selectedProv}, District: ${selectedDist}</p>
            <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
            <p>Please call the customer back immediately to finalize their order details.</p>
          `;

          await EmailService.sendEmail(
            retailerEmail,
            emailSubject,
            emailBody,
            'USSD-ORDER-NOTIFICATION'
          );
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
        return res.send('CON Choose Meter Type:\n1. TOKEN\n2. PIPING');
      }
      const meterTypeChoice = parts[2];
      const meterType = meterTypeChoice === '1' ? 'TOKEN' : 'PIPING';

      if (parts.length === 3) {
        return res.send('CON Enter Meter ID:');
      }
      const meterId = parts[3];

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

        await prisma.$transaction([
          prisma.gasReward.create({
            data: {
              consumerId: consumer.id,
              units: -unitsValue,
              source: 'USSD-Share-Rewards',
              reference: `SHARE-${meterId}`,
              meterId: meterId
            }
          })
        ]);

        const smsMessage = `You have received ${unitsValue} m3 of gas shared to Meter ${meterId} from Reward Wallet ${rewardWalletId}. Thank you!`;
        await SMSService.sendSMS(
          normalizedSMSPhone,
          smsMessage,
          'USSD-SHARE-REWARDS-SMS'
        );

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

      if (parts.length === 2) {
        return res.send('CON Enter Card PIN:');
      }
      const cardPin = parts[2];

      const card = await prisma.nfcCard.findFirst({
        where: { uid: cardNum }
      });
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
        displayMessage = responseString.substring(4);
      } else if (responseString.startsWith('END ')) {
        freeflowState = 'FB';
        displayMessage = responseString.substring(4);
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

