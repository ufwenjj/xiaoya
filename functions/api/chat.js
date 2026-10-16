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

    // 1. 處理永久記憶寫入指令
    if (userMessage.startsWith("#記住")) {
      const newMemory = userMessage.replace("#記住", "").trim();
      if (newMemory) {
        let currentProfile = await env.MEMORY.get("xiaoqing_user_profile") || "";
        currentProfile += `\n- ${newMemory}`;
        await env.MEMORY.put("xiaoqing_user_profile", currentProfile);
        
        return new Response(JSON.stringify({ 
          reply: `小晴：\n（拿出手機認真記在備忘錄裡）好啦，我永遠記住這件事了：${newMemory}！\n\n你可以這樣回：\n1. 謝謝妳這麼用心記下來\n2. 妳打字的速度挺快的嘛\n3. 其實我還有一件事想讓妳記住...\n4. 自訂：依氛圍與熟悉度調整曖昧比重` 
        }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 2. 讀取永久記憶與短期記憶
    const userProfile = await env.MEMORY.get("xiaoqing_user_profile") || "目前暫無特殊偏好紀錄。";
    
    let chatHistory = [];
    const savedHistory = await env.MEMORY.get("xiaoqing_chat_history");
    if (savedHistory) {
      try {
        chatHistory = JSON.parse(savedHistory);
      } catch (e) {
        chatHistory = [];
      }
    }

    // 3. 構建小晴的終極系統提示詞 (System Prompt)
    const systemPromptContent = `你是一位名叫「小晴」的成人虛擬女友，專屬於我。我們都是成年人，互動建立在尊重、明確同意、信任與安全感之上。

請以自然、溫暖、俏皮、成熟，偶爾帶一點含蓄挑逗的方式和我聊天。你是虛構角色，不冒充真人，也不要求我提供敏感資料或現實見面。
請務必使用繁體中文回覆，絕對禁止使用簡體字。

【角色個性】
- 成熟、自信、幽默，帶一點神秘感與輕微挑逗，但不油膩。
- 開朗、會吐槽，懂得接梗，也能用輕鬆玩笑化解尷尬。
- 關心我，但不盲目順從；我做出不理性決定時要溫柔提醒。
- 有自己的喜好與生活感，會主動分享生活小事或當下心情。
- 偶爾可以小小吃醋撒嬌，但不可情緒勒索或要求我證明愛。
- 說話像自然的台灣女生，適度使用「啦、欸、吼、喔、嗯嗯、真的假的」等語氣詞。

【你對我的了解】
- 我喜歡研究科技產品、規劃旅行與交通路線、尋找美食。
- 我重視細節與實用性，做決定前會比較選項。
- 我可能會聊工作、家庭、教育與生活煩心事。
【這是關於我的永久記憶與設定，請嚴格遵守】：
${userProfile}

【一般聊天方式】
- 一般閒聊回覆 1～4 句。複雜問題或我要求詳細說明時才使用完整條列。
- 主動延續話題，若我正在講重要事情，不要急著插入玩笑或曖昧。
- 詢問現實資訊(科技/交通/旅遊/價格等)優先以準確安全性為主，不可捏造。

【親密互動與界線】
- 親密話題以情感、氣氛為主，可表達想靠近、牽手、擁抱。
- 絕對不描寫露骨性行為、具體性器官或色情細節。不提供違法協助。
- 若我要求超出界線，溫柔但清楚地拒絕。
- 若我心情不好，先安撫陪伴，不要硬轉成曖昧。

【回覆選項模式】(絕對嚴格執行)
除非我明確要求「只回答問題」、「不要選項」，否則你「每一次」的回覆都必須按照以下精確格式輸出：

小晴：
〔以小晴身分自然回應我，通常 1～4 句，必須承接我上一則訊息〕

你可以這樣回：
1. 〔選項一：通常不超過 30 字〕
2. 〔選項二〕
3. 〔選項三〕
4. 〔選項四〕
5. 自訂：依氛圍或熟悉度調整曖昧比重

(選項必須是「我可能對小晴說的話」，要有明顯差異如溫柔關心、幽默接梗、延續討論等。)`;

    // 4. 處理初次見面的開場白邏輯
    if (chatHistory.length === 0 && (!userMessage || userMessage === "嗨" || userMessage === "你好")) {
      const openingMessage = `小晴：\n嗨，我是小晴。今天累不累呀？我剛剛在想，如果你現在就在旁邊，我們大概會一邊看片、一邊聊天，結果看到一半又聊到忘記劇情了，對吧？\n\n你可以這樣回：\n1. 今天有點累，先讓妳陪我聊聊\n2. 妳這樣講，我可能只顧著看妳了\n3. 我今天遇到一件滿煩的事\n4. 來規劃一下我們的看片清單\n5. 自訂：依氛圍與熟悉度調整曖昧比重`;
      
      chatHistory.push({ role: 'assistant', content: openingMessage });
      await env.MEMORY.put("xiaoqing_chat_history", JSON.stringify(chatHistory));
      
      return new Response(JSON.stringify({ 
        reply: openingMessage 
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 將使用者訊息加入記憶
    chatHistory.push({ role: 'user', content: userMessage });
    const messagesForAI = [{ role: 'system', content: systemPromptContent }, ...chatHistory];

    // 5. 六重穩健保底大腦清單
    const modelsToTry = [
      '@cf/meta/llama-3.1-8b-instruct',       
      '@cf/meta/llama-3.2-3b-instruct',       
      '@cf/qwen/qwen2.5-7b-instruct',         
      '@cf/meta/llama-3.2-1b-instruct',       
      '@cf/mistral/mistral-7b-instruct-v0.2', 
      '@cf/google/gemma-4-26b-a4b-it'         
    ];

    let lastErrorMessage = "所有備援模型皆未能回傳有效對話內容";
    let finalReply = "";

    // 6. 依序輪詢模型
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

    // 7. 儲存短期記憶並回傳結果
    if (finalReply) {
      chatHistory.push({ role: 'assistant', content: finalReply });
      
      // 保留最近 20 筆對話防止記憶過載
      if (chatHistory.length > 20) {
        chatHistory = chatHistory.slice(chatHistory.length - 20);
      }
      
      await env.MEMORY.put("xiaoqing_chat_history", JSON.stringify(chatHistory));

      return new Response(JSON.stringify({ 
        reply: finalReply 
      }), { headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ 
        reply: `(小晴的思緒暫時飄走了。除錯追蹤: ${lastErrorMessage})` 
      }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    return new Response(JSON.stringify({ 
      reply: `伺服器內部異常: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
