const { openaiCompatProvider } = require('./openaiCompat');

module.exports = openaiCompatProvider({
  name: 'cerebras',
  url: 'https://api.cerebras.ai/v1/chat/completions',
  modelEnv: 'CEREBRAS_MODEL',
  defaultModel: 'gpt-oss-120b',
});
