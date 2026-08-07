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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const BASE_URL = 'http://127.0.0.1:9001';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
function testUSSDStep(label_1, text_1) {
    return __awaiter(this, arguments, void 0, function* (label, text, phoneNumber = '+250788100001') {
        try {
            const res = yield axios_1.default.post(`${BASE_URL}/api/ussd`, {
                sessionId: 'test-session-' + Date.now(),
                phoneNumber,
                serviceCode: '*123#',
                text
            });
            console.log(`  ${BLUE}Payload: "${text}" => Response:${RESET}`);
            console.log(res.data.split('\n').map((l) => '    ' + l).join('\n'));
            return res.data;
        }
        catch (err) {
            console.log(`  ${RED}Request failed: ${err.message}${RESET}`);
            return null;
        }
    });
}
function runTests() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`\n${BOLD}${BLUE}${'═'.repeat(55)}`);
        console.log(`  USSD System Flow Integration Tests`);
        console.log(`${'═'.repeat(55)}${RESET}\n`);
        // ==========================================
        // ROOT MENU TEST
        // ==========================================
        console.log(`${BOLD}[TEST 1] Root Menu${RESET}`);
        yield testUSSDStep('Dialing USSD root', '');
        // ==========================================
        // OPTION 1: Gura Gas - Wallet Flow (Success Path)
        // ==========================================
        console.log(`\n${BOLD}[TEST 2] Option 1 (Gura Gas) - Wallet Payment Flow (Success)${RESET}`);
        // Assuming meter 'MTR-TEST-001' exists (or similar). Let's use whatever exists.
        // In the DB, there is seed data. Let's send the sequence:
        // choice: 1 (Gura Gas) -> meterNumber: MTR-TEST-001 (or direct number) -> amount: 1 (1st plan) -> paymentMethod: 2 (Wallet) -> cardNum: NFC-1111 (or UID) -> cardPin: 1234 -> walletType: 1 -> confirm: 1
        yield testUSSDStep('1. Option 1 selected', '1');
        yield testUSSDStep('2. Meter ID entered', '1*MTR-TEST-001');
        yield testUSSDStep('3. Amount selected', '1*MTR-TEST-001*1');
        yield testUSSDStep('4. Payment method selected', '1*MTR-TEST-001*1*2');
        yield testUSSDStep('5. Card number entered', '1*MTR-TEST-001*1*2*NFC-1111');
        yield testUSSDStep('6. Card PIN entered', '1*MTR-TEST-001*1*2*NFC-1111*1234');
        yield testUSSDStep('7. Wallet Type selected', '1*MTR-TEST-001*1*2*NFC-1111*1234*1');
        yield testUSSDStep('8. Confirmation Yes', '1*MTR-TEST-001*1*2*NFC-1111*1234*1*1');
        // ==========================================
        // OPTION 1: Gura Gas - Wallet Flow (Negative Path - Wrong PIN)
        // ==========================================
        console.log(`\n${BOLD}[TEST 3] Option 1 (Gura Gas) - Wrong Card PIN (Negative)${RESET}`);
        yield testUSSDStep('Wrong PIN Entered', '1*MTR-TEST-001*1*2*NFC-1111*9999*1*1');
        // ==========================================
        // OPTION 2: Ongera Amafaranga - Success Path
        // ==========================================
        console.log(`\n${BOLD}[TEST 4] Option 2 (Ongera amafaranga) - Wallet Top-Up (Success)${RESET}`);
        yield testUSSDStep('1. Option 2 selected', '2');
        yield testUSSDStep('2. Card number entered', '2*NFC-1111');
        yield testUSSDStep('3. Amount entered', '2*NFC-1111*5000');
        yield testUSSDStep('4. Confirmation Yes', '2*NFC-1111*5000*1');
        // ==========================================
        // OPTION 3: Kora Order - Success Path
        // ==========================================
        console.log(`\n${BOLD}[TEST 5] Option 3 (Kora order) - Retailer Order (Success)${RESET}`);
        yield testUSSDStep('1. Option 3 selected', '3');
        yield testUSSDStep('2. Province selected', '3*1');
        yield testUSSDStep('3. District selected', '3*1*1');
        // We need to enter retailer option next. We'll simulate 1
        yield testUSSDStep('4. Retailer selected', '3*1*1*1');
        yield testUSSDStep('5. Phone number entered', '3*1*1*1*0788100001');
        yield testUSSDStep('6. Confirmation Yes', '3*1*1*1*0788100001*1');
        // ==========================================
        // OPTION 4: Tanga Gas - Success & Negative Path (Decimal limit check)
        // ==========================================
        console.log(`\n${BOLD}[TEST 6] Option 4 (Tanga Gas) - Share Rewards Decimal Limit (Negative)${RESET}`);
        // 4*walletId*meterType*meterId*units*smsPhone*confirm
        // Units with 2 decimals (e.g. 1.25) -> should fail
        yield testUSSDStep('Units with 2 decimals', '4*REW123*1*MTR-TEST-001*1.25*0788100002*1');
        console.log(`\n${BOLD}[TEST 7] Option 4 (Tanga Gas) - Share Rewards (Success)${RESET}`);
        // Units with 1 decimal (e.g. 1.2) -> should pass validation checks
        // (Assuming REW123 exists and has reward balance, otherwise it will display reward validation error)
        yield testUSSDStep('1. Option 4 selected', '4');
        yield testUSSDStep('2. Reward Wallet ID entered', '4*REW123');
        yield testUSSDStep('3. Meter Type chosen', '4*REW123*1');
        yield testUSSDStep('4. Meter ID entered', '4*REW123*1*MTR-TEST-001');
        yield testUSSDStep('5. Valid Units entered', '4*REW123*1*MTR-TEST-001*1.2');
        yield testUSSDStep('6. SMS number entered', '4*REW123*1*MTR-TEST-001*1.2*0788100002');
        yield testUSSDStep('7. Confirmation Yes', '4*REW123*1*MTR-TEST-001*1.2*0788100002*1');
        // ==========================================
        // OPTION 5: Reba Balance
        // ==========================================
        console.log(`\n${BOLD}[TEST 8] Option 5 (Reba balance) - Check Balance (Success)${RESET}`);
        yield testUSSDStep('1. Option 5 selected', '5');
        yield testUSSDStep('2. Card number entered', '5*NFC-1111');
        yield testUSSDStep('3. Card PIN entered', '5*NFC-1111*1234');
    });
}
runTests();
