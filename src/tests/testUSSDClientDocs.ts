import { handleUSSDRequest } from '../controllers/ussdController';
import { Request, Response } from 'express';
import prisma from '../utils/prisma';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function testMTNFlow() {
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
  } as unknown as Request;

  let xmlResponse1 = '';
  const res1 = {
    type: () => res1,
    status: () => res1,
    send: (data: string) => {
      xmlResponse1 = data;
      return res1;
    }
  } as unknown as Response;

  await handleUSSDRequest(req1, res1);
  console.log('MTN First request response:');
  console.log(xmlResponse1);

  if (xmlResponse1.includes('<freeflowState>FC</freeflowState>') && xmlResponse1.includes('Gura Gas')) {
    console.log(`${GREEN}✔ MTN First Request passed${RESET}`);
  } else {
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
  } as unknown as Request;

  let xmlResponse2 = '';
  const res2 = {
    type: () => res2,
    status: () => res2,
    send: (data: string) => {
      xmlResponse2 = data;
      return res2;
    }
  } as unknown as Response;

  await handleUSSDRequest(req2, res2);
  console.log('MTN Continuing request response:');
  console.log(xmlResponse2);

  if (xmlResponse2.includes('<freeflowState>FC</freeflowState>') && xmlResponse2.includes('Enter Card Number')) {
    console.log(`${GREEN}✔ MTN Continuing Request passed${RESET}`);
  } else {
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
  } as unknown as Request;

  let cleanupResponse = '';
  const resCleanup = {
    type: () => resCleanup,
    status: () => resCleanup,
    send: (data: string) => {
      cleanupResponse = data;
      return resCleanup;
    }
  } as unknown as Response;

  await handleUSSDRequest(reqCleanup, resCleanup);
  const sessionCheck = await prisma.ussdSession.findUnique({ where: { sessionId } });
  if (!sessionCheck) {
    console.log(`${GREEN}✔ MTN Cleanup Request passed (session deleted)${RESET}`);
  } else {
    console.log(`${RED}❌ MTN Cleanup Request failed (session still exists)${RESET}`);
  }
}

async function testAirtelFlow() {
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
  } as unknown as Request;

  let airtelResponse1 = '';
  let freeflowHeader1 = '';
  const res1 = {
    type: () => res1,
    status: () => res1,
    setHeader: (name: string, value: string) => {
      if (name === 'Freeflow') freeflowHeader1 = value;
      return res1;
    },
    send: (data: string) => {
      airtelResponse1 = data;
      return res1;
    }
  } as unknown as Response;

  await handleUSSDRequest(req1, res1);
  console.log(`Airtel Response: "${airtelResponse1}"`);
  console.log(`Airtel Freeflow Header: "${freeflowHeader1}"`);

  if (freeflowHeader1 === 'FC' && airtelResponse1.includes('Gura Gas')) {
    console.log(`${GREEN}✔ Airtel First Request passed${RESET}`);
  } else {
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
  } as unknown as Request;

  let airtelResponse2 = '';
  let freeflowHeader2 = '';
  const res2 = {
    type: () => res2,
    status: () => res2,
    setHeader: (name: string, value: string) => {
      if (name === 'Freeflow') freeflowHeader2 = value;
      return res2;
    },
    send: (data: string) => {
      airtelResponse2 = data;
      return res2;
    }
  } as unknown as Response;

  await handleUSSDRequest(req2, res2);
  console.log(`Airtel Response 2: "${airtelResponse2}"`);
  console.log(`Airtel Freeflow Header 2: "${freeflowHeader2}"`);

  if (freeflowHeader2 === 'FC' && airtelResponse2.includes('Enter Card Number')) {
    console.log(`${GREEN}✔ Airtel Continuing Request passed${RESET}`);
  } else {
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
  } as unknown as Request;

  const resCleanup = {
    type: () => resCleanup,
    status: () => resCleanup,
    setHeader: () => resCleanup,
    send: () => resCleanup
  } as unknown as Response;

  await handleUSSDRequest(reqCleanup, resCleanup);
  const sessionCheck = await prisma.ussdSession.findUnique({ where: { sessionId: `airtel-${phone}` } });
  if (!sessionCheck) {
    console.log(`${GREEN}✔ Airtel Cleanup Request passed (session deleted)${RESET}`);
  } else {
    console.log(`${RED}❌ Airtel Cleanup Request failed (session still exists)${RESET}`);
  }
}

async function run() {
  try {
    await testMTNFlow();
    await testAirtelFlow();
  } catch (err: any) {
    console.error('Test run failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
