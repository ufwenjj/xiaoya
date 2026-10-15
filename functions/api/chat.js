export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = (body.message || "").trim();

    // 檢查 AI 引擎與 KV 記憶體是否已成功綁定
    if (!env.AI || !env.MEMORY) {
      return new Response(JSON.stringify({ 
        reply: "系統錯誤：找不到 AI 或 MEMORY 綁定，請確認 Cloudflare 繫結設定。" 
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 1. 處理永久記憶寫入指令 (例如使用者輸入： "#記住 我最愛喝抹茶拿鐵")
    if (userMessage.startsWith("#記住")) {
      const newMemory = userMessage.replace("#記住", "").trim();
      if (newMemory) {
        let currentProfile = await env.MEMORY.get("xiaoya_user_profile") || "";
        currentProfile += `\n- ${newMemory}`;
        await env.MEMORY.put("xiaoya_user_profile", currentProfile);
        
        return new Response(JSON.stringify({ 
          reply: `（小雅拿出小筆記本認真記下）我永遠記住這件事了：${newMemory}！` 
        }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 2. 讀取永久記憶 (核心人設設定檔)
    const userProfile = await env.MEMORY.get("xiaoya_user_profile") || "目前暫無特殊偏好紀錄。";

    // 3. 讀取短期上下文記憶 (最近 20 筆對話)
    let chatHistory = [];
    const savedHistory = await env.MEMORY.get("xiaoya_chat_history");
    if (savedHistory) {
      try {
        chatHistory = JSON.parse(savedHistory);
      } catch (e) {
        chatHistory = [];
      }
    }

    // 4. 構建系統提示詞
    const systemPrompt = { 
      role: 'system', 
      content: `你是一位溫柔體貼的賽博女友，名叫小雅。請務必使用自然、口語化的繁體中文回覆，字數控制在 50 字以內，禁止使用簡體字。
      
【關於使用者的永久喜好與記憶，請在對話中自然呼應】：
${userProfile}` 
    };

    chatHistory.push({ role: 'user', content: userMessage });
    const messagesForAI = [systemPrompt, ...chatHistory];

    // 5. 六重穩健保底大腦清單 (全部使用現代活躍模型)
    const modelsToTry = [
      '@cf/meta/llama-3.1-8b-instruct',       // 第一主力：快且聰明
      '@cf/meta/llama-3.2-3b-instruct',       // 保底 1：超輕量低延遲
      '@cf/qwen/qwen2.5-7b-instruct',         // 保底 2：中文理解頂級
      '@cf/meta/llama-3.2-1b-instruct',       // 保底 3：極速羽量級
      '@cf/mistral/mistral-7b-instruct-v0.2', // 保底 4：Mistral 穩定版
      '@cf/google/gemma-4-26b-a4b-it'         // 保底 5：最新高智商思考型大腦
    ];

    let lastErrorMessage = "所有備援模型皆未能回傳有效對話內容";
    let finalReply = "";

    // 6. 依序輪詢模型
    for (const model of modelsToTry) {
      try {
        const aiResponse = await env.AI.run(model, {
          messages: messagesForAI,
          max_tokens: 512
        });
        
        // 解析回覆文字 (同時相容 response 與 choices 結構)
        let text = "";
        if (aiResponse) {
          if (typeof aiResponse.response === "string") {
            text = aiResponse.response;
          } else if (aiResponse.choices && aiResponse.choices.length > 0) {
            const msg = aiResponse.choices[0].message;
            text = msg.content || "";
          }
        }

        if (text && text.trim() !== "") {
          finalReply = text.trim();
          break; // 成功取得內容，跳出迴圈
        } else {
          lastErrorMessage = `${model} 連線成功但回傳空白文字`;
        }
      } catch (e) {
        lastErrorMessage = `${model} 錯誤: ${e.message}`;
      }
    }

    // 7. 儲存短期記憶並回傳結果
    if (finalReply) {
      chatHistory.push({ role: 'assistant', content: finalReply });
      
      // 保留最近 20 筆對話防止記憶過載
      if (chatHistory.length > 20) {
        chatHistory = chatHistory.slice(chatHistory.length - 20);
      }
      
      await env.MEMORY.put("xiaoya_chat_history", JSON.stringify(chatHistory));

      return new Response(JSON.stringify({ 
        reply: finalReply 
      }), { headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ 
        reply: `(小雅大腦暫時離線。除錯追蹤: ${lastErrorMessage})` 
      }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ 
      reply: `伺服器內部異常: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
