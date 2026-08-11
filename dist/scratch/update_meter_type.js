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
        console.log('🔄 Checking meter 2510170000067...');
        const meter = yield prisma.gasMeter.findFirst({
            where: { meterNumber: '2510170000067' }
        });
        if (!meter) {
            console.error('❌ Meter 2510170000067 not found in the database.');
            return;
        }
        console.log(`Current meter type: ${meter.meterType}`);
        if (meter.meterType === 'PIPING') {
            console.log('✅ Meter type is already PIPING.');
            return;
        }
        yield prisma.gasMeter.update({
            where: { id: meter.id },
            data: { meterType: 'PIPING' }
        });
        console.log('🎉 Successfully updated meter type to PIPING.');
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
