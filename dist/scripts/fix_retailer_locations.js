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
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Populating location data for test retailers...');
        // Update Retailer 1 (Corner Shop111)
        try {
            yield prisma.retailerProfile.update({
                where: { id: 1 },
                data: {
                    province: 'Kigali',
                    district: 'Gasabo',
                    sector: 'Remera'
                }
            });
        }
        catch (e) { }
        // Update Retailer 5 (test 3)
        try {
            yield prisma.retailerProfile.update({
                where: { id: 5 },
                data: {
                    province: 'Kigali',
                    district: 'Kicukiro',
                    sector: 'Kagarama'
                }
            });
        }
        catch (e) { }
        // Update Retailer 24 (IKIZERE SHOP)
        try {
            yield prisma.retailerProfile.update({
                where: { id: 24 },
                data: {
                    province: 'Kigali',
                    district: 'Gasabo',
                    sector: 'Remera'
                }
            });
        }
        catch (e) { }
        console.log('✅ Location data populated.');
    });
}
main()
    .catch(e => console.error(e))
    .finally(() => __awaiter(void 0, void 0, void 0, function* () { return yield prisma.$disconnect(); }));
