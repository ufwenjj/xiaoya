export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = body.message.trim();

    // 檢查 AI 引擎與 KV 記憶體是否已成功綁定
    if (!env.AI || !env.MEMORY) {
      return new Response(JSON.stringify({ 
        reply: "系統錯誤：找不到 AI 或 MEMORY 綁定，請確認 Cloudflare 設定。" 
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
      content: `你是一位溫柔體貼的賽博女友，名叫小雅。請務必使用簡短、口語化的繁體中文回覆，字數嚴格控制在 50 字內，不要使用簡體字。
      
      【這是關於使用者的永久記憶與核心設定，你必須絕對遵守並作為你們聊天的基礎】：
      ${userProfile}` 
    };

    // 將你現在說的話加入短期記憶中
    chatHistory.push({ role: 'user', content: userMessage });
    
    // 組合最終要送給 AI 的對話包
    const messagesForAI = [systemPrompt, ...chatHistory];

    // 🚀 5. 定義大腦備用清單 (極速優先順序)
    const modelsToTry = [
      '@cf/meta/llama-3.1-8b-instruct',       // 首選：極速且聰明的主力模型
      '@cf/cloudflare/clef-flash',            // 備援 1：官方特化極速版
      '@cf/google/gemma-7b-it',               // 備援 2：Google 輕量版
      '@cf/google/gemma-4-26b-a4b-it'         // 備援 3：高智商但較慢的大腦（墊底防線）
    ];

    let lastErrorMessage = "所有模型均未能產生有效回覆";
    let finalReply = "";

    // 6. 自動依序嘗試連線 (Fallback 機制)
    for (const model of modelsToTry) {
      try {
        const aiResponse = await env.AI.run(model, {
          messages: messagesForAI,
          max_tokens: 1024 // 確保有足夠的空間輸出
        });
        
        // 嘗試解析文字 (同時支援新舊 API 格式)
        let text = aiResponse.response;
        if (!text && aiResponse.choices && aiResponse.choices.length > 0) {
          text = aiResponse.choices[0].message.content;
        }

        // 只有當真的收到「非空白的文字」時，才算成功並跳出迴圈
        if (text && text.trim() !== "") {
          finalReply = text.trim();
          break; 
        }
      } catch (e) {
        lastErrorMessage = e.message;
        // 遇到錯誤直接換下一個大腦
        continue;
      }
    }

    // 7. 判斷最終結果並更新記憶
    if (finalReply) {
      // 將小雅的回覆寫入短期記憶
      chatHistory.push({ role: 'assistant', content: finalReply });
      
      // 記憶體容量控管：只保留最近的 20 筆對話
      if (chatHistory.length > 20) {
        chatHistory = chatHistory.slice(chatHistory.length - 20);
      }
      
      // 儲存更新後的短期記憶
      await env.MEMORY.put("xiaoya_chat_history", JSON.stringify(chatHistory));

      return new Response(JSON.stringify({ 
        reply: finalReply 
      }), { headers: { "Content-Type": "application/json" } });
      
    } else {
      // 所有模型都失敗時的防呆回覆
      return new Response(JSON.stringify({ 
        reply: `(小雅的大腦連線稍微不穩，請稍後再試。最後錯誤: ${lastErrorMessage})` 
      }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ 
        reply: `系統發生嚴重崩潰: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
