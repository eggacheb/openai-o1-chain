import { useState } from 'react';
import Head from 'next/head';
import styles from '../styles/Home.module.css';

const parseResponse = (data) => {
  try {
    let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    
    // 处理包含 choices 数组的响应
    if (parsedData.choices && Array.isArray(parsedData.choices)) {
      parsedData = parsedData.choices[0].message.content;
    }

    // 如果是字符串，尝试解析为JSON
    if (typeof parsedData === 'string') {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (e) {
        // 如果不是有效的JSON，将其作为普通文本处理
        return [{
          title: "响应",
          content: parsedData,
          next_action: "final_answer"
        }];
      }
    }

    // 处理可能包含多个JSON对象的情况
    if (typeof parsedData === 'string' && parsedData.includes('```json')) {
      const jsonObjects = parsedData.match(/```json\n([\s\S]*?)\n```/g);
      if (jsonObjects) {
        return jsonObjects.map(obj => {
          const cleanJson = obj.replace(/```json\n|\n```/g, '');
          return JSON.parse(cleanJson);
        });
      }
    }

    // 处理单个对象的情况
    if (typeof parsedData === 'object') {
      // 如果对象有 step 和 explanation 键
      if ('step' in parsedData && 'explanation' in parsedData) {
        return [{
          title: `步骤 ${parsedData.step}`,
          content: parsedData.explanation,
          next_action: "continue"
        }];
      }
      
      // 如果对象已经符合我们期望的格式
      if ('title' in parsedData && 'content' in parsedData) {
        return [parsedData];
      }
    }

    // 如果是数组，假设每个元素都是一个步骤
    if (Array.isArray(parsedData)) {
      return parsedData.map((item, index) => ({
        title: item.title || `步骤 ${index + 1}`,
        content: item.content || JSON.stringify(item),
        next_action: item.next_action || "continue"
      }));
    }

    // 如果无法解析，返回错误信息
    console.error('无法解析的数据格式:', parsedData);
    return [{
      title: "解析错误",
      content: "无法解析响应数据: " + JSON.stringify(parsedData),
      next_action: "final_answer"
    }];
  } catch (error) {
    console.error('解析响应时出错:', error);
    return [{
      title: "解析错误",
      content: `解析响应时出错: ${error.message}`,
      next_action: "final_answer"
    }];
  }
};

export default function Home() {
  const [query, setQuery] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com');
  const [response, setResponse] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalTime, setTotalTime] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setResponse([]);
    setTotalTime(null);
    setError(null);

    const eventSource = new EventSource(`/api/generate?query=${encodeURIComponent(query)}&apiKey=${encodeURIComponent(apiKey)}&model=${encodeURIComponent(model)}&baseUrl=${encodeURIComponent(baseUrl.replace(/\/$/, ''))}`);

    eventSource.addEventListener('step', (event) => {
      try {
        const parsedSteps = parseResponse(event.data);
        setResponse(prevResponse => [...prevResponse, ...parsedSteps]);
      } catch (error) {
        console.error('处理步骤时出错:', error);
        setError(`处理响应时出错: ${error.message}`);
      }
    });

    eventSource.addEventListener('totalTime', (event) => {
      const data = JSON.parse(event.data);
      setTotalTime(data.time);
    });

    eventSource.addEventListener('error', (event) => {
      const data = JSON.parse(event.data);
      setError(data.message || '生成响应时发生错误');
      setIsLoading(false);
      eventSource.close();
    });

    eventSource.addEventListener('done', () => {
      setIsLoading(false);
      eventSource.close();
    });
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>OpenAI 高级推理链</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>
          OpenAI 高级推理链
        </h1>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="输入您的 OpenAI API 密钥"
            className={styles.input}
            required
          />
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="输入模型名称（如 gpt-4o）"
            className={styles.input}
            required
          />
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="输入 API 基础 URL"
            className={styles.input}
            required
          />
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入您的查询"
            className={styles.textarea}
            required
          />
          <button type="submit" disabled={isLoading} className={styles.button}>
            {isLoading ? '生成中...' : '生成'}
          </button>
        </form>

        {isLoading && <p className={styles.loading}>正在生成响应...</p>}

        {error && <p className={styles.error}>{error}</p>}

        {response.map((step, index) => (
          <div key={index} className={styles.step}>
            <h3>第 {index + 1} 步: {step.title}</h3>
            <p>{step.content}</p>
            {step.next_action === 'final_answer' && <p className={styles.finalAnswer}>这是最终答案</p>}
          </div>
        ))}

        {totalTime !== null && (
          <p className={styles.time}>总思考时间：{totalTime.toFixed(2)} 秒</p>
        )}
      </main>
    </div>
  );
}
