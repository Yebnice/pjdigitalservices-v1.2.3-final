import { verifyWebhookSignature } from "../../../lib/paystack";
import { enqueuePaystackWebhook } from "../../../lib/paystackWebhookQueue";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
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
    console.error("Paystack webhook enqueue error", err);
    // A non-2xx response tells Paystack to retry when the durable queue
    // could not be written.
    return res.status(500).json({ error: "Webhook could not be queued" });
  }
}
