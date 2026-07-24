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
const prisma_1 = __importDefault(require("./utils/prisma"));
const email_queue_1 = require("./queues/email.queue");
function triggerEmails() {
    return __awaiter(this, void 0, void 0, function* () {
        const targetEmail = 'lightlabcreation@gmail.com';
        console.log(`--- 🧪 TRIGGERING CUSTOMER EMAIL TEMPLATES FOR: ${targetEmail} ---`);
        // 1. Find or create a dummy user with the target email to populate template data correctly
        let user = yield prisma_1.default.user.findFirst({
            where: { email: targetEmail }
        });
        if (!user) {
            console.log(`ℹ️ Creating a temporary user record for ${targetEmail}...`);
            user = yield prisma_1.default.user.create({
                data: {
                    email: targetEmail,
                    name: 'Test Customer',
                    role: 'consumer',
                    isActive: true
                }
            });
        }
        // 2. Queue Customer Wallet Top-up Email (CUS-EMAIL-003)
        console.log('📬 Queuing Wallet Top-up Email (customer-wallet-topup-email)...');
        yield email_queue_1.emailQueue.add('customer-wallet-topup-email', {
            to: targetEmail,
            templateType: 'customer-wallet-topup-email', // Mapped to CUS-EMAIL-003
            data: {
                customer_name: user.name || 'Test Customer',
                amount: '50,000 RWF',
                new_balance: '53,000 RWF',
                transaction_id: 'TX-TOPUP-99999'
            },
            relatedEntity: { type: 'USER', id: user.id.toString() }
        });
        // 3. Queue Customer Order Confirmation Email (CUS-EMAIL-002)
        console.log('📬 Queuing Order Delivered / Confirmation Email (customer-order-delivered-email)...');
        yield email_queue_1.emailQueue.add('customer-order-delivered-email', {
            to: targetEmail,
            templateType: 'customer-order-delivered-email', // Mapped to CUS-EMAIL-002
            data: {
                customer_name: user.name || 'Test Customer',
                order_number: 'ORD-77777',
                total_amount: '12,500 RWF',
                quantity: '3',
                delivery_address: 'Kig Kigali, Rwanda'
            },
            relatedEntity: { type: 'USER', id: user.id.toString() }
        });
        console.log('✅ Emails successfully queued to Redis! The BullMQ email worker will process and deliver them shortly.');
        yield prisma_1.default.$disconnect();
        // Import emailWorker dynamically to close both the queue and worker, allowing the script to exit cleanly
        const { emailWorker } = require('./queues/email.queue');
        yield email_queue_1.emailQueue.close();
        yield emailWorker.close();
        console.log('👋 Connections closed successfully.');
    });
}
triggerEmails().catch(console.error);
