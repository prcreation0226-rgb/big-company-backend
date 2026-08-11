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
function checkRetailer24Links() {
    return __awaiter(this, void 0, void 0, function* () {
        const requests = yield prisma_1.default.customerLinkRequest.findMany({
            where: { retailerId: 24 },
            include: {
                customer: {
                    include: {
                        user: true
                    }
                }
            }
        });
        console.log('--- LINK REQUESTS FOR RETAILER 24 (IKIZERE SHOP) ---');
        console.log(requests);
    });
}
checkRetailer24Links();
