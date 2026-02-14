#!/usr/bin/env node

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';
const FALLBACK_MODELS = ['qwen2.5:1.5b', 'qwen2.5:3b', 'llama3.1:8b'];

async function pullModelIfMissing() {
  console.log(`Model not found. Pulling ${OLLAMA_MODEL}...`);

  const pullResponse = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: OLLAMA_MODEL,
      stream: false,
    }),
  });

  if (!pullResponse.ok) {
    const errText = await pullResponse.text();
    throw new Error(`Failed to pull model ${OLLAMA_MODEL}: ${errText}`);
  }

  console.log(`Model ${OLLAMA_MODEL} pulled successfully.`);
}

async function runChat(model) {
  const prompt = 'Give a quick trading analysis for AAPL today. Keep it short: trend, key risk, and one conservative action.';
  console.log(`prompting ollama with ${model} (streaming)`);

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: true,
      options: {
        temperature: 0.2,
        num_predict: 96,
      },
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama HTTP ${response.status}: ${errText}`);
  }

  if (!response.body) {
    throw new Error('Ollama response stream is empty');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      const token = data?.message?.content || '';
      if (token) {
        process.stdout.write(token);
        fullText += token;
      }
    }
  }

  if (buffer.trim()) {
    const data = JSON.parse(buffer);
    const token = data?.message?.content || '';
    if (token) {
      process.stdout.write(token);
      fullText += token;
    }
  }

  process.stdout.write('\n');
  return fullText || '(No response text received)';
}

async function main() {
  try {
    let content = '';
    let usedModel = OLLAMA_MODEL;

    try {
      content = await runChat(OLLAMA_MODEL);
    } catch (error) {
      const errorMessage = String(error && error.message ? error.message : error);
      if (errorMessage.includes('model') && errorMessage.includes('not found')) {
        await pullModelIfMissing();
        content = await runChat(OLLAMA_MODEL);
      } else {
        for (const fallbackModel of FALLBACK_MODELS) {
          if (fallbackModel === OLLAMA_MODEL) continue;
          try {
            usedModel = fallbackModel;
            content = await runChat(fallbackModel);
            break;
          } catch {
            content = '';
          }
        }
        if (!content) {
          throw error;
        }
      }
    }

    console.log('Model:', usedModel);
    console.log('Ollama URL:', OLLAMA_BASE_URL);
    console.log('--- Done ---');
  } catch (error) {
    console.error('Failed to query Ollama:', error.message || error);
    process.exit(1);
  }
}

main();
