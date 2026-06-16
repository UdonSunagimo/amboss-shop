import express from "express";
import cors from "cors";

const app  = express();
const PORT = process.env.PORT || 8080;

const AMBOSS_ENDPOINT = "https://api.amboss.tech/graphql";
const API_KEY         = process.env.AMBOSS_API_KEY;
const WALLET_ID       = process.env.AMBOSS_WALLET_ID;
// 本番フロントエンドのオリジン（GitHub PagesのURL）を環境変数で設定
const ALLOWED_ORIGIN  = process.env.ALLOWED_ORIGIN || "*";

if (!API_KEY || !WALLET_ID) {
  console.error("ERROR: AMBOSS_API_KEY と AMBOSS_WALLET_ID を環境変数に設定してください");
  process.exit(1);
}

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// ── ヘルスチェック ────────────────────────────────
app.get("/", (_req, res) => res.json({ status: "ok", service: "TBB Shop API" }));

// ── インボイス作成 ────────────────────────────────
// POST /invoice
// body: { amount: number, sandbox?: boolean }
app.post("/invoice", async (req, res) => {
  const { amount, sandbox = false } = req.body;

  if (!amount || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "amount は正の数値で指定してください" });
  }

  const mutation = `
    mutation CreateReceive($input: CreateReceiveInput!) {
      create_receive(input: $input) {
        id
        payment_request
        amount
        status
      }
    }
  `;

  const metadata = sandbox
    ? JSON.stringify({ amb_sandbox_behavior: "complete" })
    : undefined;

  try {
    const ambossRes = await fetch(AMBOSS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            wallet_id: WALLET_ID,
            amount:    String(amount),
            ...(metadata ? { metadata } : {}),
          },
        },
      }),
    });

    const data = await ambossRes.json();
    const inv  = data?.data?.create_receive;

    if (!inv?.payment_request) {
      const msg = data?.errors?.[0]?.message || "Amboss APIエラー";
      return res.status(502).json({ error: msg });
    }

    return res.json({
      id:              inv.id,
      payment_request: inv.payment_request,
      amount:          inv.amount,
      status:          inv.status,
    });

  } catch (err) {
    console.error("invoice error:", err);
    return res.status(500).json({ error: "サーバーエラー" });
  }
});

// ── 支払いステータス確認 ──────────────────────────
// GET /invoice/:id/status
app.get("/invoice/:id/status", async (req, res) => {
  const { id } = req.params;

  const query = `
    query GetPayment($id: String!) {
      payment(id: $id) {
        id
        status
      }
    }
  `;

  try {
    const ambossRes = await fetch(AMBOSS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({ query, variables: { id } }),
    });

    const data   = await ambossRes.json();
    const status = data?.data?.payment?.status;

    if (!status) {
      const msg = data?.errors?.[0]?.message || "支払い情報が見つかりません";
      return res.status(404).json({ error: msg });
    }

    return res.json({ id, status });

  } catch (err) {
    console.error("status error:", err);
    return res.status(500).json({ error: "サーバーエラー" });
  }
});

app.listen(PORT, () => {
  console.log(`TBB Shop API listening on :${PORT}`);
});
