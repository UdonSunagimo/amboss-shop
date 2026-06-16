import express from "express";
import cors from "cors";

const app  = express();
const PORT = process.env.PORT || 8080;

const AMBOSS_ENDPOINT = "https://rails.amboss.tech/graphql";
const API_KEY         = process.env.AMBOSS_API_KEY;
const WALLET_ID       = process.env.AMBOSS_WALLET_ID;
const ALLOWED_ORIGIN  = process.env.ALLOWED_ORIGIN || "*";

if (!API_KEY || !WALLET_ID) {
  console.error("ERROR: AMBOSS_API_KEY と AMBOSS_WALLET_ID を環境変数に設定してください");
  process.exit(1);
}

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

app.get("/", (_req, res) => res.json({ status: "ok", service: "TBB Shop API" }));

// ── インボイス作成 ────────────────────────────────
app.post("/invoice", async (req, res) => {
  const { amount, sandbox = false } = req.body;

  if (!amount || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "amount は正の数値で指定してください" });
  }

  const mutation = `
    mutation CreateReceive($input: CreateReceiveTransactionInput!) {
      payment {
        transaction {
          create_receive(input: $input) {
            id
            status
            payment_request
            expires_at
            amount { full_amount }
          }
        }
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
            description: "TBB Shop",
            ...(metadata ? { metadata } : {}),
          },
        },
      }),
    });

    const data = await ambossRes.json();
    const inv  = data?.data?.payment?.transaction?.create_receive;

    if (!inv?.payment_request) {
      const msg = data?.errors?.[0]?.message || "Amboss APIエラー";
      return res.status(502).json({ error: msg });
    }

    return res.json({
      id:              inv.id,
      payment_request: inv.payment_request,
      amount:          inv.amount?.full_amount,
      status:          inv.status,
    });

  } catch (err) {
    console.error("invoice error:", err);
    return res.status(500).json({ error: "サーバーエラー" });
  }
});

// ── 支払いステータス確認 ──────────────────────────
app.get("/invoice/:id/status", async (req, res) => {
  const { id } = req.params;

  const query = `
    query GetTransaction($id: String!) {
      payment {
        transaction {
          find_one(id: $id) {
            id
            status
          }
        }
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
    const status = data?.data?.payment?.transaction?.find_one?.status;

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
