# Hosting Guide for Ping

## Quick Start (Most Hosting Platforms)

The app is ready to deploy to any Node.js hosting platform:
- ✅ Heroku
- ✅ Render
- ✅ Railway
- ✅ Fly.io
- ✅ AWS, GCP, Azure (any VM/container)
- ✅ DigitalOcean App Platform
- ✅ Vercel (Node.js functions)

## Environment Variables

Copy `.env.example` to `.env` in production and configure:

```bash
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### Required
- `NODE_ENV`: Set to `production` for production deployments

### Optional
- `PORT`: Server port (default: 3000)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins (default: all origins in dev, restricted in production)
- `MATCHMAKING_INTERVAL_MS`: Matchmaking check interval (default: 150ms)
- `START_CHAT_COOLDOWN_MS`: Cooldown between chat starts (default: 600ms)

## Platform-Specific Setup

### Heroku
```bash
heroku create your-app-name
git push heroku main
heroku logs --tail
```

### Render
1. Push code to GitHub
2. New → Web Service
3. Connect to repository
4. Set environment variables in dashboard
5. Deploy

### Railway
```bash
railway link
railway up
```

### Fly.io
```bash
flyctl launch
flyctl deploy
```

## Health Check & Monitoring

The app provides two endpoints for monitoring:

- `GET /health` - Returns server status and match stats
- `GET /api/stats` - Returns active users and total chats (for landing page)

Example health check response:
```json
{
  "status": "ok",
  "stats": {
    "activeUsers": 42,
    "queueSize": 5,
    "activeRooms": 20,
    "averageMatchmakingTime": 2500,
    "totalMatches": 1200
  },
  "timestamp": 1234567890000
}
```

## Production Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure `ALLOWED_ORIGINS` to restrict CORS
- [ ] Set up SSL/TLS (HTTPS)
- [ ] Configure logging/monitoring
- [ ] Set up health check endpoint
- [ ] Test websocket connectivity
- [ ] Verify geolocation is working
- [ ] Load test with multiple users

## Troubleshooting

### WebSocket Connection Issues
- Check CORS configuration
- Verify SSL certificates (if using HTTPS)
- Ensure WebSocket support is enabled (most platforms support it)
- Check firewall/security groups allow WebSocket traffic

### Geolocation Not Working
- Verify geoip-lite module is installed
- Check IP headers are being forwarded correctly
- In local/private networks, geolocation will return "Local" or "Nearby"

### Port Already in Use
- Use `PORT` environment variable to change port
- Or kill existing process on that port

### High Memory Usage
- Monitor with platform's metrics
- Matchmaking interval controls CPU load
- Message history is capped at 200 per friend room
- Inactive users are cleaned up automatically

## Performance Tips

1. **Reduce matchmaking check frequency** if CPU is high:
   ```
   MATCHMAKING_INTERVAL_MS=500
   ```

2. **Use CDN** for static assets (app.js, styles.css, etc.)

3. **Enable compression** at reverse proxy level (gzip)

4. **Monitor active connections** via `/health` endpoint

5. **Set reasonable heartbeat timeouts** for your use case

## Scaling

The app uses in-memory storage for:
- Active users
- Rooms and chat sessions
- Friend requests and friendships
- Friend DM rooms and messages

For multi-instance scaling:
- Each instance maintains its own data
- Users may be split across instances
- Matchmaking works only within instance

For true multi-instance (load-balanced):
- Implement Redis for shared state
- Share friend data, matchmaking queue, etc.
- Implement session store for persistency

## SSL/HTTPS

Always use HTTPS in production. Most platforms handle this automatically (Heroku, Render, Railway, Fly.io).

If manually configuring:
1. Obtain certificate (Let's Encrypt)
2. Configure reverse proxy (nginx)
3. Redirect HTTP to HTTPS
4. Test with: `curl -i https://yourdomain.com/health`

## Database (Optional Future)

Currently data is in-memory. To persist friendships across restarts:

```javascript
// Could be extended to use:
// - MongoDB for friendships
// - PostgreSQL for user data
// - Redis for sessions/cache
```

No persistence is currently implemented (data resets on restart).

## Support

For issues with specific platforms, check:
- Platform's documentation for Node.js apps
- Socket.io deployment guides: https://socket.io/docs/v4/deployment-guides/
- Verify all environment variables are set correctly
- Check application logs: `heroku logs --tail`, `railway logs`, etc.
