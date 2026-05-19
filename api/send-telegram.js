export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed",
    });
  }

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      return res.status(500).json({
        ok: false,
        message: "Missing Telegram environment variables",
      });
    }

    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        ok: false,
        message: "Missing message text",
      });
    }

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      }
    );

    const telegramData = await telegramRes.json();

    if (!telegramRes.ok || !telegramData.ok) {
      return res.status(500).json({
        ok: false,
        message: "Telegram send failed",
        detail: telegramData,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Telegram sent",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}