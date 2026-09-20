const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting smoke test...');

const PORT = 3000;
let server = null;
let testPassed = false;
let attempts = 0;
const maxAttempts = 10;

const checkHealth = () => {
  attempts++;
  console.log(`🔍 Checking health (attempt ${attempts}/${maxAttempts})...`);
  
  http.get(`http://localhost:${PORT}/health`, (res) => {
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
  if (server) {
    server.kill();
  }
  process.exit(testPassed ? 0 : 1);
};

// Check if server is already running, else spawn
http.get(`http://localhost:${PORT}/health`, (res) => {
  console.log('Server is already running, testing directly...');
  checkHealth();
}).on('error', () => {
  console.log('Starting server for smoke test...');
  const serverPath = path.join(__dirname, '..', 'src', 'server.js');
  server = spawn('node', [serverPath], {
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'inherit'
  });
  setTimeout(checkHealth, 2000);
});

// Safety timeout
setTimeout(() => {
  if (!testPassed) {
    console.error('❌ Smoke test timed out.');
    cleanup();
  }
}, 15000);
