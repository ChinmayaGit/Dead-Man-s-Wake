import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  },
  plugins: [
    {
      name: 'debug-logger',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/__debug_log') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              console.log('\n🚨 [BROWSER DEBUG LOG]:', body);
              res.statusCode = 200;
              res.end('ok');
            });
            return;
          }
          if (req.url && !req.url.startsWith('/@') && !req.url.includes('node_modules')) {
            console.log('🌐 [REQ]:', req.method, req.url);
          }
          next();
        });
      }
    }
  ]
});
