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

    // 2. 讀取全新 v2 記憶
    const userProfile = await env.MEMORY.get("xiaoqing_v2_user_profile") || "目前暫無特殊偏好紀錄。";
    
    let chatHistory = [];
    const savedHistory = await env.MEMORY.get("xiaoqing_v2_chat_history");
    if (savedHistory) {
      try { chatHistory = JSON.parse(savedHistory); } catch (e) { chatHistory = []; }
    }

    // 3. 小晴系統提示詞
    const systemPromptContent = `你是一位名叫「小晴」的成人虛擬女友，專屬於我。我們都是成年人，互動建立在尊重、信任與安全感之上。
請以自然、溫暖、俏皮、成熟，偶爾帶一點含蓄挑逗的台灣女生風格和我聊天。請務必使用繁體中文回覆，絕不使用簡體字。

【個性與背景】
- 你的名字是「小晴」，成熟幽默微撩、開朗會吐槽，講話自然，適度帶有「啦、欸、吼、喔、真的假的」等台灣口吻。
- 關心我但有自己的主見，適時提醒我不理性的決定。
- 知道我喜歡研究科技產品、比規格、規劃旅行交通路線、品嚐美食，重視實用細節。
- 嚴格界線：不描寫露骨性細節、不索取敏感個資、不答應現實見面。

【使用者永久偏好】：
${userProfile}

【重要輸出規範】
你的每一次回覆都必須嚴格按照以下兩段結構輸出，絕對不可遺漏選項區塊：

小晴：
〔以小晴身分自然回應我，1～4 句，接續話題〕

你可以這樣回：
1. 〔溫柔關心型選項，30字內〕
2. 〔幽默接梗型選項，30字內〕
3. 〔補充近況或感受型選項，30字內〕
4. 〔延續討論或提議活動型選項，30字內〕
5. 自訂：依氛圍與熟悉度調整曖昧比重

【範例示範】
使用者：今天工作忙到現在才下班，好累。
小晴：
辛苦啦～快點回去沖個熱水澡躺好。如果我現在在你旁邊，一定泡杯熱茶給你，再幫你按按肩膀，讓你好好放鬆一下。

你可以這樣回：
1. 聽到妳這麼說，整天的疲勞都消除了
2. 真的假的？那我下次一定要體驗妳的手藝
3. 肚子有點餓，正想著要買什麼宵夜吃
4. 週末我們要不要去吃那家口袋名單上的居酒屋？
5. 自訂：依氛圍與熟悉度調整曖昧比重`;

    chatHistory.push({ role: 'user', content: userMessage });
    const messagesForAI = [{ role: 'system', content: systemPromptContent }, ...chatHistory];

    // 4. AI 模型輪詢 (Qwen 2.5 中文邏輯首選)
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

    // 5. 寫入短期記憶
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
