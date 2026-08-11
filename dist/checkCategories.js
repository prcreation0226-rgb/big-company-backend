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
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const products = yield prisma_1.default.product.findMany({
                select: { category: true }
            });
            const categories = [...new Set(products.map(p => p.category))];
            console.log('Unique product categories in database:', categories);
            // Also let's inspect if there are any Sales that have gas products
            const gasSales = yield prisma_1.default.sale.findMany({
                where: {
                    saleItems: {
                        some: {
                            product: {
                                category: { in: ['Gas', 'gas', 'GAS', 'lpg', 'LPG'] }
                            }
                        }
                    }
                },
                include: {
                    saleItems: {
                        include: { product: true }
                    }
                }
            });
            console.log(`Number of Sales containing gas products: ${gasSales.length}`);
            if (gasSales.length > 0) {
                console.log('Sample gas sale:', JSON.stringify(gasSales[0], null, 2));
            }
        }
        catch (error) {
            console.error('Error running script:', error.message);
        }
        finally {
            yield prisma_1.default.$disconnect();
        }
    });
}
run();
