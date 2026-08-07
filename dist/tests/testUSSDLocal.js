"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const ussdController_1 = require("../controllers/ussdController");
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
// Mock request and response creator
function createMockSession(text, phone = '0788100001') {
    const req = {
        body: {
            sessionId: 'test-session-' + Date.now(),
            phoneNumber: phone,
            serviceCode: '*123#',
            text
        }
    };
    let resolvePromise;
    const promise = new Promise((resolve) => {
        resolvePromise = resolve;
    });
    const res = {
        send: (data) => {
            resolvePromise(data);
            return res;
        }
    };
    return { req, res, promise };
}
function runStep(label_1, text_1) {
    return __awaiter(this, arguments, void 0, function* (label, text, phone = '0788100001') {
        const { req, res, promise } = createMockSession(text, phone);
        console.log(`\n  ${BLUE}▶ Testing: ${label} (text: "${text}")${RESET}`);
        yield (0, ussdController_1.handleUSSDRequest)(req, res);
        const result = yield promise;
        console.log(`  ${GREEN}Response:${RESET}`);
        console.log(result.split('\n').map(l => '    ' + l).join('\n'));
        return result;
    });
}
function testAll() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`\n${BOLD}${BLUE}${'═'.repeat(55)}`);
        console.log(`  Local Mock USSD Logic Validation`);
        console.log(`${'═'.repeat(55)}${RESET}\n`);
        try {
            // 1. Root Menu
            yield runStep('Root Menu display', '');
            // 2. Option 5 Check Balance (access denied on invalid PIN)
            yield runStep('Option 5 - Card Check (Wrong PIN)', '5*NFC-1111*9999');
            // 3. Option 4 Reward sharing (decimal validation checks)
            yield runStep('Option 4 - Share Rewards (Invalid decimals)', '4*REW123*1*MTR-001*1.234*0788100002*1');
            // 4. Option 1 Gura Gas (Invalid Meter check)
            yield runStep('Option 1 - Gura Gas (Invalid Meter)', '1*1*MTR-INVALID');
            // 5. Option 3 Kora Order Retailer Selection Menu
            yield runStep('Option 3 - Province Selection', '3');
            yield runStep('Option 3 - District Selection', '3*1');
            yield runStep('Option 3 - Retailer selection screen (Kigali -> Nyarugenge)', '3*1*1');
            console.log(`\n${BOLD}${GREEN}✔ All local logic simulation tests successfully processed.${RESET}`);
        }
        catch (err) {
            console.error(`${RED}❌ Local test run encountered error: ${err.message}${RESET}`);
        }
    });
}
testAll();
