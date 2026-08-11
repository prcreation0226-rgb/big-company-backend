"use strict";
// import axios from 'axios';
// import crypto from 'crypto';
// import prisma from '../utils/prisma';
// import { monitoringService } from './monitoring.service';
// class PalmKashService {
//   private clientId: string;
//   private secretKey: string;
//   private env: string;
//   private baseUrl: string;
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
//   constructor() {
//     this.clientId = process.env.PALMKASH_CLIENT_ID || '';
//     this.secretKey = process.env.PALMKASH_SECRET_KEY || '';
//     this.env = process.env.PALMKASH_ENV || 'sandbox';
//     this.baseUrl = process.env.PALMKASH_API_URL || 'https://dashboard.palmkash.com/api/v1';
//   }
//   /**
//    * Get Authentication Token
//    */
//   private async getAccessToken(): Promise<string> {
//     try {
//       return "";
//     } catch (error: any) {
//       console.error('PalmKash Auth Error:', error.response?.data || error.message);
//       throw new Error('Failed to authenticate with PalmKash');
//     }
//   }
//   /**
//    * Initiate Mobile Money Payment
//    */
//   async initiatePayment(params: {
//     amount: number;
//     phoneNumber: string;
//     referenceId: string;
//     description: string;
//     callbackUrl?: string;
//     customerEmail?: string;
//     customerName?: string;
//   }) {
//     const isDev = process.env.DEV_MODE === 'true' || process.env.DEV_MODE === '1';
//     console.log(`🔌 [PalmKash] DEV_MODE config: "${process.env.DEV_MODE}", isDev: ${isDev}`);
//     if (isDev) {
//       console.log(`🛠️ [PalmKash DEV MODE] Bypassing real payment for ${params.phoneNumber}, Amount: ${params.amount}`);
//       return {
//         success: true,
//         transactionId: `DEV-TXN-${Date.now()}`,
//         status: 'SUCCESS', // Simulate immediate success in DEV_MODE
//         message: 'Payment simulated (DEV_MODE active)'
//       };
//     }
//     try {
//       // Ensure phone number starts with 250 for Rwanda
//       let phone = params.phoneNumber.replace(/\s+/g, ''); // Remove spaces
//       if (phone.startsWith('0') && phone.length === 10) {
//         phone = '250' + phone.substring(1);
//       } else if (phone.length === 9 || phone.length === 10) {
//         // If it's a 9 or 10 digit number without 250, add it
//         if (!phone.startsWith('250')) {
//           phone = '250' + phone;
//         }
//       }
//       console.log(`🚀 [PalmKash] Initiating payment for ${phone}, Amount: ${params.amount}`);
//       // Official Endpoint
//       const url = `${this.baseUrl}/payments/make-payment`;
//       const callback_url = `${process.env.BACKEND_URL || 'https://big-company-backend-production.up.railway.app'}/api/webhooks/palmkash`;
//       const requestBody = {
//         merchant_id: this.clientId,
//         client_reference: params.referenceId,
//         phone_number: phone,
//         amount: params.amount,
//         currency: "RWF",
//         callback_url: callback_url,
//         customer_email: params.customerEmail || "customer@big.co.rw",
//         customer_name: params.customerName || "Valued Customer"
//       };
//       const timestamp = Math.floor(Date.now() / 1000).toString();
//       const bodyString = JSON.stringify(requestBody);
//       const signaturePayload = `${timestamp}.${bodyString}`;
//       const signature = crypto
//         .createHmac('sha256', this.secretKey)
//         .update(signaturePayload)
//         .digest('hex');
//       const requestHeaders = {
//         'Content-Type': 'application/json',
//         'Accept': 'application/json',
//         'X-Merchant-Key': this.clientId,
//         'X-Timestamp': timestamp,
//         'X-Signature': signature,
//         'X-Frame-Options': 'DENY',
//         'X-Content-Type-Options': 'nosniff',
//         'Referrer-Policy': 'no-referrer',
//         'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
//       };
//       // DEBUG LOGS BEFORE REQUEST
//       console.log('--- [PalmKash PRE-REQUEST DEBUG] ---');
//       console.log('URL:', url);
//       console.log('Headers:', JSON.stringify(requestHeaders, null, 2));
//       console.log('Body:', JSON.stringify(requestBody, null, 2));
//       console.log('------------------------------------');
//       const response = await axios.post(url, requestBody, {
//         headers: requestHeaders,
//         timeout: 15000,
//         validateStatus: (status) => status < 500
//       });
//       // DEBUG LOGS AFTER RESPONSE
//       console.log('--- [PalmKash POST-RESPONSE DEBUG] ---');
//       console.log('Status Code:', response.status);
//       console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
//       console.log('Content-Type:', response.headers['content-type']);
//       console.log(response.status);
//       console.log(response.headers);
//       console.log(response.data);
//       console.log('-------------------------------------');
//       // Check for Cloudflare/Non-JSON response
//       const contentType = response.headers['content-type'] || '';
//       if (!contentType.includes('application/json')) {
//         console.error('❌ [PalmKash] Received non-JSON response (likely Cloudflare block)');
//         await monitoringService.reportApiFailure('PALMKASH_API', 'Received non-JSON response (likely Cloudflare block)');
//         return {
//           success: false,
//           error: "PalmKash blocked request — server/IP not trusted yet",
//           status: "FAILED"
//         };
//       }
//       if (response.status >= 400) {
//         await monitoringService.reportApiFailure('PALMKASH_API', response.data.error || response.data.message || 'Payment initiation failed');
//         return {
//           success: false,
//           error: response.data.error || response.data.message || 'Payment initiation failed',
//           status: "FAILED",
//           transactionId: params.referenceId
//         };
//       }
//       await monitoringService.reportApiRecovery('PALMKASH_API');
//       return {
//         success: true,
//         transactionId: response.data.reference || response.data.transaction_id,
//         status: response.data.status || 'pending',
//         message: response.data.message || 'Payment initiated'
//       };
//     } catch (error: any) {
//       console.log("Status:", error.response?.status);
//       console.log("Headers:", error.response?.headers);
//       console.log("Body:", error.response?.data);
//       console.error('PalmKash Payment Error:', error.response?.data || error.message);
//       await monitoringService.reportApiFailure('PALMKASH_API', error.message || 'PalmKash connection failed');
//       // If we still get a 500 or network error that wasn't caught by validateStatus
//       const contentType = error.response?.headers?.['content-type'] || '';
//       if (error.response && !contentType.includes('application/json')) {
//         return {
//           success: false,
//           error: "PalmKash blocked request — server/IP not trusted yet",
//           status: "FAILED"
//         };
//       }
//       return {
//         success: false,
//         error: error.response?.data?.message || error.message || 'PalmKash connection failed',
//         status: "FAILED",
//         transactionId: params.referenceId
//       };
//     }
//   }
//   /**
//    * Verify Payment Status
//    * Updated Endpoint: /payments/get-payment-status
//    */
//   async verifyPayment(transactionId: string) {
//     try {
//       const response = await axios.post(`${this.baseUrl}/payments/get-payment-status`, {
//         app_id: this.clientId,
//         app_secret: this.secretKey,
//         reference: transactionId
//       }, {
//         headers: {
//           'Authorization': `Bearer ${this.secretKey}`,
//           'Content-Type': 'application/json',
//           'Accept': 'application/json'
//         }
//       });
//       console.log(response.status);
//       console.log(response.headers);
//       console.log(response.data);
//       await monitoringService.reportApiRecovery('PALMKASH_API');
//       return response.data; // { status: 'SUCCESS' | 'FAILED' | 'PENDING', ... }
//     } catch (error: any) {
//       console.log("Status:", error.response?.status);
//       console.log("Headers:", error.response?.headers);
//       console.log("Body:", error.response?.data);
//       console.error('PalmKash Verify Error:', error.response?.data || error.message);
//       await monitoringService.reportApiFailure('PALMKASH_API', error.message || 'PalmKash verify failed');
//       return { status: 'ERROR', message: error.message };
//     }
//   }
// }
// export default new PalmKashService();
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const monitoring_service_1 = require("./monitoring.service");
class PalmKashService {
    constructor() {
        var _a, _b, _c;
        this.clientId = ((_a = process.env.PALMKASH_CLIENT_ID) === null || _a === void 0 ? void 0 : _a.trim()) || '';
        this.secretKey = ((_b = process.env.PALMKASH_SECRET_KEY) === null || _b === void 0 ? void 0 : _b.trim()) || '';
        this.env = ((_c = process.env.PALMKASH_ENV) === null || _c === void 0 ? void 0 : _c.trim()) || 'sandbox';
        this.baseUrl = (process.env.PALMKASH_API_URL ||
            'https://testdashboard.palmkash.com/api/v1').replace(/\/+$/, '');
        if (!this.clientId) {
            console.error('[PalmKash] PALMKASH_CLIENT_ID is missing');
        }
        if (!this.secretKey) {
            console.error('[PalmKash] PALMKASH_SECRET_KEY is missing');
        }
    }
    initiatePayment(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            const isDev = process.env.DEV_MODE === 'true' ||
                process.env.DEV_MODE === '1';
            if (isDev) {
                return {
                    success: true,
                    transactionId: `DEV-TXN-${Date.now()}`,
                    status: 'SUCCESS',
                    message: 'Payment simulated because DEV_MODE is active'
                };
            }
            if (!this.clientId || !this.secretKey) {
                return {
                    success: false,
                    status: 'FAILED',
                    transactionId: params.referenceId,
                    error: 'PalmKash credentials are not configured'
                };
            }
            try {
                const phone = this.normalizeRwandanPhone(params.phoneNumber);
                const url = `${this.baseUrl}/payments/make-payment`;
                const callbackUrl = params.callbackUrl ||
                    `${process.env.BACKEND_URL}/api/webhooks/palmkash`;
                if (!process.env.BACKEND_URL && !params.callbackUrl) {
                    throw new Error('BACKEND_URL or callbackUrl must be configured');
                }
                const requestBody = {
                    merchant_id: this.clientId,
                    client_reference: params.referenceId,
                    phone_number: phone,
                    customer_name: params.customerName || 'Valued Customer',
                    customer_email: params.customerEmail || 'customer@big.co.rw',
                    amount: params.amount,
                    callback_url: callbackUrl,
                    currency: 'RWF'
                };
                /*
                 * The exact serialized string used for signing
                 * must also be the exact body transmitted.
                 */
                const bodyString = JSON.stringify(requestBody);
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const payload = `${timestamp}.${bodyString}`;
                const signature = crypto_1.default
                    .createHmac('sha256', Buffer.from(this.clientId.trim(), 'utf8'))
                    .update(Buffer.from(payload, 'utf8'))
                    .digest('hex');
                let response;
                const maxAttempts = 3;
                let lastError = null;
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    try {
                        console.log(`[PalmKash] Sending payment request (Attempt ${attempt}/${maxAttempts})...`);
                        response = yield axios_1.default.post(url, bodyString, {
                            headers: {
                                'Content-Type': 'application/json',
                                Accept: 'application/json',
                                Authorization: `Bearer ${this.secretKey}`,
                                'X-Merchant-Key': this.clientId,
                                'X-Timestamp': timestamp,
                                'X-Signature': signature,
                                /*
                                 * PalmKash Swagger currently marks these headers as required,
                                 * so retain them until PalmKash confirms otherwise.
                                 */
                                'X-Frame-Options': 'DENY',
                                'X-Content-Type-Options': 'nosniff',
                                'Referrer-Policy': 'no-referrer',
                                'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
                                /*
                                 * A descriptive server User-Agent can help PalmKash identify
                                 * and allow legitimate API traffic.
                                 */
                                'User-Agent': 'BigCompanyBackend/1.0'
                            },
                            timeout: 10000,
                            // Allows us to inspect 4xx responses without throwing.
                            validateStatus: status => status < 500,
                            // Prevent Axios from serializing the already serialized body again.
                            transformRequest: [data => data]
                        });
                        break;
                    }
                    catch (err) {
                        console.warn(`[PalmKash] Payment request attempt ${attempt} failed:`, err.message);
                        lastError = err;
                        if (attempt < maxAttempts) {
                            yield new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                }
                if (!response) {
                    throw lastError || new Error('Failed to reach PalmKash after multiple attempts');
                }
                const contentType = String(response.headers['content-type'] || '').toLowerCase();
                const cloudflareDetails = {
                    status: response.status,
                    server: response.headers.server,
                    cfRay: response.headers['cf-ray'],
                    cfMitigated: response.headers['cf-mitigated'],
                    contentType
                };
                console.log('[PalmKash] Response metadata:', cloudflareDetails);
                if (!contentType.includes('application/json')) {
                    const responsePreview = typeof response.data === 'string'
                        ? response.data.slice(0, 500)
                        : JSON.stringify(response.data).slice(0, 500);
                    console.error('[PalmKash] Non-JSON response:', Object.assign(Object.assign({}, cloudflareDetails), { responsePreview }));
                    yield monitoring_service_1.monitoringService.reportApiFailure('PALMKASH_API', `Non-JSON response. HTTP ${response.status}; CF-Ray: ${response.headers['cf-ray'] || 'not provided'}`);
                    return {
                        success: false,
                        status: 'FAILED',
                        transactionId: params.referenceId,
                        error: response.status === 403
                            ? 'PalmKash gateway blocked the server request. PalmKash must allow the backend outbound IP or adjust its Cloudflare API rules.'
                            : `PalmKash returned a non-JSON response with HTTP ${response.status}`,
                        diagnostic: cloudflareDetails
                    };
                }
                if (response.status >= 400) {
                    const message = ((_a = response.data) === null || _a === void 0 ? void 0 : _a.message) ||
                        ((_b = response.data) === null || _b === void 0 ? void 0 : _b.error) ||
                        'Payment initiation failed';
                    yield monitoring_service_1.monitoringService.reportApiFailure('PALMKASH_API', message);
                    return {
                        success: false,
                        status: 'FAILED',
                        transactionId: params.referenceId,
                        error: message,
                        details: response.data
                    };
                }
                yield monitoring_service_1.monitoringService.reportApiRecovery('PALMKASH_API');
                return {
                    success: true,
                    transactionId: response.data.reference ||
                        response.data.transaction_id ||
                        params.referenceId,
                    status: response.data.status || 'pending',
                    message: response.data.message || 'Payment initiated'
                };
            }
            catch (error) {
                const status = (_c = error.response) === null || _c === void 0 ? void 0 : _c.status;
                const headers = ((_d = error.response) === null || _d === void 0 ? void 0 : _d.headers) || {};
                const contentType = String(headers['content-type'] || '').toLowerCase();
                console.error('[PalmKash] Request failed:', {
                    status,
                    message: error.message,
                    server: headers.server,
                    cfRay: headers['cf-ray'],
                    cfMitigated: headers['cf-mitigated'],
                    contentType,
                    response: typeof ((_e = error.response) === null || _e === void 0 ? void 0 : _e.data) === 'string'
                        ? error.response.data.slice(0, 500)
                        : (_f = error.response) === null || _f === void 0 ? void 0 : _f.data
                });
                yield monitoring_service_1.monitoringService.reportApiFailure('PALMKASH_API', error.message || 'PalmKash connection failed');
                const isCloudflareResponse = ((_g = headers.server) === null || _g === void 0 ? void 0 : _g.toLowerCase().includes('cloudflare')) ||
                    Boolean(headers['cf-ray']) ||
                    Boolean(headers['cf-mitigated']);
                return {
                    success: false,
                    status: 'FAILED',
                    transactionId: params.referenceId,
                    error: isCloudflareResponse
                        ? 'PalmKash Cloudflare security blocked the backend request'
                        : ((_j = (_h = error.response) === null || _h === void 0 ? void 0 : _h.data) === null || _j === void 0 ? void 0 : _j.message) ||
                            error.message ||
                            'PalmKash connection failed',
                    diagnostic: {
                        httpStatus: status,
                        cfRay: headers['cf-ray'],
                        cfMitigated: headers['cf-mitigated']
                    }
                };
            }
        });
    }
    normalizeRwandanPhone(value) {
        let phone = value.replace(/[^\d+]/g, '');
        if (phone.startsWith('+')) {
            phone = phone.substring(1);
        }
        if (phone.startsWith('0')) {
            phone = `250${phone.substring(1)}`;
        }
        else if (!phone.startsWith('250')) {
            phone = `250${phone}`;
        }
        /*
         * Rwanda format:
         * country code 250 plus nine national digits.
         */
        if (!/^250\d{9}$/.test(phone)) {
            throw new Error('Invalid Rwanda phone number. Expected format: 2507XXXXXXXX');
        }
        return phone;
    }
}
exports.default = new PalmKashService();
