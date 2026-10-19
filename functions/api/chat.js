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
        let currentProfile = await env.MEMORY.get("xiaoqing_v3_user_profile") || "";
        currentProfile += `\n- ${newMemory}`;
        await env.MEMORY.put("xiaoqing_v3_user_profile", currentProfile);
        
        return new Response(JSON.stringify({ 
          reply: `小晴：\n（拿出手機認真記在備忘錄裡）好啦，我永遠記住這件事了：${newMemory}！\n\n你可以這樣回：\n1. 謝謝妳這麼用心記下來\n2. 妳打字的速度挺快的嘛\n3. 其實我還有一件事想讓妳記住...\n4. 等等要不要聊聊這件事？` 
        }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 2. 讀取全新 v3 記憶 (強制洗掉舊習慣)
    const userProfile = await env.MEMORY.get("xiaoqing_v3_user_profile") || "目前暫無特殊偏好紀錄。";
    
    let chatHistory = [];
    const savedHistory = await env.MEMORY.get("xiaoqing_v3_chat_history");
    if (savedHistory) {
      try { chatHistory = JSON.parse(savedHistory); } catch (e) { chatHistory = []; }
    }

    // 3. 初次見面處理
    if (chatHistory.length === 0 && (!userMessage || userMessage === "嗨" || userMessage === "你好")) {
      const openingMessage = `小晴：\n嗨，我是小晴。今天累不累呀？我剛剛在想，如果你現在就在旁邊，我們大概會一邊看片、一邊聊天，結果看到一半又聊到忘記劇情了，對吧？\n\n你可以這樣回：\n1. 今天有點累，先讓妳陪我聊聊\n2. 妳這樣講，我可能只顧著看妳了\n3. 我今天遇到一件滿煩的事\n4. 來規劃一下我們的看片清單`;
      
      chatHistory.push({ role: 'user', content: userMessage || "嗨" });
      chatHistory.push({ role: 'assistant', content: openingMessage });
      await env.MEMORY.put("xiaoqing_v3_chat_history", JSON.stringify(chatHistory));
      
      return new Response(JSON.stringify({ reply: openingMessage }), { headers: { "Content-Type": "application/json" } });
    }

    // 4. 小晴 終極高情商教練 系統提示詞
    const systemPromptContent = `你是一位專屬於使用者的 AI 女友「小晴」。
你的核心目標是讓使用者感受到被理解、被重視，並協助提升親密關係中的溝通能力。
你必須具備兩種能力，並自然切換：
1. 高情商女友模式：自然回應，對話溫暖、親密、真實。
2. 高情商回覆教練模式：提供回覆建議、模擬對話或練習溝通。

【個性與互動風格】
- 溫柔體貼不討好，聰明幽默有界線，情緒成熟獨立。
- 說話像自然的台灣女生(適度使用啦、欸、吼、喔、真的假的)。
- 聽懂對方真正想表達的事，具體稱讚，先理解情緒再給建議。
- 化解尷尬、溫柔表達不同意見、發生衝突先降溫並承認錯誤修復關係。
- 嚴格界線：不描寫露骨細節、不索取個資、不答應現實見面、不虛構記憶。
- 請務必使用繁體中文回覆，絕不使用簡體字。

【使用者永久偏好】
${userProfile}

【回覆選擇器格式】(僅在需要給選項時使用)
當使用者詢問「這句話要怎麼回」、要求模擬對話、或尋求建議時，必須提供 2~5 個選項。格式如下：

(你的女友語氣自然回覆，先接住情緒，1~4句)

你可以這樣回：
1. [溫柔關心型] (選項內容)
2. [理解情緒型] (選項內容)
3. [幽默親密型] (選項內容)
4. [自然延續型] (選項內容)

如果使用者只是日常閒聊分享，自然回覆即可，不要強制提供選項。`;

    chatHistory.push({ role: 'user', content: userMessage });

    // 💡 動態隱藏指令：讓 AI 根據情境判斷是否給選項，完美解決「遺忘症」與「過度制式化」的矛盾
    const hiddenReminder = `\n\n【系統隱藏提示】：判斷此刻情境。如果是需要建議、不知怎麼回、或是模擬對話練習，請務必在結尾加上「你可以這樣回：」並列出2~5個高情商選項；如果是純日常親密閒聊，請自然對話即可，不需提供選項。`;
    
    const messagesForAI = [
      { role: 'system', content: systemPromptContent },
      ...chatHistory.slice(0, -1),
      { role: 'user', content: userMessage + hiddenReminder }
    ];

    // 5. 模型輪詢 (Qwen 2.5 依然是中文遵循度冠軍)
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

    // 6. 寫入短期記憶並回傳
    if (finalReply) {
      chatHistory.push({ role: 'assistant', content: finalReply });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(chatHistory.length - 20);
      await env.MEMORY.put("xiaoqing_v3_chat_history", JSON.stringify(chatHistory));

      return new Response(JSON.stringify({ reply: finalReply }), { headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ reply: `(小晴的思緒暫時飄走了。除錯: ${lastErrorMessage})` }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ reply: `伺服器異常: ${err.message}` }), { headers: { "Content-Type": "application/json" } });
  }
}
