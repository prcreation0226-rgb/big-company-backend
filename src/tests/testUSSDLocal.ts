import { handleUSSDRequest } from '../controllers/ussdController';
import { Request, Response } from 'express';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// Mock request and response creator
function createMockSession(text: string, phone = '0788100001') {
  const req = {
    body: {
      sessionId: 'test-session-' + Date.now(),
      phoneNumber: phone,
      serviceCode: '*123#',
      text
    }
  } as Request;

  let resolvePromise: (val: string) => void;
  const promise = new Promise<string>((resolve) => {
    resolvePromise = resolve;
  });

  const res = {
    send: (data: string) => {
      resolvePromise(data);
      return res;
    }
  } as unknown as Response;

  return { req, res, promise };
}

async function runStep(label: string, text: string, phone = '0788100001') {
  const { req, res, promise } = createMockSession(text, phone);
  console.log(`\n  ${BLUE}▶ Testing: ${label} (text: "${text}")${RESET}`);
  await handleUSSDRequest(req, res);
  const result = await promise;
  console.log(`  ${GREEN}Response:${RESET}`);
  console.log(result.split('\n').map(l => '    ' + l).join('\n'));
  return result;
}

async function testAll() {
  console.log(`\n${BOLD}${BLUE}${'═'.repeat(55)}`);
  console.log(`  Local Mock USSD Logic Validation`);
  console.log(`${'═'.repeat(55)}${RESET}\n`);

  try {
    // 1. Root Menu
    await runStep('Root Menu display', '');

    // 2. Option 5 Check Balance (access denied on invalid PIN)
    await runStep('Option 5 - Card Check (Wrong PIN)', '5*NFC-1111*9999');

    // 3. Option 4 Reward sharing (decimal validation checks)
    await runStep('Option 4 - Share Rewards (Invalid decimals)', '4*REW123*1*MTR-001*1.234*0788100002*1');

    // 4. Option 1 Gura Gas (Invalid Meter check)
    await runStep('Option 1 - Gura Gas (Invalid Meter)', '1*1*MTR-INVALID');

    // 5. Option 3 Kora Order Retailer Selection Menu
    await runStep('Option 3 - Province Selection', '3');
    await runStep('Option 3 - District Selection', '3*1');
    await runStep('Option 3 - Retailer selection screen (Kigali -> Nyarugenge)', '3*1*1');

    console.log(`\n${BOLD}${GREEN}✔ All local logic simulation tests successfully processed.${RESET}`);
  } catch (err: any) {
    console.error(`${RED}❌ Local test run encountered error: ${err.message}${RESET}`);
  }
}

testAll();
