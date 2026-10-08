export async function onRequestPost(context) {
  // 從前端接收使用者的訊息
  const { request, env } = context;
  const body = await request.json();
  const userMessage = body.message;

  // 這裡呼叫真正的 Gemini API，並帶入隱藏的金鑰 (env.GEMINI_API_KEY)
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  
  const geminiResponse = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userMessage }] }]
    })
  });

  const data = await geminiResponse.json();
  
  // 將 Gemini 的回覆傳回給前端
  return new Response(JSON.stringify({ 
    reply: data.candidates[0].content.parts[0].text 
  }), {
    headers: { "Content-Type": "application/json" }
  });
}