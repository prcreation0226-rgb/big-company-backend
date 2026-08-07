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
const ussdController_1 = require("../controllers/ussdController");
const prisma_1 = __importDefault(require("../utils/prisma"));
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
function testMTNFlow() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`\n${BOLD}${BLUE}--- Testing MTN USSD Flow (XML) ---${RESET}`);
        const sessionId = 'mtn-session-' + Date.now();
        const phone = '250796855123';
        // 1. First time request (Root menu)
        const xml1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<request type="pull">
   <subscriberInput>939</subscriberInput>
   <sessionId>${sessionId}</sessionId>
   <msisdn>${phone}</msisdn>
   <newRequest>1</newRequest>
   <parameters></parameters>
   <freeflow><mode>FD</mode></freeflow>
</request>`;
        const req1 = {
            headers: { 'content-type': 'application/xml' },
            body: xml1
        };
        let xmlResponse1 = '';
        const res1 = {
            type: () => res1,
            status: () => res1,
            send: (data) => {
                xmlResponse1 = data;
                return res1;
            }
        };
        yield (0, ussdController_1.handleUSSDRequest)(req1, res1);
        console.log('MTN First request response:');
        console.log(xmlResponse1);
        if (xmlResponse1.includes('<freeflowState>FC</freeflowState>') && xmlResponse1.includes('Gura Gas')) {
            console.log(`${GREEN}✔ MTN First Request passed${RESET}`);
        }
        else {
            console.log(`${RED}❌ MTN First Request failed${RESET}`);
        }
        // 2. Continuing Request: User enters "5" (Reba balance)
        const xml2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<request type="pull">
   <subscriberInput>5</subscriberInput>
   <sessionId>${sessionId}</sessionId>
   <msisdn>${phone}</msisdn>
   <newRequest>0</newRequest>
   <parameters></parameters>
   <freeflow><mode>FE</mode></freeflow>
</request>`;
        const req2 = {
            headers: { 'content-type': 'application/xml' },
            body: xml2
        };
        let xmlResponse2 = '';
        const res2 = {
            type: () => res2,
            status: () => res2,
            send: (data) => {
                xmlResponse2 = data;
                return res2;
            }
        };
        yield (0, ussdController_1.handleUSSDRequest)(req2, res2);
        console.log('MTN Continuing request response:');
        console.log(xmlResponse2);
        if (xmlResponse2.includes('<freeflowState>FC</freeflowState>') && xmlResponse2.includes('Enter Card Number')) {
            console.log(`${GREEN}✔ MTN Continuing Request passed${RESET}`);
        }
        else {
            console.log(`${RED}❌ MTN Continuing Request failed${RESET}`);
        }
        // 3. Cleanup Request
        const xmlCleanup = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<request type="cleanup">
   <sessionId>${sessionId}</sessionId>
   <msisdn>${phone}</msisdn>
   <statusCode>523</statusCode>
</request>`;
        const reqCleanup = {
            headers: { 'content-type': 'application/xml' },
            body: xmlCleanup
        };
        let cleanupResponse = '';
        const resCleanup = {
            type: () => resCleanup,
            status: () => resCleanup,
            send: (data) => {
                cleanupResponse = data;
                return resCleanup;
            }
        };
        yield (0, ussdController_1.handleUSSDRequest)(reqCleanup, resCleanup);
        const sessionCheck = yield prisma_1.default.ussdSession.findUnique({ where: { sessionId } });
        if (!sessionCheck) {
            console.log(`${GREEN}✔ MTN Cleanup Request passed (session deleted)${RESET}`);
        }
        else {
            console.log(`${RED}❌ MTN Cleanup Request failed (session still exists)${RESET}`);
        }
    });
}
function testAirtelFlow() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`\n${BOLD}${BLUE}--- Testing Airtel USSD Flow (Form URL-encoded) ---${RESET}`);
        const phone = '919845098450';
        // 1. Initial request (Dialing root code 121)
        const req1 = {
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: {
                userid: 'app1',
                password: 'app1pwd',
                MSISDN: phone,
                MSC: '*121#',
                input: '121'
            }
        };
        let airtelResponse1 = '';
        let freeflowHeader1 = '';
        const res1 = {
            type: () => res1,
            status: () => res1,
            setHeader: (name, value) => {
                if (name === 'Freeflow')
                    freeflowHeader1 = value;
                return res1;
            },
            send: (data) => {
                airtelResponse1 = data;
                return res1;
            }
        };
        yield (0, ussdController_1.handleUSSDRequest)(req1, res1);
        console.log(`Airtel Response: "${airtelResponse1}"`);
        console.log(`Airtel Freeflow Header: "${freeflowHeader1}"`);
        if (freeflowHeader1 === 'FC' && airtelResponse1.includes('Gura Gas')) {
            console.log(`${GREEN}✔ Airtel First Request passed${RESET}`);
        }
        else {
            console.log(`${RED}❌ Airtel First Request failed${RESET}`);
        }
        // 2. Continuing Request: User enters "5"
        const req2 = {
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: {
                userid: 'app1',
                password: 'app1pwd',
                MSISDN: phone,
                MSC: '*121#',
                input: '5'
            }
        };
        let airtelResponse2 = '';
        let freeflowHeader2 = '';
        const res2 = {
            type: () => res2,
            status: () => res2,
            setHeader: (name, value) => {
                if (name === 'Freeflow')
                    freeflowHeader2 = value;
                return res2;
            },
            send: (data) => {
                airtelResponse2 = data;
                return res2;
            }
        };
        yield (0, ussdController_1.handleUSSDRequest)(req2, res2);
        console.log(`Airtel Response 2: "${airtelResponse2}"`);
        console.log(`Airtel Freeflow Header 2: "${freeflowHeader2}"`);
        if (freeflowHeader2 === 'FC' && airtelResponse2.includes('Enter Card Number')) {
            console.log(`${GREEN}✔ Airtel Continuing Request passed${RESET}`);
        }
        else {
            console.log(`${RED}❌ Airtel Continuing Request failed${RESET}`);
        }
        // 3. Cleanup Request
        const reqCleanup = {
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: {
                userid: 'app1',
                password: 'app1pwd',
                MSISDN: phone,
                clean: 'clean-session',
                status: '522'
            }
        };
        const resCleanup = {
            type: () => resCleanup,
            status: () => resCleanup,
            setHeader: () => resCleanup,
            send: () => resCleanup
        };
        yield (0, ussdController_1.handleUSSDRequest)(reqCleanup, resCleanup);
        const sessionCheck = yield prisma_1.default.ussdSession.findUnique({ where: { sessionId: `airtel-${phone}` } });
        if (!sessionCheck) {
            console.log(`${GREEN}✔ Airtel Cleanup Request passed (session deleted)${RESET}`);
        }
        else {
            console.log(`${RED}❌ Airtel Cleanup Request failed (session still exists)${RESET}`);
        }
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield testMTNFlow();
            yield testAirtelFlow();
        }
        catch (err) {
            console.error('Test run failed:', err);
        }
        finally {
            yield prisma_1.default.$disconnect();
        }
    });
}
run();
