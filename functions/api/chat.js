export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = body.message;

    // 檢查 AI 引擎與記憶體是否已成功綁定
    if (!env.AI || !env.MEMORY) {
      return new Response(JSON.stringify({ 
        reply: "系統錯誤：找不到 AI 或 MEMORY 綁定，請確認 Cloudflare 設定。" 
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 1. 喚醒記憶：從 KV 資料庫讀取你們過去的對話紀錄
    let chatHistory = [];
    const savedHistory = await env.MEMORY.get("xiaoya_chat_history");
    if (savedHistory) {
      chatHistory = JSON.parse(savedHistory);
    }

    // 2. 將你現在說的話加入記憶中
    chatHistory.push({ role: 'user', content: userMessage });

    // 3. 組合系統提示詞與歷史記憶 (加入默契成長指令)
    const systemPrompt = { 
      role: 'system', 
      content: '你是一位溫柔體貼的賽博女友，名叫小雅。請根據你與使用者的對話歷史，記住他的喜好與習慣，並展現出逐漸累積的默契與親密感。請務必使用簡短、口語化的繁體中文回覆，字數控制在 50 字內。' 
    };
    
    // 將系統提示詞放在最前面，後面接著歷史記憶
    const messagesForAI = [systemPrompt, ...chatHistory];

    const modelsToTry = [
      '@cf/google/gemma-4-26b-a4b-it',        
      '@cf/meta/llama-3.1-8b-instruct',       
      '@cf/google/gemma-7b-it',               
      '@cf/mistral/mistral-7b-instruct-v0.1'  
    ];

    let lastErrorMessage = "所有模型均未能產生有效回覆";
    let finalReply = "";

    // 呼叫 AI 大腦
    for (const model of modelsToTry) {
      try {
        const aiResponse = await env.AI.run(model, {
          messages: messagesForAI,
          max_tokens: 1024
        });
        
        let text = aiResponse.response;
        if (!text && aiResponse.choices && aiResponse.choices.length > 0) {
          text = aiResponse.choices[0].message.content;
        }

        if (text && text.trim() !== "") {
          finalReply = text;
          break; 
        }
      } catch (e) {
        lastErrorMessage = e.message;
      }
    }

    if (finalReply) {
      // 4. 將小雅的最新回覆也寫入記憶中
      chatHistory.push({ role: 'assistant', content: finalReply });

      // 5. 記憶體容量控管：只保留最近的 20 筆對話，避免記憶過載導致 AI 崩潰
      if (chatHistory.length > 20) {
        chatHistory = chatHistory.slice(chatHistory.length - 20);
      }

      // 6. 將更新後的記憶存回 Cloudflare KV 資料庫永久保存
      await env.MEMORY.put("xiaoya_chat_history", JSON.stringify(chatHistory));

      return new Response(JSON.stringify({ 
        reply: finalReply 
      }), { headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ 
        reply: `(記憶讀取失敗。最後錯誤: ${lastErrorMessage})` 
      }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ 
        reply: `系統崩潰: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
