import { verifyWebhookSignature } from "../../../lib/paystack";
import { enqueuePaystackWebhook } from "../../../lib/paystackWebhookQueue";

export const config = { api: { bodyParser: false } };

// Paystack events are a few KB. Cap the body so an unauthenticated caller
// can't make the server buffer an arbitrarily large payload before the
// signature check runs.
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_WEBHOOK_BYTES) {
        // Stop storing, keep draining, so the 413 response can still be sent.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        const err = new Error("Webhook body too large");
        err.code = "BODY_TOO_LARGE";
        reject(err);
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["x-paystack-signature"];
    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(rawBody);

    // Do not verify Paystack or call Techlink inside the webhook request.
    // Persist first so a successful 200 acknowledgement always corresponds
    // to durable work that the fulfillment worker can retry safely.
    await enqueuePaystackWebhook({ event, rawBody });

    return res.status(200).json({ received: true, queued: true });
  } catch (err) {
    if (err?.code === "BODY_TOO_LARGE") return res.status(413).json({ error: "Payload too large" });
    console.error("Paystack webhook enqueue error", err);
    // A non-2xx response tells Paystack to retry when the durable queue
    // could not be written.
    return res.status(500).json({ error: "Webhook could not be queued" });
  }
}
