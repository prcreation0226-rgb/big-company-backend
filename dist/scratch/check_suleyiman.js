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
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        console.log('--- Suleyiman User Details ---');
        const profile = yield prisma.consumerProfile.findUnique({
            where: { id: 17 },
            include: { user: true }
        });
        if (profile) {
            console.log(`Consumer ID: ${profile.id}`);
            console.log(`User ID: ${profile.userId}`);
            console.log(`Name: ${profile.fullName || ((_a = profile.user) === null || _a === void 0 ? void 0 : _a.name)}`);
            console.log(`Phone in DB: [${(_b = profile.user) === null || _b === void 0 ? void 0 : _b.phone}]`);
            console.log(`Email in DB: [${(_c = profile.user) === null || _c === void 0 ? void 0 : _c.email}]`);
        }
        else {
            console.log('Suleyiman profile (ID 17) not found.');
        }
        yield prisma.$disconnect();
    });
}
run().catch(console.error);
