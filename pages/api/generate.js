import { createParser } from 'eventsource-parser';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '方法不允许' });
  }

  const { query, apiKey, model, baseUrl } = req.query;

  if (!apiKey || !model || !baseUrl) {
    return res.status(400).json({ message: '缺少必要参数' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  });

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, content: data })}\n\n`);
  };

  let totalTime = 0;

  try {
    const systemPrompt = `你是一位专家级AI助手，用中文一步步解释你的推理过程。对于每一步：
1. 提供一个标题，描述你在这一步要做什么。
2. 解释这一步的推理或分析过程。
3. 决定是否需要另一步，或是否准备好给出最终答案。
4. 将你的回复格式化为一个JSON对象，包含"title"、"content"和"next_action"键。"next_action"应该是"continue"或"final_answer"。

在给出最终答案之前，至少使用3个步骤。要意识到你作为AI的局限性，明白你能做什么和不能做什么。在你的推理中，包括对替代答案的探索。考虑到你可能会出错，如果出错，你的推理可能在哪里有缺陷。充分测试所有其他可能性。当你说你要重新审视时，实际上要用不同的方法重新审视。在你的分析中使用最佳实践。`;

    let messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ];

    const startTime = Date.now();
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: false,
      }),
    });

    const data = await response.json();
    const endTime = Date.now();
    totalTime += (endTime - startTime) / 1000;

    if (!response.ok) {
      throw new Error(data.error?.message || 'API request failed');
    }

    const fullContent = data.choices[0].message.content;

    // 提取所有有效的 JSON 对象
    const jsonObjects = fullContent.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g) || [];
    
    let steps = [];
    for (let jsonStr of jsonObjects) {
      try {
        const step = JSON.parse(jsonStr);
        steps.push(step);
        sendEvent('step', step);
      } catch (error) {
        console.error('Failed to parse JSON object:', jsonStr);
      }
    }

    if (steps.length === 0) {
      // 如果没有有效的 JSON 对象，发送整个内容作为一个步骤
      const fallbackStep = {
        title: "回答",
        content: fullContent,
        next_action: "final_answer"
      };
      steps.push(fallbackStep);
      sendEvent('step', fallbackStep);
    }

    // 将所有步骤作为一个字符串添加到消息中
    messages.push({ role: "assistant", content: JSON.stringify(steps) });

    sendEvent('totalTime', totalTime);
    sendEvent('DONE', {});
  } catch (error) {
    console.error('Error:', error);
    sendEvent('error', { message: '生成响应失败', error: error.message });
  } finally {
    res.end();
  }
}
