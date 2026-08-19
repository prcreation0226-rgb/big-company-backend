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
function checkDatabase() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🔍 Database GasTopups & CustomerOrders Check');
        try {
            const orderCount = yield prisma_1.default.order.count();
            console.log(`Order Count: ${orderCount}`);
            const saleCount = yield prisma_1.default.sale.count();
            console.log(`Sale Count: ${saleCount}`);
            const customerOrderCount = yield prisma_1.default.customerOrder.count();
            console.log(`CustomerOrder Count: ${customerOrderCount}`);
            const topups = yield prisma_1.default.gasTopup.findMany({
                take: 5,
                orderBy: { createdAt: 'desc' }
            });
            console.log('\n--- RECENT TOPUPS ---');
            for (const t of topups) {
                console.log(`Topup ID: ${t.id}, Amount: ${t.amount}, orderId: ${t.orderId}`);
            }
            if (topups.length > 0) {
                const firstOrderId = topups[0].orderId;
                if (firstOrderId) {
                    // Try searching for this orderId in Order or Sale
                    const parsedId = parseInt(firstOrderId);
                    if (!isNaN(parsedId)) {
                        const matchedSale = yield prisma_1.default.sale.findUnique({ where: { id: parsedId } });
                        console.log(`\nMatched Sale:`, matchedSale);
                        const matchedOrder = yield prisma_1.default.order.findUnique({ where: { id: parsedId } });
                        console.log(`Matched Order:`, matchedOrder);
                    }
                }
            }
        }
        catch (error) {
            console.error('❌ Check failed:', error);
        }
        finally {
            yield prisma_1.default.$disconnect();
        }
    });
}
checkDatabase();
