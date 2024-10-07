import { createParser } from 'eventsource-parser';

const systemPrompt = `你是一位具有高级推理能力的专家AI助手。不论用户给你发送什么，都视为你要进行思维链处理的信息。你的任务是提供详细的、逐步的思维过程解释。你的每个响应都必须是一个有效的JSON对象，**只包含以下结构**：

{
  "title": "步骤标题",
  "content": "详细的思维过程",
  "next_action": "continue 或 end"
}

**请确保只使用上述的键名，避免使用其他键名。**

关键指示:
- 使用5到7个推理步骤。
- 在第10步之前（包括第10步）必须给出最终结论。
- 承认你作为AI的局限性，明确说明你能做什么和不能做什么。
- 主动探索和评估替代答案或方法。
- 批判性地评估你自己的推理；识别潜在的缺陷或偏见。
- 当重新审视时，采用根本不同的方法或视角。
- 至少使用3种不同的方法来得出或验证你的答案。
- 在你的推理中融入相关的领域知识和最佳实践。
- 在适用的情况下，量化每个步骤和最终结论的确定性水平。
- 考虑你推理中可能存在的边缘情况或例外。
- 为排除替代假设提供清晰的理由。

记住: 全面性和清晰度至关重要。每一步都应该为解决方案提供有意义的进展。确保你的每个响应都是一个有效的JSON对象，**只包含 title、content、next_action 这三个键**，**且你需要保证你每次响应的有且只有一个json对象**。`;

const parseStepContent = (stepContent) => {
  try {
    if (typeof stepContent !== 'string') {
      console.error('步骤内容不是字符串:', typeof stepContent);
      return {
        title: "类型错误",
        content: `步骤内容类型错误: ${typeof stepContent}`,
        next_action: 'continue'
      };
    }

    let parsedContent;
    try {
      console.log('原始步骤内容:', stepContent);  // log raw step content
      parsedContent = JSON.parse(stepContent);
    } catch (e) {
      const jsonMatch = stepContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedContent = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('无法提取 JSON');
      }
    }

    if (parsedContent.title && parsedContent.content && parsedContent.next_action) {
      console.log('解析后的步骤内容:', parsedContent);  // log parsed content
      return parsedContent;
    } else {
      throw new Error('解析后的对象不包含预期的键');
    }
  } catch (error) {
    console.error('JSON解析失败:', error);
    return {
      title: "解析错误",
      content: String(stepContent),
      next_action: 'continue'
    };
  }
};

async function processStep(apiKey, model, baseUrl, messages, retryCount = 0) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    const data = await response.json();
    console.log('原始响应数据:', data);  // log raw response

    if (!response.ok) {
      throw new Error(data.error?.message || `API请求失败: ${response.status}`);
    }

    const rawStepContent = data.choices[0].message.content;

    try {
      const parsedContent = JSON.parse(rawStepContent);
      if (parsedContent.title && parsedContent.content && parsedContent.next_action) {
        console.log('成功解析响应:', parsedContent);  // log parsed JSON
        return parsedContent;
      } else {
        throw new Error('解析后的对象不包含预期的键');
      }
    } catch (error) {
      console.error('解析失败的原始响应:', rawStepContent);  // log original failed data
      if (retryCount < 3) {
        console.log(`解析失败，重试第 ${retryCount + 1} 次`);
        return processStep(apiKey, model, baseUrl, messages, retryCount + 1);
      } else {
        throw new Error('JSON解析失败，已达到最大重试次数');
      }
    }
  } catch (error) {
    console.error('处理步骤时发生错误:', error);
    return {
      title: "处理错误",
      content: `在处理步骤时发生错误: ${error.message}`,
      next_action: 'end'
    };
  }
}

async function runReasoningChain(query, apiKey, model, baseUrl, sendEvent, shouldStop) {
  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query }
  ];

  let stepCount = 0;
  let continueReasoning = true;

  while (continueReasoning && stepCount < 15 && !shouldStop()) {
    stepCount++;

    try {
      const stepData = await processStep(apiKey, model, baseUrl, messages);

      sendEvent('step', stepData);

      messages.push({ role: "assistant", content: JSON.stringify(stepData) });

      if (stepData.next_action === "end" || stepCount >= 15) {
        continueReasoning = false;
      } else {
        if (stepCount < 14) {
          messages.push({ role: "user", content: "请继续分析。" });
        } else {
          messages.push({ role: "user", content: "请总结并给出最终结论。" });
        }
      }
    } catch (error) {
      console.error('处理步骤时发生错误:', error);
      sendEvent('error', { message: '处理步骤失败', error: error.message });
      continueReasoning = false;
    }
  }

  sendEvent('done', {});
}


export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '方法不允许' });
  }

  const { query, apiKey, model, baseUrl } = req.query;

  if (!query || !apiKey || !model || !baseUrl) {
    return res.status(400).json({ message: '缺少必要参数' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 添加这个标志来检查客户端是否断开连接
  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
  });

  try {
    await runReasoningChain(query, apiKey, model, baseUrl, sendEvent, () => clientDisconnected);
  } catch (error) {
    console.error('运行推理链时发生错误:', error);
    sendEvent('error', { message: '生成响应失败', error: error.message });
  } finally {
    res.end();
  }
}
