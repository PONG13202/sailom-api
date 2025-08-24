// api/OTP/qr.ts
import generatePayload from "promptpay-qr";
import qrcode from "qrcode";

export async function buildPromptPay(amount: number) {
  const id = process.env.PROMPTPAY_ID;
  if (!id) throw new Error("PROMPTPAY_ID is not set");
  const payload = generatePayload(id, { amount });
  const dataUrl = await qrcode.toDataURL(payload, { margin: 1, scale: 8 });
  return { payload, dataUrl };
}
