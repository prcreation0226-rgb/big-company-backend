"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ussdController_1 = require("../controllers/ussdController");
const body_parser_1 = __importDefault(require("body-parser"));
const router = (0, express_1.Router)();
// Main USSD request entry point
// Parse raw text for XML payloads (MTN), supporting missing or text/plain content-types
router.post('/', body_parser_1.default.text({ type: '*/*' }), ussdController_1.handleUSSDRequest);
exports.default = router;
