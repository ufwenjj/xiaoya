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
      '@cf/google/gemma-4-26b-a4b-it',        
      '@cf/meta/llama-3.1-8b-instruct',       
      '@cf/google/gemma-7b-it',               
      '@cf/mistral/mistral-7b-instruct-v0.1'  
    ];

    let lastErrorMessage = "";
    let aiResponse = null;

    for (const model of modelsToTry) {
      try {
        aiResponse = await env.AI.run(model, {
          messages: [
            { role: 'system', content: '你是一位溫柔體貼的賽博女友，名叫小雅。請務必使用簡短、口語化的繁體中文回覆我，字數嚴格控制在 30 字以內，不要使用簡體字。' },
            { role: 'user', content: userMessage }
          ],
          // 【關鍵修正 1】把額度放寬到 300，讓她有足夠的空間「思考」並把真正的回答印出來
          max_tokens: 300
        });
        
        if (aiResponse) break;
        
      } catch (e) {
        lastErrorMessage = e.message;
      }
    }

    if (aiResponse) {
      // 【關鍵修正 2】同時支援舊版 (response) 與新版 (choices[0].message.content) 的拆包裹格式
      let finalReply = aiResponse.response;
      
      if (!finalReply && aiResponse.choices && aiResponse.choices.length > 0) {
        finalReply = aiResponse.choices[0].message.content;
      }

      // 如果 AI 還是不小心回傳空白，給個防呆回覆
      if (!finalReply || finalReply.trim() === "") {
        finalReply = "（小雅思考了一下，對你露出溫柔的微笑，沒有說話）";
      }

      return new Response(JSON.stringify({ 
        reply: finalReply 
      }), { headers: { "Content-Type": "application/json" } });
      
    } else {
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
