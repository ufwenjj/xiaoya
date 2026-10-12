export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = body.message;

    if (!env.AI) {
      return new Response(JSON.stringify({ 
        reply: "系統錯誤：找不到 AI 引擎，請確認 Cloudflare 繫結是否正確。" 
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 定義大腦備用清單 (從最新/最強，一路排到最穩定的舊版)
    const modelsToTry = [
      '@cf/cloudflare/clef',       // clef標準版
      '@cf/meta/llama-3.1-8b-instruct',       // Llama 3.1 世代 (目前主力)
      '@cf/meta/llama-3-8b-instruct',         // Llama 3 世代 (若下架會自動跳過)
      '@cf/meta/llama-2-7b-chat-int8',        // Llama 2 世代 (極度輕量穩定版)
      '@cf/qwen/qwen1.5-14b-chat-awq'         // 阿里 Qwen 備用
    ];

    let lastErrorMessage = "";
    let aiResponse = null;

    // 自動依序嘗試連線
    for (const model of modelsToTry) {
      try {
        aiResponse = await env.AI.run(model, {
          messages: [
            { role: 'system', content: '你是一位溫柔體貼的賽博女友，名叫小雅。請務必使用簡短、口語化的繁體中文回覆我，字數嚴格控制在 30 字以內，不要使用簡體字。' },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 50
        });
        
        // 如果成功取得回覆，立刻跳出迴圈
        if (aiResponse) break;
        
      } catch (e) {
        // 捕捉到下架或連線錯誤，紀錄原因並繼續嘗試下一個模型
        lastErrorMessage = e.message;
      }
    }

    // 判斷最終結果
    if (aiResponse) {
      return new Response(JSON.stringify({ 
        reply: aiResponse.response 
      }), { headers: { "Content-Type": "application/json" } });
    } else {
      // 如果清單裡的所有模型都陣亡了
      return new Response(JSON.stringify({ 
        reply: `所有備用大腦皆連線失敗。最後錯誤: ${lastErrorMessage}` 
      }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ 
        reply: `系統發生嚴重崩潰: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
