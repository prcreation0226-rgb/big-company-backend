"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.setAppInstance = void 0;
const express_1 = require("express");
const prisma_1 = __importDefault(require("../utils/prisma"));
const router = (0, express_1.Router)();
// Store app reference for route listing
let appInstance = null;
const setAppInstance = (app) => { appInstance = app; };
exports.setAppInstance = setAppInstance;
// List all registered routes
router.get('/routes', (req, res) => {
    if (!appInstance) {
        return res.json({ error: 'App instance not set' });
    }
    const routes = [];
    const extractRoutes = (stack, basePath = '') => {
        stack.forEach((layer) => {
            if (layer.route) {
                const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
                routes.push({ method: methods, path: basePath + layer.route.path });
            }
            else if (layer.name === 'router' && layer.handle.stack) {
                const routerPath = layer.regexp.source
                    .replace('\\/?', '')
                    .replace('(?=\\/|$)', '')
                    .replace(/\\\//g, '/')
                    .replace('^', '')
                    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param');
                extractRoutes(layer.handle.stack, basePath + routerPath);
            }
        });
    };
    extractRoutes(appInstance._router.stack);
    // Filter for admin routes
    const adminRoutes = routes.filter(r => r.path.includes('/admin'));
    res.json({
        totalRoutes: routes.length,
        adminRoutes: adminRoutes,
        allRoutes: routes
    });
});
router.get('/', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Check Date
        const now = new Date();
        // 2. Check DB Connection
        let dbStatus = 'Unknown';
        let userCount = -1;
        let errorDetail = null;
        try {
            userCount = yield prisma_1.default.user.count();
            dbStatus = 'Connected';
        }
        catch (e) {
            dbStatus = 'Failed';
            errorDetail = e.message;
        }
        // 3. Check Env Vars (Masked)
        const dbUrl = process.env.DATABASE_URL || 'Not Set';
        const maskedDbUrl = dbUrl.length > 20
            ? `${dbUrl.substring(0, 10)}...${dbUrl.substring(dbUrl.length - 10)}`
            : dbUrl;
        res.json({
            status: 'Debug Info',
            version: 'v1.0.3-test',
            timestamp: now.toISOString(),
            environment: {
                NODE_ENV: process.env.NODE_ENV,
                PORT: process.env.PORT,
                DATABASE_URL: maskedDbUrl,
            },
            database: {
                status: dbStatus,
                userCount: userCount,
                error: errorDetail
            }
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Debug endpoint failed',
            message: error.message,
            stack: error.stack
        });
    }
}));
router.get('/check-wholesaler-products', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const products = yield prisma_1.default.product.findMany({
            where: {
                retailerId: null
            }
        });
        res.json(products.map(p => ({
            id: p.id,
            name: p.name,
            price: p.price,
            retailerPrice: p.retailerPrice,
            taxType: p.taxType
        })));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
}));
router.get('/check-retailer-products', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const products = yield prisma_1.default.product.findMany({
            where: {
                retailerId: { not: null }
            }
        });
        res.json(products);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
}));
router.get('/check-invoices', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const invoices = yield prisma_1.default.customProfitInvoice.findMany();
        res.json(invoices);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
}));
router.get('/seed-templates', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const results = [];
    const errors = [];
    const CUSTOMER_EMAIL_TEMPLATES = [
        { name: 'CUS-EMAIL-001', subject: 'Welcome to BIG Energy - Customer Account Created', description: 'Welcome email for customer signup', content: `<h2>Welcome to BIG Energy!</h2><p>Hello {{customer_name}},</p><p>Your customer account has been created successfully.</p><ul><li>Customer ID: {{customer_id}}</li></ul><p>Please keep your login credentials and card PIN secure at all times.</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-002', subject: 'Order Delivered - Receipt', description: 'Order delivery confirmation receipt', content: `<h2>Order Receipt Notification</h2><p>Hello {{customer_name}},</p><p>Your order <strong>{{order_id}}</strong> has been successfully delivered.</p><ul><li>Order ID: {{order_id}}</li><li>Delivery Date: {{delivery_date}}</li><li>Amount: {{amount}} RWF</li></ul><p>Thank you for shopping with us!</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-003', subject: 'Wallet Top-Up Successful', description: 'Confirmation email for customer wallet top-up', content: `<h2>Wallet Top-Up Successful</h2><p>Hello {{customer_name}},</p><p>Your wallet top-up was processed successfully.</p><ul><li>Amount: {{amount}} RWF</li><li>New Balance: {{new_balance}} RWF</li><li>Reference ID: {{transaction_id}}</li></ul><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-004', subject: 'Gas Meter Recharge Receipt', description: 'Receipt email for successful gas meter recharge', content: `<h2>Gas Meter Recharge Confirmation</h2><p>Hello {{customer_name}},</p><p>Your gas recharge for <strong>{{meter_name}}</strong> ({{meter_id}}) was successful.</p><ul><li>Recharge Amount: {{amount}} RWF</li><li>Token Code: <strong>{{token}}</strong></li><li>Reference ID: {{transaction_id}}</li></ul><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-005', subject: 'Password Reset - Your Temporary Password', description: 'Customer password reset temporary credentials email', content: `<h2>Password Reset Request</h2><p>Hello {{customer_name}},</p><p>A temporary password has been generated for your account:</p><div style="background-color:#f1f5f9;padding:15px;text-align:center;border-radius:8px;margin:20px 0;"><code style="font-size:20px;font-weight:bold;color:#0f766e;letter-spacing:1px;">{{temp_password}}</code></div><p style="color:#dc2626;font-size:14px;"><strong>Important:</strong> You will be required to change this password immediately upon logging in.</p><p>If you did not request this, please contact support at +250788541239.</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-006', subject: 'Gas Reward Balance Updated', description: 'Notification email when customer earns gas rewards', content: `<h2>You Earned Gas Rewards!</h2><p>Hello {{customer_name}},</p><p>Congratulations! You received <strong>{{reward_amount}} M³</strong> gas reward from your recent purchase.</p><ul><li>New Reward Balance: <strong>{{new_reward_balance}} M³</strong></li></ul><p>Redeem your rewards at any time through your customer portal.</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-007', subject: 'PIN or Password Security Alert', description: 'Security notification for PIN or password updates', content: `<h2>Security Alert - Credentials Updated</h2><p>Hello {{customer_name}},</p><p>Your account PIN or password was successfully updated at <strong>{{change_time}}</strong>.</p><p>If you did not make this change, contact support immediately at +250788541239.</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-008', subject: 'Security Alert - Failed Login Attempt', description: 'Security notification for failed login detection', content: `<h2>Failed Login Attempt Detected</h2><p>Hello {{customer_name}},</p><p>A failed login attempt was detected on your account at <strong>{{attempt_time}}</strong>.</p><p>If this was not you, change your PIN or password immediately.</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-009', subject: 'Refund Request Update', description: 'Confirmation email for customer refund request', content: `<h2>Refund Request Update</h2><p>Hello {{customer_name}},</p><p>We received your refund request. Our team is reviewing it.</p><ul><li>Refund Amount: {{amount}} RWF</li><li>Status: {{status}}</li><li>Submitted Date: {{date}}</li></ul><p>We will notify you once processed.</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-010', subject: 'Account Status Update', description: 'Notification email when customer account status changes', content: `<h2>Account Status Notification</h2><p>Hello {{customer_name}},</p><p>Your customer account status has been updated.</p><ul><li>Status: <strong>{{status}}</strong></li><li>Update Date: {{date}}</li></ul><p>Contact support if you have questions.</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
        { name: 'CUS-EMAIL-011', subject: 'System Notification', description: 'General system announcement template for customers', content: `<h2>System Update Notification</h2><p>Hello {{customer_name}},</p><p>We have a new update regarding our services.</p><p style="padding:15px;background-color:#f8fafc;border-left:4px solid #6366f1;border-radius:4px;">{{message}}</p><p>Thank you for choosing BIG Energy.</p><p>Regards,<br/>Big Innovation Group Ltd<br/>+250788541239<br/>Info@big.co.rw</p>` },
    ];
    const CUSTOMER_EMAIL_MAPPINGS = [
        { slug: 'customer-signup-email', template: 'CUS-EMAIL-001', desc: 'Customer account created welcome email' },
        { slug: 'customer-order-delivered-email', template: 'CUS-EMAIL-002', desc: 'Customer order delivered confirmation email' },
        { slug: 'customer-wallet-topup-email', template: 'CUS-EMAIL-003', desc: 'Customer wallet top-up confirmation email' },
        { slug: 'customer-gas-recharge-email', template: 'CUS-EMAIL-004', desc: 'Customer gas meter recharge receipt email' },
        { slug: 'customer-password-reset-email', template: 'CUS-EMAIL-005', desc: 'Customer password reset temporary credentials email' },
        { slug: 'customer-reward-update-email', template: 'CUS-EMAIL-006', desc: 'Customer gas reward update notification email' },
        { slug: 'customer-security-update-email', template: 'CUS-EMAIL-007', desc: 'Customer PIN/password security alert email' },
        { slug: 'customer-failed-login-email', template: 'CUS-EMAIL-008', desc: 'Failed login security warning email' },
        { slug: 'customer-refund-request-email', template: 'CUS-EMAIL-009', desc: 'Customer refund request email' },
        { slug: 'customer-account-status-email', template: 'CUS-EMAIL-010', desc: 'Customer account status activation/deactivation email' },
        { slug: 'customer-system-notification', template: 'CUS-EMAIL-011', desc: 'Customer general system notification email' },
    ];
    try {
        // Upsert all customer email templates
        for (const t of CUSTOMER_EMAIL_TEMPLATES) {
            try {
                yield prisma_1.default.emailTemplate.upsert({
                    where: { name: t.name },
                    update: { subject: t.subject, content: t.content, description: t.description, channel: 'EMAIL', portal: 'CUSTOMER', isActive: true, updatedBy: 'SYSTEM_INIT' },
                    create: { name: t.name, subject: t.subject, content: t.content, description: t.description, channel: 'EMAIL', portal: 'CUSTOMER', isActive: true, createdBy: 'SYSTEM_INIT', version: 1 }
                });
                results.push(`✅ Template ${t.name} seeded`);
            }
            catch (e) {
                errors.push(`❌ Template ${t.name} failed: ${e.message}`);
            }
        }
        // Upsert all customer email event mappings
        for (const m of CUSTOMER_EMAIL_MAPPINGS) {
            try {
                // @ts-ignore
                yield prisma_1.default.emailEvent.upsert({
                    where: { eventSlug: m.slug },
                    update: { templateName: m.template, description: m.desc },
                    create: { eventSlug: m.slug, templateName: m.template, description: m.desc }
                });
                results.push(`✅ Mapping ${m.slug} → ${m.template} seeded`);
            }
            catch (e) {
                errors.push(`❌ Mapping ${m.slug} failed: ${e.message}`);
            }
        }
        res.json({ success: true, seeded: results.length, results, errors });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
}));
router.get('/fix-taxes', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const results = [];
        const retailerProducts = yield prisma_1.default.product.findMany({
            where: {
                retailerId: { not: null }
            }
        });
        for (const product of retailerProducts) {
            const wholesalerProduct = yield prisma_1.default.product.findFirst({
                where: {
                    name: product.name,
                    retailerId: null,
                    wholesalerId: { not: null }
                }
            });
            if (wholesalerProduct) {
                const correctTaxType = wholesalerProduct.taxType || 'B';
                const config = yield prisma_1.default.systemConfig.findFirst();
                const retailerMarkup = (config === null || config === void 0 ? void 0 : config.retailerMarkup) || 20;
                let cleanCost = product.costPrice || product.price;
                if (!product.costPrice) {
                    const { reverseVATCalculation } = require('../utils/pricingReversalUtils');
                    const reversed = reverseVATCalculation(product.price, product.taxType);
                    cleanCost = reversed.cleanBaseCost;
                }
                const markupPrice = cleanCost * (1 + retailerMarkup / 100);
                const vatMultiplier = correctTaxType === 'B' ? 1.18 : 1;
                const newPrice = (wholesalerProduct.retailerPrice && wholesalerProduct.retailerPrice > cleanCost)
                    ? wholesalerProduct.retailerPrice
                    : Math.ceil(markupPrice * vatMultiplier);
                if (product.taxType !== correctTaxType || product.price !== newPrice) {
                    yield prisma_1.default.product.update({
                        where: { id: product.id },
                        data: {
                            taxType: correctTaxType,
                            price: newPrice,
                            costPrice: cleanCost
                        }
                    });
                    results.push({
                        name: product.name,
                        taxType: `${product.taxType} -> ${correctTaxType}`,
                        price: `${product.price} -> ${newPrice} RWF`,
                        costPrice: cleanCost
                    });
                }
            }
        }
        // Correct past invoices that have volume instead of value stored
        const pastInvoices = yield prisma_1.default.customProfitInvoice.findMany({
            where: {
                rewardsGivenAmt: { gt: 0, lt: 10 }
            }
        });
        for (const inv of pastInvoices) {
            const systemConfig = yield prisma_1.default.systemConfig.findFirst();
            const gasPrice = (systemConfig === null || systemConfig === void 0 ? void 0 : systemConfig.gasPricePerM3) || 6500;
            const correctRewardsVal = Math.round(inv.rewardsGivenAmt * gasPrice);
            const newTotalExpense = inv.rentExpense + inv.salariesExpense + inv.otherExpense + correctRewardsVal;
            const newNetProfit = Math.max(0, inv.grossProfit - newTotalExpense - inv.tax);
            const newRecipientShare = Math.round(newNetProfit * (inv.recipientSharePct / 100) * 100) / 100;
            const newCompanyShare = Math.round(newNetProfit * (inv.companySharePct / 100) * 100) / 100;
            yield prisma_1.default.customProfitInvoice.update({
                where: { id: inv.id },
                data: {
                    rewardsGivenAmt: correctRewardsVal,
                    totalExpense: newTotalExpense,
                    netProfit: newNetProfit,
                    recipientShareAmt: newRecipientShare,
                    companyShareAmt: newCompanyShare,
                    finalPayable: newRecipientShare
                }
            });
            results.push({
                invoiceId: inv.id,
                recipientName: inv.recipientName,
                rewardsGivenAmt: `${inv.rewardsGivenAmt} -> ${correctRewardsVal} RWF`,
                netProfit: `${inv.netProfit} -> ${newNetProfit} RWF`
            });
        }
        res.json({ success: true, updated: results });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
}));
// === GPRS METER DIAGNOSTIC TEST ===
router.get('/gprs-test', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const imei = req.query.imei || '865395070835713';
    const baseUrl = process.env.LORAWAN_BASE_URL || 'http://english.energyy.ucskype.com';
    const username = process.env.LORAWAN_USERNAME || 'Rwanda_Kayitare';
    const password = process.env.LORAWAN_PASSWORD || '123456';
    const results = { imei, baseUrl, tests: [] };
    try {
        const axios = (yield Promise.resolve().then(() => __importStar(require('axios')))).default;
        // Step 1: Login
        const loginPayload = { action: "lorawanMeter", method: "toLogin", params: { username, password } };
        const loginResp = yield axios.post(`${baseUrl}/api/commonInternal.jsp`, `requestParams=${encodeURIComponent(JSON.stringify(loginPayload))}`, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 });
        const apiToken = (_b = (_a = loginResp.data) === null || _a === void 0 ? void 0 : _a.value) === null || _b === void 0 ? void 0 : _b.apiToken;
        results.login = { success: !!apiToken, apiToken: apiToken ? `${apiToken.substring(0, 8)}...` : null, fullResponse: loginResp.data };
        if (!apiToken) {
            return res.json(Object.assign(Object.assign({}, results), { error: 'Login failed' }));
        }
        // Test all combinations
        const testCases = [
            { name: 'zlMeter+remotelyTopUp+imei', action: 'zlMeter', method: 'remotelyTopUp', paramKey: 'imei', extraParams: { topUpAmount: '1', topUpToDeviceAmount: '1' } },
            { name: 'zlMeter+remotelyTopUp+devEui', action: 'zlMeter', method: 'remotelyTopUp', paramKey: 'devEui', extraParams: { topUpAmount: '1', topUpToDeviceAmount: '1' } },
            { name: 'lorawanMeter+remotelyTopUp+imei', action: 'lorawanMeter', method: 'remotelyTopUp', paramKey: 'imei', extraParams: { topUpAmount: '1', topUpToDeviceAmount: '1' } },
            { name: 'lorawanMeter+remotelyTopUp+devEui', action: 'lorawanMeter', method: 'remotelyTopUp', paramKey: 'devEui', extraParams: { topUpAmount: '1', topUpToDeviceAmount: '1' } },
            { name: 'zlMeter+queryMeterInfo+imei', action: 'zlMeter', method: 'queryMeterInfo', paramKey: 'imei', extraParams: {} },
            { name: 'lorawanMeter+queryMeterInfo+imei', action: 'lorawanMeter', method: 'queryMeterInfo', paramKey: 'imei', extraParams: {} },
            { name: 'lorawanMeter+queryMeterInfo+devEui', action: 'lorawanMeter', method: 'queryMeterInfo', paramKey: 'devEui', extraParams: {} },
        ];
        for (const tc of testCases) {
            try {
                const payload = {
                    action: tc.action,
                    method: tc.method,
                    apiToken,
                    param: Object.assign({ [tc.paramKey]: imei }, tc.extraParams)
                };
                const resp = yield axios.post(`${baseUrl}/api/commonInternal.jsp`, `requestParams=${encodeURIComponent(JSON.stringify(payload))}`, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 });
                results.tests.push({ name: tc.name, payload: payload.param, response: resp.data });
            }
            catch (e) {
                results.tests.push({ name: tc.name, error: e.message });
            }
        }
        return res.json(results);
    }
    catch (e) {
        return res.json(Object.assign(Object.assign({}, results), { error: e.message }));
    }
}));
exports.default = router;
