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
function count() {
    return __awaiter(this, void 0, void 0, function* () {
        const r1 = yield prisma_1.default.gasReward.findMany({ where: { consumerId: 1 } });
        const r2 = yield prisma_1.default.gasReward.findMany({ where: { consumerId: 2 } });
        const sum1 = r1.reduce((sum, r) => sum + r.units, 0);
        const sum2 = r2.reduce((sum, r) => sum + r.units, 0);
        console.log(`=== REWARDS STATE ===`);
        console.log(`Consumer 1 (250788123456): ${r1.length} records | Total Balance: ${sum1.toFixed(4)} M³`);
        console.log(`Consumer 2 (250788100001): ${r2.length} records | Total Balance: ${sum2.toFixed(4)} M³`);
        console.log(`======================`);
        yield prisma_1.default.$disconnect();
    });
}
count();
