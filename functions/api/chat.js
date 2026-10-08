export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const userMessage = body.message;

    // 確認有沒有抓到金鑰
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ reply: "系統錯誤：找不到 API 金鑰，請確認 Cloudflare 環境變數設定。" }), { headers: { "Content-Type": "application/json" } });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userMessage }] }]
      })
    });

    const data = await geminiResponse.json();
    
    // 如果 Google 拒絕了 (例如金鑰錯誤)，回傳 Google 的錯誤訊息
    if (!geminiResponse.ok) {
        return new Response(JSON.stringify({ 
            reply: `大腦連線錯誤 (Google 回應): ${data.error?.message || '未知錯誤'}` 
        }), { headers: { "Content-Type": "application/json" } });
    }
    
    // 正常回傳小雅的回覆
    return new Response(JSON.stringify({ 
      reply: data.candidates[0].content.parts[0].text 
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    // 捕捉所有意外崩潰，網頁不再顯示 500 錯誤
    return new Response(JSON.stringify({ 
        reply: `後端崩潰了，請檢查程式碼: ${err.message}` 
    }), { headers: { "Content-Type": "application/json" } });
  }
}
