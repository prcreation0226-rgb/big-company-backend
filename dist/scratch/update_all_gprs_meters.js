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
        console.log('🔄 Fetching all GPRS/Tekana gas meters...');
        const meters = yield prisma.gasMeter.findMany({
            where: {
                OR: [
                    { isGprs: true },
                    { meterNumber: { startsWith: '2510170' } }
                ]
            }
        });
        console.log(`Found ${meters.length} meters to check.`);
        let updatedCount = 0;
        for (const meter of meters) {
            if (meter.meterType !== 'PIPING') {
                yield prisma.gasMeter.update({
                    where: { id: meter.id },
                    data: { meterType: 'PIPING' }
                });
                console.log(`✅ Updated meter ID ${meter.id} (Number: ${meter.meterNumber}) from ${meter.meterType} to PIPING`);
                updatedCount++;
            }
        }
        console.log(`🎉 Cleanup finished. Total meters updated: ${updatedCount}`);
    });
}
main()
    .catch(e => {
    console.error('❌ Update failed:', e);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
