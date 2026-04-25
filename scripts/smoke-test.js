const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting smoke test...');

const serverPath = path.join(__dirname, '..', 'src', 'server.js');
const server = spawn('node', [serverPath], {
  env: { ...process.env, PORT: 3001, NODE_ENV: 'test' },
  stdio: 'inherit'
});

let testPassed = false;
let attempts = 0;
const maxAttempts = 10;

const checkHealth = () => {
  attempts++;
  console.log(`🔍 Checking health (attempt ${attempts}/${maxAttempts})...`);
  
  http.get('http://localhost:3001/health', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.status === 'ok') {
          console.log('✅ Health check passed!');
          testPassed = true;
          cleanup();
        } else {
          retry();
        }
      } catch (e) {
        retry();
      }
    });
  }).on('error', (err) => {
    retry();
  });
};

const retry = () => {
  if (attempts < maxAttempts) {
    setTimeout(checkHealth, 1000);
  } else {
    console.error('❌ Smoke test failed: Max attempts reached.');
    cleanup();
  }
};

const cleanup = () => {
  console.log('🧹 Cleaning up...');
  server.kill();
  process.exit(testPassed ? 0 : 1);
};

// Start checking after a short delay
setTimeout(checkHealth, 2000);

// Safety timeout
setTimeout(() => {
  if (!testPassed) {
    console.error('❌ Smoke test timed out.');
    cleanup();
  }
}, 15000);
