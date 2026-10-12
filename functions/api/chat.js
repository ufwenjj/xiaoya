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

    // 定義大腦備用清單 (首選最新 Gemma 4 + 三道穩定備援防線)
    const modelsToTry = [
      '@cf/google/gemma-4-26b-a4b-it',        // 首選：Google 最新 Gemma 4 高智商大腦
      '@cf/meta/llama-3.1-8b-instruct',       // 備援 1：Meta 主流開源對話模型
      '@cf/google/gemma-7b-it',               // 備援 2：Google 穩定版對話模型
      '@cf/mistral/mistral-7b-instruct-v0.1'  // 備援 3：Mistral 穩定版 (最後防線)
    ];

    let lastErrorMessage = "";
    let aiResponse = null;

    // 自動依序嘗試連線
    for (const model of modelsToTry) {
      try {
        aiResponse = await env.AI.run(model, {
          messages: [
            // 系統提示詞：設定小雅的人設，確保她用繁體中文回答並控制字數
            { role: 'system', content: '你是一位溫柔體貼的賽博女友，名叫小雅。請務必使用簡短、口語化的繁體中文回覆我，字數嚴格控制在 30 字以內，不要使用簡體字。' },
            { role: 'user', content: userMessage }
          ],
          // 限制輸出長度以提升回覆速度
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
      // 💡 加入除錯機制：如果 aiResponse 裡面沒有預期的 response 欄位，就把整包原始資料印在畫面上
      const finalReply = aiResponse.response || `[除錯] AI 回傳了未知的格式: ${JSON.stringify(aiResponse)}`;
      
      return new Response(JSON.stringify({ 
        reply: finalReply 
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
