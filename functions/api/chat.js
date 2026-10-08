export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = body.message;

    // 1. 確認有沒有抓到金鑰
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ reply: "系統錯誤：找不到 API 金鑰，請確認 Cloudflare 環境變數設定。" }), { headers: { "Content-Type": "application/json" } });
    }

    // 2. 定義大腦備用清單 (優先嘗試最新版本，若失敗自動往下找)
    const modelsToTry = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash"
    ];

    let lastErrorMessage = "";
    let successfulData = null;

    // 3. 開始依序嘗試連線
    for (const model of modelsToTry) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
      
      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }]
        })
      });

      const data = await geminiResponse.json();

      if (geminiResponse.ok) {
        // 成功連線，紀錄資料並立刻跳出迴圈
        successfulData = data;
        break; 
      } else {
        // 紀錄錯誤原因
        lastErrorMessage = data.error?.message || '未知錯誤';
        
        // 如果錯誤原因「不是」找不到模型 (例如金鑰無效)，那就沒必要繼續試了，直接報錯
        if (!lastErrorMessage.includes("not found") && !lastErrorMessage.includes("not supported")) {
            break; 
        }
        // 如果是找不到模型，迴圈會繼續自動嘗試清單中的下一個型號
      }
    }

    // 4. 判斷最終結果並回傳給前端
    if (successfulData) {
      return new Response(JSON.stringify({ 
        reply: successfulData.candidates[0].content.parts[0].text 
      }), { headers: { "Content-Type": "application/json" } });
    } else {
      // 如果所有模型都陣亡了
      return new Response(JSON.stringify({ 
        reply: `大腦連線失敗，備用模型均無法使用。Google 回應: ${lastErrorMessage}` 
      }), { headers: { "Content-Type": "application/json" } });
    }

  } catch (err) {
    // 捕捉所有意外崩潰
    return new Response(JSON.stringify({ 
        reply: `後端崩潰了，請檢查程式碼: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
