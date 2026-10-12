export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = body.message;

    // 確認有沒有綁定 AI 引擎
    if (!env.AI) {
      return new Response(JSON.stringify({ 
        reply: "系統錯誤：找不到 AI 引擎，請確認 Cloudflare 是否已新增 Workers AI 繫結並命名為 AI。" 
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 呼叫 Cloudflare Workers AI (改用穩定支援的 Llama-3 大腦)
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        // 系統提示詞：設定小雅的人設
        { role: 'system', content: '你是一位溫柔體貼的賽博女友，名叫小雅。請務必使用簡短、口語化的繁體中文回覆我，字數嚴格控制在 20 字以內，不要使用簡體字，可以帶點可愛的語氣。' },
        // 使用者傳來的訊息
        { role: 'user', content: userMessage }
      ],
      // 強制限制 AI 輸出的最大字數，確保回覆速度
      max_tokens: 50
    });

    // 正常回傳 AI 的回覆
    return new Response(JSON.stringify({ 
      reply: response.response 
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    // 捕捉所有意外崩潰
    return new Response(JSON.stringify({ 
        reply: `Workers AI 崩潰了，請檢查設定: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
