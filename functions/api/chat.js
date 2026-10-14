export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = body.message.trim();

    if (!env.AI || !env.MEMORY) {
      return new Response(JSON.stringify({ 
        reply: "系統錯誤：找不到 AI 或 MEMORY 綁定。" 
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 💡 1. 處理永久記憶寫入指令 (例如使用者輸入： "#記住 我對海鮮過敏")
    if (userMessage.startsWith("#記住")) {
      const newMemory = userMessage.replace("#記住", "").trim();
      if (newMemory) {
        // 抓出舊的永久記憶，並把新的接在後面
        let currentProfile = await env.MEMORY.get("xiaoya_user_profile") || "";
        currentProfile += `\n- ${newMemory}`;
        await env.MEMORY.put("xiaoya_user_profile", currentProfile);
        
        return new Response(JSON.stringify({ 
          reply: `（小雅拿出筆記本認真寫下）我永遠記住這件事了：${newMemory}！` 
        }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 2. 讀取永久記憶 (潛意識設定檔)
    const userProfile = await env.MEMORY.get("xiaoya_user_profile") || "目前還沒有特別的紀錄。";

    // 3. 讀取短期對話記憶 (最近 20 筆)
    let chatHistory = [];
    const savedHistory = await env.MEMORY.get("xiaoya_chat_history");
    if (savedHistory) {
      chatHistory = JSON.parse(savedHistory);
    }

    // 4. 組合終極大腦提示詞 (將永久記憶硬編碼進系統人設中)
    const systemPrompt = { 
      role: 'system', 
      content: `你是一位溫柔體貼的賽博女友，名叫小雅。請務必使用簡短、口語化的繁體中文回覆，字數控制在 50 字內。
      
      【這是關於使用者的永久記憶與核心設定，你必須絕對遵守並作為你們聊天的基礎】：
      ${userProfile}` 
    };

    chatHistory.push({ role: 'user', content: userMessage });
    const messagesForAI = [systemPrompt, ...chatHistory];

    const modelsToTry = [
      '@cf/google/gemma-4-26b-a4b-it',        
      '@cf/meta/llama-3.1-8b-instruct',       
      '@cf/google/gemma-7b-it',               
      '@cf/mistral/mistral-7b-instruct-v0.1'  
    ];

    let finalReply = "";

    for (const model of modelsToTry) {
      try {
        const aiResponse = await env.AI.run(model, {
          messages: messagesForAI,
          max_tokens: 1024
        });
        
        let text = aiResponse.response || (aiResponse.choices && aiResponse.choices[0].message.content);
        if (text && text.trim() !== "") {
          finalReply = text;
          break; 
        }
      } catch (e) {
        continue;
      }
    }

    if (finalReply) {
      chatHistory.push({ role: 'assistant', content: finalReply });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(chatHistory.length - 20);
      await env.MEMORY.put("xiaoya_chat_history", JSON.stringify(chatHistory));

      return new Response(JSON.stringify({ reply: finalReply }), { headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ reply: "(小雅的大腦陷入混亂，請稍後再試。)" }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ reply: `系統崩潰: ${err.message}` }), { headers: { "Content-Type": "application/json" } });
  }
}
