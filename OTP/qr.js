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
exports.buildPromptPay = buildPromptPay;
// api/OTP/qr.ts
const promptpay_qr_1 = __importDefault(require("promptpay-qr"));
const qrcode_1 = __importDefault(require("qrcode"));
function buildPromptPay(amount) {
    return __awaiter(this, void 0, void 0, function* () {
        const id = process.env.PROMPTPAY_ID;
        if (!id)
            throw new Error("PROMPTPAY_ID is not set");
        const payload = (0, promptpay_qr_1.default)(id, { amount });
        const dataUrl = yield qrcode_1.default.toDataURL(payload, { margin: 1, scale: 8 });
        return { payload, dataUrl };
    });
}
