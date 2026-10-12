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

    const modelsToTry = [
      '@cf/google/gemma-4-26b-a4b-it',        // 首選：Google 最新 Gemma 4 高智商大腦
      '@cf/meta/llama-3.1-8b-instruct',       // 備援 1：Meta 主流開源對話模型
      '@cf/google/gemma-7b-it',               // 備援 2：Google 穩定版對話模型
      '@cf/mistral/mistral-7b-instruct-v0.1'  // 備援 3：Mistral 穩定版 (最後防線)
    ];

    let lastErrorMessage = "所有模型均未能產生有效回覆";
    let finalReply = "";

    // 自動依序嘗試連線
    for (const model of modelsToTry) {
      try {
        const aiResponse = await env.AI.run(model, {
          messages: [
            { role: 'system', content: '你是一位溫柔體貼的賽博女友，名叫小雅。請務必使用簡短、口語化的繁體中文回覆我，字數嚴格控制在 30 字以內，不要使用簡體字。' },
            { role: 'user', content: userMessage }
          ],
          // 大幅放寬限制，讓高智商模型有充足的內部運算空間
          max_tokens: 1024
        });
        
        // 嘗試解析文字 (同時支援新舊 API 格式)
        let text = aiResponse.response;
        if (!text && aiResponse.choices && aiResponse.choices.length > 0) {
          text = aiResponse.choices[0].message.content;
        }

        // 💡 關鍵修正：只有當真的收到「非空白的文字」時，才算成功並跳出迴圈
        if (text && text.trim() !== "") {
          finalReply = text;
          break; 
        }
        
      } catch (e) {
        // 紀錄錯誤並繼續嘗試清單中的下一個模型
        lastErrorMessage = e.message;
      }
    }

    if (finalReply) {
      return new Response(JSON.stringify({ 
        reply: finalReply 
      }), { headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ 
        reply: `(小雅的大腦陷入混亂，請稍後再試。最後錯誤: ${lastErrorMessage})` 
      }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ 
        reply: `系統發生嚴重崩潰: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
