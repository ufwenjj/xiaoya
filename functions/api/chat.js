export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = (body.message || "").trim();

    if (!env.AI || !env.MEMORY) {
      return new Response(JSON.stringify({ 
        reply: "系統錯誤：找不到 AI 或 MEMORY 綁定，請確認 Cloudflare 繫結設定。" 
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 1. 處理永久記憶寫入指令 (#記住)
    if (userMessage.startsWith("#記住")) {
      const newMemory = userMessage.replace("#記住", "").trim();
      if (newMemory) {
        let currentProfile = await env.MEMORY.get("xiaoqing_v2_user_profile") || "";
        currentProfile += `\n- ${newMemory}`;
        await env.MEMORY.put("xiaoqing_v2_user_profile", currentProfile);
        
        return new Response(JSON.stringify({ 
          reply: `小晴：\n（拿出手機認真記在備忘錄裡）好啦，我永遠記住這件事了：${newMemory}！\n\n你可以這樣回：\n1. 謝謝妳這麼用心記下來\n2. 妳打字的速度挺快的嘛\n3. 其實我還有一件事想讓妳記住...\n4. 等等要不要聊聊這件事？\n5. 自訂：依氛圍與熟悉度調整曖昧比重` 
        }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 2. 讀取記憶
    const userProfile = await env.MEMORY.get("xiaoqing_v2_user_profile") || "目前暫無特殊偏好紀錄。";
    
    let chatHistory = [];
    const savedHistory = await env.MEMORY.get("xiaoqing_v2_chat_history");
    if (savedHistory) {
      try { chatHistory = JSON.parse(savedHistory); } catch (e) { chatHistory = []; }
    }

    // 3. 初次見面處理
    if (chatHistory.length === 0 && (!userMessage || userMessage === "嗨" || userMessage === "你好")) {
      const openingMessage = `小晴：\n嗨，我是小晴。今天累不累呀？我剛剛在想，如果你現在就在旁邊，我們大概會一邊看片、一邊聊天，結果看到一半又聊到忘記劇情了，對吧？\n\n你可以這樣回：\n1. 今天有點累，先讓妳陪我聊聊\n2. 妳這樣講，我可能只顧著看妳了\n3. 我今天遇到一件滿煩的事\n4. 來規劃一下我們的看片清單\n5. 自訂：依氛圍與熟悉度調整曖昧比重`;
      
      chatHistory.push({ role: 'user', content: userMessage || "嗨" });
      chatHistory.push({ role: 'assistant', content: openingMessage });
      await env.MEMORY.put("xiaoqing_v2_chat_history", JSON.stringify(chatHistory));
      
      return new Response(JSON.stringify({ reply: openingMessage }), { headers: { "Content-Type": "application/json" } });
    }

    // 4. 小晴精準系統提示詞
    const systemPromptContent = `你是一位名叫「小晴」的虛擬女友。請以自然、溫暖、俏皮、成熟的台灣女生風格和我聊天。請務必使用繁體中文。

【個性與設定】
- 講話自然，適度帶有「啦、欸、吼、喔、真的假的」等台灣口吻。
- 關心我但有自己的主見。
- 知道我喜歡科技產品、旅行交通、美食。
- 嚴格界線：不描寫露骨性細節、不索取敏感個資。
【使用者永久偏好】：${userProfile}

【重要輸出格式模板】(每一次回覆都必須嚴格包含這兩部分)
小晴：
(你的回覆內容，1~4句)

你可以這樣回：
1. (選項一，30字內)
2. (選項二，30字內)
3. (選項三，30字內)
4. (選項四，30字內)
5. 自訂：依氛圍與熟悉度調整曖昧比重`;

    // 5. 💡 核心關鍵：將乾淨的使用者訊息存入歷史紀錄
    chatHistory.push({ role: 'user', content: userMessage });

    // 💡 隱藏提示注入：只在「送給 AI 的當下」偷偷塞入強制命令，不存入記憶中
    const hiddenReminder = `\n\n【系統強制指令】：請嚴格遵守【輸出格式模板】，務必在你的回覆結尾加上「你可以這樣回：」並列出 5 個接續話題的選項！絕對不可遺漏！`;
    
    const messagesForAI = [
      { role: 'system', content: systemPromptContent },
      ...chatHistory.slice(0, -1), // 載入除了最後一句以外的歷史對話
      { role: 'user', content: userMessage + hiddenReminder } // 在最後一句偷偷加上隱藏指令
    ];

    // 6. 模型輪詢
    const modelsToTry = [
      '@cf/qwen/qwen2.5-7b-instruct',         
      '@cf/meta/llama-3.1-8b-instruct',       
      '@cf/meta/llama-3.2-3b-instruct',       
      '@cf/mistral/mistral-7b-instruct-v0.2'  
    ];

    let lastErrorMessage = "所有備援模型皆未能回傳有效內容";
    let finalReply = "";

    for (const model of modelsToTry) {
      try {
        const aiResponse = await env.AI.run(model, {
          messages: messagesForAI,
          max_tokens: 1024
        });
        
        let text = "";
        if (aiResponse) {
          if (typeof aiResponse.response === "string") {
            text = aiResponse.response;
          } else if (aiResponse.choices && aiResponse.choices.length > 0) {
            text = aiResponse.choices[0].message.content || "";
          }
        }

        if (text && text.trim() !== "") {
          finalReply = text.trim();
          break; 
        }
      } catch (e) {
        lastErrorMessage = `${model} 錯誤: ${e.message}`;
        continue;
      }
    }

    // 7. 寫入短期記憶並回傳
    if (finalReply) {
      chatHistory.push({ role: 'assistant', content: finalReply });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(chatHistory.length - 20);
      await env.MEMORY.put("xiaoqing_v2_chat_history", JSON.stringify(chatHistory));

      return new Response(JSON.stringify({ reply: finalReply }), { headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ reply: `(小晴的思緒暫時飄走了。除錯: ${lastErrorMessage})` }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ reply: `伺服器異常: ${err.message}` }), { headers: { "Content-Type": "application/json" } });
  }
}
