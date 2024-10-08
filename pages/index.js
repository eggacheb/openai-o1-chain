import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import styles from '../styles/Home.module.css';

const parseResponse = (data) => {
  try {
    let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

    if (parsedData.choices && Array.isArray(parsedData.choices)) {
      parsedData = parsedData.choices[0].message.content;
    }

    if (typeof parsedData === 'string') {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (e) {
        console.log("原始响应 (解析失败，未解析的字符串):", parsedData);
        return [{
          title: "响应",
          content: parsedData,
          next_action: "final_answer"
        }];
      }
    }

    if (typeof parsedData === 'object') {
      if ('title' in parsedData && 'content' in parsedData) {
        console.log("解析后的响应:", parsedData);
        return [parsedData];
      }
    }

    if (Array.isArray(parsedData)) {
      console.log("解析后的响应数组:", parsedData);
      return parsedData.map((item, index) => ({
        title: item.title || `步骤 ${index + 1}`,
        content: item.content || JSON.stringify(item),
        next_action: item.next_action || "continue"
      }));
    }

    console.error('无法解析的数据格式:', parsedData);
    return [{
      title: "解析错误",
      content: "无法解析响应数据: " + JSON.stringify(parsedData),
      next_action: "final_answer"
    }];
  } catch (error) {
    console.error('解析响应时出错:', error);
    console.log("解析失败的原始响应数据:", data);
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
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [response, setResponse] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalTime, setTotalTime] = useState(null);
  const [error, setError] = useState(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    // 从 localStorage 读取保存的值，只在第一次加载时填充
    const savedApiKey = localStorage.getItem('apiKey');
    const savedModel = localStorage.getItem('model');
    const savedBaseUrl = localStorage.getItem('baseUrl');

    if (savedApiKey) setApiKey(savedApiKey);
    if (savedModel) setModel(savedModel);
    if (savedBaseUrl) setBaseUrl(savedBaseUrl);
  }, []);  // 空依赖项，确保仅在页面加载时运行一次

  useEffect(() => {
    const saveToLocalStorage = () => {
      console.log("保存 key 到 localStorage:", apiKey);
      console.log("保存模型到 localStorage:", model);
      console.log("保存 baseUrl 到 localStorage:", baseUrl);
      localStorage.setItem('apiKey', apiKey);
      localStorage.setItem('model', model);
      localStorage.setItem('baseUrl', baseUrl);
    };

    window.addEventListener('beforeunload', saveToLocalStorage);

    return () => {
      window.removeEventListener('beforeunload', saveToLocalStorage);
    };
  }, [apiKey, model, baseUrl]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setResponse([]);
    setTotalTime(null);
    setError(null);

    console.log("发送请求 - API Key:", apiKey);
    console.log("发送请求 - 模型:", model);
    console.log("发送请求 - 基础URL:", baseUrl);
    console.log("发送请求 - 查询内容:", query);
  // 添加一个状态来跟踪当前步骤
  let currentStep = 0;

  eventSourceRef.current = new EventSource(`/api/generate?query=${encodeURIComponent(query)}&apiKey=${encodeURIComponent(apiKey)}&model=${encodeURIComponent(model)}&baseUrl=${encodeURIComponent(baseUrl.replace(/\/$/, ''))}&stepCount=${currentStep}`);

  eventSourceRef.current.addEventListener('step', (event) => {
    try {
      console.log("收到步骤响应:", event.data);
      const parsedStep = parseResponse(event.data)[0];
      setResponse(prevResponse => [...prevResponse, parsedStep]);
      // 更新当前步骤
      currentStep++;
      // 在URL中更新stepCount
      eventSourceRef.current.url = eventSourceRef.current.url.replace(/stepCount=\d+/, `stepCount=${currentStep}`);
    } catch (error) {
      console.error('处理步骤时出错:', error);
      setError(`处理响应时出错: ${error.message}`);
    }
  });
    
    eventSourceRef.current.addEventListener('error', (event) => {
      const data = JSON.parse(event.data);
      console.error("生成响应时发生错误:", data);
      setError(data.message || '生成响应时发生错误');
      setIsLoading(false);
      eventSourceRef.current.close();
    });

    eventSourceRef.current.addEventListener('done', () => {
      console.log("生成响应已完成");
      setIsLoading(false);
      eventSourceRef.current.close();
    });
  };

  const handleStop = () => {
    if (eventSourceRef.current) {
      console.log("生成已停止");
      eventSourceRef.current.close();
      setIsLoading(false);
    }
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
            onChange={(e) => setApiKey(e.target.value)}  // 允许用户更新 apiKey
            placeholder="输入您的 OpenAI API 密钥"
            className={styles.input}
            required
          />
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}  // 允许用户更新模型
            placeholder="输入模型名称（如 gpt-4）"
            className={styles.input}
            required
          />
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}  // 允许用户更新 base URL
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
          <div className={styles.buttonGroup}>
            <button type="submit" disabled={isLoading} className={styles.button}>
              {isLoading ? '生成中...' : '生成'}
            </button>
            <button type="button" onClick={handleStop} disabled={!isLoading} className={styles.stopButton}>
              停止生成
            </button>
          </div>
        </form>

        {isLoading && <p className={styles.loading}>正在生成响应...</p>}
        {error && <p className={styles.error}>{error}</p>}

        {response.map((step, index) => (
          <div key={index} className={styles.step}>
            <h3>第 {index + 1} 步: {String(step.title)}</h3>
            <p>{String(step.content)}</p>
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
